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
 * Bulk variant of {@link assertReviewGatePasses}. Evaluates strict-transitive
 * gate semantics for many entities transitioning to the same target state
 * (e.g. `completeMilestoneCascade` flipping every active TestRun/Session in
 * a milestone to its DONE state). One transition target shared across N
 * entities at potentially different current states.
 *
 * Contract differences from the single-entity helper:
 *
 *   1. **Feature-flag short-circuits are the caller's responsibility.** The
 *      caller has already loaded the project's `reviewWorkflowEnabled` flag
 *      and the AppConfig system flag, so this helper accepts pre-loaded
 *      entity rows with their current state order and skips the per-row
 *      `project.reviewWorkflowEnabled` lookup that the single-entity helper
 *      runs. Callers MUST gate this call behind both flag checks themselves
 *      (matches the existing milestoneActions WR-04 fast path).
 *
 *   2. **Caller pre-loads `currentStateOrder`.** Avoids N round-trips to
 *      fetch entity rows inside the loop. `null` means "before everything"
 *      (mirrors the single-entity helper's missing-state case — every gate
 *      applies).
 *
 *   3. **One ReviewRequest batch lookup, not N×G.** Approved+unconsumed
 *      requests for `(entityId IN [...], toStateId IN [gateIds])` come back
 *      in a single `findMany` and are indexed by `(entityId, toStateId)` for
 *      O(1) per-gate lookups.
 *
 *   4. On the first missing approval the helper throws `ReviewGateError`
 *      with the FIRST blocking entity's id and the FIRST missing gate id.
 *      The throw rolls back the caller's transaction, so partial-bulk
 *      semantics ("fail closed") match the bulk-edit and submit-result
 *      paths.
 *
 *   5. Return shape matches the single-entity helper: `{ approvedRequestIds }`
 *      is the UNION across every entity × every blocking gate. The caller
 *      stamps `consumedAt` on the full list in one `updateMany` after the
 *      bulk entity update commits — same one-shot invariant as Phase 1 D-05.
 *
 * Cost: 1× workflow.findUnique (target) + 1× workflow.findMany (gates) +
 *       1× reviewRequest.findMany (all approvals). Constant in the number
 *       of entities — same characteristic as the pre-strict batch path.
 */
export async function assertBulkReviewGatePasses(
  tx: Prisma.TransactionClient,
  entityType: ReviewEntityType,
  entities: ReadonlyArray<{ id: number; currentStateOrder: number | null }>,
  toStateId: number
): Promise<{ approvedRequestIds: string[] } | null> {
  if (entities.length === 0) {
    return null;
  }

  const targetState = await tx.workflows.findUnique({
    where: { id: toStateId },
    select: { order: true },
  });
  // Missing target — FK violation will surface from the caller's update.
  if (!targetState) {
    return null;
  }

  // Filter to forward transitions; backward / same-state never blocked.
  const forward = entities.filter(
    (e) =>
      e.currentStateOrder === null || e.currentStateOrder < targetState.order
  );
  if (forward.length === 0) {
    return null;
  }

  const scope = SCOPE_BY_ENTITY_TYPE[entityType];
  const gatedStates = await tx.workflows.findMany({
    where: { scope, requiresReview: true, isDeleted: false },
    select: { id: true, order: true },
    orderBy: { order: "asc" },
  });

  // The union of "potentially blocking" gates is anything ≤ target order;
  // per-entity filtering further narrows by that entity's currentStateOrder.
  const reachableGates = gatedStates.filter(
    (g) => g.order <= targetState.order
  );
  if (reachableGates.length === 0) {
    return null;
  }

  const approvals = await tx.reviewRequest.findMany({
    where: {
      entityType,
      entityId: { in: forward.map((e) => e.id) },
      toStateId: { in: reachableGates.map((g) => g.id) },
      status: "APPROVED",
      consumedAt: null,
      isDeleted: false,
    },
    select: { id: true, entityId: true, toStateId: true },
  });

  const approvalsByEntity = new Map<number, Map<number, string>>();
  for (const a of approvals as Array<{
    id: string;
    entityId: number;
    toStateId: number;
  }>) {
    let inner = approvalsByEntity.get(a.entityId);
    if (!inner) {
      inner = new Map();
      approvalsByEntity.set(a.entityId, inner);
    }
    inner.set(a.toStateId, a.id);
  }

  const approvedRequestIds: string[] = [];
  for (const entity of forward) {
    const entityApprovals = approvalsByEntity.get(entity.id);
    for (const gate of reachableGates) {
      const inPath =
        (entity.currentStateOrder === null ||
          entity.currentStateOrder < gate.order) &&
        gate.order <= targetState.order;
      if (!inPath) continue;
      const approvalId = entityApprovals?.get(gate.id);
      if (!approvalId) {
        // Name the first missing gate so the user-facing message points at
        // the immediate blocker (matches single-entity helper behavior).
        throw new ReviewGateError(
          "REVIEW_REQUIRED",
          entityType,
          entity.id,
          toStateId,
          gate.id
        );
      }
      approvedRequestIds.push(approvalId);
    }
  }

  return approvedRequestIds.length > 0 ? { approvedRequestIds } : null;
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

/**
 * Remap a chosen `stateId` to the project's default state for the given
 * scope when the chosen state would put a brand-new entity at or beyond
 * a gated state. The schema gate fires only on `update`; without this
 * remap, any caller (server action, worker import, AI generation, copy
 * source preservation) could birth an entity directly past a gate.
 *
 * Strict-transitive rule mirrors the UI: when the project + system flags
 * are both ON and the candidate state's `order` is >= the first gated
 * state's `order` in the same scope, the helper returns the default
 * state's id instead. Otherwise the candidate is returned unchanged.
 *
 * Returns `null` when no default state exists for the scope on the
 * project — the caller should treat that as an exceptional condition
 * (seed gap) rather than swallow it.
 */
export async function resolveCreateStateRemap(
  tx: Prisma.TransactionClient,
  projectId: number,
  scope: WorkflowScope,
  candidateStateId: number
): Promise<number | null> {
  if (!(await isReviewFeatureSystemEnabled(tx))) {
    return candidateStateId;
  }

  const project = await tx.projects.findUnique({
    where: { id: projectId },
    select: { reviewWorkflowEnabled: true },
  });
  if (project?.reviewWorkflowEnabled === false) {
    return candidateStateId;
  }

  const workflows = await tx.workflows.findMany({
    where: {
      isDeleted: false,
      isEnabled: true,
      scope,
      projects: { some: { projectId } },
    },
    select: {
      id: true,
      order: true,
      isDefault: true,
      requiresReview: true,
    },
    orderBy: { order: "asc" },
  });

  const firstGatedOrder = workflows
    .filter((w) => w.requiresReview === true)
    .reduce<
      number | null
    >((acc, w) => (acc === null || w.order < acc ? w.order : acc), null);

  if (firstGatedOrder === null) {
    return candidateStateId;
  }

  const candidate = workflows.find((w) => w.id === candidateStateId);
  if (!candidate) {
    return candidateStateId;
  }
  if (candidate.order < firstGatedOrder) {
    return candidateStateId;
  }

  const defaultWorkflow = workflows.find((w) => w.isDefault === true);
  return defaultWorkflow?.id ?? null;
}
