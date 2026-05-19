import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPerCaseIterationCounts,
  getTestRunSummary,
  TestRunNotFoundError,
} from "./testRunSummary";

/**
 * Plan 02-05 Task 5.1 — smoke tests for the testRunSummary service.
 *
 * These verify the type shape and the optional `client` argument used by
 * the test_run.completed emitter (Task 5.2). Heavy SQL coverage stays in
 * Plan 02-08's E2E (the route is exercised end-to-end by the existing UI
 * surface).
 */
describe("getTestRunSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a TestRunSummaryData-shaped object with all expected keys (regular run)", async () => {
    const fakeClient = makeFakeClient({
      testRunType: "REGULAR",
      forecastManual: null,
      issues: [],
      workflowType: "DONE",
    });

    const summary = await getTestRunSummary(1, { client: fakeClient as any });

    expect(summary).toMatchObject({
      testRunType: "REGULAR",
      workflowType: "DONE",
      totalCases: expect.any(Number),
      statusCounts: expect.any(Array),
      completionRate: expect.any(Number),
      totalElapsed: expect.any(Number),
      totalEstimate: expect.any(Number),
      commentsCount: expect.any(Number),
      issues: expect.any(Array),
    });
  });

  it("returns junitSummary when the test run is a JUnit-shaped run", async () => {
    const fakeClient = makeFakeClient({
      testRunType: "JUNIT",
      forecastManual: null,
      issues: [],
      workflowType: "DONE",
    });

    const summary = await getTestRunSummary(1, { client: fakeClient as any });

    expect(summary.junitSummary).toBeDefined();
    expect(summary.junitSummary?.totalTests).toBeGreaterThanOrEqual(0);
  });

  it("uses the explicit `client` override when provided (so emitter can pass tx)", async () => {
    const fakeClient = makeFakeClient({
      testRunType: "REGULAR",
      forecastManual: null,
      issues: [],
      workflowType: "IN_PROGRESS",
    });

    await getTestRunSummary(99, { client: fakeClient as any });

    // The fake client's testRuns.findUnique is the one that fired (not the
    // singleton import).
    expect(fakeClient.testRuns.findUnique).toHaveBeenCalledWith({
      where: { id: 99 },
      select: expect.any(Object),
    });
  });

  it("throws TestRunNotFoundError when the test run does not exist", async () => {
    const fakeClient = makeFakeClient({ testRunNotFound: true });

    await expect(
      getTestRunSummary(404, { client: fakeClient as any })
    ).rejects.toThrow(TestRunNotFoundError);
  });

  it("respects forecastManual when set (overrides estimate sum)", async () => {
    const fakeClient = makeFakeClient({
      testRunType: "REGULAR",
      forecastManual: 12345,
      issues: [],
      workflowType: "IN_PROGRESS",
    });

    const summary = await getTestRunSummary(1, { client: fakeClient as any });

    expect(summary.totalEstimate).toBe(12345);
  });

  it("includes mapped issues with projectIds populated from the test run", async () => {
    const fakeClient = makeFakeClient({
      testRunType: "REGULAR",
      forecastManual: null,
      workflowType: "DONE",
      issues: [
        {
          id: 1,
          name: "BUG-1",
          title: "Crash on save",
          externalId: "JIRA-1",
          externalKey: "JIRA-1",
          externalUrl: null,
          externalStatus: null,
          data: null,
          integrationId: null,
          lastSyncedAt: null,
          issueTypeName: null,
          issueTypeIconUrl: null,
          integration: null,
        },
      ],
    });

    const summary = await getTestRunSummary(1, { client: fakeClient as any });

    expect(summary.issues).toHaveLength(1);
    expect(summary.issues[0].projectIds).toEqual([42]);
  });
});

interface FakeClientOptions {
  testRunType?: string;
  forecastManual?: number | null;
  issues?: Array<Record<string, unknown>>;
  workflowType?: "NOT_STARTED" | "IN_PROGRESS" | "DONE" | null;
  testRunNotFound?: boolean;
}

function makeFakeClient(opts: FakeClientOptions) {
  const findUnique = vi.fn(async () => {
    if (opts.testRunNotFound) return null;
    return {
      testRunType: opts.testRunType ?? "REGULAR",
      forecastManual: opts.forecastManual ?? null,
      projectId: 42,
      state: opts.workflowType ? { workflowType: opts.workflowType } : null,
      issues: opts.issues ?? [],
    };
  });

  // $queryRaw mock — returns shape-appropriate empty rows so the SQL paths
  // in getRegularRunSummary / getJUnitRunSummary all return without throwing.
  const queryRaw = vi.fn(async (..._args: unknown[]) => {
    // Inspect the first argument (template strings) to guess which query
    // is firing and return a matching empty-shape array.
    const tpl = _args[0] as TemplateStringsArray | undefined;
    const text = tpl?.join(" ") ?? "";
    if (text.includes("Comment")) {
      return [{ count: BigInt(0) }];
    }
    if (text.includes("totalElapsed")) {
      return [{ totalElapsed: BigInt(0) }];
    }
    if (text.includes("totalEstimate")) {
      return [{ totalEstimate: BigInt(0) }];
    }
    if (text.includes("totalTime")) {
      return [{ totalTime: 0 }];
    }
    return [];
  });

  return {
    testRuns: { findUnique },
    $queryRaw: queryRaw,
  };
}

/**
 * Phase 6 INT-03 / D-04 — `getPerCaseIterationCounts` reads denormalized
 * counters off TestRunCases and derives `notRun`. These tests guarantee
 * the canonical acceptance criteria from the plan:
 *   - Non-parameterized cases (totalIterations: 0) report iterationCount: 0
 *     and zeros in every bucket — no false positives.
 *   - notRun = max(total - passed - failed - skipped, 0)
 *   - skipped + passed + failed + notRun always sum to totalIterations
 *     (property test on random counters).
 */
describe("getPerCaseIterationCounts", () => {
  function makeCountClient(
    rows: Array<{
      id: number;
      passedIterations: number;
      failedIterations: number;
      skippedIterations: number;
      totalIterations: number;
    }>
  ) {
    return {
      testRunCases: {
        findMany: vi.fn(async () => rows),
      },
    };
  }

  it("non-parameterized case reports iterationCount 0 and all buckets at 0", async () => {
    const client = makeCountClient([
      {
        id: 11,
        passedIterations: 0,
        failedIterations: 0,
        skippedIterations: 0,
        totalIterations: 0,
      },
    ]);
    const counts = await getPerCaseIterationCounts(1, client as any);
    expect(counts).toEqual([
      {
        testRunCaseId: 11,
        iterationCount: 0,
        iterationsByStatus: { passed: 0, failed: 0, skipped: 0, notRun: 0 },
      },
    ]);
  });

  it("parameterized case reports passed/failed/skipped/notRun from denormalized counters", async () => {
    const client = makeCountClient([
      {
        id: 21,
        passedIterations: 3,
        failedIterations: 1,
        skippedIterations: 2,
        totalIterations: 10,
      },
    ]);
    const counts = await getPerCaseIterationCounts(1, client as any);
    expect(counts[0]).toEqual({
      testRunCaseId: 21,
      iterationCount: 10,
      iterationsByStatus: { passed: 3, failed: 1, skipped: 2, notRun: 4 },
    });
  });

  it("notRun is clamped to 0 when counters exceed totalIterations (transient drift)", async () => {
    const client = makeCountClient([
      {
        id: 31,
        passedIterations: 5,
        failedIterations: 5,
        skippedIterations: 5,
        totalIterations: 10,
      },
    ]);
    const counts = await getPerCaseIterationCounts(1, client as any);
    // 10 - 5 - 5 - 5 = -5 → clamped to 0 (no negative bucket reaches webhook)
    expect(counts[0].iterationsByStatus.notRun).toBe(0);
  });

  it("skipped + passed + failed + notRun always sum to totalIterations (property test)", async () => {
    // Generate 50 random fixtures where passed + failed + skipped <= total.
    const fixtures = Array.from({ length: 50 }, (_, i) => {
      const total = Math.floor(Math.random() * 100);
      const passed = Math.floor(Math.random() * (total + 1));
      const failed = Math.floor(Math.random() * (total - passed + 1));
      const skipped = Math.floor(
        Math.random() * (total - passed - failed + 1)
      );
      return {
        id: 100 + i,
        passedIterations: passed,
        failedIterations: failed,
        skippedIterations: skipped,
        totalIterations: total,
      };
    });
    const client = makeCountClient(fixtures);
    const counts = await getPerCaseIterationCounts(1, client as any);
    for (let i = 0; i < counts.length; i++) {
      const c = counts[i];
      const fx = fixtures[i];
      const sum =
        c.iterationsByStatus.passed +
        c.iterationsByStatus.failed +
        c.iterationsByStatus.skipped +
        c.iterationsByStatus.notRun;
      expect(sum).toBe(fx.totalIterations);
    }
  });

  it("scopes findMany by testRunId only (no cross-tenant leak)", async () => {
    const client = makeCountClient([]);
    await getPerCaseIterationCounts(777, client as any);
    expect(client.testRunCases.findMany).toHaveBeenCalledWith({
      where: { testRunId: 777 },
      select: expect.any(Object),
      orderBy: { order: "asc" },
    });
  });
});
