import { type NextRequest, NextResponse } from "next/server";
import { repoFileCache } from "~/lib/integrations/cache/RepoFileCache";
import {
  isRouteResponse,
  providerErrorResponse,
  resolveRepoRouteContext,
} from "~/lib/services/impact/repoRouteContext";

/**
 * GET /api/code-repositories/[id]/files?configId=
 * The cached file list for a project config (the Code Pin file picker).
 * Privacy-mode configs (cacheEnabled=false) list live from the provider.
 * 409 when the cache is empty so the UI can ask an admin to refresh it.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await resolveRepoRouteContext(req, params);
  if (isRouteResponse(ctx)) return ctx;
  const { config, adapter } = ctx;

  try {
    if (!config.cacheEnabled) {
      const branch = config.branch ?? (await adapter.getDefaultBranch());
      const { files, truncated } = await adapter.listAllFiles(branch);
      return NextResponse.json({
        files,
        meta: null,
        truncated: truncated === true,
        source: "live",
      });
    }

    const [files, meta] = await Promise.all([
      repoFileCache.getFiles(config.id),
      repoFileCache.getMeta(config.id),
    ]);
    if (!files) {
      return NextResponse.json({ error: "cache_empty", meta }, { status: 409 });
    }
    return NextResponse.json({
      files,
      meta,
      truncated: meta?.truncated === true,
      source: "cache",
    });
  } catch (error) {
    return providerErrorResponse(error);
  }
}
