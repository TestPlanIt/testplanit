import { buildGucPayload } from "~/lib/audit/gucContext";
import { normalizeInputs } from "~/lib/execution/inputs";
import {
  requestExecution,
  type RequestExecutionErrorCode,
} from "~/lib/execution/requestExecution";
import type { DbClient } from "~/lib/zenstack";

export type AutoExecuteResult =
  | { requested: true; executionId: number }
  | { requested: false; reason: "not_configured" }
  | {
      requested: false;
      reason: "failed";
      code: RequestExecutionErrorCode | "error";
    };

/**
 * Request automated execution of a run a repository webhook composed, when
 * that webhook has auto-execute on: its target, ref (empty = the target's
 * default) and parameter inputs, requested as the run's creator. The request
 * goes through the same checks as the run's Execute button, so a target
 * deleted or disabled since the setting was saved, or a run with no automated
 * cases, requests nothing; the delivery records why (`execute:<code>`).
 */
export async function executeAutoRun(
  db: DbClient,
  params: {
    webhookConfigId?: string;
    testRunId: number;
    projectId: number;
    deliveryId?: string;
    tenantId?: string;
  }
): Promise<AutoExecuteResult> {
  if (!params.webhookConfigId) {
    return { requested: false, reason: "not_configured" };
  }
  const hook = await db.webhookConfig.findFirst({
    where: { id: params.webhookConfigId, projectId: params.projectId },
    select: {
      autoExecuteEnabled: true,
      autoExecuteTargetId: true,
      autoExecuteRef: true,
      autoExecuteInputs: true,
    },
  });
  if (!hook?.autoExecuteEnabled || hook.autoExecuteTargetId == null) {
    return { requested: false, reason: "not_configured" };
  }

  const fail = async (code: RequestExecutionErrorCode | "error") => {
    if (params.deliveryId) {
      await db.webhookDelivery
        .update({
          where: { id: params.deliveryId },
          data: { error: `execute:${code.toLowerCase()}` },
        })
        .catch(() => {});
    }
    return { requested: false as const, reason: "failed" as const, code };
  };

  try {
    const run = await db.testRuns.findUnique({
      where: { id: params.testRunId },
      select: { createdById: true },
    });
    if (!run) return fail("RUN_NOT_FOUND");
    const inputs = normalizeInputs(hook.autoExecuteInputs);
    const result = await requestExecution({
      runId: params.testRunId,
      projectId: params.projectId,
      requestedById: run.createdById,
      targetId: hook.autoExecuteTargetId,
      ref: hook.autoExecuteRef ?? undefined,
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
    if (!result.ok) return fail(result.code);
    return { requested: true, executionId: result.execution.id };
  } catch (error) {
    console.error(
      `[impact] auto-execute for run ${params.testRunId} failed:`,
      error
    );
    return fail("error");
  }
}
