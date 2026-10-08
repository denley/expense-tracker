/*
  One data file kept in sync with the server.

  - `confirmed` is the last copy known to be on the server (with its rev).
  - Every local edit is a replayable updater (id-based, never index-based),
    queued in `pending`. The local view = pending applied to confirmed.
  - One write in flight per file: PUT the view's text against confirmed.rev.
    On 409 (someone else — another tab, a person, an agent — wrote first)
    take the server's copy as the new base and replay the queue onto it, so
    neither side's change is lost.
  - Network failures keep the queue and retry with backoff.
*/
import type { FileState, PutResult } from "./api";
import { ApiError } from "./api";
import type { WsFileName } from "./files";

export type Updater<T> = (prev: T) => T;

export interface FileSyncOptions<T> {
  name: WsFileName;
  parse: (text: string) => T;
  serialize: (data: T) => string;
  put: (name: WsFileName, text: string, rev: string) => Promise<PutResult>;
  fetch: (name: WsFileName) => Promise<FileState>;
  /** The local view changed (load, edit, remote change, replay) */
  onView: (data: T) => void;
  /** Saving state changed: pending edits exist / a retry is scheduled */
  onStatus: () => void;
  onError: (message: string) => void;
}

const MAX_CONFLICT_RETRIES = 8;

export class FileSync<T> {
  private confirmed: { data: T; rev: string } | null = null;
  private pending: Updater<T>[] = [];
  private _view: T | null = null;
  private inFlight = false;
  /** A remote rev we were told about while a write was in flight */
  private remoteRev: string | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 1000;
  offline = false;

  constructor(private readonly opts: FileSyncOptions<T>) {}

  get loaded(): boolean {
    return this.confirmed !== null;
  }

  get view(): T {
    if (this._view === null) throw new Error(`${this.opts.name} not loaded`);
    return this._view;
  }

  get rev(): string | null {
    return this.confirmed?.rev ?? null;
  }

  get hasPending(): boolean {
    return this.pending.length > 0;
  }

  /** Take a copy from the server as the base (initial load or remote change) */
  load(state: FileState): void {
    let data: T;
    try {
      data = this.opts.parse(state.text);
    } catch (e) {
      // Unparseable on the server (e.g. a broken hand edit): keep what we have
      if (!this.confirmed) throw e;
      this.opts.onError(e instanceof Error ? e.message : `${this.opts.name} couldn't be read`);
      return;
    }
    this.confirmed = { data, rev: state.rev };
    this.recompute();
  }

  /** Take the server's copy and discard queued edits (after a restore) */
  replace(state: FileState): void {
    this.pending = [];
    this.load(state);
    this.opts.onStatus();
  }

  mutate(updater: Updater<T>): void {
    if (!this.confirmed) throw new Error(`${this.opts.name} not loaded`);
    this.pending.push(updater);
    this._view = updater(this.view);
    this.opts.onView(this._view);
    this.opts.onStatus();
    void this.flush();
  }

  /** The server says the file is now at `rev` */
  remoteChanged(rev: string): void {
    if (!this.confirmed || rev === this.confirmed.rev) return;
    if (this.inFlight || this.pending.length > 0) {
      // the in-flight write (or the next one) will 409 and pick it up, or it
      // was our own write and confirmed.rev will match once it returns
      this.remoteRev = rev;
      return;
    }
    void this.refetch();
  }

  /** Re-read from the server unless edits are queued (used after reconnects) */
  async refetch(): Promise<void> {
    try {
      const state = await this.opts.fetch(this.opts.name);
      if (this.inFlight || this.pending.length > 0) {
        this.remoteRev = state.rev;
        return;
      }
      if (state.rev !== this.confirmed?.rev) this.load(state);
    } catch (e) {
      console.error(`Refetch of ${this.opts.name} failed`, e);
    }
  }

  private recompute(): void {
    if (!this.confirmed) return;
    this._view = this.pending.reduce((acc, fn) => fn(acc), this.confirmed.data);
    this.opts.onView(this._view);
  }

  private async flush(): Promise<void> {
    if (this.inFlight || !this.confirmed) return;
    this.inFlight = true;
    let conflicts = 0;
    try {
      while (this.pending.length > 0) {
        const count = this.pending.length;
        const sent = this.view;
        let result: PutResult;
        try {
          result = await this.opts.put(this.opts.name, this.opts.serialize(sent), this.confirmed.rev);
        } catch (e) {
          if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
            // The server rejected the content itself: drop the queue and resync
            this.pending = [];
            this.opts.onError(`Couldn't save ${this.opts.name}: ${e.message}`);
            this.recompute();
            void this.refetch();
            return;
          }
          this.scheduleRetry();
          return;
        }
        this.offline = false;
        this.retryDelay = 1000;
        if (result.ok) {
          this.confirmed = { data: sent, rev: result.rev };
          this.pending = this.pending.slice(count);
        } else {
          if (++conflicts > MAX_CONFLICT_RETRIES) {
            this.pending = [];
            this.load(result.current);
            this.opts.onError(`${this.opts.name} kept changing on the server — your last edit was dropped`);
            return;
          }
          this.load(result.current);
        }
      }
    } finally {
      this.inFlight = false;
      this.opts.onStatus();
    }
    if (this.remoteRev && this.remoteRev !== this.confirmed?.rev) {
      this.remoteRev = null;
      void this.refetch();
    }
    this.remoteRev = null;
  }

  private scheduleRetry(): void {
    this.offline = true;
    this.opts.onStatus();
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
  }

  /** Retry right away (e.g. the live connection came back) */
  retryNow(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.retryDelay = 1000;
    if (this.pending.length > 0) void this.flush();
  }
}
