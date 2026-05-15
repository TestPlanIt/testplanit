import { describe, expect, it, vi } from "vitest";
import { ReviewEntityType } from "@prisma/client";
import { ReviewGateError } from "~/lib/utils/errors";
import { assertReviewGatePasses } from "./reviewGate";

/**
 * Unit tests for the review-gate preflight helper.
 *
 * Coverage (Phase 1 VALIDATION.md):
 *   - #6  helper returns approvedRequestId without stamping consumedAt
 *   - #8  gate blocks when requiresReview=true && no approved+unconsumed row
 *   - #9  gate allows when requiresReview=true && an approved+unconsumed row exists
 *   - #10 gate is a no-op when requiresReview=false (early return)
 *
 * Pattern mirrors lib/services/budgetAlertService.test.ts: the helper takes a
 * Prisma TransactionClient by parameter, so we inject a per-test mock — no
 * module-level `vi.mock` needed.
 */

function createMockTx(
  workflowsResult: { requiresReview: boolean } | null,
  reviewRequestResult: { id: string } | null,
) {
  return {
    workflows: {
      findUnique: vi.fn().mockResolvedValue(workflowsResult),
    },
    reviewRequest: {
      findFirst: vi.fn().mockResolvedValue(reviewRequestResult),
      update: vi.fn(),
    },
  } as any;
}

describe("assertReviewGatePasses", () => {
  it("noop when not required: returns null and short-circuits the ReviewRequest lookup", async () => {
    const tx = createMockTx({ requiresReview: false }, null);

    const result = await assertReviewGatePasses(
      tx,
      ReviewEntityType.CASE,
      1,
      10,
    );

    expect(result).toBeNull();
    expect(tx.workflows.findUnique).toHaveBeenCalledWith({
      where: { id: 10 },
      select: { requiresReview: true },
    });
    // VALIDATION #10: must NOT query reviewRequest when the target state does
    // not require review — proves the early-return guards the cost of the
    // second roundtrip.
    expect(tx.reviewRequest.findFirst).not.toHaveBeenCalled();
  });

  it("passes with approval: returns { approvedRequestId } when requiresReview=true and an approved+unconsumed row exists", async () => {
    const tx = createMockTx(
      { requiresReview: true },
      { id: "req-abc" },
    );

    const result = await assertReviewGatePasses(
      tx,
      ReviewEntityType.CASE,
      1,
      10,
    );

    expect(result).toEqual({ approvedRequestId: "req-abc" });
    expect(tx.workflows.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.reviewRequest.findFirst).toHaveBeenCalledTimes(1);
  });

  it("blocks without approval: throws ReviewGateError when requiresReview=true and no approved+unconsumed row exists", async () => {
    // First invocation — assert the thrown instance class.
    const tx1 = createMockTx({ requiresReview: true }, null);
    await expect(
      assertReviewGatePasses(tx1, ReviewEntityType.RUN, 5, 10),
    ).rejects.toBeInstanceOf(ReviewGateError);

    // Second invocation — assert the thrown error payload shape.
    const tx2 = createMockTx({ requiresReview: true }, null);
    await expect(
      assertReviewGatePasses(tx2, ReviewEntityType.RUN, 5, 10),
    ).rejects.toMatchObject({
      code: "REVIEW_REQUIRED",
      entityType: ReviewEntityType.RUN,
      entityId: 5,
      toStateId: 10,
    });
  });

  it("returns null when target workflow not found (foreign-key violation will surface downstream from the entity update, not from the gate)", async () => {
    const tx = createMockTx(null, null);

    const result = await assertReviewGatePasses(
      tx,
      ReviewEntityType.SESSION,
      7,
      999,
    );

    expect(result).toBeNull();
    // Target state lookup ran, but no review-request query because there is
    // no requiresReview flag to gate on.
    expect(tx.workflows.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.reviewRequest.findFirst).not.toHaveBeenCalled();
  });

  it("queries reviewRequest with exact where + select shape: keys on (entityType, entityId, toStateId) per D-06 — fromStateId is intentionally NOT pinned", async () => {
    const tx = createMockTx(
      { requiresReview: true },
      { id: "req-xyz" },
    );

    await assertReviewGatePasses(tx, ReviewEntityType.SESSION, 42, 77);

    expect(tx.reviewRequest.findFirst).toHaveBeenCalledWith({
      where: {
        entityType: ReviewEntityType.SESSION,
        entityId: 42,
        toStateId: 77,
        status: "APPROVED",
        consumedAt: null,
        isDeleted: false,
      },
      select: { id: true },
    });
  });

  it("returns approvedRequestId without stamping consumedAt in helper: caller stamps atomically with the entity update per D-05 one-shot semantics", async () => {
    const tx = createMockTx(
      { requiresReview: true },
      { id: "req-one-shot" },
    );

    const result = await assertReviewGatePasses(
      tx,
      ReviewEntityType.CASE,
      11,
      22,
    );

    expect(result).toEqual({ approvedRequestId: "req-one-shot" });
    // VALIDATION #6: the helper must NOT mutate the ReviewRequest row — the
    // consumedAt stamp is the caller's responsibility, performed inside the
    // same transaction as the entity update. Proving the gate is read-only
    // preserves the one-shot invariant from D-05.
    expect(tx.reviewRequest.update).not.toHaveBeenCalled();
  });
});
