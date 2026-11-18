import { beforeEach, describe, expect, it } from "vitest";

import {
  getReadRoutingStats,
  registerReplicaStateSource,
  type ReplicaState,
  resetReadRoutingStats,
  unregisterReplicaStateSource,
} from "./routingStats";

const source = (states: ReplicaState[]) => ({ replicaStates: () => states });

describe("routingStats replicas", () => {
  beforeEach(() => resetReadRoutingStats());

  it("reports each replica once when several clients share them", () => {
    registerReplicaStateSource(
      source([
        { index: 0, status: "ok", lagMs: 10 },
        { index: 1, status: "ok", lagMs: null },
      ])
    );
    registerReplicaStateSource(
      source([
        { index: 0, status: "lagging", lagMs: 4000 },
        { index: 1, status: "down", lagMs: 5 },
      ])
    );
    registerReplicaStateSource(source([{ index: 0, status: "ok", lagMs: 12 }]));

    expect(getReadRoutingStats().replicas).toEqual([
      { index: 0, status: "lagging", lagMs: 4000 },
      { index: 1, status: "down", lagMs: 5 },
    ]);
  });

  it("drops a client's view once it is gone", () => {
    const gone = source([{ index: 0, status: "down", lagMs: null }]);
    registerReplicaStateSource(gone);
    registerReplicaStateSource(source([{ index: 0, status: "ok", lagMs: 3 }]));
    unregisterReplicaStateSource(gone);

    expect(getReadRoutingStats().replicas).toEqual([
      { index: 0, status: "ok", lagMs: 3 },
    ]);
  });
});
