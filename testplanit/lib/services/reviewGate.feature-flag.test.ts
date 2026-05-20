import { describe, expect, it, vi } from "vitest";
import { ReviewEntityType } from "@prisma/client";
import { assertReviewGatePasses } from "./reviewGate";

/**
 * Unit tests for the feature-flag short-circuits in assertReviewGatePasses.
 *
 * Two short-circuits, evaluated in order at the top of the helper:
 *
 *   (1) System-level kill switch — the `review_feature_enabled` AppConfig row.
 *       When `value === false`, the helper returns `null` immediately. A
 *       missing row (default-on, matching the seed) is treated as enabled.
 *
 *   (2) Per-project opt-out — `project.reviewWorkflowEnabled === false`,
 *       resolved via a single entity-project lookup
 *       (`loadEntityForGate` switching on entityType).
 *
 * Both short-circuits return `null` so the gate behaves exactly as it does
 * for an ungated transition. Existing PENDING reviews stay in the DB — the
 * design preserves them silently when either flag is off so re-enabling the
 * feature resurfaces them.
 *
 * The strict transitive gate logic itself lives in `reviewGate.test.ts`;
 * this file's downstream stubs are deliberately minimal (empty gated-states
 * list ⇒ no blocking gates ⇒ helper returns null on the "happy path") so
 * the feature-flag short-circuits are isolated from gate-logic concerns.
 */

function createMockTx(
  opts: {
    /**
     * Entity finder result. When provided, the returned row includes the
     * project's `reviewWorkflowEnabled` flag plus a stub current `state`
     * (order: 1 by default so any target gate above it can fire).
     */
    reviewWorkflowEnabled?: boolean;
    /** Force the entity finder to return null (missing row). */
    missingEntity?: boolean;
    /** Target state lookup result — used by the few tests that proceed past
     *  the per-project guard. */
    targetState?: { order: number } | null;
    /** Gated states list — defaults to empty (helper returns null on pass). */
    gatedStates?: Array<{ id: number; order: number }>;
    /** Approved+unconsumed ReviewRequests keyed by gate id. */
    approvalsByGateId?: Record<number, { id: string } | null>;
    /**
     * System-level AppConfig row. Defaults to enabled. Pass `null` for
     * "missing row" (also enabled), `{ value: false }` for kill switch.
     */
    appConfigResult?: { value: boolean } | null;
  } = {}
) {
  const reviewWorkflowEnabled = opts.reviewWorkflowEnabled ?? true;
  const entityRow = opts.missingEntity
    ? null
    : {
        project: { reviewWorkflowEnabled },
        state: { order: 1 },
      };
  const approvalsByGateId = opts.approvalsByGateId ?? {};

  return {
    workflows: {
      findUnique: vi.fn().mockResolvedValue(opts.targetState ?? null),
      findMany: vi.fn().mockResolvedValue(opts.gatedStates ?? []),
    },
    reviewRequest: {
      findFirst: vi.fn(async (args: any) => {
        const toStateId = args?.where?.toStateId;
        return approvalsByGateId[toStateId] ?? null;
      }),
      update: vi.fn(),
    },
    repositoryCases: {
      findUnique: vi.fn().mockResolvedValue(entityRow),
    },
    sessions: {
      findUnique: vi.fn().mockResolvedValue(entityRow),
    },
    testRuns: {
      findUnique: vi.fn().mockResolvedValue(entityRow),
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
      appConfigResult: { value: false },
      targetState: { order: 4 },
      gatedStates: [{ id: 40, order: 4 }],
    });

    const result = await assertReviewGatePasses(
      tx,
      ReviewEntityType.CASE,
      1,
      40
    );

    expect(result).toBeNull();
    expect(tx.appConfig.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.appConfig.findUnique).toHaveBeenCalledWith({
      where: { key: "review_feature_enabled" },
      select: { value: true },
    });
    expect(tx.repositoryCases.findUnique).not.toHaveBeenCalled();
    expect(tx.sessions.findUnique).not.toHaveBeenCalled();
    expect(tx.testRuns.findUnique).not.toHaveBeenCalled();
    expect(tx.workflows.findUnique).not.toHaveBeenCalled();
    expect(tx.workflows.findMany).not.toHaveBeenCalled();
    expect(tx.reviewRequest.findFirst).not.toHaveBeenCalled();
  });

  it("treats a missing AppConfig row as enabled (proceeds past system guard)", async () => {
    const tx = createMockTx({
      appConfigResult: null,
      targetState: { order: 4 },
      gatedStates: [],
    });

    const result = await assertReviewGatePasses(
      tx,
      ReviewEntityType.CASE,
      1,
      40
    );

    expect(result).toBeNull();
    expect(tx.repositoryCases.findUnique).toHaveBeenCalledTimes(1);
  });

  it("treats value === true as enabled (proceeds past system guard)", async () => {
    const tx = createMockTx({
      appConfigResult: { value: true },
      targetState: { order: 4 },
      gatedStates: [],
    });

    const result = await assertReviewGatePasses(
      tx,
      ReviewEntityType.CASE,
      1,
      40
    );

    expect(result).toBeNull();
    expect(tx.repositoryCases.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe("assertReviewGatePasses — per-project feature flag", () => {
  it("short-circuits to null when entity's project.reviewWorkflowEnabled === false (only entity lookup fires)", async () => {
    const tx = createMockTx({
      reviewWorkflowEnabled: false,
      targetState: { order: 4 },
      gatedStates: [{ id: 40, order: 4 }],
    });

    const result = await assertReviewGatePasses(
      tx,
      ReviewEntityType.CASE,
      42,
      40
    );

    expect(result).toBeNull();
    expect(tx.repositoryCases.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.repositoryCases.findUnique).toHaveBeenCalledWith({
      where: { id: 42 },
      select: {
        project: { select: { reviewWorkflowEnabled: true } },
        state: { select: { order: true } },
      },
    });
    expect(tx.workflows.findUnique).not.toHaveBeenCalled();
    expect(tx.workflows.findMany).not.toHaveBeenCalled();
    expect(tx.reviewRequest.findFirst).not.toHaveBeenCalled();
  });

  it("uses sessions.findUnique when entityType === SESSION", async () => {
    const tx = createMockTx({
      reviewWorkflowEnabled: false,
    });

    await assertReviewGatePasses(tx, ReviewEntityType.SESSION, 7, 10);

    expect(tx.sessions.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.sessions.findUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      select: {
        project: { select: { reviewWorkflowEnabled: true } },
        state: { select: { order: true } },
      },
    });
    expect(tx.repositoryCases.findUnique).not.toHaveBeenCalled();
    expect(tx.testRuns.findUnique).not.toHaveBeenCalled();
  });

  it("uses testRuns.findUnique when entityType === RUN", async () => {
    const tx = createMockTx({
      reviewWorkflowEnabled: false,
    });

    await assertReviewGatePasses(tx, ReviewEntityType.RUN, 99, 10);

    expect(tx.testRuns.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.testRuns.findUnique).toHaveBeenCalledWith({
      where: { id: 99 },
      select: {
        project: { select: { reviewWorkflowEnabled: true } },
        state: { select: { order: true } },
      },
    });
    expect(tx.repositoryCases.findUnique).not.toHaveBeenCalled();
    expect(tx.sessions.findUnique).not.toHaveBeenCalled();
  });

  it("proceeds past per-project guard when reviewWorkflowEnabled === true and returns the approval list", async () => {
    const tx = createMockTx({
      reviewWorkflowEnabled: true,
      targetState: { order: 4 },
      gatedStates: [{ id: 40, order: 4 }],
      approvalsByGateId: { 40: { id: "req-feature-on" } },
    });

    const result = await assertReviewGatePasses(
      tx,
      ReviewEntityType.CASE,
      1,
      40
    );

    expect(result).toEqual({ approvedRequestIds: ["req-feature-on"] });
    // All four layers ran: entity, target-workflow, gated-states list, reviewRequest.
    expect(tx.repositoryCases.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.workflows.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.workflows.findMany).toHaveBeenCalledTimes(1);
    expect(tx.reviewRequest.findFirst).toHaveBeenCalledTimes(1);
  });

  it("treats missing entity row (e.g. soft-deleted before gate ran) as not-flag-disabled — proceeds normally", async () => {
    // Defensive: a null entity row means we cannot prove the per-project flag
    // is off, so we must continue evaluating the gate. With no gates in the
    // path the helper returns null; with the missing entity the current
    // state order is treated as `null` so any gate at or below the target
    // would still block.
    const tx = createMockTx({
      missingEntity: true,
      targetState: { order: 4 },
      gatedStates: [],
    });

    const result = await assertReviewGatePasses(
      tx,
      ReviewEntityType.CASE,
      999,
      40
    );

    expect(result).toBeNull();
    expect(tx.repositoryCases.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.workflows.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.workflows.findMany).toHaveBeenCalledTimes(1);
  });
});

describe("assertReviewGatePasses — system flag precedes per-project flag", () => {
  it("system kill switch short-circuits even when per-project flag is true (no entity lookup)", async () => {
    const tx = createMockTx({
      reviewWorkflowEnabled: true,
      appConfigResult: { value: false },
      targetState: { order: 4 },
      gatedStates: [{ id: 40, order: 4 }],
    });

    const result = await assertReviewGatePasses(
      tx,
      ReviewEntityType.CASE,
      1,
      40
    );

    expect(result).toBeNull();
    expect(tx.appConfig.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.repositoryCases.findUnique).not.toHaveBeenCalled();
    expect(tx.workflows.findUnique).not.toHaveBeenCalled();
  });
});
