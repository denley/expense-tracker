import { describe, expect, it } from "vitest";
import { buildTree, frequentCategories, searchCategories, UNCATEGORIZED_ID } from "./tree";
import type { CategoryNode } from "./types";

const nodes: CategoryNode[] = [
  { id: "food", parentId: null, name: "Food" },
  { id: "groceries", parentId: "food", name: "Groceries" },
  { id: "eating-out", parentId: "food", name: "Eating out" },
  { id: "home", parentId: null, name: "Home" },
  { id: "garden", parentId: "home", name: "Garden" },
  { id: "old", parentId: null, name: "Old stuff", archived: true },
  { id: "old-food", parentId: "old", name: "Food court" },
];
const tree = buildTree(nodes);
const ids = (query: string, among?: CategoryNode[]) =>
  searchCategories(tree, query, among).map((n) => n.id);

describe("searchCategories", () => {
  it("returns every candidate for a blank query", () => {
    expect(ids("  ")).toEqual(tree.nodes.map((n) => n.id));
  });

  it("matches every word anywhere in the full path", () => {
    expect(ids("food gro")).toEqual(["groceries"]);
    expect(ids("Food > Eat")).toEqual(["eating-out"]);
    expect(ids("garden")).toEqual(["garden"]);
    expect(ids("nothing")).toEqual([]);
  });

  it("ranks own-name matches first and archived last", () => {
    // "Food" (prefix), its children (path only), then the archived "Food court"
    expect(ids("food")).toEqual(["food", "eating-out", "groceries", "old-food"]);
    expect(ids("out")).toEqual(["eating-out"]);
  });

  it("searches only the given candidates", () => {
    expect(ids("food", tree.nodes.filter((n) => n.id !== "food"))).toEqual(["eating-out", "groceries", "old-food"]);
  });
});

describe("frequentCategories", () => {
  const txn = (date: string, categoryId: string) => ({ date, categoryId });

  it("ranks by uses in the window, ties to the most recent", () => {
    const txns = [
      txn("2026-10-01", "garden"),
      txn("2026-10-02", "groceries"),
      txn("2026-10-03", "groceries"),
      txn("2026-10-04", "eating-out"),
      txn("2026-10-05", "garden"),
      txn("2026-10-06", "home"),
    ];
    expect(frequentCategories(tree, txns)).toEqual(["garden", "groceries", "home", "eating-out"]);
    expect(frequentCategories(tree, txns, { limit: 2 })).toEqual(["garden", "groceries"]);
  });

  it("counts only the days up to the newest transaction", () => {
    const txns = [
      txn("2026-01-01", "garden"),
      txn("2026-01-02", "garden"),
      txn("2026-06-01", "groceries"),
    ];
    expect(frequentCategories(tree, txns, { days: 90 })).toEqual(["groceries"]);
  });

  it("skips uncategorised, archived and unknown categories", () => {
    const txns = [
      txn("2026-10-01", UNCATEGORIZED_ID),
      txn("2026-10-01", "old-food"),
      txn("2026-10-01", "gone"),
      txn("2026-10-01", "food"),
    ];
    expect(frequentCategories(tree, txns)).toEqual(["food"]);
    expect(frequentCategories(tree, [])).toEqual([]);
  });
});
