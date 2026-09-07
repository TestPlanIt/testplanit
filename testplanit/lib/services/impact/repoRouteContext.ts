import { getServerSession } from "next-auth";
import { type NextRequest, NextResponse } from "next/server";
import { authOptions } from "~/server/auth";
import { loadRepoConfigForUser, type LoadedRepo } from "./repoAccess";

/**
 * Shared gate for GET /api/code-repositories/[id]/{branches,commits,compare,
 * files,file}: 401 -> 400 (ids) -> 404 (config not visible to this user, or
 * not bound to repository [id]). Visibility is the ZenStack policy on
 * ProjectCodeRepositoryConfig, so a tester with project access can read an
 * IMPACT config while QuickScript configs stay admin-only.
 */
export async function resolveRepoRouteContext(
  req: NextRequest,
  params: Promise<{ id: string }>
): Promise<LoadedRepo | NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const repositoryId = Number(id);
  const configRaw = req.nextUrl.searchParams.get("configId");
  const configId = configRaw ? Number(configRaw) : NaN;
  if (!Number.isInteger(repositoryId) || !Number.isInteger(configId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const loaded = await loadRepoConfigForUser(session, configId, {
    repositoryId,
  });
  if (!loaded) {
    return NextResponse.json(
      { error: "Repository configuration not found" },
      { status: 404 }
    );
  }
  return loaded;
}

export function isRouteResponse(
  value: LoadedRepo | NextResponse
): value is NextResponse {
  return value instanceof NextResponse;
}

/** Provider failures surface as 502 with the adapter's message (it already
 * carries rate-limit "retry in N" hints and never echoes credentials). The one
 * exception is a 404: the ref or path the caller named does not exist, which is
 * the caller's answer to give, not a gateway failure to report. */
export function providerErrorResponse(error: unknown): NextResponse {
  const message =
    error instanceof Error ? error.message : "Repository request failed";
  const status = /^HTTP 404\b/.test(message) ? 404 : 502;
  return NextResponse.json({ error: message }, { status });
}
