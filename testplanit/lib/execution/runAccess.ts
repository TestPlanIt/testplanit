import { NextResponse, type NextRequest } from "next/server";
import { ApplicationArea } from "~/zenstack/models";
import { checkApiRateLimit } from "~/lib/api-rate-limit";
import { authenticateRequest, hasBearerToken } from "~/lib/api-token-auth";
import { baseDb } from "~/lib/db";
import { userCanAddEditArea } from "~/lib/services/projectPermissions";
import { getAuthDb } from "~/lib/zenstack";
import { getServerAuthSession } from "~/server/auth";

/**
 * Shared gate for the execution routes. Accepts a browser session or an API
 * token (the same `tpi_` token the reporters and CLI use), applies the API
 * rate limit to token callers, and resolves the run through the policy
 * client so a caller who cannot read the run is told it does not exist.
 */

export interface RunRequestContext {
  userId: string;
  access: string | null | undefined;
  run: {
    id: number;
    projectId: number;
    isCompleted: boolean;
    testRunType: string;
    compositionLockedAt: Date | null;
  };
}

export async function authenticateRunRequest(
  request: NextRequest,
  runId: number,
  opts: { write?: boolean } = {}
): Promise<RunRequestContext | NextResponse> {
  if (!Number.isInteger(runId) || runId <= 0) {
    return NextResponse.json({ error: "Invalid test run id" }, { status: 400 });
  }

  const session = await getServerAuthSession();
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
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": String(limit.limit),
            "X-RateLimit-Remaining": String(limit.remaining),
            "X-RateLimit-Reset": String(limit.resetAt),
          },
        }
      );
    }
  }

  const userRecord = await baseDb.user.findUnique({
    where: { id: auth.user.userId },
    include: { role: { include: { rolePermissions: true } } },
  });
  if (!userRecord) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }
  const reader =
    userRecord.access === "ADMIN"
      ? (baseDb as unknown as typeof baseDb)
      : ((await getAuthDb(userRecord)) as unknown as typeof baseDb);
  const run = await reader.testRuns.findFirst({
    where: { id: runId, isDeleted: false },
    select: {
      id: true,
      projectId: true,
      isCompleted: true,
      testRunType: true,
      compositionLockedAt: true,
    },
  });
  if (!run) {
    return NextResponse.json({ error: "Test run not found" }, { status: 404 });
  }

  if (opts.write) {
    const canEdit = await userCanAddEditArea(
      auth.user.userId,
      run.projectId,
      ApplicationArea.TestRuns,
      auth.user.access
    );
    if (!canEdit) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return { userId: auth.user.userId, access: auth.user.access, run };
}

export function isRouteResponse(
  value: RunRequestContext | NextResponse
): value is NextResponse {
  return value instanceof NextResponse;
}

export function parseId(raw: string): number {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : NaN;
}
