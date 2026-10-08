/*
  Client for the server API (served from the same origin, under the app's
  base path). The server is the only writer of the data folder; see
  server/main.ts for the routes.
*/
import type { WsFileName } from "./files";

const API = `${(import.meta.env.BASE_URL || "/").replace(/\/$/, "")}/api`;

export interface FileState {
  text: string;
  rev: string;
}

export interface Actor {
  login: string;
  name: string;
  /** "tailnet" (a person via Tailscale), "local" (agent/script on the server) or "system" */
  kind: "tailnet" | "local" | "system";
}

export interface ActivityEntry {
  id: string;
  at: string;
  /** Last time a coalesced run of edits was extended */
  until?: string;
  actor: Actor;
  /** app = edits made in the app, api = agent operations, external = direct file edits */
  source: "app" | "api" | "external" | "system";
  files: string[];
  summary: string;
  examples: string[];
  canUndo?: boolean;
  undoneAt?: string;
  undoneBy?: string;
}

export interface BackupInfo {
  name: string;
  /** Local wall time of the server, yyyy-mm-ddThh:mm:ss */
  at: string;
  reason: string;
}

export interface WorkspaceResponse {
  files: Record<WsFileName, FileState>;
  me: Actor;
  version: string;
  dataDir: string;
}

export interface ChangeEvent {
  files: Partial<Record<WsFileName, string>>;
  entry?: ActivityEntry;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // not JSON
    }
    throw new ApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const getWorkspace = () => request<WorkspaceResponse>("/workspace");

export const getFile = (name: WsFileName) => request<FileState>(`/files/${name}?format=json`);

export type PutResult = { ok: true; rev: string } | { ok: false; current: FileState };

/** gzip big bodies: a whole transactions.csv per edit adds up on mobile data */
async function maybeGzip(text: string): Promise<{ body: BodyInit; headers: Record<string, string> }> {
  if (text.length < 16_384 || typeof CompressionStream === "undefined") return { body: text, headers: {} };
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return { body: await new Response(stream).blob(), headers: { "Content-Encoding": "gzip" } };
}

/** Write a whole file, based on revision `rev`. A 409 returns the server's current copy. */
export async function putFile(name: WsFileName, text: string, rev: string): Promise<PutResult> {
  const { body, headers } = await maybeGzip(text);
  const res = await fetch(`${API}/files/${name}`, {
    method: "PUT",
    headers: { "Content-Type": "text/plain; charset=utf-8", "If-Match": rev, ...headers },
    body,
  });
  if (res.status === 409) return { ok: false, current: (await res.json()) as FileState };
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      message = (await res.json())?.error ?? message;
    } catch {
      // not JSON
    }
    throw new ApiError(message, res.status);
  }
  return { ok: true, rev: ((await res.json()) as { rev: string }).rev };
}

/** Replace every data file at once (restore / first-time upload). Snapshots first. */
export const replaceWorkspace = (files: Partial<Record<WsFileName, string>>, reason: string) =>
  request<{ revs: Record<string, string> }>("/workspace", { ...json({ files, reason }), method: "PUT" });

export const listBackups = () => request<{ backups: BackupInfo[] }>("/backups");
export const createBackup = () => request<{ backup: BackupInfo }>("/backups", json({}));
export const restoreBackup = (name: string) =>
  request<{ ok: true }>(`/backups/${encodeURIComponent(name)}/restore`, json({}));

export const listActivity = (limit = 100) =>
  request<{ entries: ActivityEntry[] }>(`/activity?limit=${limit}`);
export const undoActivity = (id: string) =>
  request<{ summary: string }>(`/activity/${encodeURIComponent(id)}/undo`, json({}));

/**
 * Live change feed. EventSource reconnects by itself; `onOpen` fires on every
 * (re)connect so the caller can resync anything missed while disconnected.
 */
export function subscribeChanges(
  onChange: (ev: ChangeEvent) => void,
  onOpen: () => void,
  onDown: () => void
): () => void {
  const es = new EventSource(`${API}/events`);
  es.addEventListener("change", (e) => onChange(JSON.parse((e as MessageEvent).data)));
  es.addEventListener("open", onOpen);
  es.addEventListener("error", onDown);
  return () => es.close();
}
