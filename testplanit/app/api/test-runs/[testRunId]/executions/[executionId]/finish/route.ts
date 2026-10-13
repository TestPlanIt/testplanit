import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { baseDb } from "~/lib/db";
import { finalizeExecution } from "~/lib/execution/dispatch";
import {
  authenticateRunRequest,
  isRouteResponse,
  parseId,
} from "~/lib/execution/runAccess";
import { ACTIVE_EXECUTION_STATUSES } from "~/lib/execution/types";
import { getCurrentTenantId } from "~/lib/multiTenantDb";

const bodySchema = z.object({
  conclusion: z.enum(["success", "failure", "cancelled"]),
  message: z.string().max(1024).optional(),
});

/**
 * POST /api/test-runs/{testRunId}/executions/{executionId}/finish
 * Explicit completion from the CI side (`testplanit run finish`). Needed for
 * generic-webhook targets, which TestPlanIt cannot poll; harmless for the
 * others. The run itself stays open — completing it is a separate decision.
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

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "Invalid input",
        details: err instanceof z.ZodError ? z.treeifyError(err) : undefined,
      },
      { status: 400 }
    );
  }

  const execution = await baseDb.testRunExecution.findFirst({
    where: { id: execId, testRunId: runId },
    select: { id: true, status: true },
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

  const status =
    body.conclusion === "success"
      ? "SUCCEEDED"
      : body.conclusion === "failure"
        ? "FAILED"
        : "CANCELLED";
  await finalizeExecution(baseDb, execution.id, status, {
    // The message explains a failure or a cancellation; a success needs none
    // and must not read as an error on the run page.
    error: status === "SUCCEEDED" ? null : (body.message ?? null),
    actorUserId: ctx.userId,
    tenantId: getCurrentTenantId(),
  });
  return NextResponse.json({ id: execution.id, status });
}
