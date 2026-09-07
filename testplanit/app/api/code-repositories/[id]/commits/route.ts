import { createHash } from "crypto";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import type { ListCommitsResult } from "~/lib/integrations/adapters/GitRepoAdapter";
import { repoFileCache } from "~/lib/integrations/cache/RepoFileCache";
import { isSafeRepoPath } from "~/lib/services/impact/fileAtCommit";
import {
  isRouteResponse,
  providerErrorResponse,
  resolveRepoRouteContext,
} from "~/lib/services/impact/repoRouteContext";

const querySchema = z.object({
  ref: z.string().trim().min(1).max(255).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(30),
  path: z.string().max(4096).optional(),
});

/**
 * GET /api/code-repositories/[id]/commits?configId=&ref=&page=&perPage=&path=
 * Commit log for a branch, tag, or sha (newest first). `ref` defaults to the
 * config's branch, then the repository default branch.
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
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", details: parsed.error.issues },
      { status: 400 }
    );
  }
  const { page, perPage, path } = parsed.data;
  if (path !== undefined && !isSafeRepoPath(path)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const ref =
      parsed.data.ref ?? config.branch ?? (await adapter.getDefaultBranch());
    const hash = createHash("sha1")
      .update(`${ref}\n${page}\n${perPage}\n${path ?? ""}`)
      .digest("hex")
      .slice(0, 16);

    let result = config.cacheEnabled
      ? await repoFileCache.getRefList<ListCommitsResult>(
          config.repositoryId,
          "commits",
          hash
        )
      : null;
    if (!result) {
      result = await adapter.listCommits(ref, { page, perPage, path });
      if (config.cacheEnabled) {
        await repoFileCache.setRefList(
          config.repositoryId,
          "commits",
          hash,
          result
        );
      }
    }
    return NextResponse.json({ ref, page, perPage, ...result });
  } catch (error) {
    return providerErrorResponse(error);
  }
}
