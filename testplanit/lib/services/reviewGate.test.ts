import { describe, expect, it, vi } from "vitest";
import { ReviewEntityType, WorkflowScope } from "~/zenstack/models";
import { ReviewGateError } from "~/lib/utils/errors";
import {
  applyApprovedReviewTransition,
  assertBulkReviewGatePasses,
  assertReviewGatePasses,
  resolveCreateStateRemap,
} from "./reviewGate";

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
 *   - applyApprovedReviewTransition: approval performs the move + consume,
 *     and returns false (never throws) for every expected no-move case
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
  /** Entity row is absent (soft-deleted / bad id). Defaults to present. */
  entityMissing?: boolean;
  /**
   * `count` the `consumedAt` stamp returns. Defaults to "every requested id
   * was stamped"; set 0 to simulate a concurrent transition that already
   * spent one of the approvals.
   */
  stampCount?: number;
}

function createMockTx(opts: MockTxOptions) {
  const reviewWorkflowEnabled = opts.reviewWorkflowEnabled ?? true;
  const systemFeatureEnabled = opts.systemFeatureEnabled ?? true;
  const approvalsByGateId = opts.approvalsByGateId ?? {};

  const entityRow = opts.entityMissing
    ? null
    : {
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
      updateMany: vi.fn(async (args: any) => ({
        count: opts.stampCount ?? args?.where?.id?.in?.length ?? 0,
      })),
    },
    repositoryCases: {
      findUnique: vi.fn().mockResolvedValue(entityRow),
      update: vi.fn(),
    },
    sessions: {
      findUnique: vi.fn().mockResolvedValue(entityRow),
      update: vi.fn(),
    },
    testRuns: {
      findUnique: vi.fn().mockResolvedValue(entityRow),
      update: vi.fn(),
    },
    appConfig: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          systemFeatureEnabled ? { value: true } : { value: false }
        ),
    },
  } as any;
}

describe("assertReviewGatePasses (strict transitive)", () => {
  describe("system-admin bypass", () => {
    it("returns null + queries nothing at all when userAccess is ADMIN, even with an unapproved gate in the path", async () => {
      const tx = createMockTx({
        currentStateOrder: 3,
        targetState: { order: 6 },
        // Gate at 4 with NO approval — a non-admin would throw here.
        gatedStates: [{ id: 40, order: 4 }],
        approvalsByGateId: {},
      });

      const result = await assertReviewGatePasses(
        tx,
        ReviewEntityType.CASE,
        1,
        6,
        "ADMIN"
      );

      expect(result).toBeNull();
      // Bypass is evaluated before the system kill switch, so not even the
      // AppConfig row is read.
      expect(tx.appConfig.findUnique).not.toHaveBeenCalled();
      expect(tx.repositoryCases.findUnique).not.toHaveBeenCalled();
      expect(tx.workflows.findUnique).not.toHaveBeenCalled();
      expect(tx.workflows.findMany).not.toHaveBeenCalled();
      expect(tx.reviewRequest.findFirst).not.toHaveBeenCalled();
    });

    it("does NOT consume a pending approval when an admin crosses a gate that has one", async () => {
      const tx = createMockTx({
        currentStateOrder: 3,
        targetState: { order: 4 },
        gatedStates: [{ id: 40, order: 4 }],
        approvalsByGateId: { 40: { id: "req-40" } },
      });

      const result = await assertReviewGatePasses(
        tx,
        ReviewEntityType.CASE,
        1,
        4,
        "ADMIN"
      );

      // null (not `{ approvedRequestIds: ["req-40"] }`) — the reviewer's
      // decision stays available for the transition it was raised for.
      expect(result).toBeNull();
      expect(tx.reviewRequest.updateMany).not.toHaveBeenCalled();
      expect(tx.reviewRequest.update).not.toHaveBeenCalled();
    });

    it.each([
      ["PROJECTADMIN", "PROJECTADMIN"],
      ["USER", "USER"],
      ["undefined", undefined],
      ["null", null],
    ])(
      "still enforces the gate for non-admin access %s",
      async (_label, access) => {
        const tx = createMockTx({
          currentStateOrder: 3,
          targetState: { order: 4 },
          gatedStates: [{ id: 40, order: 4 }],
          approvalsByGateId: {},
        });

        await expect(
          assertReviewGatePasses(
            tx,
            ReviewEntityType.CASE,
            1,
            4,
            access as string | null | undefined
          )
        ).rejects.toBeInstanceOf(ReviewGateError);
      }
    );
  });

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

// ─────────────────────────────────────────────────────────────────────────────
// assertBulkReviewGatePasses — one transition target across many entities.
// ─────────────────────────────────────────────────────────────────────────────

interface BulkMockTxOptions {
  /** Target state lookup result — pass `null` for FK-missing. */
  targetState: { order: number } | null;
  /** Gated workflow states in this scope, ascending by order. */
  gatedStates: Array<{ id: number; order: number }>;
  /**
   * Approved+unconsumed ReviewRequest rows the bulk findMany returns.
   * `entityId` keys per-entity which gates the entity has approved.
   */
  approvals?: Array<{ id: string; entityId: number; toStateId: number }>;
}

function createBulkMockTx(opts: BulkMockTxOptions) {
  return {
    workflows: {
      findUnique: vi.fn().mockResolvedValue(opts.targetState),
      findMany: vi.fn().mockResolvedValue(opts.gatedStates),
    },
    reviewRequest: {
      findMany: vi.fn().mockResolvedValue(opts.approvals ?? []),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  } as any;
}

describe("assertBulkReviewGatePasses (strict transitive, bulk)", () => {
  describe("system-admin bypass", () => {
    it("returns null + queries nothing when userAccess is ADMIN, even with entities missing approvals", async () => {
      const tx = createBulkMockTx({
        targetState: { order: 6 },
        gatedStates: [{ id: 40, order: 4 }],
        approvals: [],
      });

      const result = await assertBulkReviewGatePasses(
        tx,
        ReviewEntityType.RUN,
        [
          { id: 1, currentStateOrder: 1 },
          { id: 2, currentStateOrder: null },
        ],
        60,
        "ADMIN"
      );

      expect(result).toBeNull();
      expect(tx.workflows.findUnique).not.toHaveBeenCalled();
      expect(tx.workflows.findMany).not.toHaveBeenCalled();
      expect(tx.reviewRequest.findMany).not.toHaveBeenCalled();
    });

    it("still enforces the gate for a non-admin caller", async () => {
      const tx = createBulkMockTx({
        targetState: { order: 6 },
        gatedStates: [{ id: 40, order: 4 }],
        approvals: [],
      });

      await expect(
        assertBulkReviewGatePasses(
          tx,
          ReviewEntityType.RUN,
          [{ id: 1, currentStateOrder: 1 }],
          60,
          "PROJECTADMIN"
        )
      ).rejects.toBeInstanceOf(ReviewGateError);
    });
  });

  describe("short-circuits", () => {
    it("returns null when entities array is empty (zero work)", async () => {
      const tx = createBulkMockTx({
        targetState: { order: 4 },
        gatedStates: [],
      });
      const result = await assertBulkReviewGatePasses(
        tx,
        ReviewEntityType.RUN,
        [],
        40
      );
      expect(result).toBeNull();
      expect(tx.workflows.findUnique).not.toHaveBeenCalled();
      expect(tx.reviewRequest.findMany).not.toHaveBeenCalled();
    });

    it("returns null when the target state can't be resolved (FK violation will surface from caller's update)", async () => {
      const tx = createBulkMockTx({
        targetState: null,
        gatedStates: [{ id: 40, order: 4 }],
      });
      const result = await assertBulkReviewGatePasses(
        tx,
        ReviewEntityType.RUN,
        [{ id: 1, currentStateOrder: 1 }],
        99
      );
      expect(result).toBeNull();
      // Skipped gate fetch + approval lookup.
      expect(tx.workflows.findMany).not.toHaveBeenCalled();
      expect(tx.reviewRequest.findMany).not.toHaveBeenCalled();
    });

    it("returns null when every entity is already at or past the target order (backward / same-state — never blocked)", async () => {
      const tx = createBulkMockTx({
        targetState: { order: 4 },
        gatedStates: [{ id: 40, order: 4 }],
      });
      const result = await assertBulkReviewGatePasses(
        tx,
        ReviewEntityType.RUN,
        [
          { id: 1, currentStateOrder: 4 }, // same state
          { id: 2, currentStateOrder: 5 }, // past target
        ],
        40
      );
      expect(result).toBeNull();
      // Avoid the gated-states + approvals roundtrips when nothing crosses.
      expect(tx.workflows.findMany).not.toHaveBeenCalled();
      expect(tx.reviewRequest.findMany).not.toHaveBeenCalled();
    });

    it("returns null when there are no reachable gates in scope (target order is below the lowest gate)", async () => {
      const tx = createBulkMockTx({
        targetState: { order: 3 },
        gatedStates: [{ id: 40, order: 4 }],
      });
      const result = await assertBulkReviewGatePasses(
        tx,
        ReviewEntityType.RUN,
        [{ id: 1, currentStateOrder: 1 }],
        30
      );
      expect(result).toBeNull();
      expect(tx.reviewRequest.findMany).not.toHaveBeenCalled();
    });
  });

  describe("strict transitive semantics", () => {
    it("returns the union of approval ids when every entity has approvals for every blocking gate it crosses", async () => {
      const tx = createBulkMockTx({
        targetState: { order: 6 },
        gatedStates: [
          { id: 40, order: 4 },
          { id: 50, order: 5 },
        ],
        approvals: [
          { id: "a1-g4", entityId: 1, toStateId: 40 },
          { id: "a1-g5", entityId: 1, toStateId: 50 },
          // Entity 2 starts AT order 5, so only gate 50 (5) ≤ 5? No — `currentStateOrder < gate.order`,
          // so gate at 5 is NOT in path for entity 2. Only gate 50? Wait — order 5 ≤ 5, so it IS in
          // path. Let me set entity 2 currentStateOrder=5 → gates with order > 5 are in path. The
          // only reachable gate ≤ 6 is order 5; "5 < 5" is false → entity 2 has NO blocking gate.
          { id: "a2-g5", entityId: 2, toStateId: 50 },
        ],
      });
      const result = await assertBulkReviewGatePasses(
        tx,
        ReviewEntityType.RUN,
        [
          { id: 1, currentStateOrder: 1 },
          { id: 2, currentStateOrder: 5 },
        ],
        60
      );
      // Entity 1 crosses gates 40 + 50 → consumes a1-g4 + a1-g5.
      // Entity 2 starts at order 5 → no blocking gate in (5, 6] → no consumption.
      expect(result).toEqual({
        approvedRequestIds: ["a1-g4", "a1-g5"],
      });
    });

    it("throws ReviewGateError naming the first blocking entity + gate when an entity is missing its approval (Scenario 3 strict)", async () => {
      const tx = createBulkMockTx({
        targetState: { order: 6 },
        gatedStates: [
          { id: 40, order: 4 },
          { id: 50, order: 5 },
        ],
        // Entity 1 has only the later approval — strict semantics: that does
        // NOT satisfy gate 40. The first miss for entity 1 fires.
        approvals: [{ id: "a1-g5", entityId: 1, toStateId: 50 }],
      });

      let captured: ReviewGateError | null = null;
      try {
        await assertBulkReviewGatePasses(
          tx,
          ReviewEntityType.RUN,
          [{ id: 1, currentStateOrder: 1 }],
          60
        );
      } catch (e) {
        captured = e as ReviewGateError;
      }
      expect(captured).toBeInstanceOf(ReviewGateError);
      expect(captured?.entityId).toBe(1);
      expect(captured?.entityType).toBe(ReviewEntityType.RUN);
      // First missing gate (40) is named via blockingStateId for the
      // immediate-blocker UX.
      expect(captured?.blockingStateId).toBe(40);
    });

    it("treats null currentStateOrder as 'before everything' so every reachable gate applies", async () => {
      const tx = createBulkMockTx({
        targetState: { order: 6 },
        gatedStates: [{ id: 40, order: 4 }],
        // No approvals → entity with null currentStateOrder still hits gate 40.
        approvals: [],
      });
      await expect(
        assertBulkReviewGatePasses(
          tx,
          ReviewEntityType.RUN,
          [{ id: 1, currentStateOrder: null }],
          60
        )
      ).rejects.toBeInstanceOf(ReviewGateError);
    });
  });

  describe("query shape (one batched lookup, not N×G)", () => {
    it("issues exactly one workflow.findMany for gates and one reviewRequest.findMany covering the full selection", async () => {
      const tx = createBulkMockTx({
        targetState: { order: 6 },
        gatedStates: [
          { id: 40, order: 4 },
          { id: 50, order: 5 },
        ],
        approvals: [
          { id: "a1-g4", entityId: 1, toStateId: 40 },
          { id: "a1-g5", entityId: 1, toStateId: 50 },
          { id: "a2-g4", entityId: 2, toStateId: 40 },
          { id: "a2-g5", entityId: 2, toStateId: 50 },
        ],
      });
      await assertBulkReviewGatePasses(
        tx,
        ReviewEntityType.RUN,
        [
          { id: 1, currentStateOrder: 1 },
          { id: 2, currentStateOrder: 1 },
        ],
        60
      );
      expect(tx.workflows.findMany).toHaveBeenCalledTimes(1);
      expect(tx.reviewRequest.findMany).toHaveBeenCalledTimes(1);
      expect(tx.reviewRequest.findMany).toHaveBeenCalledWith({
        where: {
          entityType: ReviewEntityType.RUN,
          entityId: { in: [1, 2] },
          toStateId: { in: [40, 50] },
          status: "APPROVED",
          consumedAt: null,
          isDeleted: false,
        },
        select: { id: true, entityId: true, toStateId: true },
      });
    });

    it("helper is read-only — does NOT mutate ReviewRequest (caller stamps consumedAt)", async () => {
      const tx = createBulkMockTx({
        targetState: { order: 4 },
        gatedStates: [{ id: 40, order: 4 }],
        approvals: [{ id: "a1-g4", entityId: 1, toStateId: 40 }],
      });
      await assertBulkReviewGatePasses(
        tx,
        ReviewEntityType.RUN,
        [{ id: 1, currentStateOrder: 1 }],
        40
      );
      expect(tx.reviewRequest.update).not.toHaveBeenCalled();
      expect(tx.reviewRequest.updateMany).not.toHaveBeenCalled();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// applyApprovedReviewTransition — approval IS the transition.
//
// The reviewer's approval performs the state change the requester asked for,
// so nobody has to come back and repeat it by hand. These tests pin the two
// halves of that contract: the move + consume on the happy path, and the
// "return false rather than throw" posture for every expected no-move case,
// since the decision must survive an entity that can't move yet.
// ─────────────────────────────────────────────────────────────────────────────

describe("applyApprovedReviewTransition", () => {
  const APPROVAL_ID = "approval-under-decision";

  it("moves the entity to the target state and consumes the approval", async () => {
    const tx = createMockTx({
      currentStateOrder: 3,
      targetState: { order: 4 },
      gatedStates: [{ id: 40, order: 4 }],
      approvalsByGateId: { 40: { id: APPROVAL_ID } },
    });

    const applied = await applyApprovedReviewTransition(tx, {
      reviewRequestId: APPROVAL_ID,
      entityType: ReviewEntityType.CASE,
      entityId: 1,
      toStateId: 40,
    });

    expect(applied).toBe(true);
    expect(tx.repositoryCases.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { stateId: 40 },
    });
    expect(tx.reviewRequest.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [APPROVAL_ID] }, consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });
  });

  it("consumes every approval the crossing spends when one transition clears several gates", async () => {
    // Entity at 1 moving to gate 5; gate 4 was approved earlier and never
    // redeemed (the requester approved both before either was applied).
    const tx = createMockTx({
      currentStateOrder: 1,
      targetState: { order: 5 },
      gatedStates: [
        { id: 40, order: 4 },
        { id: 50, order: 5 },
      ],
      approvalsByGateId: {
        40: { id: "approval-for-4" },
        50: { id: APPROVAL_ID },
      },
    });

    const applied = await applyApprovedReviewTransition(tx, {
      reviewRequestId: APPROVAL_ID,
      entityType: ReviewEntityType.CASE,
      entityId: 1,
      toStateId: 50,
    });

    expect(applied).toBe(true);
    expect(tx.reviewRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["approval-for-4", APPROVAL_ID] },
        consumedAt: null,
      },
      data: { consumedAt: expect.any(Date) },
    });
  });

  it("consumes the approving request even when the target state is no longer gated", async () => {
    // `requiresReview` was switched off on the target after the request was
    // raised, so the gate matches nothing. The move still happens and the
    // approval is still spent — otherwise it would linger as a live token.
    const tx = createMockTx({
      currentStateOrder: 3,
      targetState: { order: 4 },
      gatedStates: [],
    });

    const applied = await applyApprovedReviewTransition(tx, {
      reviewRequestId: APPROVAL_ID,
      entityType: ReviewEntityType.CASE,
      entityId: 1,
      toStateId: 40,
    });

    expect(applied).toBe(true);
    expect(tx.repositoryCases.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { stateId: 40 },
    });
    expect(tx.reviewRequest.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [APPROVAL_ID] }, consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });
  });

  it("updates testRuns for RUN and sessions for SESSION", async () => {
    const runTx = createMockTx({
      currentStateOrder: 3,
      targetState: { order: 4 },
      gatedStates: [{ id: 40, order: 4 }],
      approvalsByGateId: { 40: { id: APPROVAL_ID } },
    });
    await applyApprovedReviewTransition(runTx, {
      reviewRequestId: APPROVAL_ID,
      entityType: ReviewEntityType.RUN,
      entityId: 7,
      toStateId: 40,
    });
    expect(runTx.testRuns.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { stateId: 40 },
    });
    expect(runTx.repositoryCases.update).not.toHaveBeenCalled();

    const sessionTx = createMockTx({
      currentStateOrder: 3,
      targetState: { order: 4 },
      gatedStates: [{ id: 40, order: 4 }],
      approvalsByGateId: { 40: { id: APPROVAL_ID } },
    });
    await applyApprovedReviewTransition(sessionTx, {
      reviewRequestId: APPROVAL_ID,
      entityType: ReviewEntityType.SESSION,
      entityId: 9,
      toStateId: 40,
    });
    expect(sessionTx.sessions.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { stateId: 40 },
    });
  });

  describe("expected no-move cases return false instead of throwing", () => {
    it("an earlier unapproved gate blocks the move but leaves the approval intact", async () => {
      // Gate 4 was never requested; this approval targets gate 5. Strict
      // transitive semantics keep the entity where it is, and the approval
      // stays unconsumed so it applies once gate 4 clears.
      const tx = createMockTx({
        currentStateOrder: 1,
        targetState: { order: 5 },
        gatedStates: [
          { id: 40, order: 4 },
          { id: 50, order: 5 },
        ],
        approvalsByGateId: { 50: { id: APPROVAL_ID } },
      });

      const applied = await applyApprovedReviewTransition(tx, {
        reviewRequestId: APPROVAL_ID,
        entityType: ReviewEntityType.CASE,
        entityId: 1,
        toStateId: 50,
      });

      expect(applied).toBe(false);
      expect(tx.repositoryCases.update).not.toHaveBeenCalled();
      expect(tx.reviewRequest.updateMany).not.toHaveBeenCalled();
    });

    it("an entity already at the target state is left alone", async () => {
      const tx = createMockTx({
        currentStateOrder: 4,
        targetState: { order: 4 },
        gatedStates: [{ id: 40, order: 4 }],
        approvalsByGateId: { 40: { id: APPROVAL_ID } },
      });

      const applied = await applyApprovedReviewTransition(tx, {
        reviewRequestId: APPROVAL_ID,
        entityType: ReviewEntityType.CASE,
        entityId: 1,
        toStateId: 40,
      });

      expect(applied).toBe(false);
      expect(tx.repositoryCases.update).not.toHaveBeenCalled();
      expect(tx.reviewRequest.updateMany).not.toHaveBeenCalled();
    });

    it("an entity already past the target state is not dragged backward", async () => {
      const tx = createMockTx({
        currentStateOrder: 6,
        targetState: { order: 4 },
        gatedStates: [{ id: 40, order: 4 }],
        approvalsByGateId: { 40: { id: APPROVAL_ID } },
      });

      const applied = await applyApprovedReviewTransition(tx, {
        reviewRequestId: APPROVAL_ID,
        entityType: ReviewEntityType.CASE,
        entityId: 1,
        toStateId: 40,
      });

      expect(applied).toBe(false);
      expect(tx.repositoryCases.update).not.toHaveBeenCalled();
    });

    it("a missing entity row is a no-op", async () => {
      const tx = createMockTx({
        currentStateOrder: 3,
        targetState: { order: 4 },
        gatedStates: [{ id: 40, order: 4 }],
        approvalsByGateId: { 40: { id: APPROVAL_ID } },
        entityMissing: true,
      });

      const applied = await applyApprovedReviewTransition(tx, {
        reviewRequestId: APPROVAL_ID,
        entityType: ReviewEntityType.CASE,
        entityId: 1,
        toStateId: 40,
      });

      expect(applied).toBe(false);
      expect(tx.repositoryCases.update).not.toHaveBeenCalled();
    });

    it("a missing target state row is a no-op", async () => {
      const tx = createMockTx({
        currentStateOrder: 3,
        targetState: null,
        gatedStates: [{ id: 40, order: 4 }],
        approvalsByGateId: { 40: { id: APPROVAL_ID } },
      });

      const applied = await applyApprovedReviewTransition(tx, {
        reviewRequestId: APPROVAL_ID,
        entityType: ReviewEntityType.CASE,
        entityId: 1,
        toStateId: 40,
      });

      expect(applied).toBe(false);
      expect(tx.repositoryCases.update).not.toHaveBeenCalled();
    });
  });

  it("throws ReviewGateError when a concurrent transition already spent an approval", async () => {
    // The one-shot invariant (D-05) outranks the move: a short stamp count
    // means someone else redeemed the approval between the gate read and the
    // stamp, so the caller's transaction must roll back rather than commit a
    // half-consumed crossing.
    const tx = createMockTx({
      currentStateOrder: 3,
      targetState: { order: 4 },
      gatedStates: [{ id: 40, order: 4 }],
      approvalsByGateId: { 40: { id: APPROVAL_ID } },
      stampCount: 0,
    });

    await expect(
      applyApprovedReviewTransition(tx, {
        reviewRequestId: APPROVAL_ID,
        entityType: ReviewEntityType.CASE,
        entityId: 1,
        toStateId: 40,
      })
    ).rejects.toBeInstanceOf(ReviewGateError);
  });
});

describe("resolveCreateStateRemap — system-admin bypass", () => {
  /**
   * Minimal tx for the create-time remap: a project row carrying the
   * per-project flag plus the scope's workflow list (the helper reads
   * `isDefault` / `requiresReview` / `order` off it).
   */
  function createRemapMockTx() {
    return {
      appConfig: {
        findUnique: vi.fn().mockResolvedValue({ value: true }),
      },
      projects: {
        findUnique: vi.fn().mockResolvedValue({ reviewWorkflowEnabled: true }),
      },
      workflows: {
        findMany: vi.fn().mockResolvedValue([
          { id: 10, order: 1, isDefault: true, requiresReview: false },
          { id: 40, order: 4, isDefault: false, requiresReview: true },
        ]),
      },
    } as any;
  }

  it("returns the candidate unchanged and queries nothing when userAccess is ADMIN", async () => {
    const tx = createRemapMockTx();

    // Candidate 40 is the gate itself — a non-admin would be remapped to 10.
    const result = await resolveCreateStateRemap(
      tx,
      1,
      WorkflowScope.CASES,
      40,
      "ADMIN"
    );

    expect(result).toBe(40);
    expect(tx.appConfig.findUnique).not.toHaveBeenCalled();
    expect(tx.projects.findUnique).not.toHaveBeenCalled();
    expect(tx.workflows.findMany).not.toHaveBeenCalled();
  });

  it("remaps a gated candidate to the project default for a non-admin", async () => {
    const tx = createRemapMockTx();

    const result = await resolveCreateStateRemap(
      tx,
      1,
      WorkflowScope.CASES,
      40,
      "USER"
    );

    expect(result).toBe(10);
  });

  it("remaps when no actor is supplied (importer / worker contexts)", async () => {
    const tx = createRemapMockTx();

    const result = await resolveCreateStateRemap(
      tx,
      1,
      WorkflowScope.CASES,
      40
    );

    expect(result).toBe(10);
  });
});
