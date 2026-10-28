import { describe, expect, it } from "vitest";
import { buildTree, searchCategories } from "./tree";
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
