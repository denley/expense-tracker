import { describe, expect, it, vi } from "vitest";
import { FileSync } from "./sync";
import { ApiError, type FileState, type PutResult } from "./api";

/** A fake server holding one file whose content is a comma-separated list */
function fakeServer(initial: string) {
  let state: FileState = { text: initial, rev: "r0" };
  let n = 0;
  return {
    get state() {
      return state;
    },
    /** Someone else writes */
    external(text: string) {
      state = { text, rev: `r${++n}` };
    },
    put: vi.fn(async (_name: string, text: string, rev: string): Promise<PutResult> => {
      if (rev !== state.rev) return { ok: false, current: state };
      state = { text, rev: `r${++n}` };
      return { ok: true, rev: state.rev };
    }),
    fetch: vi.fn(async () => state),
  };
}

const parse = (t: string) => (t ? t.split(",") : []);
const serialize = (d: string[]) => d.join(",");

function make(server: ReturnType<typeof fakeServer>, onError = vi.fn()) {
  const views: string[][] = [];
  const sync = new FileSync<string[]>({
    name: "rules.csv",
    parse,
    serialize,
    put: server.put,
    fetch: server.fetch,
    onView: (v) => views.push(v),
    onStatus: () => {},
    onError,
  });
  sync.load(server.state);
  return { sync, views, onError };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("FileSync", () => {
  it("writes edits against the confirmed revision", async () => {
    const server = fakeServer("a");
    const { sync } = make(server);
    sync.mutate((d) => [...d, "b"]);
    expect(sync.view).toEqual(["a", "b"]);
    await settle();
    expect(server.state.text).toBe("a,b");
    expect(sync.rev).toBe(server.state.rev);
    expect(sync.hasPending).toBe(false);
  });

  it("replays queued edits onto someone else's newer copy instead of clobbering it", async () => {
    const server = fakeServer("a");
    const { sync } = make(server);
    server.external("a,x"); // e.g. an agent added "x"
    sync.mutate((d) => [...d, "b"]);
    await settle();
    await settle();
    expect(server.state.text).toBe("a,x,b");
    expect(sync.view).toEqual(["a", "x", "b"]);
    expect(server.put).toHaveBeenCalledTimes(2);
  });

  it("keeps edits made while a write is in flight", async () => {
    const server = fakeServer("a");
    const { sync } = make(server);
    sync.mutate((d) => [...d, "b"]);
    sync.mutate((d) => [...d, "c"]);
    await settle();
    await settle();
    expect(server.state.text).toBe("a,b,c");
  });

  it("refetches on a remote change, but not for its own write", async () => {
    const server = fakeServer("a");
    const { sync } = make(server);
    sync.mutate((d) => [...d, "b"]);
    await settle();
    sync.remoteChanged(server.state.rev);
    expect(server.fetch).not.toHaveBeenCalled();
    server.external("a,b,z");
    sync.remoteChanged(server.state.rev);
    await settle();
    expect(sync.view).toEqual(["a", "b", "z"]);
  });

  it("drops edits the server rejects as invalid and resyncs", async () => {
    const server = fakeServer("a");
    server.put.mockImplementationOnce(async () => {
      throw new ApiError("bad content", 400);
    });
    const { sync, onError } = make(server);
    sync.mutate((d) => [...d, "bad"]);
    await settle();
    await settle();
    expect(onError).toHaveBeenCalled();
    expect(sync.view).toEqual(["a"]);
    expect(sync.hasPending).toBe(false);
  });

  it("keeps edits through a network failure and retries", async () => {
    vi.useFakeTimers();
    const server = fakeServer("a");
    server.put.mockImplementationOnce(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { sync } = make(server);
    sync.mutate((d) => [...d, "b"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.offline).toBe(true);
    expect(sync.view).toEqual(["a", "b"]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(server.state.text).toBe("a,b");
    expect(sync.offline).toBe(false);
    vi.useRealTimers();
  });

  it("ignores an unparseable remote copy and keeps the last good one", () => {
    const server = fakeServer("a");
    const onError = vi.fn();
    const sync = new FileSync<string[]>({
      name: "transactions.csv",
      parse: (t) => {
        if (t === "broken") throw new Error("unreadable");
        return parse(t);
      },
      serialize,
      put: server.put,
      fetch: server.fetch,
      onView: () => {},
      onStatus: () => {},
      onError,
    });
    sync.load(server.state);
    sync.load({ text: "broken", rev: "r9" });
    expect(sync.view).toEqual(["a"]);
    expect(onError).toHaveBeenCalledWith("unreadable");
  });
});
