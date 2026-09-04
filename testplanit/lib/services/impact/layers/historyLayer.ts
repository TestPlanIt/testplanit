import type { ImpactConfig } from "../config";
import { historyScoreFor } from "../scoring";
import type { HistoryReason, LayerResult } from "../types";

export interface HistoryDbClient {
  impactAnalysis: { findMany: (args: any) => Promise<any[]> };
  testRunCases: { findMany: (args: any) => Promise<any[]> };
}

export interface HistoryLayerInput {
  projectId: number;
  analysisId: number;
  changedPaths: string[];
  changedDirs: string[];
  cfg: Pick<ImpactConfig, "historyLookbackDays" | "historyMaxAnalyses">;
  now?: Date;
}

interface PriorAnalysis {
  id: number;
  testRunId: number;
  changedPaths: string[];
  changedDirs: string[];
  createdAt: Date;
  cases: Array<{ caseId: number }>;
}

interface RunCaseRow {
  testRunId: number;
  repositoryCaseId: number;
  status: { isFailure: boolean } | null;
}

/**
 * Layer 2: cases that ran (or failed) in runs composed from earlier analyses
 * whose changes overlapped this one. Failure is read from the status flag,
 * never from a status name.
 */
export async function runHistoryLayer(
  db: HistoryDbClient,
  input: HistoryLayerInput
): Promise<{ layer: LayerResult; priorAnalysisCount: number }> {
  const layer: LayerResult = new Map();
  const now = input.now ?? new Date();
  if (input.changedPaths.length === 0 && input.changedDirs.length === 0) {
    return { layer, priorAnalysisCount: 0 };
  }

  const lookback = new Date(
    now.getTime() - input.cfg.historyLookbackDays * 24 * 60 * 60 * 1000
  );
  const prior = (await db.impactAnalysis.findMany({
    where: {
      projectId: input.projectId,
      id: { not: input.analysisId },
      status: "COMPLETED",
      isDeleted: false,
      testRunId: { not: null },
      createdAt: { gte: lookback },
      OR: [
        { changedPaths: { hasSome: input.changedPaths } },
        { changedDirs: { hasSome: input.changedDirs } },
      ],
    },
    select: {
      id: true,
      testRunId: true,
      changedPaths: true,
      changedDirs: true,
      createdAt: true,
      cases: { where: { addedManually: true }, select: { caseId: true } },
    },
    orderBy: { createdAt: "desc" },
    take: input.cfg.historyMaxAnalyses,
  })) as PriorAnalysis[];

  if (prior.length === 0) return { layer, priorAnalysisCount: 0 };

  const runCases = (await db.testRunCases.findMany({
    where: {
      testRunId: { in: prior.map((p) => p.testRunId) },
      isDeleted: false,
    },
    select: {
      testRunId: true,
      repositoryCaseId: true,
      status: { select: { isFailure: true } },
    },
  })) as RunCaseRow[];

  const changedPathSet = new Set(input.changedPaths);
  const changedDirSet = new Set(input.changedDirs);
  const analysisDates = new Map<number, Date>();
  const byRun = new Map<number, PriorAnalysis>();
  for (const p of prior) {
    analysisDates.set(p.id, new Date(p.createdAt));
    byRun.set(p.testRunId, p);
  }

  const hitsByCase = new Map<number, HistoryReason[]>();
  for (const rc of runCases) {
    const analysis = byRun.get(rc.testRunId);
    if (!analysis) continue;
    const overlappingPaths = analysis.changedPaths.filter((p) =>
      changedPathSet.has(p)
    );
    const overlap: "file" | "dir" =
      overlappingPaths.length > 0
        ? "file"
        : analysis.changedDirs.some((d) => changedDirSet.has(d))
          ? "dir"
          : "dir";
    const reason: HistoryReason = {
      kind: "HISTORY",
      analysisId: analysis.id,
      testRunId: rc.testRunId,
      overlap,
      failed: rc.status?.isFailure === true,
      addedManually: analysis.cases.some(
        (c) => c.caseId === rc.repositoryCaseId
      ),
      overlappingPaths: overlappingPaths.slice(0, 10),
    };
    const list = hitsByCase.get(rc.repositoryCaseId) ?? [];
    list.push(reason);
    hitsByCase.set(rc.repositoryCaseId, list);
  }

  for (const [caseId, hits] of hitsByCase) {
    layer.set(caseId, {
      caseId,
      score: historyScoreFor(hits, now, 180, analysisDates),
      reasons: hits,
    });
  }
  return { layer, priorAnalysisCount: prior.length };
}
