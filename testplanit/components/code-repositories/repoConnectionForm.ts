import type { RepoPreviewRequest } from "~/hooks/useRepoPreviewFiles";
import type { PathPatternValue } from "./PathPatternsCard";

/**
 * The fields every repository connection form shares. QuickScript and Impact
 * each add their own on top; what decides which files the connection holds
 * is handled here, once.
 */
export interface RepoConnectionFormValues {
  repositoryId: string;
  branch: string;
  pathPatterns: PathPatternValue[];
  cacheEnabled: boolean;
  cacheTtlDays: number;
}

/** The stored row fields the shared logic reads. */
export interface StoredRepoConnection {
  repositoryId: number;
  branch: string | null;
  pathPatterns: unknown;
}

/** A form row: the exclude flag is always a boolean in the form. */
export type PathPatternRow = PathPatternValue & { exclude: boolean };

/** Stored rows → form rows. */
export function pathPatternRows(stored: unknown): PathPatternRow[] {
  if (!Array.isArray(stored)) return [];
  return stored
    .filter(
      (row): row is PathPatternValue =>
        !!row && typeof row === "object" && typeof row.pattern === "string"
    )
    .map((row) => ({
      path: typeof row.path === "string" ? row.path : "",
      pattern: row.pattern,
      exclude: Boolean(row.exclude),
    }));
}

/** What Preview Files sends: the same filters a save would store. */
export function repoPreviewRequest(
  values: RepoConnectionFormValues
): RepoPreviewRequest {
  return {
    branch: values.branch || undefined,
    pathPatterns: values.pathPatterns,
    cacheEnabled: values.cacheEnabled,
  };
}

/**
 * True when the values change which files the cache holds: the repository,
 * branch or path patterns (include and exclude rows alike). The TTL and the
 * cache switch do not, so saving those keeps the cached files.
 */
export function cacheContentChanged(
  existing: StoredRepoConnection | null | undefined,
  values: RepoConnectionFormValues
): boolean {
  if (!existing) return true;
  return (
    existing.repositoryId !== parseInt(values.repositoryId) ||
    existing.branch !== (values.branch || null) ||
    JSON.stringify(pathPatternRows(existing.pathPatterns)) !==
      JSON.stringify(pathPatternRows(values.pathPatterns))
  );
}

/** Cleared on save when the cache content changed, so the next refresh starts over. */
export const CACHE_RESET_FIELDS = {
  cacheStatus: null,
  cacheLastFetchedAt: null,
  cacheFileCount: null,
  cacheTotalSize: null,
  cacheError: null,
} as const;

/**
 * The connection fields both forms write, with the cache reset folded in
 * when its content changed. Callers spread their purpose-specific fields on
 * top.
 */
export function repoConnectionData(
  existing: StoredRepoConnection | null | undefined,
  values: RepoConnectionFormValues
): {
  data: {
    branch: string | null;
    /** Spelled out so the ORM accepts it as JSON (an interface has no index signature). */
    pathPatterns: { path: string; pattern: string; exclude?: boolean }[];
    cacheEnabled: boolean;
    cacheTtlDays: number;
  } & Partial<typeof CACHE_RESET_FIELDS>;
  cacheContentChanged: boolean;
} {
  const changed = cacheContentChanged(existing, values);
  return {
    data: {
      branch: values.branch || null,
      pathPatterns: values.pathPatterns,
      cacheEnabled: values.cacheEnabled,
      cacheTtlDays: values.cacheTtlDays,
      ...(changed ? CACHE_RESET_FIELDS : {}),
    },
    cacheContentChanged: changed,
  };
}
