import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  markFailed,
  markRunning,
  saveDiff,
  saveResult,
  toResultRecord,
  type ImpactDbClient,
} from "./persistence";
import type { AnalysisResult, CaseTier, ScoredCase } from "./types";

function makeDb() {
  const calls: string[] = [];
  const db = {
    impactAnalysis: {
      update: vi.fn(async (_args: any) => {
        calls.push("impactAnalysis.update");
        return {};
      }),
    },
    impactAnalysisCase: {
      createMany: vi.fn(async (_args: any) => {
        calls.push("impactAnalysisCase.createMany");
        return { count: 0 };
      }),
      deleteMany: vi.fn(async (_args: any) => {
        calls.push("impactAnalysisCase.deleteMany");
        return { count: 0 };
      }),
    },
  };
  return { db: db as ImpactDbClient & typeof db, calls };
}

function scored(caseId: number, tier: CaseTier): ScoredCase {
  return {
    caseId,
    score: tier === "pinned" ? 100 : tier === "affected" ? 70 : 30,
    tier,
    layers: ["PIN"],
    reasons: [
      {
        kind: "PIN",
        pinId: caseId,
        filePath: "src/a.ts",
        pinKind: "FILE",
        source: "MANUAL",
        confidence: "file",
      },
    ],
    coveredFiles: ["src/a.ts"],
  };
}

function makeResult(cases: ScoredCase[]): AnalysisResult {
  return {
    analysisId: 42,
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    diff: {
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      files: [],
      excludedFiles: [],
      totalFiles: 0,
      truncatedByProvider: false,
      truncatedByBudget: false,
      omittedFileCount: 0,
      estimatedTokens: 0,
    },
    cases,
    stalePins: [
      {
        pinId: 1,
        caseId: 1,
        filePath: "src/a.ts",
        pinKind: "FILE",
        reason: "FILE_DELETED",
      },
    ],
    uncoveredFiles: ["src/orphan.ts"],
    summary: "Touched the login flow.",
    warnings: [{ code: "no_candidates" }],
    stats: {
      repositoryTotalCount: 10,
      candidateCount: cases.length,
      aiCandidateCount: 0,
      layerCounts: { PIN: cases.length, PATH: 0, HISTORY: 0, AI: 0, LINKED: 0 },
      searchMode: "db",
      durationsMs: {},
    },
  };
}

describe("saveResult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes earlier rows, inserts in batches of 500, then marks the analysis COMPLETED", async () => {
    const { db, calls } = makeDb();
    const cases: ScoredCase[] = Array.from({ length: 1200 }, (_, i) =>
      scored(i + 1, i < 100 ? "pinned" : i < 700 ? "affected" : "related")
    );

    await saveResult(db, 42, makeResult(cases));

    expect(db.impactAnalysisCase.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.impactAnalysisCase.deleteMany).toHaveBeenCalledWith({
      where: { analysisId: 42 },
    });

    expect(db.impactAnalysisCase.createMany).toHaveBeenCalledTimes(3);
    const batchSizes = db.impactAnalysisCase.createMany.mock.calls.map(
      (c: any[]) => c[0].data.length
    );
    expect(batchSizes).toEqual([500, 500, 200]);

    // Delete strictly precedes every insert, which precede the final update.
    expect(calls).toEqual([
      "impactAnalysisCase.deleteMany",
      "impactAnalysisCase.createMany",
      "impactAnalysisCase.createMany",
      "impactAnalysisCase.createMany",
      "impactAnalysis.update",
    ]);

    // Batches are contiguous and preserve order.
    const allIds = db.impactAnalysisCase.createMany.mock.calls.flatMap(
      (c: any[]) => c[0].data.map((row: any) => row.caseId)
    );
    expect(allIds).toEqual(cases.map((c) => c.caseId));
  });

  it("maps each scored case to a suggested row carrying its evidence", async () => {
    const { db } = makeDb();
    const one = scored(7, "affected");

    await saveResult(db, 42, makeResult([one]));

    const [row] = db.impactAnalysisCase.createMany.mock.calls[0][0].data;
    expect(row).toEqual({
      analysisId: 42,
      caseId: 7,
      score: 70,
      tier: "affected",
      layers: ["PIN"],
      reasons: one.reasons,
      coveredFiles: ["src/a.ts"],
      suggested: true,
    });
  });

  it("computes pinnedCaseCount and affectedCaseCount from the tiers", async () => {
    const { db } = makeDb();
    const cases = [
      scored(1, "pinned"),
      scored(2, "pinned"),
      scored(3, "affected"),
      scored(4, "related"),
      scored(5, "related"),
      scored(6, "related"),
    ];

    await saveResult(db, 42, makeResult(cases));

    const update = db.impactAnalysis.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 42 });
    expect(update.data).toMatchObject({
      status: "COMPLETED",
      pinnedCaseCount: 2,
      // pinned + affected; related cases are not "affected".
      affectedCaseCount: 3,
      error: null,
    });
    expect(update.data.completedAt).toBeInstanceOf(Date);
  });

  it("stores a result record without the per-case rows", async () => {
    const { db } = makeDb();
    const result = makeResult([scored(1, "pinned")]);

    await saveResult(db, 42, result);

    const stored = db.impactAnalysis.update.mock.calls[0][0].data.result;
    expect(stored).toEqual({
      summary: result.summary,
      stalePins: result.stalePins,
      uncoveredFiles: result.uncoveredFiles,
      warnings: result.warnings,
      stats: result.stats,
      diff: result.diff,
    });
    expect(stored).not.toHaveProperty("cases");
    expect(stored).not.toHaveProperty("analysisId");
    expect(stored).toEqual(toResultRecord(result));
  });

  it("still clears old rows and completes when there are no cases", async () => {
    const { db } = makeDb();

    await saveResult(db, 42, makeResult([]));

    expect(db.impactAnalysisCase.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.impactAnalysisCase.createMany).not.toHaveBeenCalled();
    expect(db.impactAnalysis.update.mock.calls[0][0].data).toMatchObject({
      status: "COMPLETED",
      pinnedCaseCount: 0,
      affectedCaseCount: 0,
    });
  });

  it("inserts exactly one batch for exactly 500 cases", async () => {
    const { db } = makeDb();
    const cases = Array.from({ length: 500 }, (_, i) =>
      scored(i + 1, "related")
    );

    await saveResult(db, 42, makeResult(cases));

    expect(db.impactAnalysisCase.createMany).toHaveBeenCalledTimes(1);
    expect(db.impactAnalysisCase.createMany.mock.calls[0][0].data).toHaveLength(
      500
    );
  });
});

describe("markFailed", () => {
  it("truncates long errors to 2000 characters and stamps completedAt", async () => {
    const { db } = makeDb();
    const longError = "e".repeat(5000);

    await markFailed(db, 42, "FAILED", longError);

    const update = db.impactAnalysis.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 42 });
    expect(update.data.status).toBe("FAILED");
    expect(update.data.error).toHaveLength(2000);
    expect(update.data.error).toBe("e".repeat(2000));
    expect(update.data.completedAt).toBeInstanceOf(Date);
  });

  it("stores a short error verbatim and supports CANCELLED", async () => {
    const { db } = makeDb();

    await markFailed(db, 42, "CANCELLED", "Cancelled by user");

    expect(db.impactAnalysis.update.mock.calls[0][0].data).toMatchObject({
      status: "CANCELLED",
      error: "Cancelled by user",
    });
  });
});

describe("markRunning", () => {
  it("sets RUNNING, clears the error, and records the jobId when given", async () => {
    const { db } = makeDb();

    await markRunning(db, 42, "impact-42");

    expect(db.impactAnalysis.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { status: "RUNNING", jobId: "impact-42", error: null },
    });
  });

  it("leaves jobId untouched when none is given", async () => {
    const { db } = makeDb();

    await markRunning(db, 42, undefined);

    const data = db.impactAnalysis.update.mock.calls[0][0].data;
    expect(data).toEqual({ status: "RUNNING", error: null });
    expect(data).not.toHaveProperty("jobId");
  });
});

describe("saveDiff", () => {
  it("writes the diff summary and its rollup counters", async () => {
    const { db } = makeDb();
    const diffRecords = [
      {
        path: "src/a.ts",
        status: "modified" as const,
        additions: 2,
        deletions: 1,
        isBinary: false,
        hunks: [],
      },
    ];

    await saveDiff(db, 42, {
      diffRecords,
      changedPaths: ["src/a.ts"],
      changedDirs: ["src"],
      fileCount: 1,
      additions: 2,
      deletions: 1,
      truncated: false,
    });

    expect(db.impactAnalysis.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: {
        diffSummary: diffRecords,
        changedPaths: ["src/a.ts"],
        changedDirs: ["src"],
        fileCount: 1,
        additions: 2,
        deletions: 1,
        truncated: false,
      },
    });
  });
});
