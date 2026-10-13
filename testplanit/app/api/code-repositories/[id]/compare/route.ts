import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import {
  getOrComputeCompare,
  RefNotFoundError,
  resolveRefToSha,
} from "~/lib/services/impact/compareService";
import {
  isRouteResponse,
  providerErrorResponse,
  resolveRepoRouteContext,
} from "~/lib/services/impact/repoRouteContext";

// Providers without a native file diff (Azure DevOps, Gitea) fetch both sides
// of every changed file; give them room.
export const maxDuration = 120;

const refSchema = z.string().trim().min(1).max(255).regex(/^\S+$/);
const querySchema = z.object({ base: refSchema, head: refSchema });

/**
 * GET /api/code-repositories/[id]/compare?configId=&base=&head=
 * Files changed between two refs. Refs are resolved to shas first so the
 * cache key is immutable.
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
  const { base, head } = parsed.data;

  try {
    const [baseSha, headSha] = await Promise.all([
      resolveRefToSha(adapter, base),
      resolveRefToSha(adapter, head),
    ]);
    if (baseSha === headSha) {
      return NextResponse.json(
        { error: "Base and head resolve to the same commit" },
        { status: 400 }
      );
    }
    const { result, cached } = await getOrComputeCompare({
      configId: config.id,
      cacheEnabled: config.cacheEnabled,
      adapter,
      baseSha,
      headSha,
    });
    return NextResponse.json({
      ...result,
      baseRef: base,
      headRef: head,
      cached,
    });
  } catch (error) {
    if (error instanceof RefNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return providerErrorResponse(error);
  }
}
