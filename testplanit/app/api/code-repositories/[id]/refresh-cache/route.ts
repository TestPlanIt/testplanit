import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import micromatch from "micromatch";
import { authOptions } from "~/server/auth";
import { prisma } from "@/lib/prisma";
import { createGitRepoAdapter } from "~/lib/integrations/adapters/GitRepoAdapter";
import { repoFileCache, type RepoFileEntry } from "~/lib/integrations/cache/RepoFileCache";

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

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { access: true },
    });

    if (
      !user?.access ||
      !["ADMIN", "PROJECTADMIN"].includes(user.access)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // params.id is the repository id (for URL consistency), but we operate on the config
    await params; // consume params to avoid Next.js warning

    const body = await req.json();
    const { projectConfigId, step = "all" } = body;

    if (!projectConfigId) {
      return NextResponse.json(
        { error: "projectConfigId is required" },
        { status: 400 }
      );
    }

    // Load repo config
    const config = await prisma.projectCodeRepositoryConfig.findUnique({
      where: { id: parseInt(projectConfigId) },
      include: {
        repository: {
          select: { credentials: true, settings: true, provider: true },
        },
      },
    });

    if (!config) {
      return NextResponse.json(
        { error: "Config not found" },
        { status: 404 }
      );
    }

    if (!(config as any).cacheEnabled) {
      return NextResponse.json(
        { success: false, error: "File caching is disabled for this project" },
        { status: 400 }
      );
    }

    const credentials = config.repository.credentials as Record<string, string>;

    const adapter = createGitRepoAdapter(
      config.repository.provider,
      credentials,
      config.repository.settings as Record<string, string> | null
    );

    const branch = config.branch || (await adapter.getDefaultBranch());

    // ─── Step: contents-only ───────────────────────────────────────────────
    // Called after a successful "list-only" step. Reads the already-cached file
    // list and fetches content, without touching the file-list cache or DB status.
    if (step === "contents-only") {
      const cachedFiles = await repoFileCache.getFiles(config.id);
      if (!cachedFiles || cachedFiles.length === 0) {
        return NextResponse.json(
          { success: false, error: "No cached file list — run list step first" },
          { status: 400 }
        );
      }

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
              `[refresh-cache] Rate limited — stopping content fetch after ${contentMap.size}/${cachedFiles.length} files cached`
            );
          } else {
            console.warn(`[refresh-cache] Skipping content for a file:`, result.reason);
          }
        }
      }

      if (contentMap.size > 0) {
        await repoFileCache.setFileContents(config.id, contentMap, config.cacheTtlDays);
      }

      return NextResponse.json({
        success: true,
        contentCached: contentMap.size,
        contentTotal: cachedFiles.length,
        contentRateLimited,
      });
    }

    // ─── Step: list-only or all ─────────────────────────────────────────────
    // Invalidate existing cache and fetch a fresh file list.
    await repoFileCache.invalidate(config.id);

    // Update DB status to "pending" immediately (UI can show loading state)
    await prisma.projectCodeRepositoryConfig.update({
      where: { id: config.id },
      data: { cacheStatus: "pending", cacheError: null },
    });

    try {
      const pathPatterns = (config.pathPatterns as unknown as PathPattern[]) ?? [];
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
      await prisma.projectCodeRepositoryConfig.update({
        where: { id: config.id },
        data: {
          cacheStatus: "success",
          cacheLastFetchedAt: new Date(),
          cacheFileCount: files.length,
          cacheTotalSize: BigInt(totalSize),
          cacheError: null,
        },
      });

      // If step === "list-only", stop here and let the client handle contents
      if (step === "list-only") {
        return NextResponse.json({
          success: true,
          fileCount: files.length,
          totalSize,
          truncated: truncated ?? false,
        });
      }

      // step === "all": also fetch and cache file contents in one round-trip
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
              `[refresh-cache] Rate limited — stopping content fetch after ${contentMap.size}/${files.length} files cached`
            );
          } else {
            console.warn(`[refresh-cache] Skipping content for a file:`, result.reason);
          }
        }
      }

      if (contentMap.size > 0) {
        await repoFileCache.setFileContents(config.id, contentMap, config.cacheTtlDays);
      }

      return NextResponse.json({
        success: true,
        fileCount: files.length,
        totalSize,
        truncated: truncated ?? false,
        contentCached: contentMap.size,
        contentRateLimited,
      });
    } catch (fetchErr: unknown) {
      const errorMessage =
        fetchErr instanceof Error
          ? fetchErr.message
          : "Unknown error during file fetch";

      // Store error in both Valkey and DB
      await repoFileCache.setError(config.id, errorMessage, config.cacheTtlDays);
      await prisma.projectCodeRepositoryConfig.update({
        where: { id: config.id },
        data: {
          cacheStatus: "error",
          cacheLastFetchedAt: new Date(),
          cacheError: errorMessage,
        },
      });

      return NextResponse.json(
        { success: false, error: errorMessage },
        { status: 500 }
      );
    }
  } catch (err: unknown) {
    console.error("[POST refresh-cache]:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
