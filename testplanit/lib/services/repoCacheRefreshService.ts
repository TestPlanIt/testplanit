import type { DbClient } from "~/lib/zenstack";
import {
  createGitRepoAdapter,
  type ArchiveTree,
} from "~/lib/integrations/adapters/GitRepoAdapter";
import {
  repoFileCache,
  type RepoFileEntry,
} from "~/lib/integrations/cache/RepoFileCache";
import {
  applyPathPatterns,
  extractBasePathScopes,
  type PathPattern,
} from "~/lib/integrations/repoPathPatterns";

function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("rate limit") || msg.includes("429");
}

const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RETRY_SECONDS = 60;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch file contents with rate-limit retry. On 429, waits for the
 * Retry-After period, drops to sequential fetching, and continues.
 * Gives up after MAX_RATE_LIMIT_RETRIES consecutive rate-limit hits.
 */
async function fetchContentsBatched(
  files: RepoFileEntry[],
  adapter: {
    getFileContent(path: string, branch: string): Promise<string>;
    retryAfterSeconds: number;
  },
  branch: string,
  initialConcurrency: number
): Promise<{ contentMap: Map<string, string>; contentRateLimited: boolean }> {
  const contentMap = new Map<string, string>();
  let concurrency = initialConcurrency;
  let consecutiveRateLimits = 0;
  let i = 0;

  while (i < files.length) {
    if (consecutiveRateLimits >= MAX_RATE_LIMIT_RETRIES) {
      console.warn(
        `[repoCacheRefresh] Giving up after ${MAX_RATE_LIMIT_RETRIES} consecutive rate limits — ${contentMap.size}/${files.length} files cached`
      );
      return { contentMap, contentRateLimited: true };
    }

    const batch = files.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (file) => {
        const content = await adapter.getFileContent(file.path, branch);
        return { path: file.path, content };
      })
    );

    let batchRateLimited = false;

    for (const result of results) {
      if (result.status === "fulfilled") {
        contentMap.set(result.value.path, result.value.content);
      } else if (isRateLimitError(result.reason)) {
        batchRateLimited = true;
      } else {
        console.warn(
          `[repoCacheRefresh] Skipping content for a file:`,
          result.reason
        );
      }
    }

    if (batchRateLimited) {
      consecutiveRateLimits++;
      // Drop to sequential and wait before retrying
      concurrency = 1;
      const waitSeconds = adapter.retryAfterSeconds || DEFAULT_RETRY_SECONDS;
      console.warn(
        `[repoCacheRefresh] Rate limited (attempt ${consecutiveRateLimits}/${MAX_RATE_LIMIT_RETRIES}) — waiting ${waitSeconds}s, then continuing sequentially (${contentMap.size}/${files.length} cached so far)`
      );
      await sleep(waitSeconds * 1000);
      // Don't advance i — retry the files that failed in this batch
      // (successful ones are already in contentMap and will be skipped by the adapter's cache or deduped by Map.set)
      continue;
    }

    // Batch succeeded — reset rate-limit counter and advance
    consecutiveRateLimits = 0;
    i += concurrency;
  }

  return { contentMap, contentRateLimited: false };
}

export interface RefreshResult {
  success: boolean;
  fileCount: number;
  totalSize: number;
  truncated: boolean;
  contentCached: number;
  contentRateLimited: boolean;
  error?: string;
}

/**
 * Refresh the code repository cache for a given ProjectCodeRepositoryConfig.
 *
 * This is the shared logic used by both the API route (manual refresh) and
 * the background worker (automatic refresh on expiry).
 *
 * Performs: invalidate old cache → fetch file list → store in Valkey →
 * fetch file contents → store in Valkey → update DB status.
 */
export async function refreshRepoCache(
  configId: number,
  dbClient: DbClient
): Promise<RefreshResult> {
  const config = await (dbClient as any).projectCodeRepositoryConfig.findUnique(
    {
      where: { id: configId },
      include: {
        repository: {
          select: { credentials: true, settings: true, provider: true },
        },
      },
    }
  );

  if (!config) {
    throw new Error(`ProjectCodeRepositoryConfig ${configId} not found`);
  }

  if (!config.cacheEnabled) {
    return {
      success: false,
      fileCount: 0,
      totalSize: 0,
      truncated: false,
      contentCached: 0,
      contentRateLimited: false,
      error: "File caching is disabled for this project",
    };
  }

  const credentials = config.repository.credentials as Record<string, string>;
  const adapter = createGitRepoAdapter(
    config.repository.provider,
    credentials,
    config.repository.settings as Record<string, string> | null
  );
  const branch = config.branch || (await adapter.getDefaultBranch());

  // Invalidate existing cache
  await repoFileCache.invalidate(config.id);

  // Update DB status to "pending"
  await (dbClient as any).projectCodeRepositoryConfig.update({
    where: { id: config.id },
    data: { cacheStatus: "pending", cacheError: null },
  });

  try {
    const pathPatterns =
      (config.pathPatterns as unknown as PathPattern[]) ?? [];

    let files: RepoFileEntry[];
    let truncated = false;
    let contentMap: Map<string, string>;
    let contentRateLimited = false;

    // Prefer ONE archive download that yields BOTH the file list and the file
    // contents (like `git clone`) — no per-directory API tree-walk and no
    // per-file rate limits. Fall back to the API tree-walk + per-file fetch
    // when the provider has no archive support or the archive download fails.
    let tree: ArchiveTree | null = null;
    try {
      tree = await adapter.downloadArchiveTree(branch);
    } catch (archiveErr) {
      console.warn(
        `[repoCacheRefresh] Archive download failed, falling back to tree-walk + per-file fetch:`,
        archiveErr
      );
      tree = null;
    }

    if (tree) {
      const matched = applyPathPatterns(tree.files, pathPatterns);
      contentMap = await tree.getContents(new Set(matched.map((f) => f.path)));
      // Archive entries carry no size up front — resolve it from the
      // decompressed content so cacheTotalSize stays accurate.
      files = matched.map((f) => ({
        ...f,
        size: Buffer.byteLength(contentMap.get(f.path) ?? "", "utf8"),
      }));
    } else {
      // Bound each base's scan depth to its glob so a non-recursive root pattern
      // (e.g. "." + "*.md") doesn't crawl the whole repo.
      const scopes = extractBasePathScopes(pathPatterns);
      const basePaths = scopes.map((s) => s.path);
      const maxDepthByPath = Object.fromEntries(
        scopes.map((s) => [s.path, s.maxDepth])
      );
      const listing = await adapter.listFilesInPaths(
        branch,
        basePaths,
        undefined,
        maxDepthByPath
      );
      truncated = listing.truncated ?? false;
      files = applyPathPatterns(listing.files, pathPatterns);
      ({ contentMap, contentRateLimited } = await fetchContentsBatched(
        files,
        adapter,
        branch,
        10
      ));
    }

    const totalSize = files.reduce((sum, f) => sum + (f.size ?? 0), 0);

    // Store file list in Valkey
    await repoFileCache.setFiles(config.id, files, config.cacheTtlDays, {
      truncated,
    });

    // Record the file list now so the UI can show the list count. Status stays
    // "pending" until contents are cached so "success" never lies about content
    // being available.
    await (dbClient as any).projectCodeRepositoryConfig.update({
      where: { id: config.id },
      data: {
        cacheLastFetchedAt: new Date(),
        cacheFileCount: files.length,
        cacheTotalSize: BigInt(totalSize),
        cacheError: null,
      },
    });

    if (contentMap.size > 0) {
      await repoFileCache.setFileContents(
        config.id,
        contentMap,
        config.cacheTtlDays
      );
    }

    // Finalize: mark success now that contents are cached. cacheContentFileCount
    // records how many file contents were actually stored — the UI warns when
    // it is below the file count (e.g. a rate-limited per-file fallback).
    await (dbClient as any).projectCodeRepositoryConfig.update({
      where: { id: config.id },
      data: {
        cacheStatus: "success",
        cacheContentFileCount: contentMap.size,
      },
    });

    return {
      success: true,
      fileCount: files.length,
      totalSize,
      truncated,
      contentCached: contentMap.size,
      contentRateLimited,
    };
  } catch (fetchErr: unknown) {
    const errorMessage =
      fetchErr instanceof Error
        ? fetchErr.message
        : "Unknown error during file fetch";

    // Store error in both Valkey and DB
    await repoFileCache.setError(config.id, errorMessage, config.cacheTtlDays);
    await (dbClient as any).projectCodeRepositoryConfig.update({
      where: { id: config.id },
      data: {
        cacheStatus: "error",
        cacheLastFetchedAt: new Date(),
        cacheError: errorMessage,
      },
    });

    return {
      success: false,
      fileCount: 0,
      totalSize: 0,
      truncated: false,
      contentCached: 0,
      contentRateLimited: false,
      error: errorMessage,
    };
  }
}
