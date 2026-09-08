/**
 * "Ready to complete" detection.
 *
 * Two regressions this guards against, both silent:
 *   - Treating a parameterized case's rolled-up status as proof its iterations
 *     ran. The rollup ignores unrecorded iterations, so a 10-iteration case
 *     with one Passed reads as Passed while nine remain untouched.
 *   - Notifying more than once per "became ready" transition, or failing to
 *     re-arm when a run stops being ready.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/queues", () => ({ getNotificationQueue: () => null }));

const { claimRunReadyTransition, evaluateRunReadiness, runReadyCheckJobId } =
  await import("./runReadyCheck");

interface Counts {
  liveCases: number;
  openCases: number;
  openIterations?: number;
}

const makeDb = (
  run: Record<string, unknown> | null,
  counts: Counts,
  updateCount = 1
) => {
  const queryRaw = vi.fn();
  queryRaw.mockResolvedValueOnce([
    { liveCases: counts.liveCases, openCases: counts.openCases },
  ]);
  queryRaw.mockResolvedValueOnce([
    { openIterations: counts.openIterations ?? 0 },
  ]);
  return {
    $queryRaw: queryRaw,
    testRuns: {
      findUnique: vi.fn().mockResolvedValue(run),
      updateMany: vi.fn().mockResolvedValue({ count: updateCount }),
    },
  };
};

const READY_RUN = {
  id: 42,
  name: "Regression sweep",
  projectId: 7,
  testRunType: "REGULAR",
  isCompleted: false,
  isDeleted: false,
  readyToCompleteNotifiedAt: null,
  project: { name: "Checkout" },
};

beforeEach(() => vi.clearAllMocks());

describe("runReadyCheckJobId", () => {
  // The job id is the debounce: a bulk submission touching hundreds of cases
  // must collapse onto one evaluation per run.
  it("is stable per run and tenant", () => {
    expect(runReadyCheckJobId(42, "acme")).toBe("runready:acme:42");
    expect(runReadyCheckJobId(42, undefined)).toBe("runready:default:42");
    expect(runReadyCheckJobId(42, "acme")).not.toBe(
      runReadyCheckJobId(43, "acme")
    );
  });
});

describe("evaluateRunReadiness", () => {
  it("is ready when no case and no iteration is open", async () => {
    const db = makeDb(READY_RUN, { liveCases: 3, openCases: 0 });
    await expect(evaluateRunReadiness(db as never, 42)).resolves.toMatchObject({
      liveCases: 3,
      openCases: 0,
      openIterations: 0,
      isReady: true,
    });
  });

  it("is not ready while a case is open", async () => {
    const db = makeDb(READY_RUN, { liveCases: 3, openCases: 1 });
    await expect(evaluateRunReadiness(db as never, 42)).resolves.toMatchObject({
      isReady: false,
    });
  });

  // The rollup trap: every case reads as complete, but iterations remain.
  it("is not ready while an iteration is open, even with every case complete", async () => {
    const db = makeDb(READY_RUN, {
      liveCases: 1,
      openCases: 0,
      openIterations: 9,
    });
    await expect(evaluateRunReadiness(db as never, 42)).resolves.toMatchObject({
      openCases: 0,
      openIterations: 9,
      isReady: false,
    });
  });

  // Nothing outstanding is trivially true of an empty run, and obviously not
  // an invitation to complete it.
  it("is not ready with no live cases", async () => {
    const db = makeDb(READY_RUN, { liveCases: 0, openCases: 0 });
    await expect(evaluateRunReadiness(db as never, 42)).resolves.toMatchObject({
      isReady: false,
    });
  });

  it("skips the iteration query when a case is already open", async () => {
    const db = makeDb(READY_RUN, { liveCases: 3, openCases: 2 });
    await evaluateRunReadiness(db as never, 42);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });
});

describe("claimRunReadyTransition", () => {
  it("claims the transition and reports what to notify about", async () => {
    const db = makeDb(READY_RUN, { liveCases: 5, openCases: 0 });
    const outcome = await claimRunReadyTransition(db as never, 42);

    expect(outcome.reason).toBe("notified");
    expect(outcome.notify).toEqual({
      runId: 42,
      runName: "Regression sweep",
      projectId: 7,
      projectName: "Checkout",
      caseCount: 5,
    });
    expect(db.testRuns.updateMany).toHaveBeenCalledWith({
      where: {
        id: 42,
        readyToCompleteNotifiedAt: null,
        isCompleted: false,
        isDeleted: false,
      },
      data: { readyToCompleteNotifiedAt: expect.any(Date) },
    });
  });

  // The compare-and-set is what makes concurrent evaluations safe: whoever
  // loses the race updates nothing and stays quiet.
  it("stays quiet when another evaluation already claimed it", async () => {
    const db = makeDb(READY_RUN, { liveCases: 5, openCases: 0 }, 0);
    const outcome = await claimRunReadyTransition(db as never, 42);
    expect(outcome.reason).toBe("already-notified");
    expect(outcome.notify).toBeNull();
  });

  it("clears the marker when the run stops being ready, re-arming it", async () => {
    const db = makeDb(
      { ...READY_RUN, readyToCompleteNotifiedAt: new Date() },
      { liveCases: 5, openCases: 1 }
    );
    const outcome = await claimRunReadyTransition(db as never, 42);

    expect(outcome.reason).toBe("not-ready");
    expect(outcome.notify).toBeNull();
    expect(db.testRuns.updateMany).toHaveBeenCalledWith({
      where: { id: 42, readyToCompleteNotifiedAt: { not: null } },
      data: { readyToCompleteNotifiedAt: null },
    });
  });

  it("writes nothing when an unready run was never marked", async () => {
    const db = makeDb(READY_RUN, { liveCases: 5, openCases: 1 });
    await claimRunReadyTransition(db as never, 42);
    expect(db.testRuns.updateMany).not.toHaveBeenCalled();
  });

  it("does not nudge an already-completed run", async () => {
    const db = makeDb(
      { ...READY_RUN, isCompleted: true },
      { liveCases: 5, openCases: 0 }
    );
    const outcome = await claimRunReadyTransition(db as never, 42);
    expect(outcome.reason).toBe("already-completed");
    expect(db.testRuns.updateMany).not.toHaveBeenCalled();
  });

  // Manual runs only. Automated runs reach completion through the import
  // pipeline and summarise from JUnitTestResult, so these counts don't
  // describe them at all — and nudging someone to close a CI run by hand is
  // exactly the wrong prompt.
  it.each(["JUNIT", "TESTNG", "XUNIT", "NUNIT", "MSTEST", "MOCHA", "CUCUMBER"])(
    "ignores %s runs before running any count",
    async (testRunType) => {
      const db = makeDb(
        { ...READY_RUN, testRunType },
        { liveCases: 5, openCases: 0 }
      );
      const outcome = await claimRunReadyTransition(db as never, 42);
      expect(outcome.reason).toBe("not-regular");
      expect(db.$queryRaw).not.toHaveBeenCalled();
      expect(db.testRuns.updateMany).not.toHaveBeenCalled();
    }
  );

  // An allowlist, so a future run type nobody has considered stays silent
  // rather than opting itself in.
  it("ignores an unrecognised run type", async () => {
    const db = makeDb(
      { ...READY_RUN, testRunType: "SOME_FUTURE_TYPE" },
      { liveCases: 5, openCases: 0 }
    );
    const outcome = await claimRunReadyTransition(db as never, 42);
    expect(outcome.reason).toBe("not-regular");
  });

  it("ignores a missing or deleted run", async () => {
    const missing = makeDb(null, { liveCases: 0, openCases: 0 });
    await expect(
      claimRunReadyTransition(missing as never, 42)
    ).resolves.toMatchObject({ reason: "not-found" });

    const deleted = makeDb(
      { ...READY_RUN, isDeleted: true },
      { liveCases: 5, openCases: 0 }
    );
    await expect(
      claimRunReadyTransition(deleted as never, 42)
    ).resolves.toMatchObject({ reason: "not-found" });
  });
});
