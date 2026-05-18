"use client";

import { WorkflowScope } from "@prisma/client";
import { useMemo } from "react";

import { useFindManyReviewRequest, useFindManyWorkflows } from "~/lib/hooks";

import { useReviewFeatureEnabled } from "./useReviewFeatureEnabled";

export type ReviewableEntityType = "CASE" | "RUN" | "SESSION";

export interface BlockingGate {
  id: number;
  order: number;
  name: string;
}

export interface TransitionGateStatus {
  /**
   * False when the review feature is disabled at the system or project
   * level — callers treat this as "every transition is allowed" (matches
   * the server's feature-flag short-circuits).
   */
  enabled: boolean;
  /** True while any of the underlying queries are still loading. */
  isLoading: boolean;
  /**
   * Returns whether a transition from the current state to `toStateId` is
   * allowed under the strict transitive gate semantics. When blocked,
   * `blockingGate` names the FIRST gate (lowest order) in the path that
   * lacks an approved + unconsumed ReviewRequest — same shape the server's
   * `ReviewGateError.blockingStateId` returns.
   */
  canTransitionTo(toStateId: number | null | undefined): {
    allowed: boolean;
    blockingGate: BlockingGate | null;
  };
}

const SCOPE_BY_ENTITY_TYPE: Record<ReviewableEntityType, WorkflowScope> = {
  CASE: WorkflowScope.CASES,
  RUN: WorkflowScope.RUNS,
  SESSION: WorkflowScope.SESSIONS,
};

/**
 * Client mirror of `assertReviewGatePasses`. Entity-state-form Zod refines
 * call this to pre-validate a chosen target state BEFORE submit, so the
 * user sees an inline "approval required for {gate}" error instead of
 * losing all of their other edits on a 403 round-trip.
 *
 * The hook fetches two slices once per entity:
 *
 *   1. All gated workflow states in the entity-type's scope
 *      (`requiresReview: true`). One row per gate; cached by TanStack so
 *      re-renders are free.
 *   2. Approved + unconsumed ReviewRequests for this entity. One row per
 *      gate the reviewer has signed off on.
 *
 * `canTransitionTo(toStateId)` then walks the gate list for the target,
 * filters to blocking gates by order, and returns `allowed=false` with
 * the first missing-approval gate. Backward / same-state transitions are
 * always allowed; an unset `currentStateId` (e.g. on a brand-new entity
 * before save) treats current as "before everything" so all gates apply.
 *
 * The hook stays on a STRICT model (matching the server): an approval for
 * gate Y does NOT satisfy gate X, even when X.order < Y.order. Each gate
 * is its own checkpoint with its own reviewer decision.
 *
 * Custom hook (lives in `testplanit/hooks/` rather than `lib/hooks/` —
 * the latter is the ZenStack tanstack-query plugin's output directory and
 * is wiped on `pnpm zenstack generate`).
 */
export function useTransitionGateStatus(
  entityType: ReviewableEntityType,
  entityId: number,
  currentStateId: number | null | undefined,
  projectId: number
): TransitionGateStatus {
  const { enabled, isLoading: featureLoading } =
    useReviewFeatureEnabled(projectId);

  // Workflow states in the entity-type's scope. We fetch ALL (gated and
  // non-gated) so the hook can look up the target state's order from the
  // same list, then filter to gates client-side. One round trip total.
  const { data: workflows, isLoading: workflowsLoading } = useFindManyWorkflows(
    {
      where: {
        scope: SCOPE_BY_ENTITY_TYPE[entityType],
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        order: true,
        requiresReview: true,
      },
      orderBy: { order: "asc" },
    },
    { enabled: enabled === true } as any
  );

  // Approved + unconsumed ReviewRequests for this entity. The client gate
  // resolves "do I have approval for each blocking gate?" by indexing this
  // list by `toStateId`.
  const { data: approvedRequests, isLoading: approvalsLoading } =
    useFindManyReviewRequest(
      {
        where: {
          entityType,
          entityId,
          status: "APPROVED",
          consumedAt: null,
          isDeleted: false,
        },
        select: { id: true, toStateId: true },
      },
      { enabled: enabled === true } as any
    );

  return useMemo<TransitionGateStatus>(() => {
    const allWorkflows = (workflows ?? []) as Array<{
      id: number;
      name: string;
      order: number;
      requiresReview: boolean;
    }>;
    const approvedByToStateId = new Set<number>(
      ((approvedRequests ?? []) as Array<{ toStateId: number }>).map(
        (r) => r.toStateId
      )
    );
    const gatedStates: BlockingGate[] = allWorkflows.filter(
      (w) => w.requiresReview
    );

    const currentOrder =
      currentStateId == null
        ? null
        : (allWorkflows.find((w) => w.id === currentStateId)?.order ?? null);

    const isLoading =
      featureLoading || workflowsLoading || approvalsLoading || false;

    return {
      enabled: enabled === true,
      isLoading,
      canTransitionTo(toStateId) {
        if (enabled !== true) {
          return { allowed: true, blockingGate: null };
        }
        if (toStateId == null) {
          return { allowed: true, blockingGate: null };
        }
        const targetOrder = allWorkflows.find((w) => w.id === toStateId)?.order;
        // Unknown target — let the FK violation surface server-side rather
        // than blocking here on data that may still be loading.
        if (targetOrder === undefined) {
          return { allowed: true, blockingGate: null };
        }
        // Backward / same-state transitions are never blocked.
        if (currentOrder !== null && currentOrder >= targetOrder) {
          return { allowed: true, blockingGate: null };
        }
        // Walk gates in ascending order so the FIRST missing approval is
        // the one we name (the immediate blocker).
        for (const gate of gatedStates) {
          const inPath =
            (currentOrder === null || currentOrder < gate.order) &&
            gate.order <= targetOrder;
          if (!inPath) continue;
          if (!approvedByToStateId.has(gate.id)) {
            return { allowed: false, blockingGate: gate };
          }
        }
        return { allowed: true, blockingGate: null };
      },
    };
  }, [
    enabled,
    featureLoading,
    workflows,
    workflowsLoading,
    approvedRequests,
    approvalsLoading,
    currentStateId,
  ]);
}
