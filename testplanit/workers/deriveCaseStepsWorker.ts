import { Job, Worker } from "bullmq";
import { NotificationType } from "@prisma/client";
import { tipTapDoc } from "@testplanit/api";
import { LlmManager } from "../lib/llm/services/llm-manager.service";
import { PromptResolver } from "../lib/llm/services/prompt-resolver.service";
import { LLM_FEATURES } from "../lib/llm/constants";
import type { LlmRequest } from "../lib/llm/types";
import {
  disconnectAllTenantClients,
  getPrismaClientForJob,
  isMultiTenantMode,
  MultiTenantJobData,
  validateMultiTenantJobData,
} from "../lib/multiTenantPrisma";
import { DERIVE_CASE_STEPS_QUEUE_NAME } from "../lib/queueNames";
import { NotificationService } from "../lib/services/notificationService";
import { withTenantContext } from "../lib/tenantContext";
import valkeyConnection from "../lib/valkey";
import { BULLMQ_PREFIX } from "../lib/bullPrefix";

// ─── Job data type ───────────────────────────────────────────────────────────

export interface DeriveCaseStepsCase {
  testCaseId: number;
  name: string;
  className: string | null;
  failure: string | null;
  systemOut: string | null;
}

export interface DeriveCaseStepsJobData extends MultiTenantJobData {
  projectId: number;
  testRunId: number;
  userId: string;
  cases: DeriveCaseStepsCase[];
}

// ─── Prompt + parser (pure) ──────────────────────────────────────────────────

/**
 * Substitute the prompt-config template variables for one case into a resolved
 * userPrompt template. The test text is inserted as DATA (the system prompt
 * instructs the model to treat it as untrusted, not as instructions — T-04-01).
 * Variables are declared in PROMPT_FEATURE_VARIABLES[DERIVE_CASE_STEPS].
 */
export function fillUserPrompt(
  template: string,
  c: DeriveCaseStepsCase
): string {
  return template
    .replace(/\{\{TEST_NAME\}\}/g, c.name)
    .replace(/\{\{CLASS_NAME\}\}/g, c.className ?? "")
    .replace(/\{\{FAILURE\}\}/g, c.failure ?? "")
    .replace(/\{\{SYSTEM_OUT\}\}/g, c.systemOut ?? "");
}

export interface DerivedStepRow {
  step: string;
  expectedResult: string;
}

/**
 * Defensively parse the LLM response into derived step rows. Extracts the first
 * JSON array, tolerates surrounding prose/fences, and keeps only objects with a
 * non-empty string `step`. Returns [] on any parse failure (never throws).
 */
export function parseStepsFromLlmResponse(content: string): DerivedStepRow[] {
  if (!content) return [];
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const rows: DerivedStepRow[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const step = (item as Record<string, unknown>).step;
    if (typeof step !== "string" || step.trim() === "") continue;
    const expected = (item as Record<string, unknown>).expectedResult;
    rows.push({
      step: step.trim(),
      expectedResult: typeof expected === "string" ? expected.trim() : "",
    });
  }
  return rows;
}

// ─── Processor ───────────────────────────────────────────────────────────────

const processor = async (job: Job<DeriveCaseStepsJobData>): Promise<void> => {
  const { projectId, testRunId, userId, cases, tenantId } = job.data;
  console.log(
    `Processing derive-case-steps job ${job.id} for ${cases.length} case(s)` +
      (tenantId ? ` (tenant: ${tenantId})` : "")
  );

  // 1. Validate multi-tenant context + get tenant-scoped client (T-04-03)
  validateMultiTenantJobData(job.data);
  const prisma = getPrismaClientForJob(job.data);

  // 2. Per-tenant LLM manager (never the singleton in a worker)
  const llmManager = LlmManager.createForWorker(prisma, tenantId);

  // 3. Resolve the provider ONCE per import — provider-configured IS the opt-in.
  //    feature FIRST, projectId SECOND. Null → inert: no work, no notification.
  const resolved = await llmManager.resolveIntegration(
    LLM_FEATURES.DERIVE_CASE_STEPS,
    projectId
  );
  if (!resolved) {
    console.log(
      `derive-case-steps job ${job.id}: no LLM provider configured for project ${projectId}; skipping.`
    );
    return;
  }

  // Resolve the configurable prompt ONCE per import (project override → default
  // config → hard-coded fallback). Admins can customize it in Prompt Configurations.
  const promptResolver = new PromptResolver(prisma);
  const prompt = await promptResolver.resolve(
    LLM_FEATURES.DERIVE_CASE_STEPS,
    projectId
  );

  let derivedCount = 0;

  for (const c of cases) {
    try {
      const request: LlmRequest = {
        messages: [
          { role: "system", content: prompt.systemPrompt },
          { role: "user", content: fillUserPrompt(prompt.userPrompt, c) },
        ],
        temperature: prompt.temperature,
        maxTokens: prompt.maxOutputTokens,
        userId,
        projectId,
        feature: LLM_FEATURES.DERIVE_CASE_STEPS,
        ...(resolved.model ? { model: resolved.model } : {}),
      };

      const response = await llmManager.chat(resolved.integrationId, request, {
        maxRetries: 2,
        baseDelayMs: 1000,
      });

      const rows = parseStepsFromLlmResponse(response.content);
      if (rows.length === 0) continue;

      // CORE-01 re-check: only ever write to a case that is STILL stepless.
      // A human or the deterministic path may have added steps after import.
      const existingStepCount = await prisma.steps.count({
        where: { testCaseId: c.testCaseId, isDeleted: false },
      });
      if (existingStepCount > 0) continue;

      await prisma.steps.createMany({
        data: rows.map((row, index) => ({
          testCaseId: c.testCaseId,
          order: index,
          step: tipTapDoc(row.step),
          expectedResult: row.expectedResult
            ? tipTapDoc(row.expectedResult)
            : undefined,
        })),
      });
      derivedCount++;
    } catch (caseErr) {
      // Graceful per-case degradation (D-11): skip this case, keep going.
      console.error(
        `derive-case-steps job ${job.id}: case ${c.testCaseId} failed:`,
        caseErr instanceof Error ? caseErr.message : caseErr
      );
    }
  }

  // 4. One summary notification per import, only when something was written.
  if (derivedCount > 0) {
    const run = await prisma.testRuns.findUnique({
      where: { id: testRunId },
      select: { name: true },
    });
    await NotificationService.createNotification({
      userId,
      type: NotificationType.AI_STEPS_DERIVED,
      title: "AI-Derived Test Steps Ready",
      message: `${derivedCount} test case${
        derivedCount === 1 ? " was" : "s were"
      } given AI-derived steps — review for accuracy.`,
      relatedEntityId: String(testRunId),
      relatedEntityType: "RUN",
      tenantId,
      data: {
        projectId,
        testRunId,
        derivedCount,
        testRunName: run?.name ?? null,
      },
    });
  }

  console.log(
    `derive-case-steps job ${job.id}: wrote steps for ${derivedCount}/${cases.length} case(s).`
  );
};

// ─── Worker setup ────────────────────────────────────────────────────────────

let worker: Worker<DeriveCaseStepsJobData, void> | null = null;

const startWorker = async () => {
  if (isMultiTenantMode()) {
    console.log("Derive-case-steps worker starting in MULTI-TENANT mode");
  } else {
    console.log("Derive-case-steps worker starting in SINGLE-TENANT mode");
  }

  if (valkeyConnection) {
    worker = new Worker<DeriveCaseStepsJobData, void>(
      DERIVE_CASE_STEPS_QUEUE_NAME,
      withTenantContext(processor),
      {
        connection: valkeyConnection as any,
        prefix: BULLMQ_PREFIX,
        concurrency: parseInt(
          process.env.DERIVE_CASE_STEPS_CONCURRENCY || "2",
          10
        ),
      }
    );

    worker.on("completed", (job) => {
      console.log(`Derive-case-steps job ${job.id} completed successfully.`);
    });

    worker.on("failed", (job, err) => {
      console.error(`Derive-case-steps job ${job?.id} failed:`, err.message);
    });

    worker.on("error", (err) => {
      console.error("Derive-case-steps worker error:", err);
    });

    console.log(
      `Derive-case-steps worker started for queue "${DERIVE_CASE_STEPS_QUEUE_NAME}".`
    );
  } else {
    console.warn(
      "Valkey connection not available. Derive-case-steps worker not started."
    );
  }

  process.on("SIGTERM", async () => {
    console.log("Shutting down derive-case-steps worker...");
    if (worker) {
      await worker.close();
    }
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log("Shutting down derive-case-steps worker...");
    if (worker) {
      await worker.close();
    }
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  });
};

// Run the worker only when this file is executed directly (not on require)
if (require.main === module) {
  console.log("Derive-case-steps worker running...");
  startWorker().catch((err) => {
    console.error("Failed to start derive-case-steps worker:", err);
    process.exit(1);
  });
}

export default worker;
export { processor, startWorker };
