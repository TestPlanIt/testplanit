import { NextResponse, type NextRequest } from "next/server";
import { checkApiRateLimit } from "~/lib/api-rate-limit";
import { authenticateRequest, hasBearerToken } from "~/lib/api-token-auth";
import type { Actor } from "~/lib/execution/executionTargetsService";

/**
 * Shared gate for the execution-target CRUD routes. Accepts a browser
 * session or an API token, rate-limits token callers, and resolves an
 * `Actor`. Deliberately does not check `canManageExecutionTargets` itself —
 * every service function in executionTargetsService.ts already does that
 * check against the target's own project, so routes just authenticate the
 * caller and let the service authorize the operation.
 */
export async function resolveExecutionTargetActor(
  request: NextRequest,
  session: Parameters<typeof authenticateRequest>[1]
): Promise<{ actor: Actor } | NextResponse> {
  const auth = await authenticateRequest(request, session);
  if (!auth.authenticated) {
    return NextResponse.json(
      {
        error: auth.error,
        ...(auth.errorCode ? { code: auth.errorCode } : {}),
      },
      { status: auth.status }
    );
  }
  if (hasBearerToken(request)) {
    const limit = await checkApiRateLimit();
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429 }
      );
    }
  }
  return { actor: { userId: auth.user.userId, access: auth.user.access } };
}

export function isRouteResponse(
  value: { actor: Actor } | NextResponse
): value is NextResponse {
  return value instanceof NextResponse;
}

export function parseId(raw: string): number {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : NaN;
}
