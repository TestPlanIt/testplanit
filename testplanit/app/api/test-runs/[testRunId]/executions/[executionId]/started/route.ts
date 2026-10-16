import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { baseDb } from "~/lib/db";
import {
  externalLinkPatch,
  externalRunIdSchema,
  externalUrlSchema,
} from "~/lib/execution/externalLink";
import {
  authenticateRunRequest,
  isRouteResponse,
  parseId,
} from "~/lib/execution/runAccess";
import { publishExecutionChanged } from "~/lib/execution/service";
import { ACTIVE_EXECUTION_STATUSES } from "~/lib/execution/types";

const bodySchema = z.object({
  externalUrl: externalUrlSchema,
  externalRunId: externalRunIdSchema.optional(),
});

/**
 * POST /api/test-runs/{testRunId}/executions/{executionId}/started
 * The CI job reports its own URL (and build id) as soon as it starts
 * (`testplanit run started`). Needed for generic-webhook targets, where the
 * receiver's reply has no build to link to yet (Jenkins answers with a queue
 * item); harmless for the others. Moves a waiting execution to RUNNING and
 * may be called again, for example by a retried job.
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

  const updated = await baseDb.testRunExecution.update({
    where: { id: execution.id },
    data: {
      ...externalLinkPatch(body),
      ...(execution.status !== "RUNNING" ? { status: "RUNNING" } : {}),
    },
    select: { id: true, testRunId: true, projectId: true, status: true },
  });
  publishExecutionChanged(updated);
  return NextResponse.json({ id: updated.id, status: updated.status });
}
