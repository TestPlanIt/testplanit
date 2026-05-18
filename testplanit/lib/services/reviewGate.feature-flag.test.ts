import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewEntityType } from "@prisma/client";
import { assertReviewGatePasses } from "./reviewGate";

/**
 * Unit tests for the Phase 2 feature-flag short-circuit added to
 * assertReviewGatePasses.
 *
 * Two short-circuits, evaluated in order at the top of the helper:
 *
 *   (1) `process.env.TESTPLANIT_REVIEW_FEATURE_ENABLED === 'false'` —
 *       system-level kill switch (D-19/D-20). Only the literal string 'false'
 *       disables; any other value (undefined, 'true', '0', 'no', '') leaves the
 *       feature enabled.
 *
 *   (2) `project.reviewWorkflowEnabled === false` — per-project opt-out
 *       (D-17/D-18). Resolved via a single entity-project lookup (new
 *       `loadEntityProject` helper switching on entityType).
 *
 * Both short-circuits return `null` so the gate behaves exactly as it does for
 * an ungated target state. Existing PENDING reviews stay in the DB (D-20
 * "preserved silently"); the caller continues without throwing.
 *
 * Pattern mirrors lib/services/reviewGate.test.ts createMockTx, extended to
 * include findUnique stubs for the three entity finders (repositoryCases,
 * sessions, testRuns).
 */

function createMockTx(opts: {
  workflowsResult?: { requiresReview: boolean } | null;
  reviewRequestResult?: { id: string } | null;
  entityProjectResult?: { project: { reviewWorkflowEnabled: boolean } } | null;
} = {}) {
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
  } as any;
}

describe("assertReviewGatePasses — env-var system kill switch", () => {
  beforeEach(() => {
    // Default: env-var unset. Each test stubs as needed.
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("short-circuits to null when TESTPLANIT_REVIEW_FEATURE_ENABLED === 'false', with NO DB calls", async () => {
    vi.stubEnv("TESTPLANIT_REVIEW_FEATURE_ENABLED", "false");
    const tx = createMockTx({
      workflowsResult: { requiresReview: true },
      reviewRequestResult: null,
      entityProjectResult: { project: { reviewWorkflowEnabled: true } },
    });

    const result = await assertReviewGatePasses(
      tx,
      ReviewEntityType.CASE,
      1,
      10,
    );

    expect(result).toBeNull();
    // Proves the env-var guard is the *first* check — no entity, workflow, or
    // review-request queries fired before short-circuit returned null.
    expect(tx.repositoryCases.findUnique).not.toHaveBeenCalled();
    expect(tx.sessions.findUnique).not.toHaveBeenCalled();
    expect(tx.testRuns.findUnique).not.toHaveBeenCalled();
    expect(tx.workflows.findUnique).not.toHaveBeenCalled();
    expect(tx.reviewRequest.findFirst).not.toHaveBeenCalled();
  });

  it("treats undefined env-var as enabled (proceeds past env-var guard)", async () => {
    vi.stubEnv("TESTPLANIT_REVIEW_FEATURE_ENABLED", undefined);
    const tx = createMockTx({
      workflowsResult: { requiresReview: false },
      entityProjectResult: { project: { reviewWorkflowEnabled: true } },
    });

    const result = await assertReviewGatePasses(
      tx,
      ReviewEntityType.CASE,
      1,
      10,
    );

    expect(result).toBeNull();
    // Entity-project lookup ran (proves env-var guard did NOT short-circuit).
    expect(tx.repositoryCases.findUnique).toHaveBeenCalledTimes(1);
  });

  it("treats 'true' env-var as enabled (proceeds past env-var guard)", async () => {
    vi.stubEnv("TESTPLANIT_REVIEW_FEATURE_ENABLED", "true");
    const tx = createMockTx({
      workflowsResult: { requiresReview: false },
      entityProjectResult: { project: { reviewWorkflowEnabled: true } },
    });

    const result = await assertReviewGatePasses(
      tx,
      ReviewEntityType.CASE,
      1,
      10,
    );

    expect(result).toBeNull();
    expect(tx.repositoryCases.findUnique).toHaveBeenCalledTimes(1);
  });

  it("treats unrelated env-var values ('0', 'no') as enabled — only the literal 'false' disables", async () => {
    for (const value of ["0", "no", ""]) {
      vi.stubEnv("TESTPLANIT_REVIEW_FEATURE_ENABLED", value);
      const tx = createMockTx({
        workflowsResult: { requiresReview: false },
        entityProjectResult: { project: { reviewWorkflowEnabled: true } },
      });

      await assertReviewGatePasses(tx, ReviewEntityType.CASE, 1, 10);

      expect(tx.repositoryCases.findUnique).toHaveBeenCalledTimes(1);
      vi.unstubAllEnvs();
    }
  });
});

describe("assertReviewGatePasses — per-project feature flag", () => {
  beforeEach(() => {
    vi.stubEnv("TESTPLANIT_REVIEW_FEATURE_ENABLED", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

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
      10,
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
      10,
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
      10,
    );

    expect(result).toBeNull();
    expect(tx.repositoryCases.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.workflows.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe("assertReviewGatePasses — env-var precedes per-project flag", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("env-var 'false' short-circuits even when per-project flag is true (no entity lookup)", async () => {
    vi.stubEnv("TESTPLANIT_REVIEW_FEATURE_ENABLED", "false");
    const tx = createMockTx({
      workflowsResult: { requiresReview: true },
      entityProjectResult: { project: { reviewWorkflowEnabled: true } },
    });

    const result = await assertReviewGatePasses(
      tx,
      ReviewEntityType.CASE,
      1,
      10,
    );

    expect(result).toBeNull();
    expect(tx.repositoryCases.findUnique).not.toHaveBeenCalled();
    expect(tx.workflows.findUnique).not.toHaveBeenCalled();
  });
});
