import { z } from "zod";
import { auditedTransaction } from "~/lib/audit/auditedTransaction";
import { enqueueWithAuditContext } from "~/lib/auditContextEnqueue";
import { baseDb } from "~/lib/db";
import { getCurrentTenantId } from "~/lib/multiTenantDb";
import { getExecutionDispatchQueue } from "~/lib/queues";
import { JOB_DISPATCH_EXECUTION } from "~/lib/queueNames";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { promoteRunToHybrid } from "~/lib/services/hybridRunProjection";
import { dispatchExecution } from "./dispatch";
import {
  describeInputError,
  normalizeInputs,
  validateCustomInputs,
} from "./inputs";
import { countAutomatedCasesInRun } from "./plan";
import { checkDispatchRateLimit } from "./rateLimit";
import {
  emitExecutionEvent,
  EXECUTION_REQUESTED_EVENT,
  findActiveExecution,
  publishExecutionChanged,
} from "./service";

/**
 * Create a TestRunExecution for a run and hand it to the dispatch worker.
 * Shared by the run-level execute route and the ad-hoc case route.
 *
 * Inside one audited transaction, with the run row locked: refuse a completed
 * run, refuse a second active execution, refuse an empty selection, promote
 * a REGULAR run to HYBRID, insert the PENDING row and emit the requested
 * event. After commit, enqueue the dispatch (or dispatch inline when no
 * queue is available, e.g. single-pod dev without Valkey).
 */

export const executeBodySchema = z.object({
  targetId: z.number().int().positive(),
  ref: z.string().trim().min(1).max(255).optional(),
  caseIds: z.array(z.number().int().positive()).max(5000).optional(),
  inputs: z.record(z.string(), z.string().max(1000)).optional(),
});

export type ExecuteBody = z.infer<typeof executeBodySchema>;

export type RequestExecutionErrorCode =
  | "INVALID_INPUTS"
  | "TARGET_NOT_FOUND"
  | "TARGET_DISABLED"
  | "RATE_LIMITED"
  | "RUN_NOT_FOUND"
  | "RUN_COMPLETED"
  | "EXECUTION_IN_PROGRESS"
  | "NO_AUTOMATED_CASES";

export type RequestExecutionResult =
  | {
      ok: true;
      execution: { id: number; status: string; selectionCount: number };
      queued: boolean;
    }
  | {
      ok: false;
      status: number;
      code: RequestExecutionErrorCode;
      error: string;
      executionId?: number;
    };

class RequestExecutionError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: RequestExecutionErrorCode,
    message: string,
    public readonly executionId?: number
  ) {
    super(message);
  }
}

export async function requestExecution(params: {
  runId: number;
  projectId: number;
  requestedById: string;
  targetId: number;
  ref?: string;
  caseIds?: number[];
  inputs?: Record<string, string>;
  /** Created by "Run automated test": the run holds only this case and completes itself. */
  adHoc?: boolean;
}): Promise<RequestExecutionResult> {
  const inputError = validateCustomInputs(params.inputs);
  if (inputError) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_INPUTS",
      error: describeInputError(inputError),
    };
  }
  const inputs = normalizeInputs(params.inputs);
  const caseIds = Array.from(new Set(params.caseIds ?? []));

  const target = await baseDb.executionTarget.findFirst({
    where: {
      id: params.targetId,
      projectId: params.projectId,
      isDeleted: false,
    },
    select: { id: true, provider: true, isEnabled: true, defaultRef: true },
  });
  if (!target) {
    return {
      ok: false,
      status: 404,
      code: "TARGET_NOT_FOUND",
      error: "Execution target not found",
    };
  }
  if (!target.isEnabled) {
    return {
      ok: false,
      status: 409,
      code: "TARGET_DISABLED",
      error: "Execution target is disabled",
    };
  }

  const rate = await checkDispatchRateLimit(params.projectId);
  if (!rate.allowed) {
    return {
      ok: false,
      status: 429,
      code: "RATE_LIMITED",
      error: "Too many executions requested for this project; try again later",
    };
  }

  const tenantId = getCurrentTenantId();
  let created: { id: number; status: string; selectionCount: number };
  try {
    created = await auditedTransaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "TestRuns" WHERE id = ${params.runId} FOR UPDATE`;
      const run = await tx.testRuns.findFirst({
        where: {
          id: params.runId,
          isDeleted: false,
          projectId: params.projectId,
        },
        select: { id: true, isCompleted: true, testRunType: true },
      });
      if (!run) {
        throw new RequestExecutionError(
          404,
          "RUN_NOT_FOUND",
          "Test run not found"
        );
      }
      if (run.isCompleted) {
        throw new RequestExecutionError(
          409,
          "RUN_COMPLETED",
          "Test run is completed"
        );
      }
      const active = await findActiveExecution(tx as never, params.runId);
      if (active) {
        throw new RequestExecutionError(
          409,
          "EXECUTION_IN_PROGRESS",
          "An execution is already in progress for this run",
          active.id
        );
      }
      const count = await countAutomatedCasesInRun(
        tx as never,
        params.runId,
        caseIds
      );
      if (count === 0) {
        throw new RequestExecutionError(
          409,
          "NO_AUTOMATED_CASES",
          "The run has no automated cases to execute"
        );
      }
      if (run.testRunType === "REGULAR") {
        await promoteRunToHybrid(tx as never, params.runId);
      }
      const execution = await tx.testRunExecution.create({
        data: {
          testRunId: params.runId,
          projectId: params.projectId,
          targetId: target.id,
          provider: target.provider,
          requestedById: params.requestedById,
          ref: params.ref ?? target.defaultRef ?? null,
          inputs,
          selectionCount: count,
          requestedCaseIds: caseIds,
          adHoc: params.adHoc ?? false,
        },
      });
      await emitExecutionEvent(
        tx,
        EXECUTION_REQUESTED_EVENT,
        execution,
        params.requestedById
      );
      return {
        id: execution.id,
        status: execution.status,
        selectionCount: execution.selectionCount,
      };
    });
  } catch (err) {
    if (err instanceof RequestExecutionError) {
      return {
        ok: false,
        status: err.status,
        code: err.code,
        error: err.message,
        ...(err.executionId ? { executionId: err.executionId } : {}),
      };
    }
    throw err;
  }

  try {
    await captureAuditEvent({
      action: "EXECUTION_REQUESTED",
      entityType: "TestRunExecution",
      entityId: String(created.id),
      projectId: params.projectId,
      userId: params.requestedById,
      metadata: {
        testRunId: params.runId,
        targetId: target.id,
        provider: target.provider,
        selectionCount: created.selectionCount,
        adHoc: params.adHoc ?? false,
        subset: caseIds.length > 0,
      },
    });
  } catch (err) {
    console.warn(
      "[execution] audit capture failed (non-blocking):",
      err instanceof Error ? err.message : String(err)
    );
  }

  publishExecutionChanged({
    id: created.id,
    testRunId: params.runId,
    projectId: params.projectId,
  });

  const queue = getExecutionDispatchQueue();
  if (queue) {
    await enqueueWithAuditContext(
      queue,
      JOB_DISPATCH_EXECUTION,
      { executionId: created.id, tenantId },
      {
        // Unique per request: BullMQ returns an existing job for a repeated
        // jobId, and completed jobs are retained, so a bare execution id could
        // collide with a retained job from another database on the same Valkey.
        // No colons: BullMQ reserves them for repeatable-job ids.
        jobId: `dispatch-${tenantId ?? "default"}-${created.id}-${Date.now()}`,
      }
    );
    return { ok: true, execution: created, queued: true };
  }

  // No queue (Valkey absent): dispatch on the request path so the feature
  // still works in a single-process deployment.
  await dispatchExecution(baseDb, created.id, { tenantId });
  return { ok: true, execution: created, queued: false };
}
