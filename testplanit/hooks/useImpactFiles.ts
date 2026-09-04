"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

export const IMPACT_FILES_QUERY_KEY_ROOT = "impactFiles";

export interface ImpactFileEntry {
  path: string;
  size: number;
}

export interface ImpactFilesMeta {
  fetchedAt: string;
  fileCount: number;
}

export interface ImpactFilesData {
  files: ImpactFileEntry[];
  meta: ImpactFilesMeta | null;
  truncated: boolean;
  source: "cache" | "live";
  cacheEmpty: boolean;
}

export interface ImpactFilesFilterResult {
  results: ImpactFileEntry[];
  total: number;
}

export function impactFilesUrl(repositoryId: number, configId: number): string {
  return `/api/code-repositories/${repositoryId}/files?configId=${configId}`;
}

export async function fetchImpactFiles(
  repositoryId: number,
  configId: number
): Promise<ImpactFilesData> {
  const res = await fetch(impactFilesUrl(repositoryId, configId));
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.status === 409 && body?.error === "cache_empty") {
    return {
      files: [],
      meta: body?.meta ?? null,
      truncated: false,
      source: "cache",
      cacheEmpty: true,
    };
  }
  if (!res.ok) {
    throw new Error(
      typeof body?.error === "string"
        ? body.error
        : "Failed to load repository files."
    );
  }
  return {
    files: Array.isArray(body?.files) ? body.files : [],
    meta: body?.meta ?? null,
    truncated: body?.truncated === true,
    source: body?.source === "live" ? "live" : "cache",
    cacheEmpty: false,
  };
}

function matchTier(lowerPath: string, query: string): 0 | 1 | 2 {
  const segments = lowerPath.split("/");
  const basename = segments[segments.length - 1] ?? "";
  const stem = basename.replace(/\.[^.]+$/, "");
  if (basename === query || stem === query) return 0;
  if (segments.some((segment) => segment.startsWith(query))) return 1;
  return 2;
}

/**
 * Case-insensitive substring match over the file list, ranked so a file
 * whose name is the query comes first, then files with a path segment that
 * starts with the query, then any other substring hit; ties break on path
 * length, then alphabetically.
 */
export function rankImpactFiles(
  files: ImpactFileEntry[],
  query: string
): ImpactFileEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return files;
  const scored: Array<{ file: ImpactFileEntry; tier: number }> = [];
  for (const file of files) {
    const lower = file.path.toLowerCase();
    if (!lower.includes(needle)) continue;
    scored.push({ file, tier: matchTier(lower, needle) });
  }
  scored.sort(
    (a, b) =>
      a.tier - b.tier ||
      a.file.path.length - b.file.path.length ||
      a.file.path.localeCompare(b.file.path)
  );
  return scored.map((entry) => entry.file);
}

export function filterImpactFiles(
  files: ImpactFileEntry[],
  query: string,
  page: number,
  pageSize: number
): ImpactFilesFilterResult {
  const ranked = rankImpactFiles(files, query);
  const start = Math.max(0, page) * pageSize;
  return {
    results: ranked.slice(start, start + pageSize),
    total: ranked.length,
  };
}

const EMPTY_FILES: ImpactFileEntry[] = [];

interface UseImpactFilesOptions {
  repositoryId: number | undefined;
  configId: number | undefined;
  enabled?: boolean;
}

/**
 * The Impact repository's file list for a project, cached for five minutes
 * and filtered client-side so the file picker never round-trips per
 * keystroke.
 */
export function useImpactFiles(
  projectId: number | undefined,
  { repositoryId, configId, enabled = true }: UseImpactFilesOptions
) {
  const query = useQuery<ImpactFilesData>({
    queryKey: [IMPACT_FILES_QUERY_KEY_ROOT, projectId, repositoryId, configId],
    queryFn: () => fetchImpactFiles(repositoryId as number, configId as number),
    enabled:
      enabled && Number.isFinite(repositoryId) && Number.isFinite(configId),
    staleTime: 5 * 60 * 1000,
  });

  const files = query.data?.files ?? EMPTY_FILES;

  const filter = useCallback(
    (search: string, page: number, pageSize: number) =>
      filterImpactFiles(files, search, page, pageSize),
    [files]
  );

  return {
    files,
    meta: query.data?.meta ?? null,
    source: query.data?.source ?? null,
    truncated: query.data?.truncated ?? false,
    cacheEmpty: query.data?.cacheEmpty ?? false,
    isLoading: query.isLoading,
    error: query.error,
    refresh: query.refetch,
    filter,
  };
}
