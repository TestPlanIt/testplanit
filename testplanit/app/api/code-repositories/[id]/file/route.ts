import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import {
  RefNotFoundError,
  resolveRefToSha,
} from "~/lib/services/impact/compareService";
import {
  FileTooLargeError,
  getFileAtCommit,
  isSafeRepoPath,
} from "~/lib/services/impact/fileAtCommit";
import {
  isRouteResponse,
  providerErrorResponse,
  resolveRepoRouteContext,
} from "~/lib/services/impact/repoRouteContext";

const querySchema = z.object({
  path: z.string().min(1).max(4096),
  ref: z.string().trim().min(1).max(255).optional(),
});

/**
 * GET /api/code-repositories/[id]/file?configId=&path=&ref=
 * One file's text at a commit (code viewer, pin anchoring). `ref` defaults to
 * the config's branch, then the repository default branch, and is resolved
 * to a sha so the response can be anchored.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await resolveRepoRouteContext(req, params);
  if (isRouteResponse(ctx)) return ctx;
  const { config, adapter } = ctx;

  const parsed = querySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries())
  );
  if (!parsed.success || !isSafeRepoPath(parsed.data.path)) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }
  const { path } = parsed.data;

  try {
    const ref =
      parsed.data.ref ?? config.branch ?? (await adapter.getDefaultBranch());
    const sha = await resolveRefToSha(adapter, ref);
    const { content, cached } = await getFileAtCommit({
      configId: config.id,
      cacheEnabled: config.cacheEnabled,
      adapter,
      path,
      sha,
    });
    return NextResponse.json({ path, ref, sha, content, cached });
  } catch (error) {
    if (error instanceof RefNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof FileTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    if (error instanceof Error && /\b404\b/.test(error.message)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    return providerErrorResponse(error);
  }
}
