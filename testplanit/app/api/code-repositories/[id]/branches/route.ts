import { type NextRequest, NextResponse } from "next/server";
import {
  type GitRepoAdapter,
  MAX_BRANCHES,
  type RepoBranch,
} from "~/lib/integrations/adapters/GitRepoAdapter";
import { repoFileCache } from "~/lib/integrations/cache/RepoFileCache";
import {
  isRouteResponse,
  providerErrorResponse,
  resolveRepoRouteContext,
} from "~/lib/services/impact/repoRouteContext";

interface BranchesPayload {
  branches: RepoBranch[];
  defaultBranch: string | null;
}

interface CacheScope {
  repositoryId: number;
  cacheEnabled: boolean;
}

/** The first MAX_BRANCHES branches, from the short-lived cache when it has them. */
async function loadBranches(
  scope: CacheScope,
  adapter: GitRepoAdapter
): Promise<BranchesPayload> {
  const cached = scope.cacheEnabled
    ? await repoFileCache.getRefList<BranchesPayload>(
        scope.repositoryId,
        "branches",
        "all"
      )
    : null;
  if (cached) return cached;
  const branches = await adapter.listBranches();
  const payload: BranchesPayload = {
    branches,
    defaultBranch: branches.find((b) => b.isDefault)?.name ?? null,
  };
  if (scope.cacheEnabled) {
    await repoFileCache.setRefList(
      scope.repositoryId,
      "branches",
      "all",
      payload
    );
  }
  return payload;
}

/** Branches the provider finds for `query`, cached per query like the list. */
async function searchBranches(
  scope: CacheScope,
  adapter: GitRepoAdapter,
  query: string
): Promise<RepoBranch[]> {
  const key = `q:${query.toLowerCase()}`;
  const cached = scope.cacheEnabled
    ? await repoFileCache.getRefList<RepoBranch[]>(
        scope.repositoryId,
        "branches",
        key
      )
    : null;
  if (cached) return cached;
  const branches = await adapter.searchBranches(query);
  if (scope.cacheEnabled) {
    await repoFileCache.setRefList(
      scope.repositoryId,
      "branches",
      key,
      branches
    );
  }
  return branches;
}

/**
 * GET /api/code-repositories/[id]/branches?configId=&q=
 * Branches of the repository bound to a project config the caller can read.
 * Without `q`, the first MAX_BRANCHES branches; `truncated` says whether the
 * repository has more. With `q`, the loaded branches whose name contains it
 * and, when the list is truncated, whatever the provider finds for it.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await resolveRepoRouteContext(req, params);
  if (isRouteResponse(ctx)) return ctx;
  const { config, adapter } = ctx;
  const query = req.nextUrl.searchParams.get("q")?.trim() ?? "";

  try {
    const payload = await loadBranches(config, adapter);
    const truncated = payload.branches.length >= MAX_BRANCHES;
    let branches = payload.branches;
    if (query) {
      const needle = query.toLowerCase();
      branches = branches.filter((b) => b.name.toLowerCase().includes(needle));
      if (truncated) {
        const seen = new Set(branches.map((b) => b.name));
        const remote = await searchBranches(config, adapter, query);
        branches = branches.concat(remote.filter((b) => !seen.has(b.name)));
      }
    }
    return NextResponse.json({
      ...payload,
      branches,
      truncated,
      query,
      configuredBranch: config.branch,
    });
  } catch (error) {
    return providerErrorResponse(error);
  }
}
