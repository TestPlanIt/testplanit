import { type NextRequest, NextResponse } from "next/server";
import type { RepoBranch } from "~/lib/integrations/adapters/GitRepoAdapter";
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

/**
 * GET /api/code-repositories/[id]/branches?configId=
 * Branches of the repository bound to a project config the caller can read.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await resolveRepoRouteContext(req, params);
  if (isRouteResponse(ctx)) return ctx;
  const { config, adapter } = ctx;

  try {
    let payload = config.cacheEnabled
      ? await repoFileCache.getRefList<BranchesPayload>(
          config.repositoryId,
          "branches",
          "all"
        )
      : null;
    if (!payload) {
      const branches = await adapter.listBranches();
      payload = {
        branches,
        defaultBranch: branches.find((b) => b.isDefault)?.name ?? null,
      };
      if (config.cacheEnabled) {
        await repoFileCache.setRefList(
          config.repositoryId,
          "branches",
          "all",
          payload
        );
      }
    }
    return NextResponse.json({
      ...payload,
      configuredBranch: config.branch,
    });
  } catch (error) {
    return providerErrorResponse(error);
  }
}
