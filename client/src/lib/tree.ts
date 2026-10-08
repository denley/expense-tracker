/*
  Category tree helpers. The tree is a flat list of CategoryNode rows
  (categories.csv); this module builds the derived indexes everything else
  uses: children, paths, roots, archived/one-off subtree membership.

  Robustness rules for externally edited files:
  - a parentId pointing at a missing node → the node is treated as a root
  - a parentId cycle → every node in the cycle is treated as a root
  - the "Uncategorized" root always exists (re-added if deleted)
*/
import type { CategoryNode } from "./types";

/** Path separator. Chosen because "/" appears in real category names. */
export const PATH_SEP = " > ";

export const UNCATEGORIZED_ID = "uncategorized";
export const UNCATEGORIZED_NAME = "Uncategorized";

export function makeUncategorizedNode(): CategoryNode {
  return { id: UNCATEGORIZED_ID, parentId: null, name: UNCATEGORIZED_NAME };
}

export interface CategoryTree {
  /** All nodes in stable depth-first display order */
  nodes: CategoryNode[];
  byId: Map<string, CategoryNode>;
  /** Children per parent id (null key = roots), in display order */
  children: Map<string | null, CategoryNode[]>;
  pathOf: (id: string) => string;
  /** Top-level ancestor (the chart bucket). Returns the node itself if root. */
  rootOf: (id: string) => CategoryNode | undefined;
  depthOf: (id: string) => number;
  /** Node or any ancestor archived */
  isArchived: (id: string) => boolean;
  /** Node or any ancestor one-off */
  isOneOff: (id: string) => boolean;
  descendantsOf: (id: string) => CategoryNode[];
  /** id → id of every node in that node's subtree (self included) */
  subtreeIds: (id: string) => Set<string>;
}

/** Display order: regular children alphabetically, then one-off children alphabetically */
function childOrder(a: CategoryNode, b: CategoryNode): number {
  return Number(!!a.oneOff) - Number(!!b.oneOff) || a.name.localeCompare(b.name);
}

export function buildTree(rawNodes: CategoryNode[]): CategoryTree {
  const byId = new Map<string, CategoryNode>();
  for (const n of rawNodes) if (n.id && !byId.has(n.id)) byId.set(n.id, n);

  // Resolve effective parent: missing parent or cycle → root
  const effParent = new Map<string, string | null>();
  for (const n of byId.values()) {
    let parent = n.parentId && byId.has(n.parentId) ? n.parentId : null;
    if (parent !== null) {
      // walk up; if we revisit ourselves there's a cycle
      const seen = new Set<string>([n.id]);
      let cur: string | null = parent;
      while (cur !== null) {
        if (seen.has(cur)) {
          parent = null;
          break;
        }
        seen.add(cur);
        const p: CategoryNode | undefined = byId.get(cur);
        cur = p && p.parentId && byId.has(p.parentId) ? p.parentId : null;
      }
    }
    effParent.set(n.id, parent);
  }

  const children = new Map<string | null, CategoryNode[]>();
  for (const n of byId.values()) {
    const p = effParent.get(n.id) ?? null;
    if (!children.has(p)) children.set(p, []);
    children.get(p)!.push(n);
  }
  for (const list of children.values()) list.sort(childOrder);

  // Depth-first display order
  const ordered: CategoryNode[] = [];
  const visit = (parent: string | null) => {
    for (const n of children.get(parent) ?? []) {
      ordered.push(n);
      visit(n.id);
    }
  };
  visit(null);

  const pathCache = new Map<string, string>();
  const pathOf = (id: string): string => {
    if (pathCache.has(id)) return pathCache.get(id)!;
    const n = byId.get(id);
    if (!n) return id;
    const parent = effParent.get(id) ?? null;
    const path = parent === null ? n.name : `${pathOf(parent)}${PATH_SEP}${n.name}`;
    pathCache.set(id, path);
    return path;
  };

  const rootOf = (id: string): CategoryNode | undefined => {
    let cur = byId.get(id);
    if (!cur) return undefined;
    let parent = effParent.get(cur.id) ?? null;
    while (parent !== null) {
      cur = byId.get(parent)!;
      parent = effParent.get(cur.id) ?? null;
    }
    return cur;
  };

  const depthOf = (id: string): number => {
    let depth = 0;
    let parent = effParent.get(id) ?? null;
    while (parent !== null) {
      depth++;
      parent = effParent.get(parent) ?? null;
    }
    return depth;
  };

  const flagUp = (id: string, flag: "archived" | "oneOff"): boolean => {
    let cur: string | null = id;
    while (cur !== null) {
      const n = byId.get(cur);
      if (!n) return false;
      if (n[flag]) return true;
      cur = effParent.get(cur) ?? null;
    }
    return false;
  };

  const descendantsOf = (id: string): CategoryNode[] => {
    const out: CategoryNode[] = [];
    const walk = (pid: string) => {
      for (const c of children.get(pid) ?? []) {
        out.push(c);
        walk(c.id);
      }
    };
    walk(id);
    return out;
  };

  const subtreeIds = (id: string): Set<string> => {
    const set = new Set<string>([id]);
    for (const d of descendantsOf(id)) set.add(d.id);
    return set;
  };

  return {
    nodes: ordered,
    byId,
    children,
    pathOf,
    rootOf,
    depthOf,
    isArchived: (id) => flagUp(id, "archived"),
    isOneOff: (id) => flagUp(id, "oneOff"),
    descendantsOf,
    subtreeIds,
  };
}

/** Readable stable slug for a new node, unique against existing ids */
export function slugForName(name: string, taken: Iterable<string>): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "node";
  const existing = new Set(taken);
  if (!existing.has(base)) return base;
  for (let i = 2; ; i++) {
    if (!existing.has(`${base}-${i}`)) return `${base}-${i}`;
  }
}

/** Names must be unique among siblings and must not contain the path separator */
export function validateName(
  tree: CategoryTree,
  name: string,
  parentId: string | null,
  selfId?: string
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Name can't be empty";
  if (trimmed.includes(">")) return `Name can't contain ">" (reserved for paths)`;
  const clash = (tree.children.get(parentId) ?? []).some(
    (s) => s.id !== selfId && s.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (clash) return `"${trimmed}" already exists at this level`;
  return null;
}

/**
 * Resolve a node id, full path ("Travel > Japan 2026 > Food") or unique name
 * to a node id. Names prefer non-archived nodes; ambiguous names don't resolve.
 */
export function resolveCategoryIn(tree: CategoryTree, idPathOrName: string): string | undefined {
  const raw = idPathOrName.trim();
  if (!raw) return undefined;
  if (tree.byId.has(raw)) return raw;
  const needle = raw.toLowerCase();
  for (const n of tree.nodes) {
    if (tree.pathOf(n.id).toLowerCase() === needle) return n.id;
  }
  const byName = tree.nodes.filter((n) => n.name.toLowerCase() === needle);
  const active = byName.filter((n) => !tree.isArchived(n.id));
  const pool = active.length > 0 ? active : byName;
  return pool.length === 1 ? pool[0].id : undefined;
}

/**
 * Resolve-or-create category paths. Existing paths/names resolve as in
 * resolveCategoryIn; anything else is created segment by segment under the
 * matching ancestors. Returns the input → id map and the nodes created.
 */
export function ensurePaths(
  nodes: CategoryNode[],
  nameOrPaths: string[],
  now = new Date().toISOString()
): { ids: Record<string, string>; created: CategoryNode[] } {
  const ids: Record<string, string> = {};
  const created: CategoryNode[] = [];
  let cur = buildTree(nodes);
  for (const nameOrPath of nameOrPaths) {
    const existing = resolveCategoryIn(cur, nameOrPath);
    if (existing) {
      ids[nameOrPath] = existing;
      continue;
    }
    const segments = nameOrPath.split(PATH_SEP).map((s) => s.trim()).filter(Boolean);
    if (segments.length === 0) {
      ids[nameOrPath] = UNCATEGORIZED_ID;
      continue;
    }
    let parentId: string | null = null;
    for (const seg of segments) {
      const siblings: CategoryNode[] = cur.children.get(parentId) ?? [];
      const found = siblings.find((s) => s.name.toLowerCase() === seg.toLowerCase());
      if (found) {
        parentId = found.id;
      } else {
        const node: CategoryNode = {
          id: slugForName(seg, cur.byId.keys()),
          parentId,
          name: seg.replace(/>/g, "-"),
          createdAt: now,
        };
        created.push(node);
        parentId = node.id;
        cur = buildTree([...nodes, ...created]);
      }
    }
    ids[nameOrPath] = parentId ?? UNCATEGORIZED_ID;
  }
  return { ids, created };
}
