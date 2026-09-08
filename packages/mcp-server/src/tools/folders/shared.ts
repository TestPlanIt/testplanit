import type {
  RepositoryFoldersInclude,
} from "@db/input";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { buildFolderBreadcrumb } from "../cases/shared.js";
import {
  buildFolderIndex,
  computeRecursiveCounts,
  fetchAutomatedCaseCounts,
  fetchProjectFolders,
} from "./tree.js";

const FOLDER_DETAIL_INCLUDE = {
  children: {
    where: { isDeleted: false },
    select: {
      id: true,
      name: true,
      _count: { select: { cases: { where: { isDeleted: false } } } },
    },
    orderBy: { order: "asc" },
  },
  cases: {
    where: { isDeleted: false },
    select: { id: true, name: true, source: true },
    orderBy: { order: "asc" },
    take: 100,
  },
  _count: { select: { cases: { where: { isDeleted: false } } } },
} as const satisfies RepositoryFoldersInclude;

export interface FolderDetailChild {
  id: number;
  name: string;
  caseCount: number;
  caseCountRecursive?: number;
  automatedCaseCount?: number;
  automatedCaseCountRecursive?: number;
  hasChildren?: boolean;
}

/**
 * Fetch a single folder with breadcrumb + children + cases summary.
 * Reused by create.ts and update.ts to return CASE-07-shaped responses
 * after a write.
 *
 * `includeRecursiveCounts` (folders_get passes true) adds whole-subtree
 * totals — caseCountRecursive, automatedCaseCount,
 * automatedCaseCountRecursive on the folder and each child, plus each
 * child's hasChildren — from one flat project-folder fetch + one batched
 * automated groupBy (folders/tree.ts). The write paths keep the lean shape:
 * a create/update response doesn't need subtree analytics.
 */
export async function fetchFolderDetail(
  folderId: number,
  env: EnvConfig,
  opts?: { includeRecursiveCounts?: boolean },
) {
  const raw = await zenstack<{
    id: number;
    projectId: number;
    name: string;
    parentId: number | null;
    children: Array<{ id: number; name: string; _count?: { cases?: number } }>;
    cases: Array<{ id: number; name: string; source: string }>;
    _count?: { cases?: number };
  } | null>(
    "repositoryFolders",
    "findUnique",
    {
      where: { id: folderId },
      include: FOLDER_DETAIL_INCLUDE,
    },
    env,
  );
  if (!raw) return null;

  const breadcrumb = await buildFolderBreadcrumb(
    { id: raw.id, name: raw.name, parentId: raw.parentId },
    env,
  );
  const fullPath = breadcrumb.map((b) => b.name).join(" / ");

  const detail: {
    id: number;
    name: string;
    parentId: number | null;
    breadcrumb: typeof breadcrumb;
    fullPath: string;
    children: FolderDetailChild[];
    cases: Array<{ id: number; name: string; source: string }>;
    caseCount: number;
    caseCountRecursive?: number;
    automatedCaseCount?: number;
    automatedCaseCountRecursive?: number;
  } = {
    id: raw.id,
    name: raw.name,
    parentId: raw.parentId,
    breadcrumb,
    fullPath,
    children: raw.children.map((c) => ({
      id: c.id,
      name: c.name,
      caseCount: c._count?.cases ?? 0,
    })),
    cases: raw.cases,
    caseCount: raw._count?.cases ?? 0,
  };

  if (opts?.includeRecursiveCounts) {
    const folders = await fetchProjectFolders(raw.projectId, env);
    const index = buildFolderIndex(folders);
    const direct = new Map(folders.map((f) => [f.id, f.caseCount]));
    const automatedDirect = await fetchAutomatedCaseCounts(raw.projectId, env);
    const recursive = computeRecursiveCounts(index, direct);
    const automatedRecursive = computeRecursiveCounts(index, automatedDirect);

    detail.caseCountRecursive = recursive.get(raw.id) ?? 0;
    detail.automatedCaseCount = automatedDirect.get(raw.id) ?? 0;
    detail.automatedCaseCountRecursive = automatedRecursive.get(raw.id) ?? 0;
    detail.children = detail.children.map((c) => ({
      ...c,
      caseCountRecursive: recursive.get(c.id) ?? 0,
      automatedCaseCount: automatedDirect.get(c.id) ?? 0,
      automatedCaseCountRecursive: automatedRecursive.get(c.id) ?? 0,
      hasChildren: (index.childrenOf.get(c.id) ?? []).length > 0,
    }));
  }

  return detail;
}
