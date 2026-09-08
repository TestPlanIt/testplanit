import { describe, expect, it } from "vitest";
import { ReviewEntityType } from "~/zenstack/models";

import { resolveBulkReviewTargets } from "./reviewGate";

/**
 * Unit tests for the bulk review-request planner.
 *
 * `resolveBulkReviewTargets` answers "which of these entities need an
 * approval, and which gate does each need FIRST?" — the work-list the
 * bulk-edit path turns into ReviewRequest rows. Coverage matrix:
 *
 *   - Empty selection / missing target state ⇒ nothing to do
 *   - Backward and same-state entities are never blocked
 *   - Each entity resolves to the LOWEST-order gate it lacks (strict
 *     transitive), not the target state and not the highest gate
 *   - Entities at different current states resolve to different gates in
 *     one call
 *   - An approval for a LATER gate does not satisfy an earlier one
 *   - Entities already carrying a PENDING request are skipped, not failed
 *   - A PENDING request on an UNBLOCKED entity is not miscounted as a skip
 *   - Gate lookup is scoped to the project's assigned workflows
 *
 * Pattern matches reviewGate.test.ts: a hand-rolled `tx` per test, no
 * module-level mocking, since the helper takes its client by parameter.
 */

interface MockEntity {
  id: number;
  stateId: number | null;
  order: number | null;
}

interface MockTxOptions {
  entities: MockEntity[];
  targetState: { order: number } | null;
  /** Gated states in the project's scope, ascending by order. */
  gatedStates: Array<{ id: number; order: number }>;
  /** Approved + unconsumed rows as (entityId, toStateId) pairs. */
  approvals?: Array<{ entityId: number; toStateId: number }>;
  /** Entity ids carrying a PENDING request. */
  pendingEntityIds?: number[];
}

function createMockTx(opts: MockTxOptions) {
  const calls = {
    gatedStatesWhere: null as any,
    entityWhere: null as any,
  };

  const tx = {
    workflows: {
      findUnique: async () => opts.targetState,
      findMany: async (args: any) => {
        calls.gatedStatesWhere = args?.where;
        return opts.gatedStates;
      },
    },
    repositoryCases: {
      findMany: async (args: any) => {
        calls.entityWhere = args?.where;
        const requested: number[] = args?.where?.id?.in ?? [];
        return opts.entities
          .filter((e) => requested.includes(e.id))
          .map((e) => ({
            id: e.id,
            stateId: e.stateId,
            state: e.order === null ? null : { order: e.order },
          }));
      },
    },
    reviewRequest: {
      findMany: async (args: any) => {
        if (args?.where?.status === "PENDING") {
          return (opts.pendingEntityIds ?? []).map((entityId) => ({
            entityId,
          }));
        }
        return opts.approvals ?? [];
      },
    },
  } as any;

  return { tx, calls };
}

const run = (opts: MockTxOptions, toStateId = 99, entityIds?: number[]) => {
  const { tx, calls } = createMockTx(opts);
  return resolveBulkReviewTargets(
    tx,
    /* projectId */ 7,
    ReviewEntityType.CASE,
    entityIds ?? opts.entities.map((e) => e.id),
    toStateId
  ).then((result) => ({ result, calls }));
};

describe("resolveBulkReviewTargets", () => {
  it("returns nothing for an empty selection", async () => {
    const { result } = await run({
      entities: [],
      targetState: { order: 5 },
      gatedStates: [{ id: 30, order: 3 }],
    });

    expect(result.targets).toEqual([]);
    expect(result.skippedPending).toEqual([]);
    expect(result.skippedNotBlocked).toEqual([]);
  });

  it("returns nothing when the target state row is missing", async () => {
    const { result } = await run({
      entities: [{ id: 1, stateId: 10, order: 1 }],
      targetState: null,
      gatedStates: [{ id: 30, order: 3 }],
    });

    expect(result.targets).toEqual([]);
  });

  it("skips backward and same-state entities", async () => {
    const { result } = await run({
      entities: [
        { id: 1, stateId: 50, order: 5 }, // same order as target
        { id: 2, stateId: 60, order: 6 }, // beyond target
      ],
      targetState: { order: 5 },
      gatedStates: [{ id: 30, order: 3 }],
    });

    expect(result.targets).toEqual([]);
    expect(result.skippedNotBlocked).toEqual([1, 2]);
  });

  it("resolves each entity to the LOWEST-order gate it lacks", async () => {
    // Entity at order 1, target at 6, gates at 3 and 5. Both are on the
    // path, but only the first one gets requested.
    const { result } = await run({
      entities: [{ id: 1, stateId: 10, order: 1 }],
      targetState: { order: 6 },
      gatedStates: [
        { id: 30, order: 3 },
        { id: 50, order: 5 },
      ],
    });

    expect(result.targets).toEqual([
      { entityId: 1, fromStateId: 10, gateId: 30 },
    ]);
  });

  it("does not let a later gate's approval satisfy an earlier gate", async () => {
    const { result } = await run({
      entities: [{ id: 1, stateId: 10, order: 1 }],
      targetState: { order: 6 },
      gatedStates: [
        { id: 30, order: 3 },
        { id: 50, order: 5 },
      ],
      approvals: [{ entityId: 1, toStateId: 50 }],
    });

    expect(result.targets).toEqual([
      { entityId: 1, fromStateId: 10, gateId: 30 },
    ]);
  });

  it("advances to the next gate once the earlier one is approved", async () => {
    const { result } = await run({
      entities: [{ id: 1, stateId: 10, order: 1 }],
      targetState: { order: 6 },
      gatedStates: [
        { id: 30, order: 3 },
        { id: 50, order: 5 },
      ],
      approvals: [{ entityId: 1, toStateId: 30 }],
    });

    expect(result.targets).toEqual([
      { entityId: 1, fromStateId: 10, gateId: 50 },
    ]);
  });

  it("resolves different gates for entities at different current states", async () => {
    // The headline bulk case: one target state, a selection spread across
    // the workflow, so a single action spans two gates.
    const { result } = await run({
      entities: [
        { id: 1, stateId: 10, order: 1 }, // needs gate 30
        { id: 2, stateId: 40, order: 4 }, // past gate 30, needs gate 50
        { id: 3, stateId: 10, order: 1 }, // needs gate 30
      ],
      targetState: { order: 6 },
      gatedStates: [
        { id: 30, order: 3 },
        { id: 50, order: 5 },
      ],
    });

    expect(result.targets).toEqual([
      { entityId: 1, fromStateId: 10, gateId: 30 },
      { entityId: 2, fromStateId: 40, gateId: 50 },
      { entityId: 3, fromStateId: 10, gateId: 30 },
    ]);
  });

  it("marks entities with every gate approved as not blocked", async () => {
    const { result } = await run({
      entities: [{ id: 1, stateId: 10, order: 1 }],
      targetState: { order: 6 },
      gatedStates: [
        { id: 30, order: 3 },
        { id: 50, order: 5 },
      ],
      approvals: [
        { entityId: 1, toStateId: 30 },
        { entityId: 1, toStateId: 50 },
      ],
    });

    expect(result.targets).toEqual([]);
    expect(result.skippedNotBlocked).toEqual([1]);
  });

  it("skips entities that already carry a PENDING request", async () => {
    // The one-PENDING-per-entity invariant has no DB constraint behind it,
    // so this skip is the only thing preventing duplicate requests.
    const { result } = await run({
      entities: [
        { id: 1, stateId: 10, order: 1 },
        { id: 2, stateId: 10, order: 1 },
      ],
      targetState: { order: 6 },
      gatedStates: [{ id: 30, order: 3 }],
      pendingEntityIds: [1],
    });

    expect(result.targets).toEqual([
      { entityId: 2, fromStateId: 10, gateId: 30 },
    ]);
    expect(result.skippedPending).toEqual([1]);
  });

  it("does not report an unblocked entity as pending-skipped", async () => {
    // Entity 1 is moving backward, so it needs nothing — a stale PENDING
    // request on it must not be reported as "skipped because pending".
    const { result } = await run({
      entities: [{ id: 1, stateId: 60, order: 6 }],
      targetState: { order: 5 },
      gatedStates: [{ id: 30, order: 3 }],
      pendingEntityIds: [1],
    });

    expect(result.skippedPending).toEqual([]);
    expect(result.skippedNotBlocked).toEqual([1]);
  });

  it("treats an entity with no current state as not actionable", async () => {
    // Every gate applies to a stateless row, but it can't supply a
    // fromStateId, so it can't carry a ReviewRequest.
    const { result } = await run({
      entities: [{ id: 1, stateId: null, order: null }],
      targetState: { order: 6 },
      gatedStates: [{ id: 30, order: 3 }],
    });

    expect(result.targets).toEqual([]);
    expect(result.skippedNotBlocked).toEqual([1]);
  });

  it("reports everything as unblocked when the project has no gates", async () => {
    const { result } = await run({
      entities: [{ id: 1, stateId: 10, order: 1 }],
      targetState: { order: 6 },
      gatedStates: [],
    });

    expect(result.targets).toEqual([]);
    expect(result.skippedNotBlocked).toEqual([1]);
  });

  it("scopes the gate lookup and the entity lookup to the project", async () => {
    // `requiresReview` is a global Workflows column — an unscoped query
    // would surface another project's gates as blockers here.
    const { calls } = await run({
      entities: [{ id: 1, stateId: 10, order: 1 }],
      targetState: { order: 6 },
      gatedStates: [{ id: 30, order: 3 }],
    });

    expect(calls.gatedStatesWhere.projects).toEqual({ some: { projectId: 7 } });
    expect(calls.gatedStatesWhere.requiresReview).toBe(true);
    expect(calls.entityWhere.projectId).toBe(7);
    expect(calls.entityWhere.isDeleted).toBe(false);
  });

  it("ignores ids that do not belong to the project", async () => {
    // The entity findMany is project-scoped, so a smuggled id simply
    // doesn't come back — it can't produce a request.
    const { result } = await run(
      {
        entities: [{ id: 1, stateId: 10, order: 1 }],
        targetState: { order: 6 },
        gatedStates: [{ id: 30, order: 3 }],
      },
      99,
      [1, 4242]
    );

    expect(result.targets).toEqual([
      { entityId: 1, fromStateId: 10, gateId: 30 },
    ]);
    expect(result.skippedNotBlocked).not.toContain(4242);
  });
});
