import { describe, expect, it } from "vitest";
import { parseSnapshotName, snapshotsToPrune } from "./backups";

describe("snapshot names", () => {
  it("parse with hyphenated reasons and collision counters", () => {
    expect(parseSnapshotName("2026-10-08T153012-pre-restore")).toMatchObject({ reason: "pre-restore", at: "2026-10-08T15:30:12" });
    expect(parseSnapshotName("2026-10-08T153012-2-daily")).toMatchObject({ reason: "daily" });
    expect(parseSnapshotName("notes.txt")).toBeNull();
  });
});

describe("retention", () => {
  const now = new Date(2026, 9, 8, 12, 0, 0);
  it("keeps the last 30 days and the newest snapshot of each older month", () => {
    const names = [
      "2026-10-01T090000-daily",
      "2026-09-20T090000-daily", // within 30 days
      "2026-08-30T090000-daily", // older: newest of August, kept
      "2026-08-02T090000-daily", // older, not newest of August
      "2026-08-02T100000-pre-import",
      "2025-12-31T235959-daily", // newest of Dec 2025
    ];
    expect(snapshotsToPrune(names, now).sort()).toEqual(["2026-08-02T090000-daily", "2026-08-02T100000-pre-import"]);
  });
  it("ignores unrelated entries", () => {
    expect(snapshotsToPrune(["README", "2020-01-01T000000-daily"], now)).toEqual([]);
  });
});
