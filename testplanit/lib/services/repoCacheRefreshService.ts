import type { PrismaClient } from "@prisma/client";
import micromatch from "micromatch";
import { createGitRepoAdapter } from "~/lib/integrations/adapters/GitRepoAdapter";
import {
  repoFileCache,
  type RepoFileEntry
} from "~/lib/integrations/cache/RepoFileCache";

interface PathPattern {
  path: string;
  pattern: string;
}

function applyPathPatterns(
  allFiles: RepoFileEntry[],
  pathPatterns: PathPattern[]
): RepoFileEntry[] {
  if (!pathPatterns.length) return allFiles;

  const matched = new Set<string>();
  for (const { path: basePath, pattern } of pathPatterns) {
    const trimmedBase = basePath.replace(/\/$/, "");
    const globPattern = trimmedBase ? `${trimmedBase}/${pattern}` : pattern;
    const matchedPaths = micromatch(
      allFiles.map((f) => f.path),
      globPattern
    );
    matchedPaths.forEach((p: string) => matched.add(p));
  }

  return allFiles.filter((f) => matched.has(f.path));
}

/** Extract unique base directory paths from PathPattern[] for scoped listing. */
function extractBasePaths(pathPatterns: PathPattern[]): string[] {
  if (!pathPatterns.length) return [];
  const paths = new Set<string>();
  for (const { path: basePath } of pathPatterns) {
    const trimmed = basePath.replace(/\/$/, "");
    if (trimmed) paths.add(trimmed);
  }
  return paths.size > 0 ? [...paths] : [];
}

function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("rate limit") || msg.includes("429");
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
  prismaClient: PrismaClient
): Promise<RefreshResult> {
  const config = await (prismaClient as any).projectCodeRepositoryConfig.findUnique({
    where: { id: configId },
    include: {
      repository: {
        select: { credentials: true, settings: true, provider: true },
      },
    },
  });

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
  await (prismaClient as any).projectCodeRepositoryConfig.update({
    where: { id: config.id },
    data: { cacheStatus: "pending", cacheError: null },
  });

  try {
    const pathPatterns =
      (config.pathPatterns as unknown as PathPattern[]) ?? [];
    const basePaths = extractBasePaths(pathPatterns);

    const { files: allFiles, truncated } = await adapter.listFilesInPaths(
      branch,
      basePaths
    );

    // Apply glob pattern filtering
    const files = applyPathPatterns(allFiles, pathPatterns);

    // Store file list in Valkey
    await repoFileCache.setFiles(config.id, files, config.cacheTtlDays, {
      truncated: truncated ?? false,
    });

    const totalSize = files.reduce((sum, f) => sum + (f.size ?? 0), 0);

    // Update DB with success status
    await (prismaClient as any).projectCodeRepositoryConfig.update({
      where: { id: config.id },
      data: {
        cacheStatus: "success",
        cacheLastFetchedAt: new Date(),
        cacheFileCount: files.length,
        cacheTotalSize: BigInt(totalSize),
        cacheError: null,
      },
    });

    // Fetch and cache file contents
    const CONTENT_FETCH_CONCURRENCY = 10;
    const contentMap = new Map<string, string>();
    let contentRateLimited = false;

    for (let i = 0; i < files.length; i += CONTENT_FETCH_CONCURRENCY) {
      if (contentRateLimited) break;

      const batch = files.slice(i, i + CONTENT_FETCH_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (file) => {
          const content = await adapter.getFileContent(file.path, branch);
          return { path: file.path, content };
        })
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          contentMap.set(result.value.path, result.value.content);
        } else if (isRateLimitError(result.reason)) {
          contentRateLimited = true;
          console.warn(
            `[repoCacheRefresh] Rate limited — stopping content fetch after ${contentMap.size}/${files.length} files cached`
          );
        } else {
          console.warn(
            `[repoCacheRefresh] Skipping content for a file:`,
            result.reason
          );
        }
      }
    }

    if (contentMap.size > 0) {
      await repoFileCache.setFileContents(
        config.id,
        contentMap,
        config.cacheTtlDays
      );
    }

    return {
      success: true,
      fileCount: files.length,
      totalSize,
      truncated: truncated ?? false,
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
    await (prismaClient as any).projectCodeRepositoryConfig.update({
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

/**
 * Refresh only file contents for a config that already has a cached file list.
 * Used by the "contents-only" step in the API route.
 */
export async function refreshRepoCacheContentsOnly(
  configId: number,
  prismaClient: PrismaClient
): Promise<{
  success: boolean;
  contentCached: number;
  contentTotal: number;
  contentRateLimited: boolean;
  error?: string;
}> {
  const config = await (prismaClient as any).projectCodeRepositoryConfig.findUnique({
    where: { id: configId },
    include: {
      repository: {
        select: { credentials: true, settings: true, provider: true },
      },
    },
  });

  if (!config) {
    throw new Error(`ProjectCodeRepositoryConfig ${configId} not found`);
  }

  const cachedFiles = await repoFileCache.getFiles(config.id);
  if (!cachedFiles || cachedFiles.length === 0) {
    return {
      success: false,
      contentCached: 0,
      contentTotal: 0,
      contentRateLimited: false,
      error: "No cached file list — run list step first",
    };
  }

  const credentials = config.repository.credentials as Record<string, string>;
  const adapter = createGitRepoAdapter(
    config.repository.provider,
    credentials,
    config.repository.settings as Record<string, string> | null
  );
  const branch = config.branch || (await adapter.getDefaultBranch());

  const CONTENT_FETCH_CONCURRENCY = 10;
  const contentMap = new Map<string, string>();
  let contentRateLimited = false;

  for (let i = 0; i < cachedFiles.length; i += CONTENT_FETCH_CONCURRENCY) {
    if (contentRateLimited) break;

    const batch = cachedFiles.slice(i, i + CONTENT_FETCH_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (file) => {
        const content = await adapter.getFileContent(file.path, branch);
        return { path: file.path, content };
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        contentMap.set(result.value.path, result.value.content);
      } else if (isRateLimitError(result.reason)) {
        contentRateLimited = true;
        console.warn(
          `[repoCacheRefresh] Rate limited — stopping content fetch after ${contentMap.size}/${cachedFiles.length} files cached`
        );
      } else {
        console.warn(
          `[repoCacheRefresh] Skipping content for a file:`,
          result.reason
        );
      }
    }
  }

  if (contentMap.size > 0) {
    await repoFileCache.setFileContents(
      config.id,
      contentMap,
      config.cacheTtlDays
    );
  }

  return {
    success: true,
    contentCached: contentMap.size,
    contentTotal: cachedFiles.length,
    contentRateLimited,
  };
}
