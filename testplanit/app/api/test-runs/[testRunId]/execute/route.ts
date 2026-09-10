import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withAuditContext } from "~/lib/auditContextWrappers";
import {
  executeBodySchema,
  requestExecution,
} from "~/lib/execution/requestExecution";
import {
  authenticateRunRequest,
  isRouteResponse,
  parseId,
} from "~/lib/execution/runAccess";

/**
 * POST /api/test-runs/{testRunId}/execute
 * Body: { targetId, ref?, caseIds?, inputs? }
 *
 * Requests automated execution of the run's automated cases (or the given
 * subset) on one of the project's execution targets. Responds 202 with the
 * new execution; the dispatch itself happens on the worker.
 */
export const POST = withAuditContext(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ testRunId: string }> }
  ) => {
    const { testRunId } = await params;
    const runId = parseId(testRunId);
    const ctx = await authenticateRunRequest(request, runId, { write: true });
    if (isRouteResponse(ctx)) return ctx;

    let body: z.infer<typeof executeBodySchema>;
    try {
      body = executeBodySchema.parse(await request.json());
    } catch (err) {
      return NextResponse.json(
        {
          error: "Invalid input",
          details: err instanceof z.ZodError ? z.treeifyError(err) : undefined,
        },
        { status: 400 }
      );
    }

    const result = await requestExecution({
      runId: ctx.run.id,
      projectId: ctx.run.projectId,
      requestedById: ctx.userId,
      targetId: body.targetId,
      ref: body.ref,
      caseIds: body.caseIds,
      inputs: body.inputs,
    });
    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          code: result.code,
          ...(result.executionId ? { executionId: result.executionId } : {}),
        },
        { status: result.status }
      );
    }
    return NextResponse.json(
      {
        executionId: result.execution.id,
        status: result.execution.status,
        selectionCount: result.execution.selectionCount,
        queued: result.queued,
      },
      { status: 202 }
    );
  }
);
