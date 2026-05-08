import { beforeEach, describe, expect, it, vi } from "vitest";

import { getTestRunSummary, TestRunNotFoundError } from "./testRunSummary";

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
