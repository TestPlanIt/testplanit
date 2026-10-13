import type { DiffFileRecord } from "./compareService";
import type { AnalysisResult, ScoredCase } from "./types";

/** Minimal client surface the worker needs (raw, un-policed client). */
export interface ImpactDbClient {
  impactAnalysis: {
    update: (args: any) => Promise<any>;
  };
  impactAnalysisCase: {
    createMany: (args: any) => Promise<any>;
    deleteMany: (args: any) => Promise<any>;
  };
}

const CREATE_BATCH = 500;

export async function markRunning(
  db: ImpactDbClient,
  analysisId: number,
  jobId: string | undefined
): Promise<void> {
  await db.impactAnalysis.update({
    where: { id: analysisId },
    data: { status: "RUNNING", ...(jobId ? { jobId } : {}), error: null },
  });
}

export interface DiffPersistInput {
  diffRecords: DiffFileRecord[];
  changedPaths: string[];
  changedDirs: string[];
  fileCount: number;
  additions: number;
  deletions: number;
  truncated: boolean;
}

export async function saveDiff(
  db: ImpactDbClient,
  analysisId: number,
  input: DiffPersistInput
): Promise<void> {
  await db.impactAnalysis.update({
    where: { id: analysisId },
    data: {
      diffSummary: input.diffRecords,
      changedPaths: input.changedPaths,
      changedDirs: input.changedDirs,
      fileCount: input.fileCount,
      additions: input.additions,
      deletions: input.deletions,
      truncated: input.truncated,
    },
  });
}

/** What lands in ImpactAnalysis.result (everything but the per-case rows). */
export function toResultRecord(result: AnalysisResult) {
  return {
    summary: result.summary,
    stalePins: result.stalePins,
    uncoveredFiles: result.uncoveredFiles,
    warnings: result.warnings,
    stats: result.stats,
    diff: result.diff,
  };
}

function toCaseRow(analysisId: number, scored: ScoredCase) {
  return {
    analysisId,
    caseId: scored.caseId,
    score: scored.score,
    tier: scored.tier,
    layers: scored.layers,
    reasons: scored.reasons,
    coveredFiles: scored.coveredFiles,
    suggested: true,
  };
}

/**
 * Persist the engine output: replace any earlier rows for this analysis (a
 * re-run after a retry), insert the scored cases, and mark the row complete.
 */
export async function saveResult(
  db: ImpactDbClient,
  analysisId: number,
  result: AnalysisResult
): Promise<void> {
  await db.impactAnalysisCase.deleteMany({ where: { analysisId } });
  for (let i = 0; i < result.cases.length; i += CREATE_BATCH) {
    await db.impactAnalysisCase.createMany({
      data: result.cases
        .slice(i, i + CREATE_BATCH)
        .map((scored) => toCaseRow(analysisId, scored)),
    });
  }
  const pinnedCaseCount = result.cases.filter(
    (c) => c.tier === "pinned"
  ).length;
  const affectedCaseCount = result.cases.filter(
    (c) => c.tier !== "related"
  ).length;
  await db.impactAnalysis.update({
    where: { id: analysisId },
    data: {
      status: "COMPLETED",
      pinnedCaseCount,
      affectedCaseCount,
      result: toResultRecord(result),
      error: null,
      completedAt: new Date(),
    },
  });
}

export async function markFailed(
  db: ImpactDbClient,
  analysisId: number,
  status: "FAILED" | "CANCELLED",
  error: string
): Promise<void> {
  await db.impactAnalysis.update({
    where: { id: analysisId },
    data: { status, error: error.slice(0, 2000), completedAt: new Date() },
  });
}
