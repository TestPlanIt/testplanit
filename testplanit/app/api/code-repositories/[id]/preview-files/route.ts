import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "~/server/auth";
import { prisma } from "@/lib/prisma";
import {
  createGitRepoAdapter,
  RepoFileEntry,
} from "~/lib/integrations/adapters/GitRepoAdapter";
import micromatch from "micromatch";

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

    const { id } = await params;
    const body = await req.json();
    const {
      branch,
      pathPatterns = [],
    }: { branch?: string; pathPatterns?: PathPattern[] } = body;

    // Load repository
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

    const credentials = repo.credentials as Record<string, string>;

    const adapter = createGitRepoAdapter(
      repo.provider,
      credentials,
      repo.settings as Record<string, string> | null
    );

    // Resolve branch (use default if not specified)
    const resolvedBranch = branch || (await adapter.getDefaultBranch());

    // Fetch all files
    const { files: allFiles, truncated } =
      await adapter.listAllFiles(resolvedBranch);

    // Apply path patterns
    const filteredFiles = applyPathPatterns(allFiles, pathPatterns);

    const totalSize = filteredFiles.reduce(
      (sum, f) => sum + (f.size ?? 0),
      0
    );
    const exceedsLimit = totalSize > MAX_CONTEXT_BYTES;

    return NextResponse.json({
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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
