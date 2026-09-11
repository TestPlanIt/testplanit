/**
 * Run-readiness enqueue wiring.
 *
 * The plugin is the only seam that notices a run filling up, and it hangs off
 * the hottest table in the app. Two properties are load-bearing and neither is
 * visible from `runReadyCheck`'s own unit tests:
 *
 *   - a write enqueues the check with the *deterministic* dedup id, so BullMQ
 *     can collapse a burst onto one evaluation;
 *   - a bulk write of N rows for one run costs one enqueue, not N distinct
 *     jobs. (It may call `add` more than once; what must not vary is the id.)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { queueAdd } = vi.hoisted(() => ({
  queueAdd: vi.fn((..._args: any[]) => Promise.resolve({ id: "bull-job-1" })),
}));

// Real `enqueueRunReadyCheck` on purpose — the dedup id is the thing under
// test, so only the queue underneath it is replaced.
vi.mock("~/lib/queues", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/queues")>()),
  getNotificationQueue: () => ({ add: queueAdd }) as any,
}));

vi.mock("~/services/sessionSearch", () => ({
  syncSessionToElasticsearch: vi.fn(() => Promise.resolve()),
}));
vi.mock("~/services/testRunSearch", () => ({
  syncTestRunToElasticsearch: vi.fn(() => Promise.resolve()),
}));
vi.mock("~/lib/webhooks/event-emitters/caseEvents", () => ({
  emitCaseCreated: vi.fn(() => Promise.resolve()),
  emitCaseUpdated: vi.fn(() => Promise.resolve()),
  emitCaseDeleted: vi.fn(() => Promise.resolve()),
}));
vi.mock("~/lib/services/reviewCancellation", () => ({
  cancelReviewsForDeletedEntities: vi.fn(() => Promise.resolve([])),
  announceDeletionCancelledReviews: vi.fn(() => Promise.resolve()),
}));

import { sideEffectsPlugin } from "./sideEffectsPlugin";
import {
  JOB_CHECK_RUN_READY,
  runReadyDedupId,
} from "~/lib/services/runReadyCheck";
import { WorkflowType } from "~/zenstack/models";

const afterEntityMutation = (sideEffectsPlugin as any).onEntityMutation
  .afterEntityMutation;

/** Dedup ids of every job the queue was asked to add, in call order. */
function dedupIds(): string[] {
  return queueAdd.mock.calls.map((c) => c[2]?.deduplication?.id);
}

/** The TestRunCases seam: one hook call carrying `rows` written together. */
function runCaseWrite(
  rows: Array<Record<string, unknown>>,
  action: "create" | "update" = "update"
) {
  return afterEntityMutation({
    model: "TestRunCases",
    action,
    client: {},
    loadAfterMutationEntities: async () => rows,
    beforeMutationEntities: undefined,
  });
}

/**
 * The RepositoryCases seam: a case moving to a NOT_STARTED state in a project
 * that excludes draft cases from runs, which soft-deletes its unexecuted
 * entries and re-checks every run that lost one.
 */
function draftStateChange(affectedRunIds: number[]) {
  const tx = {
    projects: {
      findUnique: vi.fn(async () => ({ excludeNotStartedFromRuns: true })),
    },
    workflows: {
      findUnique: vi.fn(async () => ({
        workflowType: WorkflowType.NOT_STARTED,
      })),
    },
    testRunCases: {
      findMany: vi.fn(async () =>
        affectedRunIds.map((testRunId) => ({ testRunId }))
      ),
      updateMany: vi.fn(async () => ({ count: affectedRunIds.length })),
    },
  };

  return afterEntityMutation({
    model: "RepositoryCases",
    action: "update",
    client: tx,
    loadAfterMutationEntities: async () => [
      { id: 11, projectId: 7, stateId: 2, isDeleted: false },
    ],
    beforeMutationEntities: [
      { id: 11, projectId: 7, stateId: 1, isDeleted: false },
    ],
  });
}

describe("sideEffectsPlugin — run-ready enqueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  describe("TestRunCases writes", () => {
    it("enqueues exactly one readiness check with the deterministic dedup id", async () => {
      await runCaseWrite([{ id: 1, testRunId: 42 }]);

      expect(queueAdd).toHaveBeenCalledTimes(1);
      const [name, data, opts] = queueAdd.mock.calls[0];
      expect(name).toBe(JOB_CHECK_RUN_READY);
      expect(data).toEqual({ runId: 42, tenantId: undefined });
      expect(opts.deduplication.id).toBe(runReadyDedupId(42, undefined));
      expect(opts.deduplication.id).toBe("runready:default:42");
      expect(opts.delay).toBeGreaterThan(0);
      expect(opts.deduplication.ttl).toBe(opts.delay);
    });

    it("collapses a bulk of N results for one run onto a single dedup id", async () => {
      const rows = Array.from({ length: 25 }, (_, i) => ({
        id: i + 1,
        testRunId: 42,
      }));

      await runCaseWrite(rows);

      // One run touched, so one job — not 25 distinct ones.
      expect(queueAdd).toHaveBeenCalledTimes(1);
      expect(new Set(dedupIds())).toEqual(
        new Set([runReadyDedupId(42, undefined)])
      );
    });

    it("keeps the dedup id stable across separate writes to the same run", async () => {
      await runCaseWrite([{ id: 1, testRunId: 42 }]);
      await runCaseWrite([{ id: 2, testRunId: 42 }]);

      expect(queueAdd).toHaveBeenCalledTimes(2);
      expect(dedupIds()).toEqual([
        runReadyDedupId(42, undefined),
        runReadyDedupId(42, undefined),
      ]);
    });

    it("enqueues one distinct job per run when a write spans several runs", async () => {
      await runCaseWrite([
        { id: 1, testRunId: 42 },
        { id: 2, testRunId: 42 },
        { id: 3, testRunId: 43 },
      ]);

      expect(queueAdd).toHaveBeenCalledTimes(2);
      expect(dedupIds()).toEqual([
        runReadyDedupId(42, undefined),
        runReadyDedupId(43, undefined),
      ]);
    });

    it("namespaces the dedup id by tenant", async () => {
      vi.stubEnv("INSTANCE_TENANT_ID", "acme");

      await runCaseWrite([{ id: 1, testRunId: 42 }]);

      const [, data, opts] = queueAdd.mock.calls[0];
      expect(data).toEqual({ runId: 42, tenantId: "acme" });
      expect(opts.deduplication.id).toBe("runready:acme:42");
      expect(opts.deduplication.id).not.toBe(runReadyDedupId(42, undefined));
    });

    it("enqueues nothing when no row carries a run id", async () => {
      await runCaseWrite([{ id: 1 }, { id: 2, testRunId: null }]);

      expect(queueAdd).not.toHaveBeenCalled();
    });
  });

  describe("draft-case exclusion writes", () => {
    it("enqueues one check per run that lost an unexecuted case", async () => {
      await draftStateChange([42, 43]);

      expect(queueAdd).toHaveBeenCalledTimes(2);
      expect(dedupIds()).toEqual([
        runReadyDedupId(42, undefined),
        runReadyDedupId(43, undefined),
      ]);
    });

    it("collapses repeated run ids from a bulk exclusion onto one dedup id", async () => {
      await draftStateChange([42, 42, 42, 42]);

      expect(queueAdd).toHaveBeenCalledTimes(1);
      expect(dedupIds()).toEqual([runReadyDedupId(42, undefined)]);
    });

    it("enqueues nothing when the state change removed no cases", async () => {
      await draftStateChange([]);

      expect(queueAdd).not.toHaveBeenCalled();
    });

    it("uses the same dedup id as the TestRunCases seam for the same run", async () => {
      await draftStateChange([42]);
      const fromExclusion = dedupIds();

      queueAdd.mockClear();
      await runCaseWrite([{ id: 1, testRunId: 42 }]);

      expect(dedupIds()).toEqual(fromExclusion);
    });
  });
});
