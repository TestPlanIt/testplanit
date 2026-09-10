import { NextResponse, type NextRequest } from "next/server";
import { baseDb } from "~/lib/db";
import {
  authenticateRunRequest,
  isRouteResponse,
  parseId,
} from "~/lib/execution/runAccess";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * GET /api/test-runs/{testRunId}/executions?limit=
 * Dispatch history for a run, newest first. Never includes credentials.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ testRunId: string }> }
) {
  const { testRunId } = await params;
  const runId = parseId(testRunId);
  const ctx = await authenticateRunRequest(request, runId);
  if (isRouteResponse(ctx)) return ctx;

  const limitRaw = Number.parseInt(
    request.nextUrl.searchParams.get("limit") ?? "",
    10
  );
  const limit = Number.isInteger(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const executions = await baseDb.testRunExecution.findMany({
    where: { testRunId: runId },
    orderBy: { id: "desc" },
    take: limit,
    select: {
      id: true,
      status: true,
      provider: true,
      ref: true,
      externalRunId: true,
      externalUrl: true,
      externalStatus: true,
      error: true,
      selectionCount: true,
      requestedCaseIds: true,
      dispatchedAt: true,
      resultsReceivedAt: true,
      completedAt: true,
      createdAt: true,
      target: {
        select: { id: true, name: true, provider: true, timeoutMinutes: true },
      },
      requestedBy: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json(
    { executions },
    { headers: { "Cache-Control": "no-store" } }
  );
}
