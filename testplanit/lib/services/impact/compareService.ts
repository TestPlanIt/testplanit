import type {
  ChangedFileStatus,
  CompareOptions,
  CompareResult,
  GitRepoAdapter,
} from "~/lib/integrations/adapters/GitRepoAdapter";
import { repoFileCache } from "~/lib/integrations/cache/RepoFileCache";
import {
  parseUnifiedDiff,
  type DiffHunk,
} from "~/lib/integrations/diff/parseUnifiedDiff";

const FULL_SHA = /^[0-9a-f]{40}$/i;

export class RefNotFoundError extends Error {
  constructor(ref: string) {
    super(`Ref not found: ${ref}`);
    this.name = "RefNotFoundError";
  }
}

/** Resolve a branch, tag, or short sha to a full commit sha. */
export async function resolveRefToSha(
  adapter: GitRepoAdapter,
  ref: string
): Promise<string> {
  if (FULL_SHA.test(ref)) return ref.toLowerCase();
  const { commits } = await adapter.listCommits(ref, { perPage: 1 });
  const sha = commits[0]?.sha;
  if (!sha) throw new RefNotFoundError(ref);
  return sha;
}

export interface CompareRequest {
  configId: number;
  cacheEnabled: boolean;
  adapter: GitRepoAdapter;
  baseSha: string;
  headSha: string;
  opts?: CompareOptions;
}

export interface ResolvedCompare {
  result: CompareResult;
  cached: boolean;
}

/**
 * Cache-first compare. Both shas must already be resolved so the cache key is
 * immutable; privacy-mode configs (cacheEnabled=false) always go live.
 */
export async function getOrComputeCompare(
  req: CompareRequest
): Promise<ResolvedCompare> {
  const { configId, cacheEnabled, adapter, baseSha, headSha, opts } = req;
  if (cacheEnabled) {
    const cached = await repoFileCache.getCompare(configId, baseSha, headSha);
    if (cached) return { result: cached, cached: true };
  }
  const result = await adapter.compareCommits(baseSha, headSha, opts);
  if (cacheEnabled) {
    await repoFileCache.setCompare(configId, baseSha, headSha, result);
  }
  return { result, cached: false };
}

/** Per-file record persisted on ImpactAnalysis.diffSummary (no patch text). */
export interface DiffFileRecord {
  path: string;
  previousPath?: string;
  status: ChangedFileStatus;
  additions: number;
  deletions: number;
  isBinary: boolean;
  patchTruncated?: boolean;
  hunks: DiffHunk[];
}

export function toDiffFileRecords(result: CompareResult): DiffFileRecord[] {
  return result.files.map((file) => ({
    path: file.path,
    ...(file.previousPath ? { previousPath: file.previousPath } : {}),
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    isBinary: file.isBinary,
    ...(file.patchTruncated ? { patchTruncated: true } : {}),
    hunks: file.patch ? parseUnifiedDiff(file.patch).hunks : [],
  }));
}

/** Distinct parent directories (depth <= 3) of the changed paths. */
export function changedDirsOf(paths: string[], maxDepth = 3): string[] {
  const dirs = new Set<string>();
  for (const path of paths) {
    const segments = path.split("/");
    segments.pop();
    for (let depth = 1; depth <= Math.min(maxDepth, segments.length); depth++) {
      dirs.add(segments.slice(0, depth).join("/"));
    }
  }
  return [...dirs].sort();
}
