import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryReason } from "../types";
import { runHistoryLayer, type HistoryLayerInput } from "./historyLayer";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-09-10T00:00:00Z");

const cfg = { historyLookbackDays: 365, historyMaxAnalyses: 25 };

function input(overrides: Partial<HistoryLayerInput> = {}): HistoryLayerInput {
  return {
    projectId: 374,
    analysisId: 900,
    changedPaths: ["lib/auth.ts", "lib/session.ts"],
    changedDirs: ["lib"],
    cfg,
    now,
    ...overrides,
  };
}

interface PriorOptions {
  id: number;
  testRunId: number;
  changedPaths?: string[];
  changedDirs?: string[];
  ageDays?: number;
  manualCaseIds?: number[];
}

function prior(options: PriorOptions) {
  return {
    id: options.id,
    testRunId: options.testRunId,
    changedPaths: options.changedPaths ?? [],
    changedDirs: options.changedDirs ?? [],
    createdAt: new Date(now.getTime() - (options.ageDays ?? 1) * DAY),
    cases: (options.manualCaseIds ?? []).map((caseId) => ({ caseId })),
  };
}

/** `status` is deliberately loose: the layer may only read the flag off it. */
function runCase(
  testRunId: number,
  repositoryCaseId: number,
  status: Record<string, unknown> | null = null
) {
  return { testRunId, repositoryCaseId, status };
}

function makeDb(priorAnalyses: unknown[], runCases: unknown[] = []) {
  return {
    impactAnalysis: { findMany: vi.fn().mockResolvedValue(priorAnalyses) },
    testRunCases: { findMany: vi.fn().mockResolvedValue(runCases) },
  };
}

function reasonsFor(
  layer: Awaited<ReturnType<typeof runHistoryLayer>>["layer"],
  caseId: number
): HistoryReason[] {
  return (layer.get(caseId)?.reasons ?? []) as HistoryReason[];
}

describe("runHistoryLayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks nothing when the diff touched no paths or directories", async () => {
    const db = makeDb([]);

    const out = await runHistoryLayer(
      db as any,
      input({ changedPaths: [], changedDirs: [] })
    );

    expect(out.layer.size).toBe(0);
    expect(out.priorAnalysisCount).toBe(0);
    expect(db.impactAnalysis.findMany).not.toHaveBeenCalled();
  });

  it("scopes the prior-analysis query to the lookback window and the cap", async () => {
    const db = makeDb([]);

    await runHistoryLayer(
      db as any,
      input({ cfg: { historyLookbackDays: 30, historyMaxAnalyses: 5 } })
    );

    const args = db.impactAnalysis.findMany.mock.calls[0][0];
    expect(args.take).toBe(5);
    expect(args.where.createdAt.gte).toEqual(
      new Date(now.getTime() - 30 * DAY)
    );
    expect(args.where.id).toEqual({ not: 900 });
    expect(args.where.testRunId).toEqual({ not: null });
    expect(args.where.isDeleted).toBe(false);
  });

  it("does not look up run cases when no prior analysis overlapped", async () => {
    const db = makeDb([]);

    const out = await runHistoryLayer(db as any, input());

    expect(out.priorAnalysisCount).toBe(0);
    expect(db.testRunCases.findMany).not.toHaveBeenCalled();
  });

  it("queries only the runs the surviving analyses composed", async () => {
    const db = makeDb(
      [
        prior({ id: 1, testRunId: 10, changedPaths: ["lib/auth.ts"] }),
        prior({ id: 2, testRunId: 20, changedDirs: ["lib"] }),
      ],
      []
    );

    await runHistoryLayer(db as any, input());

    const args = db.testRunCases.findMany.mock.calls[0][0];
    expect(args.where.testRunId).toEqual({ in: [10, 20] });
    expect(args.where.isDeleted).toBe(false);
  });

  it("scores a file overlap above a directory-only overlap", async () => {
    const db = makeDb(
      [
        prior({ id: 1, testRunId: 10, changedPaths: ["lib/auth.ts"] }),
        prior({ id: 2, testRunId: 20, changedDirs: ["lib"] }),
      ],
      [runCase(10, 101), runCase(20, 202)]
    );

    const out = await runHistoryLayer(db as any, input());

    expect(out.priorAnalysisCount).toBe(2);
    expect(reasonsFor(out.layer, 101)[0]).toMatchObject({
      kind: "HISTORY",
      analysisId: 1,
      testRunId: 10,
      overlap: "file",
      overlappingPaths: ["lib/auth.ts"],
    });
    expect(reasonsFor(out.layer, 202)[0]).toMatchObject({
      overlap: "dir",
      overlappingPaths: [],
    });
    expect(out.layer.get(101)!.score).toBe(40);
    expect(out.layer.get(202)!.score).toBe(25);
    expect(out.layer.get(101)!.score).toBeGreaterThan(
      out.layer.get(202)!.score
    );
  });

  it("reports at most ten overlapping paths per hit", async () => {
    const paths = Array.from({ length: 14 }, (_, i) => `lib/file${i}.ts`);
    const db = makeDb(
      [prior({ id: 1, testRunId: 10, changedPaths: paths })],
      [runCase(10, 101)]
    );

    const out = await runHistoryLayer(
      db as any,
      input({ changedPaths: paths, changedDirs: ["lib"] })
    );

    expect(reasonsFor(out.layer, 101)[0].overlappingPaths).toEqual(
      paths.slice(0, 10)
    );
  });

  it("reads failure from the status flag, never from a status name", async () => {
    const db = makeDb(
      [prior({ id: 1, testRunId: 10, changedPaths: ["lib/auth.ts"] })],
      [
        runCase(10, 101, { isFailure: true, name: "Passed" }),
        runCase(10, 202, { isFailure: false, name: "Failed" }),
        runCase(10, 303, null),
      ]
    );

    const out = await runHistoryLayer(db as any, input());

    expect(reasonsFor(out.layer, 101)[0].failed).toBe(true);
    expect(reasonsFor(out.layer, 202)[0].failed).toBe(false);
    expect(reasonsFor(out.layer, 303)[0].failed).toBe(false);
    expect(out.layer.get(101)!.score).toBe(70);
    expect(out.layer.get(202)!.score).toBe(40);
    expect(out.layer.get(303)!.score).toBe(40);

    const select = db.testRunCases.findMany.mock.calls[0][0].select;
    expect(select.status).toEqual({ select: { isFailure: true } });
  });

  it("marks a case the prior analysis added by hand", async () => {
    const db = makeDb(
      [
        prior({
          id: 1,
          testRunId: 10,
          changedDirs: ["lib"],
          manualCaseIds: [101],
        }),
      ],
      [runCase(10, 101), runCase(10, 202)]
    );

    const out = await runHistoryLayer(db as any, input());

    expect(reasonsFor(out.layer, 101)[0].addedManually).toBe(true);
    expect(reasonsFor(out.layer, 202)[0].addedManually).toBe(false);
    expect(out.layer.get(101)!.score).toBe(60);
    expect(out.layer.get(202)!.score).toBe(25);
  });

  it("decays a hit from an analysis older than the 180-day window", async () => {
    const db = makeDb(
      [
        prior({
          id: 1,
          testRunId: 10,
          changedPaths: ["lib/auth.ts"],
          ageDays: 200,
        }),
        prior({
          id: 2,
          testRunId: 20,
          changedPaths: ["lib/auth.ts"],
          ageDays: 10,
        }),
      ],
      [
        runCase(10, 101, { isFailure: true }),
        runCase(20, 202, { isFailure: true }),
      ]
    );

    const out = await runHistoryLayer(db as any, input());

    expect(out.layer.get(101)!.score).toBe(49);
    expect(out.layer.get(202)!.score).toBe(70);
  });

  it("adds a bonus for a case seen across several prior analyses", async () => {
    const db = makeDb(
      [
        prior({ id: 1, testRunId: 10, changedPaths: ["lib/auth.ts"] }),
        prior({ id: 2, testRunId: 20, changedPaths: ["lib/session.ts"] }),
      ],
      [runCase(10, 101), runCase(20, 101)]
    );

    const out = await runHistoryLayer(db as any, input());

    expect(reasonsFor(out.layer, 101)).toHaveLength(2);
    expect(out.layer.get(101)!.score).toBe(45);
  });

  it("keeps one signal per test run when two analyses share it", async () => {
    // A run can be composed from more than one analysis (the accept endpoint
    // lets a second analysis add its cases to an existing run). Its result rows
    // carry only a run id, so they are one execution signal, not two: counting
    // them once per analysis would pay the multi-analysis bonus for a single
    // run. The newest analysis (first in the newest-first query order) gets
    // the credit, because its hand-added cases and overlap are current.
    const db = makeDb(
      [
        prior({ id: 2, testRunId: 10, changedPaths: ["lib/auth.ts"] }),
        prior({ id: 1, testRunId: 10, changedPaths: ["lib/session.ts"] }),
      ],
      [runCase(10, 101)]
    );

    const out = await runHistoryLayer(db as any, input());

    expect(out.priorAnalysisCount).toBe(2);
    expect(reasonsFor(out.layer, 101)).toHaveLength(1);
    expect(reasonsFor(out.layer, 101)[0].testRunId).toBe(10);
    expect(reasonsFor(out.layer, 101)[0].analysisId).toBe(2);
    expect(out.layer.get(101)!.score).toBe(40);
  });

  it("ignores run cases from a run no surviving analysis composed", async () => {
    const db = makeDb(
      [prior({ id: 1, testRunId: 10, changedPaths: ["lib/auth.ts"] })],
      [runCase(10, 101), runCase(99, 202)]
    );

    const out = await runHistoryLayer(db as any, input());

    expect([...out.layer.keys()]).toEqual([101]);
  });
});
