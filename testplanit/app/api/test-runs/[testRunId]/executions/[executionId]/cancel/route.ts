import { NextResponse, type NextRequest } from "next/server";
import { baseDb } from "~/lib/db";
import { createCiDispatchAdapter } from "~/lib/execution/adapters";
import { finalizeExecution } from "~/lib/execution/dispatch";
import {
  authenticateRunRequest,
  isRouteResponse,
  parseId,
} from "~/lib/execution/runAccess";
import { resolveTargetCredentials } from "~/lib/execution/service";
import { ACTIVE_EXECUTION_STATUSES } from "~/lib/execution/types";
import { getCurrentTenantId } from "~/lib/multiTenantDb";

/**
 * POST /api/test-runs/{testRunId}/executions/{executionId}/cancel
 * Marks an in-flight execution CANCELLED and asks the provider to stop the
 * job (best-effort). Requires add/edit on Test Runs.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ testRunId: string; executionId: string }> }
) {
  const { testRunId, executionId } = await params;
  const runId = parseId(testRunId);
  const execId = parseId(executionId);
  if (Number.isNaN(execId)) {
    return NextResponse.json(
      { error: "Invalid execution id" },
      { status: 400 }
    );
  }
  const ctx = await authenticateRunRequest(request, runId, { write: true });
  if (isRouteResponse(ctx)) return ctx;

  const execution = await baseDb.testRunExecution.findFirst({
    where: { id: execId, testRunId: runId },
    include: { target: { include: { codeRepository: true } } },
  });
  if (!execution) {
    return NextResponse.json({ error: "Execution not found" }, { status: 404 });
  }
  if (!ACTIVE_EXECUTION_STATUSES.includes(execution.status)) {
    return NextResponse.json(
      { error: "Execution is already finished", code: "EXECUTION_FINISHED" },
      { status: 409 }
    );
  }

  await finalizeExecution(baseDb, execution.id, "CANCELLED", {
    actorUserId: ctx.userId,
    tenantId: getCurrentTenantId(),
  });

  if (execution.externalRunId) {
    try {
      const credentials = await resolveTargetCredentials(
        execution.target,
        execution.target.codeRepository
      );
      const adapter = createCiDispatchAdapter(
        execution.target,
        credentials,
        (execution.target.codeRepository?.settings ?? null) as Record<
          string,
          string
        > | null
      );
      await adapter.cancel(execution.externalRunId);
    } catch (err) {
      console.warn(
        "[execution] provider cancel failed (non-blocking):",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  return NextResponse.json({ id: execution.id, status: "CANCELLED" });
}
