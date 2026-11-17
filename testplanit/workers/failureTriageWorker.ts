import { Job, Worker } from "bullmq";
import { LlmManager } from "../lib/llm/services/llm-manager.service";
import {
  disconnectAllTenantClients,
  getDbClientForJob,
  isMultiTenantMode,
  validateMultiTenantJobData,
} from "../lib/multiTenantDb";
import {
  FAILURE_TRIAGE_QUEUE_NAME,
  JOB_CLASSIFY_SIGNATURES,
  JOB_TRIAGE_BACKFILL,
  JOB_TRIAGE_RUN,
} from "../lib/queueNames";
import {
  enqueueAlertRunEvaluation,
  projectHasActiveAlertRules,
} from "../lib/services/alertEnqueue";
import { classifySignatures } from "../lib/services/triage/classify";
import { enqueueSignatureClassification } from "../lib/services/triage/enqueue";
import { releaseRecoveredQuarantines } from "../lib/services/triage/quarantine";
import {
  triageProjectFailures,
  triageRunFailures,
} from "../lib/services/triage/signatures";
import type {
  ClassifySignaturesJobData,
  FailureTriageJobData,
  TriageBackfillJobData,
  TriageRunJobData,
} from "../lib/services/triage/types";
import { withTenantContext } from "../lib/tenantContext";
import valkeyConnection from "../lib/valkey";
import { BULLMQ_PREFIX } from "../lib/bullPrefix";

/** Signatures classified inline after one run's results; the rest wait for the next run or a manual request. */
export const MAX_INLINE_CLASSIFICATIONS = 25;
/** Backfill classifies only signatures seen this recently, in jobs of this size. */
export const BACKFILL_CLASSIFY_MAX_AGE_DAYS = 30;
export const BACKFILL_CLASSIFY_LIMIT = 100;
export const CLASSIFY_JOB_BATCH = 10;

type TriageProjectFlags = {
  failureTriageEnabled: boolean;
  failureTriageAutoClassify: boolean;
};

async function loadProjectFlags(
  db: ReturnType<typeof getDbClientForJob>,
  projectId: number
): Promise<TriageProjectFlags | null> {
  const project = await db.projects.findUnique({
    where: { id: projectId },
    select: {
      failureTriageEnabled: true,
      failureTriageAutoClassify: true,
      isDeleted: true,
    },
  });
  if (!project || project.isDeleted) return null;
  return project;
}

async function processRun(job: Job<TriageRunJobData>): Promise<void> {
  const { testRunId, projectId, tenantId } = job.data;
  const db = getDbClientForJob(job.data);
  const flags = await loadProjectFlags(db, projectId);
  if (!flags?.failureTriageEnabled) return;

  const result = await triageRunFailures(db, { testRunId, projectId });
  console.log(
    `[failure-triage] run ${testRunId}: ${result.processed} failure(s) → ${result.signatureIds.length} signature(s), ${result.newSignatureIds.length} new, ${result.reopenedSignatureIds.length} reopened`
  );
  const recovered = await releaseRecoveredQuarantines(db, {
    projectId,
    testRunId,
  });
  if (recovered.released.length > 0) {
    console.log(
      `[failure-triage] run ${testRunId}: released ${recovered.released.length} quarantine(s): cases ${recovered.released.map((r) => r.caseId).join(", ")}`
    );
  }
  // The result hooks evaluated run alerts before these signatures existed;
  // a run that introduced new ones gets a fresh pass for the
  // new-signatures metric.
  if (
    result.newSignatureIds.length > 0 &&
    (await projectHasActiveAlertRules(db, projectId))
  ) {
    await enqueueAlertRunEvaluation({
      runId: testRunId,
      projectId,
      trigger: "result",
      tenantId,
    });
  }
  if (!flags.failureTriageAutoClassify || result.signatureIds.length === 0)
    return;

  // Classify what this run surfaced and is still unclassified by anyone.
  const pending = await db.failureSignature.findMany({
    where: {
      id: { in: result.signatureIds },
      aiClassifiedAt: null,
      classifiedById: null,
      status: "OPEN",
    },
    select: { id: true },
    orderBy: { occurrenceCount: "desc" },
    take: MAX_INLINE_CLASSIFICATIONS,
  });
  if (pending.length === 0) return;

  const userId = job.data.userId ?? (await resolveRunUser(db, testRunId));
  if (!userId) return;
  const outcome = await classifySignatures(db, {
    llmManager: LlmManager.createForWorker(db, tenantId),
    projectId,
    signatureIds: pending.map((s) => s.id),
    userId,
  });
  if (!outcome.skipped) {
    console.log(
      `[failure-triage] run ${testRunId}: classified ${outcome.classified}, failed ${outcome.failed}`
    );
  }
}

async function resolveRunUser(
  db: ReturnType<typeof getDbClientForJob>,
  testRunId: number
): Promise<string | null> {
  const run = await db.testRuns.findUnique({
    where: { id: testRunId },
    select: { createdById: true },
  });
  return run?.createdById ?? null;
}

async function processBackfill(job: Job<TriageBackfillJobData>): Promise<void> {
  const { projectId, tenantId, userId } = job.data;
  const db = getDbClientForJob(job.data);
  const flags = await loadProjectFlags(db, projectId);
  if (!flags?.failureTriageEnabled) return;

  const result = await triageProjectFailures(db, {
    projectId,
    onBatch: async ({ processed }) => {
      await job.updateProgress({ processed });
    },
  });
  console.log(
    `[failure-triage] backfill project ${projectId}: ${result.processed} failure(s) → ${result.signatureIds.length} signature(s)`
  );
  if (!flags.failureTriageAutoClassify) return;

  const since = new Date(
    Date.now() - BACKFILL_CLASSIFY_MAX_AGE_DAYS * 24 * 3600 * 1000
  );
  const pending = await db.failureSignature.findMany({
    where: {
      projectId,
      status: "OPEN",
      aiClassifiedAt: null,
      classifiedById: null,
      lastSeenAt: { gte: since },
    },
    select: { id: true },
    orderBy: { lastSeenAt: "desc" },
    take: BACKFILL_CLASSIFY_LIMIT,
  });
  for (let i = 0; i < pending.length; i += CLASSIFY_JOB_BATCH) {
    await enqueueSignatureClassification({
      projectId,
      tenantId,
      userId,
      signatureIds: pending.slice(i, i + CLASSIFY_JOB_BATCH).map((s) => s.id),
    });
  }
}

async function processClassify(
  job: Job<ClassifySignaturesJobData>
): Promise<void> {
  const { projectId, tenantId, userId, signatureIds } = job.data;
  const db = getDbClientForJob(job.data);
  const flags = await loadProjectFlags(db, projectId);
  if (!flags?.failureTriageEnabled) return;
  const outcome = await classifySignatures(db, {
    llmManager: LlmManager.createForWorker(db, tenantId),
    projectId,
    signatureIds,
    userId,
  });
  console.log(
    `[failure-triage] classify job ${job.id}: classified ${outcome.classified}, failed ${outcome.failed}${outcome.skipped ? " (no provider)" : ""}`
  );
}

const processor = async (job: Job<FailureTriageJobData>): Promise<void> => {
  validateMultiTenantJobData(job.data);
  switch (job.name) {
    case JOB_TRIAGE_RUN:
      return processRun(job as Job<TriageRunJobData>);
    case JOB_TRIAGE_BACKFILL:
      return processBackfill(job as Job<TriageBackfillJobData>);
    case JOB_CLASSIFY_SIGNATURES:
      return processClassify(job as Job<ClassifySignaturesJobData>);
    default:
      console.warn(`[failure-triage] unknown job name ${job.name}; ignoring`);
  }
};

// ─── Worker setup ────────────────────────────────────────────────────────────

let worker: Worker<FailureTriageJobData, void> | null = null;

const startWorker = async () => {
  console.log(
    `Failure-triage worker starting in ${isMultiTenantMode() ? "MULTI" : "SINGLE"}-TENANT mode`
  );

  if (valkeyConnection) {
    worker = new Worker<FailureTriageJobData, void>(
      FAILURE_TRIAGE_QUEUE_NAME,
      withTenantContext(processor),
      {
        connection: valkeyConnection as any,
        prefix: BULLMQ_PREFIX,
        concurrency: parseInt(
          process.env.FAILURE_TRIAGE_CONCURRENCY || "2",
          10
        ),
      }
    );

    worker.on("failed", (job, err) => {
      console.error(
        `Failure-triage job ${job?.id} (${job?.name}) failed:`,
        err.message
      );
    });

    worker.on("error", (err) => {
      console.error("Failure-triage worker error:", err);
    });

    console.log(
      `Failure-triage worker started for queue "${FAILURE_TRIAGE_QUEUE_NAME}".`
    );
  } else {
    console.warn(
      "Valkey connection not available. Failure-triage worker not started."
    );
  }

  const shutdown = async () => {
    console.log("Shutting down failure-triage worker...");
    if (worker) {
      await worker.close();
    }
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
};

// Run the worker only when this file is executed directly (not on require)
if (require.main === module) {
  console.log("Failure-triage worker running...");
  startWorker().catch((err) => {
    console.error("Failed to start failure-triage worker:", err);
    process.exit(1);
  });
}

export default worker;
export { processor, startWorker };
