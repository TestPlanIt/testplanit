import { prisma } from "@/lib/prisma";
import micromatch from "micromatch";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import {
  createGitRepoAdapter,
  RepoFileEntry
} from "~/lib/integrations/adapters/GitRepoAdapter";
import { authOptions } from "~/server/auth";

const MAX_CONTEXT_BYTES = 500_000; // 500KB — Phase 2 will derive from LLM token budget

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
    // Combine basePath + pattern into a single glob
    const trimmedBase = basePath.replace(/\/$/, "");
    const globPattern = trimmedBase ? `${trimmedBase}/${pattern}` : pattern;
    const matchedPaths = micromatch(
      allFiles.map((f) => f.path),
      globPattern
    );
    matchedPaths.forEach((p: string) => matched.add(p));
  }

  return allFiles
    .filter((f) => matched.has(f.path))
    .sort((a, b) => a.path.localeCompare(b.path));
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

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  // Auth checks — return JSON errors before we start streaming
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

  const { id } = await params;
  const body = await req.json();
  const {
    branch,
    pathPatterns = [],
  }: { branch?: string; pathPatterns?: PathPattern[] } = body;

  const repo = await prisma.codeRepository.findUnique({
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

        // Step 1: Resolve branch
        send({ type: "progress", step: "branch" });
        const resolvedBranch = branch || (await adapter.getDefaultBranch());

        // Step 2: Fetch files — use path-scoped listing when paths are available
        const basePaths = extractBasePaths(pathPatterns);
        const scopeLabel = basePaths.length > 0
          ? basePaths.join(", ")
          : "repository root";
        send({ type: "progress", step: "listing", scope: scopeLabel });

        const { files: allFiles, truncated } =
          await adapter.listFilesInPaths(
            resolvedBranch,
            basePaths,
            (filesFound) => {
              send({ type: "progress", step: "listing", filesFound, scope: scopeLabel });
            }
          );

        // Step 3: Apply glob pattern filtering
        send({ type: "progress", step: "filtering", totalFiles: allFiles.length });
        const filteredFiles = applyPathPatterns(allFiles, pathPatterns);

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
