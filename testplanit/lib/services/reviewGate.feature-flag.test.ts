import { describe, expect, it, vi } from "vitest";
import { ReviewEntityType } from "@prisma/client";
import { assertReviewGatePasses } from "./reviewGate";

/**
 * Unit tests for the Phase 2 feature-flag short-circuit in
 * assertReviewGatePasses.
 *
 * Two short-circuits, evaluated in order at the top of the helper:
 *
 *   (1) System-level kill switch — the `review_feature_enabled` AppConfig row.
 *       When `value === false`, the helper returns `null` immediately. A
 *       missing row (default-on, matching the seed) is treated as enabled so
 *       installations that haven't run the seed yet still gate correctly.
 *
 *   (2) Per-project opt-out — `project.reviewWorkflowEnabled === false`,
 *       resolved via a single entity-project lookup (`loadEntityProject`
 *       switching on entityType).
 *
 * Both short-circuits return `null` so the gate behaves exactly as it does
 * for an ungated target state. Existing PENDING reviews stay in the DB —
 * the design preserves them silently when either flag is off so re-enabling
 * the feature resurfaces them.
 *
 * Pattern mirrors lib/services/reviewGate.test.ts createMockTx, extended to
 * include findUnique stubs for the three entity finders (repositoryCases,
 * sessions, testRuns) plus an `appConfig.findUnique` stub for the new
 * system-level read.
 */

function createMockTx(
  opts: {
    workflowsResult?: { requiresReview: boolean } | null;
    reviewRequestResult?: { id: string } | null;
    entityProjectResult?: {
      project: { reviewWorkflowEnabled: boolean };
    } | null;
    /**
     * System-level AppConfig row. Defaults to `{ value: true }` (feature on).
     * Pass `null` to simulate a missing row (default-on per the helper's
     * contract); pass `{ value: false }` to simulate the kill switch.
     */
    appConfigResult?: { value: boolean } | null;
  } = {}
) {
  return {
    workflows: {
      findUnique: vi.fn().mockResolvedValue(opts.workflowsResult ?? null),
    },
    reviewRequest: {
      findFirst: vi.fn().mockResolvedValue(opts.reviewRequestResult ?? null),
      update: vi.fn(),
    },
    repositoryCases: {
      findUnique: vi.fn().mockResolvedValue(opts.entityProjectResult ?? null),
    },
    sessions: {
      findUnique: vi.fn().mockResolvedValue(opts.entityProjectResult ?? null),
    },
    testRuns: {
      findUnique: vi.fn().mockResolvedValue(opts.entityProjectResult ?? null),
    },
    appConfig: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          opts.appConfigResult === undefined
            ? { value: true }
            : opts.appConfigResult
        ),
    },
  } as any;
}

describe("assertReviewGatePasses — system kill switch (AppConfig)", () => {
  it("short-circuits to null when review_feature_enabled value is false, with NO downstream DB calls", async () => {
    const tx = createMockTx({
      workflowsResult: { requiresReview: true },
      reviewRequestResult: null,
      entityProjectResult: { project: { reviewWorkflowEnabled: true } },
      appConfigResult: { value: false },
    });

    const result = await assertReviewGatePasses(
      tx,
      ReviewEntityType.CASE,
      1,
      10
    );

    expect(result).toBeNull();
    // System read is the *first* check — entity/workflow/reviewRequest queries
    // must not fire when the kill switch is active.
    expect(tx.appConfig.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.appConfig.findUnique).toHaveBeenCalledWith({
      where: { key: "review_feature_enabled" },
      select: { value: true },
    });
    expect(tx.repositoryCases.findUnique).not.toHaveBeenCalled();
    expect(tx.sessions.findUnique).not.toHaveBeenCalled();
    expect(tx.testRuns.findUnique).not.toHaveBeenCalled();
    expect(tx.workflows.findUnique).not.toHaveBeenCalled();
    expect(tx.reviewRequest.findFirst).not.toHaveBeenCalled();
  });

  it("treats a missing AppConfig row as enabled (proceeds past system guard)", async () => {
    const tx = createMockTx({
      workflowsResult: { requiresReview: false },
      entityProjectResult: { project: { reviewWorkflowEnabled: true } },
      appConfigResult: null,
    });

    const result = await assertReviewGatePasses(
      tx,
      ReviewEntityType.CASE,
      1,
      10
    );

    expect(result).toBeNull();
    // Entity-project lookup ran — proves the system guard did NOT short-circuit.
    expect(tx.repositoryCases.findUnique).toHaveBeenCalledTimes(1);
  });

  it("treats value === true as enabled (proceeds past system guard)", async () => {
    const tx = createMockTx({
      workflowsResult: { requiresReview: false },
      entityProjectResult: { project: { reviewWorkflowEnabled: true } },
      appConfigResult: { value: true },
    });

    const result = await assertReviewGatePasses(
      tx,
      ReviewEntityType.CASE,
      1,
      10
    );

    expect(result).toBeNull();
    expect(tx.repositoryCases.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe("assertReviewGatePasses — per-project feature flag", () => {
  it("short-circuits to null when entity's project.reviewWorkflowEnabled === false (only entity lookup fires)", async () => {
    const tx = createMockTx({
      workflowsResult: { requiresReview: true },
      reviewRequestResult: null,
      entityProjectResult: { project: { reviewWorkflowEnabled: false } },
    });

    const result = await assertReviewGatePasses(
      tx,
      ReviewEntityType.CASE,
      42,
      10
    );

    expect(result).toBeNull();
    // Entity-project lookup ran ONCE; downstream queries did not.
    expect(tx.repositoryCases.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.repositoryCases.findUnique).toHaveBeenCalledWith({
      where: { id: 42 },
      select: { project: { select: { reviewWorkflowEnabled: true } } },
    });
    expect(tx.workflows.findUnique).not.toHaveBeenCalled();
    expect(tx.reviewRequest.findFirst).not.toHaveBeenCalled();
  });

  it("uses sessions.findUnique when entityType === SESSION", async () => {
    const tx = createMockTx({
      workflowsResult: { requiresReview: true },
      entityProjectResult: { project: { reviewWorkflowEnabled: false } },
    });

    await assertReviewGatePasses(tx, ReviewEntityType.SESSION, 7, 10);

    expect(tx.sessions.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.sessions.findUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      select: { project: { select: { reviewWorkflowEnabled: true } } },
    });
    expect(tx.repositoryCases.findUnique).not.toHaveBeenCalled();
    expect(tx.testRuns.findUnique).not.toHaveBeenCalled();
  });

  it("uses testRuns.findUnique when entityType === RUN", async () => {
    const tx = createMockTx({
      workflowsResult: { requiresReview: true },
      entityProjectResult: { project: { reviewWorkflowEnabled: false } },
    });

    await assertReviewGatePasses(tx, ReviewEntityType.RUN, 99, 10);

    expect(tx.testRuns.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.testRuns.findUnique).toHaveBeenCalledWith({
      where: { id: 99 },
      select: { project: { select: { reviewWorkflowEnabled: true } } },
    });
    expect(tx.repositoryCases.findUnique).not.toHaveBeenCalled();
    expect(tx.sessions.findUnique).not.toHaveBeenCalled();
  });

  it("proceeds past per-project guard when reviewWorkflowEnabled === true (existing Phase 1 behaviour preserved)", async () => {
    const tx = createMockTx({
      workflowsResult: { requiresReview: true },
      reviewRequestResult: { id: "req-feature-on" },
      entityProjectResult: { project: { reviewWorkflowEnabled: true } },
    });

    const result = await assertReviewGatePasses(
      tx,
      ReviewEntityType.CASE,
      1,
      10
    );

    expect(result).toEqual({ approvedRequestId: "req-feature-on" });
    // All three layers ran: entity, workflow, reviewRequest.
    expect(tx.repositoryCases.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.workflows.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.reviewRequest.findFirst).toHaveBeenCalledTimes(1);
  });

  it("treats missing entity row (e.g. soft-deleted before gate ran) as not-flag-disabled — proceeds normally", async () => {
    // Defensive: a null result from the entity finder means we cannot prove
    // the per-project flag is off, so we must continue to evaluate the gate.
    // This preserves the Phase 1 contract that a missing entity surfaces via
    // the downstream FK violation, not via the gate helper.
    const tx = createMockTx({
      workflowsResult: { requiresReview: false },
      entityProjectResult: null,
    });

    const result = await assertReviewGatePasses(
      tx,
      ReviewEntityType.CASE,
      999,
      10
    );

    expect(result).toBeNull();
    expect(tx.repositoryCases.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.workflows.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe("assertReviewGatePasses — system flag precedes per-project flag", () => {
  it("system kill switch short-circuits even when per-project flag is true (no entity lookup)", async () => {
    const tx = createMockTx({
      workflowsResult: { requiresReview: true },
      entityProjectResult: { project: { reviewWorkflowEnabled: true } },
      appConfigResult: { value: false },
    });

    const result = await assertReviewGatePasses(
      tx,
      ReviewEntityType.CASE,
      1,
      10
    );

    expect(result).toBeNull();
    expect(tx.appConfig.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.repositoryCases.findUnique).not.toHaveBeenCalled();
    expect(tx.workflows.findUnique).not.toHaveBeenCalled();
  });
});
