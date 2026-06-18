import type { PrismaClient } from "@prisma/client";
import { LLM_FEATURES } from "~/lib/llm/constants";
import { LlmManager } from "~/lib/llm/services/llm-manager.service";
import { getCurrentTenantId } from "~/lib/multiTenantPrisma";
import { getDeriveCaseStepsQueue } from "~/lib/queues";
import type { DeriveCaseStepsJobData } from "~/workers/deriveCaseStepsWorker";

/**
 * Phase 4 (D-02 / CORE-01): a case imported from automation is eligible for
 * opt-in LLM step derivation ONLY when it is both low-structure (the parser
 * produced no automation steps — the deterministic path can't help) AND
 * stepless (no existing steps to clobber).
 */
export function isLlmStepDerivationEligible(
  automationStepCount: number,
  existingStepCount: number
): boolean {
  return automationStepCount === 0 && existingStepCount === 0;
}

/**
 * Phase 4 (LLM-01..03, D-03/D-06): resolve the project's LLM provider ONCE —
 * provider-config IS the opt-in — and, only when one is configured, enqueue
 * exactly ONE background derive-case-steps job for the whole batch. Returns
 * whether a job was enqueued. NEVER derives inline (no chat() here). Callers
 * wrap this in try/catch so a queue/LLM hiccup can't fail a successful import.
 */
export async function enqueueDeriveCaseSteps(params: {
  prisma: PrismaClient;
  projectId: number;
  testRunId: number;
  userId: string;
  cases: DeriveCaseStepsJobData["cases"];
}): Promise<boolean> {
  const { prisma, projectId, testRunId, userId, cases } = params;
  if (cases.length === 0) return false;

  const llmManager = LlmManager.getInstance(prisma);
  const resolved = await llmManager.resolveIntegration(
    LLM_FEATURES.DERIVE_CASE_STEPS,
    projectId
  );
  if (!resolved) return false; // inert when no provider configured (LLM-01)

  const queue = getDeriveCaseStepsQueue();
  if (!queue) return false;

  await queue.add("derive-case-steps", {
    projectId,
    testRunId,
    userId,
    tenantId: getCurrentTenantId(),
    cases,
  } satisfies DeriveCaseStepsJobData);
  return true;
}
