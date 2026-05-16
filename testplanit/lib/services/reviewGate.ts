import { type Prisma, ReviewEntityType } from "@prisma/client";

import { ReviewGateError } from "~/lib/utils/errors";

/**
 * Review-gate preflight. Asserts that a state transition to `toStateId` for
 * the given entity is permitted by the Review & Approval gate.
 *
 * Contract:
 *
 *   1. Called BEFORE the caller updates the entity's `stateId`. The caller
 *      must invoke this inside the same transaction that will perform the
 *      entity update so the gate check and the update are atomic.
 *
 *   2. Feature-flag short-circuits (evaluated first, in order):
 *
 *        (a) When the env var `TESTPLANIT_REVIEW_FEATURE_ENABLED` is the
 *            literal string `'false'`, the helper returns `null` immediately
 *            and queries no tables. Only the literal `'false'` disables; any
 *            other value (undefined, 'true', '0', 'no', '') leaves the
 *            feature enabled.
 *
 *        (b) Otherwise the helper looks up the entity's project via
 *            `loadEntityProject` (one finder call routed by `entityType`).
 *            When `project.reviewWorkflowEnabled === false`, the helper
 *            returns `null` and does NOT query workflows or reviewRequest.
 *            A missing entity row (e.g. soft-deleted between the caller's
 *            initial fetch and the gate call) does not short-circuit — the
 *            downstream FK violation will surface that case via a different
 *            error class.
 *
 *      Existing PENDING reviews are preserved silently while either flag is
 *      off; re-enabling the feature resurfaces them. No auto-cancel.
 *
 *   3. If the target Workflows row has `requiresReview === false` (or does
 *      not exist), the helper returns `null` — no gate is in play. A
 *      missing Workflows row is treated as "not gated" deliberately; the
 *      foreign-key constraint on the entity update will surface the bad
 *      `stateId` as a different error class downstream.
 *
 *   4. If `requiresReview === true`, the helper looks for an approved AND
 *      unconsumed ReviewRequest matching `(entityType, entityId, toStateId)`.
 *      Per D-06 the gate keys on the target state only; `fromStateId` is
 *      intentionally NOT pinned so the request remains valid even if the
 *      entity drifts between states between request and transition.
 *
 *   5. On a hit, the helper returns `{ approvedRequestId }` so the caller
 *      can stamp `consumedAt` on the ReviewRequest AFTER the entity update
 *      fires. Per D-05 the stamp is the caller's responsibility — the gate
 *      does NOT mutate the ReviewRequest itself, which preserves the
 *      one-shot invariant when the caller stamps inside the same
 *      transaction as the entity update.
 *
 *   6. On a miss, the helper throws `ReviewGateError` with
 *      `code === 'REVIEW_REQUIRED'` and the full
 *      `(entityType, entityId, toStateId)` payload so chokepoint routes can
 *      translate it to a structured 403 response.
 *
 * The helper accepts a raw `Prisma.TransactionClient` rather than an
 * enhanced ZenStack client. This is a documented exception to the
 * `feedback_default_to_enhanced_db` memory rule: the gate runs as a
 * system-context preflight, and the caller's downstream `consumedAt` stamp
 * needs raw-Prisma semantics to bypass the append-only
 * `@@deny('update', status != 'PENDING')` rule on ReviewRequest. Keeping
 * both calls on the same raw client preserves transactional consistency.
 *
 * @param tx          a Prisma TransactionClient — either `prisma` itself or
 *                    a `tx` handle from inside `prisma.$transaction(...)`.
 * @param entityType  CASE / RUN / SESSION — selects which entity table the
 *                    update targets; ReviewRequest keys on this pair
 *                    polymorphically (no FK back-relation).
 * @param entityId    primary key of the entity being updated.
 * @param toStateId   the Workflows.id the caller intends to set on the
 *                    entity. Gate decisions are made against this target.
 *
 * @returns           `null` when the feature is disabled OR the target
 *                    state does not require review (no gate applied);
 *                    `{ approvedRequestId }` when an approved + unconsumed
 *                    ReviewRequest exists for the transition.
 *
 * @throws            `ReviewGateError` with `code === 'REVIEW_REQUIRED'`
 *                    when the target state requires review and no approved
 *                    + unconsumed ReviewRequest exists.
 */
export async function assertReviewGatePasses(
  tx: Prisma.TransactionClient,
  entityType: ReviewEntityType,
  entityId: number,
  toStateId: number,
): Promise<{ approvedRequestId: string } | null> {
  // (a) System kill switch. Only the literal string 'false' disables.
  if (process.env.TESTPLANIT_REVIEW_FEATURE_ENABLED === "false") {
    return null;
  }

  // (b) Per-project opt-out. One finder call routed by entityType.
  const entityProject = await loadEntityProject(tx, entityType, entityId);
  if (entityProject?.project?.reviewWorkflowEnabled === false) {
    return null;
  }

  const targetState = await tx.workflows.findUnique({
    where: { id: toStateId },
    select: { requiresReview: true },
  });

  if (!targetState?.requiresReview) {
    return null;
  }

  const approvedRequest = await tx.reviewRequest.findFirst({
    where: {
      entityType,
      entityId,
      toStateId,
      status: "APPROVED",
      consumedAt: null,
      isDeleted: false,
    },
    select: { id: true },
  });

  if (!approvedRequest) {
    throw new ReviewGateError(
      "REVIEW_REQUIRED",
      entityType,
      entityId,
      toStateId,
    );
  }

  return { approvedRequestId: approvedRequest.id };
}

/**
 * Resolve the project's `reviewWorkflowEnabled` flag for a polymorphic
 * (entityType, entityId) pair. Returns `null` when the entity row is
 * missing — callers treat null as "do not short-circuit; continue
 * evaluating the gate" because a missing entity surfaces via a
 * downstream FK violation, not via the gate helper.
 */
async function loadEntityProject(
  tx: Prisma.TransactionClient,
  entityType: ReviewEntityType,
  entityId: number,
): Promise<{ project: { reviewWorkflowEnabled: boolean } } | null> {
  const select = {
    project: { select: { reviewWorkflowEnabled: true } },
  } as const;

  switch (entityType) {
    case ReviewEntityType.CASE:
      return tx.repositoryCases.findUnique({ where: { id: entityId }, select });
    case ReviewEntityType.SESSION:
      return tx.sessions.findUnique({ where: { id: entityId }, select });
    case ReviewEntityType.RUN:
      return tx.testRuns.findUnique({ where: { id: entityId }, select });
    default: {
      // Exhaustiveness — TypeScript will complain if a ReviewEntityType variant
      // is added without a branch here.
      const _exhaustive: never = entityType;
      void _exhaustive;
      return null;
    }
  }
}
