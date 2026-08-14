import type {
  RepositoryCasesGroupByArgs,
  RepositoryFoldersFindManyArgs,
} from "@db/input";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";

/**
 * Whole-project folder utilities shared by the folder tools (folders_list /
 * folders_get recursive counts) and the case tools (cases_list
 * includeDescendants / includeFolderPath, cases_count folder groupings).
 *
 * The folder hierarchy cannot be aggregated recursively through the ZenStack
 * RPC surface (no recursive CTE passthrough), so every consumer works from
 * ONE flat fetch of the project's folders — id/name/parentId/order plus the
 * direct live-case count — and derives subtrees, recursive totals, and
 * root-to-leaf paths in memory. A project's folder list is small (hundreds to
 * low thousands of rows with five scalar columns), so the flat fetch is far
 * cheaper than any per-folder walk.
 */

/**
 * Cap on subtree-scoped folder id in-clauses. The ids travel in the RPC GET
 * query string, and Node rejects request lines past ~16KB — 500 ids plus the
 * include shape stays comfortably under that. Callers surface an explicit
 * error pointing at an uncapped alternative rather than silently truncating
 * the scope.
 */
export const MAX_SUBTREE_FOLDER_IDS = 500;

export interface FlatFolder {
  id: number;
  name: string;
  parentId: number | null;
  order: number;
  /** Direct (non-recursive) count of live cases pinned to this folder. */
  caseCount: number;
}

export interface FolderIndex {
  byId: Map<number, FlatFolder>;
  /** Children grouped by parentId, preserving (order asc, id asc). */
  childrenOf: Map<number | null, FlatFolder[]>;
}

export async function fetchProjectFolders(
  projectId: number,
  env: EnvConfig,
): Promise<FlatFolder[]> {
  const rows = await zenstack<
    Array<{
      id: number;
      name: string;
      parentId: number | null;
      order: number;
      _count?: { cases?: number };
    }>
  >(
    "repositoryFolders",
    "findMany",
    {
      where: { projectId, isDeleted: false },
      select: {
        id: true,
        name: true,
        parentId: true,
        order: true,
        _count: { select: { cases: { where: { isDeleted: false } } } },
      },
      orderBy: [{ order: "asc" }, { id: "asc" }],
    } satisfies RepositoryFoldersFindManyArgs,
    env,
  );
  return (rows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    parentId: r.parentId,
    order: r.order,
    caseCount: r._count?.cases ?? 0,
  }));
}

/**
 * Per-folder direct counts of live cases with `automated: true`, via one
 * batched groupBy (same shape the run rollups use — never per-folder N+1).
 * Folders with zero automated cases are absent from the map.
 */
export async function fetchAutomatedCaseCounts(
  projectId: number,
  env: EnvConfig,
): Promise<Map<number, number>> {
  const groups = await zenstack<
    Array<{ folderId: number; _count: { id: number } }>
  >(
    "repositoryCases",
    "groupBy",
    {
      by: ["folderId"],
      where: { projectId, isDeleted: false, automated: true },
      _count: { id: true },
    } satisfies RepositoryCasesGroupByArgs,
    env,
  );
  return new Map((groups ?? []).map((g) => [g.folderId, g._count.id]));
}

export function buildFolderIndex(folders: FlatFolder[]): FolderIndex {
  const byId = new Map<number, FlatFolder>();
  const childrenOf = new Map<number | null, FlatFolder[]>();
  for (const f of folders) byId.set(f.id, f);
  for (const f of folders) {
    const siblings = childrenOf.get(f.parentId);
    if (siblings) siblings.push(f);
    else childrenOf.set(f.parentId, [f]);
  }
  return { byId, childrenOf };
}

/**
 * All folder ids in the subtree rooted at `rootId`, INCLUDING the root
 * itself. Cycle-safe via a visited set (a corrupted parent chain terminates
 * instead of looping).
 */
export function collectSubtreeIds(
  index: FolderIndex,
  rootId: number,
): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const child of index.childrenOf.get(id) ?? []) stack.push(child.id);
  }
  return out;
}

/**
 * Roll direct per-folder counts up into recursive subtree totals:
 * recursive(f) = direct(f) + Σ direct(every descendant of f). Every folder in
 * the index gets an entry (0 when the whole subtree is empty). Each folder's
 * direct count is added to all its ancestors in one upward walk — O(N·depth),
 * cycle-safe.
 */
export function computeRecursiveCounts(
  index: FolderIndex,
  direct: Map<number, number>,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const f of index.byId.values()) out.set(f.id, direct.get(f.id) ?? 0);
  for (const f of index.byId.values()) {
    const n = direct.get(f.id) ?? 0;
    if (n === 0) continue;
    const seen = new Set<number>([f.id]);
    let parentId = f.parentId;
    while (parentId != null && !seen.has(parentId)) {
      const parent = index.byId.get(parentId);
      if (!parent) break;
      seen.add(parentId);
      out.set(parentId, (out.get(parentId) ?? 0) + n);
      parentId = parent.parentId;
    }
  }
  return out;
}

export interface FolderPathInfo {
  /** Root-to-leaf display path, " / "-joined (matches cases_get fullPath). */
  path: string;
  /** Ancestor ids root-first, EXCLUDING the folder itself. */
  ancestorIds: number[];
  rootId: number;
  rootName: string;
}

/**
 * Root-to-leaf path info for every folder in the index. A folder whose
 * parent chain leaves the index (defensive — dangling parentId) is treated
 * as its own root.
 */
export function buildPathInfo(index: FolderIndex): Map<number, FolderPathInfo> {
  const out = new Map<number, FolderPathInfo>();
  for (const f of index.byId.values()) {
    const chain: FlatFolder[] = [f];
    const seen = new Set<number>([f.id]);
    let parentId = f.parentId;
    while (parentId != null && !seen.has(parentId)) {
      const parent = index.byId.get(parentId);
      if (!parent) break;
      seen.add(parentId);
      chain.unshift(parent);
      parentId = parent.parentId;
    }
    const root = chain[0]!;
    out.set(f.id, {
      path: chain.map((c) => c.name).join(" / "),
      ancestorIds: chain.slice(0, -1).map((c) => c.id),
      rootId: root.id,
      rootName: root.name,
    });
  }
  return out;
}
