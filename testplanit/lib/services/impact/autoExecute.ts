import { buildGucPayload } from "~/lib/audit/gucContext";
import { normalizeInputs } from "~/lib/execution/inputs";
import {
  requestExecution,
  type RequestExecutionErrorCode,
} from "~/lib/execution/requestExecution";
import type { AutoExecuteOptions } from "~/lib/webhooks/actions/schemas";
import type { DbClient } from "~/lib/zenstack";

export type AutoExecuteResult =
  | { requested: true; executionId: number }
  | { requested: false; code: RequestExecutionErrorCode | "ERROR" };

/**
 * Request automated execution of a run a webhook action composed, on the
 * rule's target with its ref (empty = the target's default) and parameter
 * inputs, requested as the run's creator. The request goes through the same
 * checks as the run's Execute button, so a target deleted or disabled since
 * the rule was saved, or a run with no automated cases, requests nothing and
 * the code says why.
 */
export async function executeAutoRun(
  db: DbClient,
  params: {
    autoExecute: AutoExecuteOptions;
    testRunId: number;
    projectId: number;
    tenantId?: string;
  }
): Promise<AutoExecuteResult> {
  try {
    const run = await db.testRuns.findUnique({
      where: { id: params.testRunId },
      select: { createdById: true },
    });
    if (!run) return { requested: false, code: "RUN_NOT_FOUND" };
    const inputs = normalizeInputs(params.autoExecute.inputs);
    const result = await requestExecution({
      runId: params.testRunId,
      projectId: params.projectId,
      requestedById: run.createdById,
      targetId: params.autoExecute.targetId,
      ref: params.autoExecute.ref || undefined,
      inputs: Object.keys(inputs).length > 0 ? inputs : undefined,
      env: {
        db,
        tenantId: params.tenantId,
        guc: {
          ...buildGucPayload(run.createdById),
          source: "worker",
          tenantId: params.tenantId ?? null,
        },
        systemReason: "webhook:auto-execute",
      },
    });
    if (!result.ok) return { requested: false, code: result.code };
    return { requested: true, executionId: result.execution.id };
  } catch (error) {
    console.error(
      `[webhook-actions] auto-execute for run ${params.testRunId} failed:`,
      error
    );
    return { requested: false, code: "ERROR" };
  }
}
