import { describe, expect, it, vi } from "vitest";
import { ReviewEntityType } from "@prisma/client";
import { ReviewGateError } from "~/lib/utils/errors";
import { assertReviewGatePasses } from "./reviewGate";

/**
 * Unit tests for the strict transitive review-gate preflight.
 *
 * Coverage matrix:
 *   - Feature-flag short-circuits (system kill switch, per-project opt-out)
 *   - Backward / same-state transitions are never blocked
 *   - No gates in scope ⇒ allowed
 *   - No gates between current and target ⇒ allowed
 *   - Single gate at target ⇒ requires approval keyed on target
 *   - Transitive (Scenario 1): gate at 4 blocks 4, 5, 6 until 4 is approved
 *   - Transitive (Scenario 2): gates at 4 + 5 each need their own approval
 *   - Strict (Scenario 3): approval for 5 does NOT satisfy gate at 4
 *   - Helper is read-only (does not mutate ReviewRequest)
 *
 * Pattern: hand-rolled mock `tx` injected per test. No module-level
 * `vi.mock` needed — the helper takes a Prisma TransactionClient by
 * parameter so the mock is fully scoped to each invocation.
 */

interface MockTxOptions {
  /** Current state order on the entity row. `null` means missing state. */
  currentStateOrder: number | null;
  /** Target state lookup result — pass `null` to simulate FK-missing. */
  targetState: { order: number } | null;
  /** Gated workflow states in this scope, ascending by order. */
  gatedStates: Array<{ id: number; order: number }>;
  /** Approved+unconsumed ReviewRequest rows keyed by `toStateId`. */
  approvalsByGateId?: Record<number, { id: string } | null>;
  /** Project's `reviewWorkflowEnabled` flag. Defaults to true. */
  reviewWorkflowEnabled?: boolean;
  /** System feature-flag AppConfig row. Defaults to enabled. */
  systemFeatureEnabled?: boolean;
}

function createMockTx(opts: MockTxOptions) {
  const reviewWorkflowEnabled = opts.reviewWorkflowEnabled ?? true;
  const systemFeatureEnabled = opts.systemFeatureEnabled ?? true;
  const approvalsByGateId = opts.approvalsByGateId ?? {};

  const entityRow = {
    project: { reviewWorkflowEnabled },
    state:
      opts.currentStateOrder === null
        ? null
        : { order: opts.currentStateOrder },
  };

  return {
    workflows: {
      findUnique: vi.fn().mockResolvedValue(opts.targetState),
      findMany: vi.fn().mockResolvedValue(opts.gatedStates),
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
        .mockResolvedValue(systemFeatureEnabled ? null : { value: false }),
    },
  } as any;
}

describe("assertReviewGatePasses (strict transitive)", () => {
  describe("feature-flag short-circuits", () => {
    it("returns null + no entity / workflow / reviewRequest queries when system flag is off", async () => {
      const tx = createMockTx({
        currentStateOrder: 3,
        targetState: { order: 4 },
        gatedStates: [{ id: 4, order: 4 }],
        systemFeatureEnabled: false,
      });

      const result = await assertReviewGatePasses(
        tx,
        ReviewEntityType.CASE,
        1,
        4
      );

      expect(result).toBeNull();
      expect(tx.repositoryCases.findUnique).not.toHaveBeenCalled();
      expect(tx.workflows.findUnique).not.toHaveBeenCalled();
      expect(tx.workflows.findMany).not.toHaveBeenCalled();
      expect(tx.reviewRequest.findFirst).not.toHaveBeenCalled();
    });

    it("returns null + no workflow / reviewRequest queries when project flag is off", async () => {
      const tx = createMockTx({
        currentStateOrder: 3,
        targetState: { order: 4 },
        gatedStates: [{ id: 4, order: 4 }],
        reviewWorkflowEnabled: false,
      });

      const result = await assertReviewGatePasses(
        tx,
        ReviewEntityType.CASE,
        1,
        4
      );

      expect(result).toBeNull();
      expect(tx.workflows.findUnique).not.toHaveBeenCalled();
      expect(tx.workflows.findMany).not.toHaveBeenCalled();
      expect(tx.reviewRequest.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("backward / same-state transitions are never blocked", () => {
    it("backward transition (current > target) returns null without querying gates", async () => {
      const tx = createMockTx({
        currentStateOrder: 5,
        targetState: { order: 2 },
        gatedStates: [{ id: 4, order: 4 }],
      });

      const result = await assertReviewGatePasses(
        tx,
        ReviewEntityType.CASE,
        1,
        2
      );

      expect(result).toBeNull();
      expect(tx.workflows.findMany).not.toHaveBeenCalled();
      expect(tx.reviewRequest.findFirst).not.toHaveBeenCalled();
    });

    it("same-state transition (current === target) returns null without querying gates", async () => {
      const tx = createMockTx({
        currentStateOrder: 4,
        targetState: { order: 4 },
        gatedStates: [{ id: 4, order: 4 }],
      });

      const result = await assertReviewGatePasses(
        tx,
        ReviewEntityType.CASE,
        1,
        4
      );

      expect(result).toBeNull();
      expect(tx.workflows.findMany).not.toHaveBeenCalled();
      expect(tx.reviewRequest.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("no-gate paths", () => {
    it("returns null when no gated states exist in scope", async () => {
      const tx = createMockTx({
        currentStateOrder: 1,
        targetState: { order: 6 },
        gatedStates: [],
      });

      const result = await assertReviewGatePasses(
        tx,
        ReviewEntityType.CASE,
        1,
        6
      );

      expect(result).toBeNull();
      expect(tx.reviewRequest.findFirst).not.toHaveBeenCalled();
    });

    it("returns null when gates exist but none lie in (currentOrder, targetOrder]", async () => {
      // Gates at 4 and 5. User is at 5 (past both), transitioning to 6.
      const tx = createMockTx({
        currentStateOrder: 5,
        targetState: { order: 6 },
        gatedStates: [
          { id: 40, order: 4 },
          { id: 50, order: 5 },
        ],
      });

      const result = await assertReviewGatePasses(
        tx,
        ReviewEntityType.CASE,
        1,
        6
      );

      expect(result).toBeNull();
      expect(tx.reviewRequest.findFirst).not.toHaveBeenCalled();
    });

    it("returns null when target workflow is missing (FK violation surfaces downstream, not from the gate)", async () => {
      const tx = createMockTx({
        currentStateOrder: 1,
        targetState: null,
        gatedStates: [{ id: 4, order: 4 }],
      });

      const result = await assertReviewGatePasses(
        tx,
        ReviewEntityType.SESSION,
        7,
        999
      );

      expect(result).toBeNull();
      expect(tx.workflows.findMany).not.toHaveBeenCalled();
      expect(tx.reviewRequest.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("Scenario 1 — single gate at state 4 (transitive)", () => {
    const gates = [{ id: 40, order: 4 }];

    it("transitioning to 3 (before the gate) is allowed without approval", async () => {
      const tx = createMockTx({
        currentStateOrder: 1,
        targetState: { order: 3 },
        gatedStates: gates,
      });

      const result = await assertReviewGatePasses(
        tx,
        ReviewEntityType.CASE,
        1,
        3
      );

      expect(result).toBeNull();
      expect(tx.reviewRequest.findFirst).not.toHaveBeenCalled();
    });

    it("transitioning to 4 (the gate) without approval throws naming gate 40", async () => {
      const tx = createMockTx({
        currentStateOrder: 1,
        targetState: { order: 4 },
        gatedStates: gates,
        approvalsByGateId: {},
      });

      await expect(
        assertReviewGatePasses(tx, ReviewEntityType.CASE, 1, 40)
      ).rejects.toMatchObject({
        code: "REVIEW_REQUIRED",
        entityType: ReviewEntityType.CASE,
        entityId: 1,
        toStateId: 40,
        blockingStateId: 40,
      });
    });

    it("transitioning to 6 (past the gate) without approval throws naming gate 40, NOT the user's target", async () => {
      const tx = createMockTx({
        currentStateOrder: 1,
        targetState: { order: 6 },
        gatedStates: gates,
        approvalsByGateId: {},
      });

      // The user picked target id=60 (state order 6). The gate that fired
      // is id=40 (state order 4) — `blockingStateId` should reflect THAT,
      // not the user's intended target.
      await expect(
        assertReviewGatePasses(tx, ReviewEntityType.CASE, 1, 60)
      ).rejects.toMatchObject({
        code: "REVIEW_REQUIRED",
        entityType: ReviewEntityType.CASE,
        entityId: 1,
        toStateId: 60,
        blockingStateId: 40,
      });
    });

    it("transitioning to 6 with approval for gate 4 returns that approval id", async () => {
      const tx = createMockTx({
        currentStateOrder: 1,
        targetState: { order: 6 },
        gatedStates: gates,
        approvalsByGateId: { 40: { id: "approval-for-gate-4" } },
      });

      const result = await assertReviewGatePasses(
        tx,
        ReviewEntityType.CASE,
        1,
        60
      );

      expect(result).toEqual({
        approvedRequestIds: ["approval-for-gate-4"],
      });
    });
  });

  describe("Scenario 2 — gates at 4 AND 5 (independent checkpoints)", () => {
    const gates = [
      { id: 40, order: 4 },
      { id: 50, order: 5 },
    ];

    it("transitioning to 5 with approval for 4 only throws naming gate 50 (second checkpoint)", async () => {
      const tx = createMockTx({
        currentStateOrder: 1,
        targetState: { order: 5 },
        gatedStates: gates,
        approvalsByGateId: { 40: { id: "approval-for-4" } },
      });

      await expect(
        assertReviewGatePasses(tx, ReviewEntityType.CASE, 1, 50)
      ).rejects.toMatchObject({
        code: "REVIEW_REQUIRED",
        entityType: ReviewEntityType.CASE,
        entityId: 1,
        toStateId: 50,
        blockingStateId: 50,
      });
    });

    it("transitioning to 5 with approvals for both 4 AND 5 returns both approval ids in path order", async () => {
      const tx = createMockTx({
        currentStateOrder: 1,
        targetState: { order: 5 },
        gatedStates: gates,
        approvalsByGateId: {
          40: { id: "approval-for-4" },
          50: { id: "approval-for-5" },
        },
      });

      const result = await assertReviewGatePasses(
        tx,
        ReviewEntityType.CASE,
        1,
        50
      );

      expect(result).toEqual({
        approvedRequestIds: ["approval-for-4", "approval-for-5"],
      });
    });

    it("transitioning to 6 with both approvals also passes (both gates crossed, neither remains)", async () => {
      const tx = createMockTx({
        currentStateOrder: 1,
        targetState: { order: 6 },
        gatedStates: gates,
        approvalsByGateId: {
          40: { id: "approval-for-4" },
          50: { id: "approval-for-5" },
        },
      });

      const result = await assertReviewGatePasses(
        tx,
        ReviewEntityType.CASE,
        1,
        60
      );

      expect(result).toEqual({
        approvedRequestIds: ["approval-for-4", "approval-for-5"],
      });
    });
  });

  describe("Scenario 3 — strict semantics (approval for later gate does NOT satisfy an earlier one)", () => {
    const gates = [
      { id: 40, order: 4 },
      { id: 50, order: 5 },
    ];

    it("transitioning to 5 with approval ONLY for 5 throws naming gate 40 (the first missing gate)", async () => {
      // User skipped requesting approval for gate 4 entirely. They have an
      // approval for gate 5. Strict semantics: each gate is its own
      // checkpoint, so gate 4 still blocks.
      const tx = createMockTx({
        currentStateOrder: 1,
        targetState: { order: 5 },
        gatedStates: gates,
        approvalsByGateId: { 50: { id: "approval-for-5" } },
      });

      await expect(
        assertReviewGatePasses(tx, ReviewEntityType.CASE, 1, 50)
      ).rejects.toMatchObject({
        code: "REVIEW_REQUIRED",
        entityType: ReviewEntityType.CASE,
        entityId: 1,
        toStateId: 50,
        blockingStateId: 40,
      });
    });
  });

  describe("query shape", () => {
    it("queries gated states scoped to the entity type (CASE → CASES scope)", async () => {
      const tx = createMockTx({
        currentStateOrder: 1,
        targetState: { order: 5 },
        gatedStates: [],
      });

      await assertReviewGatePasses(tx, ReviewEntityType.CASE, 1, 50);

      expect(tx.workflows.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            scope: "CASES",
            requiresReview: true,
            isDeleted: false,
          }),
          orderBy: { order: "asc" },
        })
      );
    });

    it("queries the reviewRequest for each blocking gate with the correct strict filter shape", async () => {
      const tx = createMockTx({
        currentStateOrder: 1,
        targetState: { order: 5 },
        gatedStates: [
          { id: 40, order: 4 },
          { id: 50, order: 5 },
        ],
        approvalsByGateId: {
          40: { id: "approval-for-4" },
          50: { id: "approval-for-5" },
        },
      });

      await assertReviewGatePasses(tx, ReviewEntityType.RUN, 7, 50);

      expect(tx.reviewRequest.findFirst).toHaveBeenCalledTimes(2);
      expect(tx.reviewRequest.findFirst).toHaveBeenNthCalledWith(1, {
        where: {
          entityType: ReviewEntityType.RUN,
          entityId: 7,
          toStateId: 40,
          status: "APPROVED",
          consumedAt: null,
          isDeleted: false,
        },
        select: { id: true },
      });
      expect(tx.reviewRequest.findFirst).toHaveBeenNthCalledWith(2, {
        where: {
          entityType: ReviewEntityType.RUN,
          entityId: 7,
          toStateId: 50,
          status: "APPROVED",
          consumedAt: null,
          isDeleted: false,
        },
        select: { id: true },
      });
    });
  });

  describe("invariants", () => {
    it("helper is read-only — does NOT mutate ReviewRequest (consumedAt stamping is the caller's responsibility per D-05)", async () => {
      const tx = createMockTx({
        currentStateOrder: 1,
        targetState: { order: 4 },
        gatedStates: [{ id: 40, order: 4 }],
        approvalsByGateId: { 40: { id: "approval-for-4" } },
      });

      const result = await assertReviewGatePasses(
        tx,
        ReviewEntityType.CASE,
        1,
        40
      );

      expect(result).toEqual({ approvedRequestIds: ["approval-for-4"] });
      expect(tx.reviewRequest.update).not.toHaveBeenCalled();
    });

    it("thrown error is a ReviewGateError instance (for `isReviewGateError` discrimination in route catches)", async () => {
      const tx = createMockTx({
        currentStateOrder: 1,
        targetState: { order: 4 },
        gatedStates: [{ id: 40, order: 4 }],
      });

      await expect(
        assertReviewGatePasses(tx, ReviewEntityType.CASE, 1, 40)
      ).rejects.toBeInstanceOf(ReviewGateError);
    });
  });
});
