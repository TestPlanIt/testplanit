import { baseDb } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import {
  createGitRepoAdapter,
  type RepoFileEntry,
} from "~/lib/integrations/adapters/GitRepoAdapter";
import { repoFileCache } from "~/lib/integrations/cache/RepoFileCache";
import {
  applyPathPatterns,
  extractBasePathScopes,
  type PathPattern,
} from "~/lib/integrations/repoPathPatterns";
import { authOptions } from "~/server/auth";

const MAX_CONTEXT_BYTES = 500_000;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  // Auth checks — return JSON errors before we start streaming
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await baseDb.user.findUnique({
    where: { id: session.user.id },
    select: { access: true },
  });

  if (!user?.access || !["ADMIN", "PROJECTADMIN"].includes(user.access)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const {
    branch,
    pathPatterns = [],
    cacheEnabled = true,
  }: {
    branch?: string;
    pathPatterns?: PathPattern[];
    cacheEnabled?: boolean;
  } = body;

  const repo = await baseDb.codeRepository.findUnique({
    where: { id: parseInt(id) },
    select: {
      credentials: true,
      settings: true,
      provider: true,
      name: true,
    },
  });

  if (!repo) {
    return NextResponse.json(
      { error: "Repository not found" },
      { status: 404 }
    );
  }

  // Stream SSE events so the client gets progress updates
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
        );
      };

      try {
        const credentials = repo.credentials as Record<string, string>;
        const adapter = createGitRepoAdapter(
          repo.provider,
          credentials,
          repo.settings as Record<string, string> | null
        );

        // Surface rate-limit waits as progress so the user sees we're backing
        // off and retrying rather than staring at a frozen spinner.
        adapter.onRateLimitWait = (waitSeconds) => {
          send({ type: "progress", step: "rate-limited", waitSeconds });
        };

        // Step 1: Resolve branch
        send({ type: "progress", step: "branch" });
        const resolvedBranch = branch || (await adapter.getDefaultBranch());

        // Step 2: Fetch files — use path-scoped listing when paths are
        // available, bounding each base's scan depth to what its glob needs so
        // a non-recursive root pattern (e.g. "." + "*.md") doesn't crawl the
        // whole repo.
        const scopes = extractBasePathScopes(pathPatterns);
        const basePaths = scopes.map((s) => s.path);
        const maxDepthByPath = Object.fromEntries(
          scopes.map((s) => [s.path, s.maxDepth])
        );
        // Depth-aware cache key: tuning a glob from "*.md" to "**/*.md" changes
        // the scan depth, so the cached listing must not be reused across them.
        const scopeKeys = scopes.map((s) => `${s.path}@${s.maxDepth}`);
        const scopeLabel =
          basePaths.length > 0
            ? basePaths.map((p) => p || "repository root").join(", ")
            : "repository root";
        send({ type: "progress", step: "listing", scope: scopeLabel });

        // The listing (paths + sizes) is independent of the glob patterns, so a
        // short-lived cache lets re-previews while tuning patterns reuse one
        // provider call instead of re-listing (and risking rate limits) each
        // time. Skipped in privacy mode (caching disabled).
        const repoId = parseInt(id);
        let allFiles: RepoFileEntry[];
        let truncated: boolean | undefined;

        const cachedList = cacheEnabled
          ? await repoFileCache.getPreviewList(
              repoId,
              resolvedBranch,
              scopeKeys
            )
          : null;

        if (cachedList) {
          allFiles = cachedList.files;
          truncated = cachedList.truncated;
          send({
            type: "progress",
            step: "listing",
            filesFound: allFiles.length,
            scope: scopeLabel,
            cached: true,
          });
        } else {
          const listed = await adapter.listFilesInPaths(
            resolvedBranch,
            basePaths,
            (filesFound) => {
              send({
                type: "progress",
                step: "listing",
                filesFound,
                scope: scopeLabel,
              });
            },
            maxDepthByPath
          );
          allFiles = listed.files;
          truncated = listed.truncated;

          if (cacheEnabled) {
            await repoFileCache.setPreviewList(
              repoId,
              resolvedBranch,
              scopeKeys,
              { files: allFiles, truncated: truncated ?? false }
            );
          }
        }

        // Step 3: Apply glob pattern filtering
        send({
          type: "progress",
          step: "filtering",
          totalFiles: allFiles.length,
        });
        const filteredFiles = applyPathPatterns(allFiles, pathPatterns).sort(
          (a, b) => a.path.localeCompare(b.path)
        );

        const totalSize = filteredFiles.reduce(
          (sum, f) => sum + (f.size ?? 0),
          0
        );
        const exceedsLimit = totalSize > MAX_CONTEXT_BYTES;

        // Final result
        send({
          type: "complete",
          files: filteredFiles,
          fileCount: filteredFiles.length,
          totalSize,
          totalSizeFormatted: formatBytes(totalSize),
          exceedsLimit,
          overflowBytes: exceedsLimit ? totalSize - MAX_CONTEXT_BYTES : 0,
          truncated: truncated ?? false,
        });
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to fetch file list";
        console.error("[POST preview-files]:", err);
        send({ type: "error", error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
