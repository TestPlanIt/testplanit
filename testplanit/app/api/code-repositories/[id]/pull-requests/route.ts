import { createHash } from "crypto";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import {
  PullRequestsUnsupportedError,
  type ListPullRequestsResult,
} from "~/lib/integrations/adapters/GitRepoAdapter";
import { repoFileCache } from "~/lib/integrations/cache/RepoFileCache";
import {
  isRouteResponse,
  providerErrorResponse,
  resolveRepoRouteContext,
} from "~/lib/services/impact/repoRouteContext";

const querySchema = z.object({
  state: z.enum(["all", "open", "merged", "closed"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(255).optional(),
});

/**
 * GET /api/code-repositories/[id]/pull-requests?configId=&state=&page=&perPage=
 * Pull requests (merge requests on GitLab) newest first, as an alternative to
 * naming two commits by hand. A provider without the concept answers 501 so
 * the picker can hide the mode rather than show an error.
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
  const { state, page, perPage, search } = parsed.data;

  try {
    const hash = createHash("sha1")
      .update(`${state}\n${page}\n${perPage}`)
      .digest("hex")
      .slice(0, 16);

    // The search term filters what the provider returned, so it stays out of
    // the cache key: one fetch serves every keystroke.
    let result = config.cacheEnabled
      ? await repoFileCache.getRefList<ListPullRequestsResult>(
          config.repositoryId,
          "pull-requests",
          hash
        )
      : null;
    if (!result) {
      result = await adapter.listPullRequests({ state, page, perPage });
      if (config.cacheEnabled) {
        await repoFileCache.setRefList(
          config.repositoryId,
          "pull-requests",
          hash,
          result
        );
      }
    }

    const needle = search?.toLowerCase();
    const pullRequests = needle
      ? result.pullRequests.filter(
          (pr) =>
            pr.title.toLowerCase().includes(needle) ||
            String(pr.number).includes(needle) ||
            (pr.authorName ?? "").toLowerCase().includes(needle) ||
            pr.sourceBranch.toLowerCase().includes(needle)
        )
      : result.pullRequests;

    return NextResponse.json({
      state,
      page,
      perPage,
      pullRequests,
      hasMore: result.hasMore,
    });
  } catch (error) {
    if (error instanceof PullRequestsUnsupportedError) {
      return NextResponse.json(
        { error: error.message, code: "unsupported" },
        { status: 501 }
      );
    }
    return providerErrorResponse(error);
  }
}
