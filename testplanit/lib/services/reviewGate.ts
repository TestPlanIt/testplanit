import { type Prisma, ReviewEntityType, WorkflowScope } from "@prisma/client";

import { ReviewGateError } from "~/lib/utils/errors";
import { isReviewFeatureSystemEnabled } from "~/lib/services/reviewFeatureFlag";

/**
 * Review-gate preflight. Asserts that a state transition to `toStateId` for
 * the given entity is permitted by the Review & Approval gate under
 * **strict transitive** semantics.
 *
 * Contract:
 *
 *   1. Called BEFORE the caller updates the entity's `stateId`. The caller
 *      must invoke this inside the same transaction that will perform the
 *      entity update so the gate check and the update are atomic.
 *
 *   2. Feature-flag short-circuits (evaluated first, in order):
 *
 *        (a) When the AppConfig row keyed by `review_feature_enabled` has
 *            `value === false`, the helper returns `null` immediately and
 *            queries no other tables. A missing row leaves the feature
 *            enabled; admins toggle it from the Admin Workflows page (no
 *            restart required).
 *
 *        (b) Otherwise the helper looks up the entity row to read the
 *            project's `reviewWorkflowEnabled` flag AND the entity's current
 *            workflow state (one query). When `reviewWorkflowEnabled ===
 *            false`, the helper returns `null` and queries no further. A
 *            missing entity row (soft-deleted between fetch and gate) does
 *            not short-circuit — the downstream FK violation will surface
 *            that case via a different error class.
 *
 *      Existing PENDING reviews are preserved silently while either flag is
 *      off; re-enabling the feature resurfaces them. No auto-cancel.
 *
 *   3. **Backward / same-state transitions are never blocked.** If the
 *      target state's `order` is at or below the entity's current state
 *      order, the helper returns `null` — moving "back" along the workflow
 *      doesn't need re-approval for gates that were already crossed.
 *
 *   4. **Transitive gate detection.** The helper loads all gated workflow
 *      states (`requiresReview === true`) in the entity-type's scope and
 *      filters to "blocking gates": those with
 *      `currentOrder < gate.order ≤ targetOrder`. A transition crosses
 *      every blocking gate, so every one must be satisfied.
 *
 *   5. **Strict per-gate approval.** For each blocking gate the helper
 *      requires an approved + unconsumed ReviewRequest with `toStateId ===
 *      gate.id`. An approval for a *different* gate (even a later one)
 *      does NOT satisfy the gate — each gate is its own checkpoint with
 *      its own reviewer decision. On a miss the helper throws
 *      `ReviewGateError` naming the FIRST missing gate (lowest order) so
 *      the user-facing message points at the immediate blocker.
 *
 *   6. On a full pass, the helper returns `{ approvedRequestIds }` — the
 *      list of every approved ReviewRequest satisfying the blocking gates
 *      this transition crosses. Per D-05 the helper does NOT mutate the
 *      ReviewRequest rows; the caller stamps `consumedAt` on every id in
 *      the list AFTER the entity update fires, preserving the one-shot
 *      invariant while ensuring a single transition can consume multiple
 *      pre-approved gates in one shot.
 *
 * The helper accepts a raw `Prisma.TransactionClient` rather than an
 * enhanced ZenStack client. This is a documented exception to the
 * `feedback_default_to_enhanced_db` memory rule: the gate runs as a
 * system-context preflight, and the caller's downstream `consumedAt` stamp
 * needs raw-Prisma semantics to bypass the append-only
 * `@@deny('update', status != 'PENDING')` rule on ReviewRequest.
 *
 * @param tx          a Prisma TransactionClient — either `prisma` itself
 *                    or a `tx` handle from inside `prisma.$transaction(...)`.
 * @param entityType  CASE / RUN / SESSION — selects which entity table the
 *                    update targets; ReviewRequest keys on this pair
 *                    polymorphically (no FK back-relation).
 * @param entityId    primary key of the entity being updated.
 * @param toStateId   the Workflows.id the caller intends to set on the
 *                    entity. Gate decisions are made against this target.
 *
 * @returns           `null` when the feature is disabled, the transition
 *                    is backward / same-state, or no gates lie in the
 *                    path; `{ approvedRequestIds }` (possibly empty? no —
 *                    always populated when non-null) when every blocking
 *                    gate has a matching approval.
 *
 * @throws            `ReviewGateError` with `code === 'REVIEW_REQUIRED'`
 *                    when any blocking gate lacks an approved + unconsumed
 *                    ReviewRequest. `blockingStateId` on the error names
 *                    the gate that fired (which may differ from
 *                    `toStateId` for transitive blocks).
 */
export async function assertReviewGatePasses(
  tx: Prisma.TransactionClient,
  entityType: ReviewEntityType,
  entityId: number,
  toStateId: number
): Promise<{ approvedRequestIds: string[] } | null> {
  // (a) System kill switch — AppConfig row `review_feature_enabled`.
  if (!(await isReviewFeatureSystemEnabled(tx))) {
    return null;
  }

  // (b) Entity row carries both signals we need: project's reviewWorkflowEnabled
  // flag AND the entity's current state.order. One query covers both.
  const entityRow = await loadEntityForGate(tx, entityType, entityId);
  if (entityRow?.project?.reviewWorkflowEnabled === false) {
    return null;
  }

  const targetState = await tx.workflows.findUnique({
    where: { id: toStateId },
    select: { order: true },
  });

  // Missing target state — FK violation will surface from the downstream
  // entity update; treat as "no gate" so this helper doesn't double-fail.
  if (!targetState) {
    return null;
  }

  const currentStateOrder = entityRow?.state?.order ?? null;

  // (3) Backward / same-state transitions are never blocked.
  if (currentStateOrder !== null && currentStateOrder >= targetState.order) {
    return null;
  }

  // (4) Load gated states in this entity-type's workflow scope and filter
  // to blocking gates (currentOrder < g.order ≤ targetOrder).
  const scope = SCOPE_BY_ENTITY_TYPE[entityType];
  const gatedStates = await tx.workflows.findMany({
    where: {
      scope,
      requiresReview: true,
      isDeleted: false,
    },
    select: { id: true, order: true },
    orderBy: { order: "asc" },
  });

  const blockingGates = gatedStates.filter(
    (g) =>
      (currentStateOrder === null || currentStateOrder < g.order) &&
      g.order <= targetState.order
  );

  if (blockingGates.length === 0) {
    return null;
  }

  // (5) Strict per-gate approval. Each gate needs its OWN approval keyed
  // on toStateId === gate.id.
  const approvedRequestIds: string[] = [];
  for (const gate of blockingGates) {
    const approval = await tx.reviewRequest.findFirst({
      where: {
        entityType,
        entityId,
        toStateId: gate.id,
        status: "APPROVED",
        consumedAt: null,
        isDeleted: false,
      },
      select: { id: true },
    });
    if (!approval) {
      throw new ReviewGateError(
        "REVIEW_REQUIRED",
        entityType,
        entityId,
        toStateId,
        gate.id
      );
    }
    approvedRequestIds.push(approval.id);
  }

  return { approvedRequestIds };
}

/**
 * Map a polymorphic `ReviewEntityType` (CASE/RUN/SESSION) to the matching
 * `WorkflowScope` (CASES/RUNS/SESSIONS) so the gated-states lookup only
 * loads rows relevant to the entity's workflow.
 */
const SCOPE_BY_ENTITY_TYPE: Record<ReviewEntityType, WorkflowScope> = {
  [ReviewEntityType.CASE]: WorkflowScope.CASES,
  [ReviewEntityType.RUN]: WorkflowScope.RUNS,
  [ReviewEntityType.SESSION]: WorkflowScope.SESSIONS,
};

/**
 * Resolve the entity's project flag + current workflow state in one query.
 * Returns `null` when the entity row is missing — callers treat null as
 * "do not short-circuit; continue evaluating the gate" because a missing
 * entity surfaces via a downstream FK violation, not via the gate helper.
 */
async function loadEntityForGate(
  tx: Prisma.TransactionClient,
  entityType: ReviewEntityType,
  entityId: number
): Promise<{
  project: { reviewWorkflowEnabled: boolean };
  state: { order: number } | null;
} | null> {
  const select = {
    project: { select: { reviewWorkflowEnabled: true } },
    state: { select: { order: true } },
  } as const;

  switch (entityType) {
    case ReviewEntityType.CASE:
      return tx.repositoryCases.findUnique({
        where: { id: entityId },
        select,
      });
    case ReviewEntityType.SESSION:
      return tx.sessions.findUnique({ where: { id: entityId }, select });
    case ReviewEntityType.RUN:
      return tx.testRuns.findUnique({ where: { id: entityId }, select });
    default: {
      // Exhaustiveness — TypeScript will complain if a ReviewEntityType
      // variant is added without a branch here.
      const _exhaustive: never = entityType;
      void _exhaustive;
      return null;
    }
  }
}
