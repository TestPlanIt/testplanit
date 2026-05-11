import type { Prisma } from "@prisma/client";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { buildFolderBreadcrumb } from "../cases/shared.js";

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
} as const satisfies Prisma.RepositoryFoldersInclude;

interface RawFolderNode {
  id: number;
  name: string;
  parentId: number | null;
  _count?: { cases?: number };
  children?: RawFolderNode[];
}

export interface FolderTreeNode {
  id: number;
  name: string;
  parentId: number | null;
  caseCount: number;
  children: FolderTreeNode[];
}

export function mapFolderTreeNode(raw: RawFolderNode): FolderTreeNode {
  return {
    id: raw.id,
    name: raw.name,
    parentId: raw.parentId,
    caseCount: raw._count?.cases ?? 0,
    children: (raw.children ?? []).map(mapFolderTreeNode),
  };
}

/**
 * Fetch a single folder with breadcrumb + children + cases summary.
 * Reused by create.ts and update.ts to return CASE-07-shaped responses
 * after a write.
 */
export async function fetchFolderDetail(folderId: number, env: EnvConfig) {
  const raw = await zenstack<{
    id: number;
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

  return {
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
}
