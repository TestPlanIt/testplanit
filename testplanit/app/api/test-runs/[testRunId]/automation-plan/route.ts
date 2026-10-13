import { NextResponse, type NextRequest } from "next/server";
import { baseDb } from "~/lib/db";
import { buildAutomationPlan } from "~/lib/execution/plan";
import {
  authenticateRunRequest,
  isRouteResponse,
  parseId,
} from "~/lib/execution/runAccess";

/**
 * GET /api/test-runs/{testRunId}/automation-plan[?executionId=]
 *
 * The plan a CI job pulls after TestPlanIt dispatches it: the run's automated
 * cases with the identifiers a shim script can match on. Accepts a browser
 * session or an API token (read-only tokens are fine). When `executionId`
 * names an execution of this run, its ad-hoc case subset and ref apply.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ testRunId: string }> }
) {
  const { testRunId } = await params;
  const runId = parseId(testRunId);
  const ctx = await authenticateRunRequest(request, runId);
  if (isRouteResponse(ctx)) return ctx;

  let requestedCaseIds: number[] | undefined;
  let executionId: number | null = null;
  let ref: string | null = null;
  const executionRaw = request.nextUrl.searchParams.get("executionId");
  if (executionRaw) {
    const id = parseId(executionRaw);
    if (Number.isNaN(id)) {
      return NextResponse.json(
        { error: "Invalid executionId" },
        { status: 400 }
      );
    }
    const execution = await baseDb.testRunExecution.findFirst({
      where: { id, testRunId: runId },
      select: { id: true, requestedCaseIds: true, ref: true },
    });
    if (!execution) {
      return NextResponse.json(
        { error: "Execution not found" },
        { status: 404 }
      );
    }
    executionId = execution.id;
    ref = execution.ref;
    requestedCaseIds = Array.isArray(execution.requestedCaseIds)
      ? (execution.requestedCaseIds as unknown[]).filter(
          (v): v is number => typeof v === "number"
        )
      : undefined;
  }

  const plan = await buildAutomationPlan(baseDb, runId, {
    requestedCaseIds,
    executionId,
    ref,
  });
  if (!plan) {
    return NextResponse.json({ error: "Test run not found" }, { status: 404 });
  }
  return NextResponse.json(plan, {
    headers: { "Cache-Control": "no-store" },
  });
}
