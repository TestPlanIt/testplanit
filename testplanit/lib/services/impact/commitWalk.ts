import type {
  ListCommitsOptions,
  ListCommitsResult,
  RepoCommit,
} from "~/lib/integrations/adapters/GitRepoAdapter";

import { repoFileCache } from "~/lib/integrations/cache/RepoFileCache";

/**
 * Walking a branch's commits for the ticket scan, with a cache of what was
 * walked before. The provider only ever has to serve commits newer than the
 * cached tip, and a full-history scan that stopped at its cap resumes from
 * the oldest cached commit on the next run instead of starting over.
 *
 * The cache is one JSON list per (config, branch) in Valkey, newest first and
 * contiguous from the tip. It is trusted only where the fresh walk from the
 * current tip meets it; if the tip has moved somewhere the cache does not
 * know (a force-push, a rebase), the fresh walk replaces it.
 */

export interface CommitWalkSource {
  listCommits(
    ref: string,
    opts?: ListCommitsOptions
  ): Promise<ListCommitsResult>;
}

export interface CommitWalkCache {
  branch: string;
  tipSha: string;
  /** The list reaches the first commit of the branch. */
  complete: boolean;
  walkedAt: string;
  /** Newest first, contiguous from `tipSha`. */
  commits: RepoCommit[];
}

export interface CommitWalkStore {
  load(): Promise<CommitWalkCache | null>;
  save(cache: CommitWalkCache): Promise<void>;
}

export interface WalkCommitsOptions {
  /** Commits older than this many days are left out; Infinity walks everything. */
  lookbackDays: number;
  /** Most commits returned by this run, fresh and cached together. */
  maxCommits: number;
  /**
   * When the cached list does not reach the start of the branch, keep walking
   * from its oldest commit until the cap. Full-history scans set this; a
   * recent-window scan never needs commits older than its window.
   */
  continueFromCache?: boolean;
  store?: CommitWalkStore;
  now?: Date;
  /** Called per provider page with the commits gathered so far. */
  onProgress?: (
    scannedCommits: number,
    fromCache: number
  ) => Promise<void> | void;
  /**
   * Asked before each provider page. A true answer ends the walk where it
   * is, as the cap would, so what was read is still cached and reported.
   */
  shouldStop?: () => Promise<boolean> | boolean;
}

export interface WalkCommitsResult {
  /** Newest first. */
  commits: RepoCommit[];
  /** The cap stopped the walk before the window or the branch start. */
  truncated: boolean;
  /** The returned list reaches the first commit of the branch. */
  complete: boolean;
  /** How many of the returned commits came from the cache. */
  fromCache: number;
  /** `shouldStop` ended the walk early. */
  cancelled: boolean;
}

export const COMMITS_PER_PAGE = 100;
/** Most commits kept per branch; beyond this the oldest are dropped. */
export const COMMIT_CACHE_MAX = 100_000;
/** Refreshed on every save; a branch nobody scans for a month starts over. */
export const COMMIT_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
const CACHE_KIND = "commit-walk";

/** The Valkey-backed store for one config and branch. */
export function commitWalkStore(
  configId: number,
  branch: string
): CommitWalkStore {
  return {
    load: async () => {
      const cached = await repoFileCache.getRefList<CommitWalkCache>(
        configId,
        CACHE_KIND,
        branch
      );
      return cached &&
        cached.branch === branch &&
        Array.isArray(cached.commits) &&
        cached.commits.length > 0
        ? cached
        : null;
    },
    save: (cache) =>
      repoFileCache.setRefList(
        configId,
        CACHE_KIND,
        branch,
        cache,
        COMMIT_CACHE_TTL_SECONDS
      ),
  };
}

function authoredMs(commit: RepoCommit): number {
  const at = Date.parse(commit.authoredAt);
  return Number.isFinite(at) ? at : Number.POSITIVE_INFINITY;
}

/**
 * Commits on `ref`, newest first, within the lookback and under the cap,
 * read from the provider only where the cache cannot answer.
 */
export async function walkCommits(
  source: CommitWalkSource,
  ref: string,
  opts: WalkCommitsOptions
): Promise<WalkCommitsResult> {
  const now = opts.now ?? new Date();
  const cutoff = Number.isFinite(opts.lookbackDays)
    ? now.getTime() - opts.lookbackDays * 24 * 60 * 60 * 1000
    : Number.NEGATIVE_INFINITY;
  const cached = opts.store ? await opts.store.load() : null;
  const cachedIndex = new Map<string, number>();
  cached?.commits.forEach((commit, index) =>
    cachedIndex.set(commit.sha, index)
  );

  // Phase 1: fresh commits from the tip down to the cache, the window, or
  // the cap.
  const fresh: RepoCommit[] = [];
  let joinIndex = -1;
  let reachedCutoff = false;
  let capHit = false;
  let exhausted = false;
  let cancelled = false;
  const report = (fromCache: number) =>
    opts.onProgress?.(fresh.length + fromCache, fromCache);
  const stopRequested = async () => {
    if (!opts.shouldStop || !(await opts.shouldStop())) return false;
    cancelled = true;
    return true;
  };

  pages: for (let page = 1; ; page++) {
    if (await stopRequested()) {
      capHit = true;
      break;
    }
    const result = await source.listCommits(ref, {
      page,
      perPage: COMMITS_PER_PAGE,
    });
    await report(0);
    for (const commit of result.commits) {
      const hit = cachedIndex.get(commit.sha);
      if (hit !== undefined) {
        joinIndex = hit;
        break pages;
      }
      if (authoredMs(commit) < cutoff) {
        reachedCutoff = true;
        break pages;
      }
      if (fresh.length >= opts.maxCommits) {
        capHit = true;
        break pages;
      }
      fresh.push(commit);
    }
    if (!result.hasMore || result.commits.length === 0) {
      exhausted = true;
      break;
    }
  }

  // Assemble the contiguous list this run knows about.
  let known: RepoCommit[];
  let complete: boolean;
  let cacheUsable = false;
  if (joinIndex >= 0 && cached) {
    known = fresh.concat(cached.commits.slice(joinIndex));
    complete = cached.complete;
    cacheUsable = true;
  } else {
    known = fresh;
    complete = exhausted;
  }
  const fromCacheTotal = cacheUsable ? known.length - fresh.length : 0;
  if (cacheUsable) await report(fromCacheTotal);

  // Phase 2: a full walk resumes from the oldest known commit.
  let truncated = capHit;
  if (
    opts.continueFromCache &&
    !complete &&
    !reachedCutoff &&
    !capHit &&
    known.length < opts.maxCommits &&
    known.length > 0
  ) {
    const seen = new Set(known.map((commit) => commit.sha));
    const oldest = known[known.length - 1];
    continuation: for (let page = 1; ; page++) {
      if (await stopRequested()) {
        truncated = true;
        break;
      }
      const result = await source.listCommits(oldest.sha, {
        page,
        perPage: COMMITS_PER_PAGE,
      });
      await report(fromCacheTotal);
      for (const commit of result.commits) {
        if (seen.has(commit.sha)) continue;
        if (known.length >= opts.maxCommits) {
          truncated = true;
          break continuation;
        }
        seen.add(commit.sha);
        known.push(commit);
      }
      if (!result.hasMore || result.commits.length === 0) {
        complete = true;
        break;
      }
    }
  }

  // Remember what this run learned, when it is contiguous from the tip and
  // not a shorter view of what the cache already holds.
  const replacesCache = !cached || cacheUsable || exhausted || capHit;
  if (opts.store && known.length > 0 && replacesCache) {
    const kept = known.slice(0, COMMIT_CACHE_MAX);
    await opts.store.save({
      branch: ref,
      tipSha: kept[0].sha,
      complete: complete && kept.length === known.length,
      walkedAt: now.toISOString(),
      commits: kept,
    });
  }

  // The view this run wanted: inside the window, under the cap.
  let commits = known;
  if (Number.isFinite(cutoff)) {
    const firstOld = commits.findIndex((commit) => authoredMs(commit) < cutoff);
    if (firstOld >= 0) commits = commits.slice(0, firstOld);
  }
  if (commits.length > opts.maxCommits) {
    commits = commits.slice(0, opts.maxCommits);
    truncated = true;
  }
  const returnedComplete = complete && commits.length === known.length;
  // Fresh commits lead, cached ones follow, continuation comes last.
  const fromCache = Math.min(
    fromCacheTotal,
    Math.max(0, commits.length - fresh.length)
  );
  return {
    commits,
    truncated,
    complete: returnedComplete,
    fromCache,
    cancelled,
  };
}
