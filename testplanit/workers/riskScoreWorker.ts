import { Job, Worker } from "bullmq";
import { BULLMQ_PREFIX } from "../lib/bullPrefix";
import { LlmManager } from "../lib/llm/services/llm-manager.service";
import {
  disconnectAllTenantClients,
  getDbClientForJob,
  isMultiTenantMode,
  validateMultiTenantJobData,
} from "../lib/multiTenantDb";
import {
  JOB_RISK_RERANK,
  JOB_RISK_UPDATE_ALL,
  JOB_RISK_UPDATE_PROJECT,
  JOB_RISK_UPDATE_RUN,
  RISK_SCORE_QUEUE_NAME,
} from "../lib/queueNames";
import {
  rerankRiskCandidates,
  type RerankOutcome,
} from "../lib/services/risk/rerank";
import {
  updateProjectRiskScores,
  updateRiskScoresForCases,
} from "../lib/services/risk/service";
import { getRecentlyExecutedRunCaseIds } from "../lib/services/risk/signals";
import type {
  RiskProjectJobData,
  RiskRerankJobData,
  RiskRunJobData,
  RiskScoreJobData,
  RiskUpdateAllJobData,
} from "../lib/services/risk/types";
import { withTenantContext } from "../lib/tenantContext";
import valkeyConnection from "../lib/valkey";

/**
 * Only cases with a result inside this window are rescored per tick, so a
 * reporter streaming a big run costs each 10s tick its burst, not the whole
 * run; anything a tick misses is caught by the nightly sweep.
 */
export const RUN_RESULT_WINDOW_MS = 10 * 60 * 1000;

async function processRun(job: Job<RiskRunJobData>): Promise<void> {
  const { testRunId, projectId, tenantId } = job.data;
  const db = getDbClientForJob(job.data);
  const since = new Date(Date.now() - RUN_RESULT_WINDOW_MS);
  const caseIds = await getRecentlyExecutedRunCaseIds(db, testRunId, since);
  const result = await updateRiskScoresForCases(db, projectId, caseIds, {
    tenantId,
  });
  console.log(
    `[risk-score] run ${testRunId}: ${result.scanned} case(s) scored, ${result.updated} changed`
  );
}

async function processProject(job: Job<RiskProjectJobData>): Promise<void> {
  const { projectId, tenantId } = job.data;
  const db = getDbClientForJob(job.data);
  const result = await updateProjectRiskScores(db, projectId, {
    tenantId,
    onBatch: async (progress) => {
      await job.updateProgress(progress);
    },
  });
  console.log(
    `[risk-score] project ${projectId}: ${result.scanned} case(s) scored, ${result.updated} changed`
  );
}

/**
 * Nightly sweep: sequential per-project recompute with per-project
 * try/catch, so one failing project never aborts the rest (same shape as
 * forecastWorker's JOB_UPDATE_ALL_CASES).
 */
async function processUpdateAll(job: Job<RiskUpdateAllJobData>): Promise<void> {
  const { tenantId } = job.data;
  const db = getDbClientForJob(job.data);
  const projects = await db.projects.findMany({
    where: { isDeleted: false, isCompleted: false, riskScoringEnabled: true },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  let scanned = 0;
  let updated = 0;
  let failed = 0;
  for (const project of projects) {
    try {
      const result = await updateProjectRiskScores(db, project.id, {
        tenantId,
      });
      scanned += result.scanned;
      updated += result.updated;
    } catch (error) {
      failed++;
      console.error(
        `[risk-score] nightly sweep failed for project ${project.id}:`,
        error
      );
    }
  }
  console.log(
    `[risk-score] nightly sweep: ${projects.length} project(s), ${scanned} case(s) scored, ${updated} changed${failed > 0 ? `, ${failed} project(s) failed` : ""}`
  );
}

/**
 * The one job on this queue a user is waiting for, and the only one with a
 * return value: the dialog polls for it. Nothing is persisted — the ranking
 * lives in the job result and dies with it.
 */
async function processRerank(
  job: Job<RiskRerankJobData>
): Promise<RerankOutcome> {
  const { projectId, caseIds, runContext, userId, tenantId } = job.data;
  const db = getDbClientForJob(job.data);
  const outcome = await rerankRiskCandidates(db, {
    llmManager: LlmManager.createForWorker(db, tenantId),
    projectId,
    caseIds,
    runContext,
    userId,
  });
  console.log(
    `[risk-rerank] project ${projectId}: ${outcome.ranked.length} of ${outcome.candidateCount} candidate(s) ranked${outcome.skipped ? ` (${outcome.skipped})` : ""}`
  );
  return outcome;
}

/** Only the re-rank answers; the recomputes report through their logs. */
type RiskJobResult = RerankOutcome | null;

const processor = async (
  job: Job<RiskScoreJobData>
): Promise<RiskJobResult> => {
  validateMultiTenantJobData(job.data);
  switch (job.name) {
    case JOB_RISK_UPDATE_RUN:
      await processRun(job as Job<RiskRunJobData>);
      return null;
    case JOB_RISK_UPDATE_PROJECT:
      await processProject(job as Job<RiskProjectJobData>);
      return null;
    case JOB_RISK_UPDATE_ALL:
      await processUpdateAll(job as Job<RiskUpdateAllJobData>);
      return null;
    case JOB_RISK_RERANK:
      return processRerank(job as Job<RiskRerankJobData>);
    default:
      console.warn(`[risk-score] unknown job name ${job.name}; ignoring`);
      return null;
  }
};

// ─── Worker setup ────────────────────────────────────────────────────────────

let worker: Worker<RiskScoreJobData, RiskJobResult> | null = null;

const startWorker = async () => {
  console.log(
    `Risk-score worker starting in ${isMultiTenantMode() ? "MULTI" : "SINGLE"}-TENANT mode`
  );

  if (valkeyConnection) {
    worker = new Worker<RiskScoreJobData, RiskJobResult>(
      RISK_SCORE_QUEUE_NAME,
      withTenantContext(processor),
      {
        connection: valkeyConnection as any,
        prefix: BULLMQ_PREFIX,
        concurrency: parseInt(process.env.RISK_SCORE_CONCURRENCY || "2", 10),
      }
    );

    worker.on("failed", (job, err) => {
      console.error(
        `Risk-score job ${job?.id} (${job?.name}) failed:`,
        err.message
      );
    });

    worker.on("error", (err) => {
      console.error("Risk-score worker error:", err);
    });

    console.log(
      `Risk-score worker started for queue "${RISK_SCORE_QUEUE_NAME}".`
    );
  } else {
    console.warn(
      "Valkey connection not available. Risk-score worker not started."
    );
  }

  const shutdown = async () => {
    console.log("Shutting down risk-score worker...");
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
  console.log("Risk-score worker running...");
  startWorker().catch((err) => {
    console.error("Failed to start risk-score worker:", err);
    process.exit(1);
  });
}

export default worker;
export { processor, startWorker };
