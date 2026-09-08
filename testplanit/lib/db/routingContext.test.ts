import { describe, expect, it } from "vitest";

import {
  getRoutingContext,
  markWroteInContext,
  runWithDbRouting,
  withPrimary,
  withReplica,
} from "./routingContext";

describe("routingContext", () => {
  it("has no context outside any run wrapper", () => {
    expect(getRoutingContext()).toBeUndefined();
  });

  it("runWithDbRouting establishes a fresh, unpinned frame", () => {
    runWithDbRouting(() => {
      const ctx = getRoutingContext();
      expect(ctx).toEqual({
        forcePrimary: false,
        forceReplica: false,
        autoReplica: false,
        wroteInContext: false,
      });
    });
  });

  it("runWithDbRouting can opt into auto-replica offload (read request)", () => {
    runWithDbRouting(
      () => {
        expect(getRoutingContext()?.autoReplica).toBe(true);
        expect(getRoutingContext()?.forcePrimary).toBe(false);
      },
      { autoReplica: true }
    );
  });

  it("runWithDbRouting can start pinned to primary (cookie-honored request)", () => {
    runWithDbRouting(
      () => {
        expect(getRoutingContext()?.forcePrimary).toBe(true);
      },
      { forcePrimary: true }
    );
  });

  it("markWroteInContext flips wroteInContext for the current frame", () => {
    runWithDbRouting(() => {
      expect(getRoutingContext()?.wroteInContext).toBe(false);
      markWroteInContext();
      expect(getRoutingContext()?.wroteInContext).toBe(true);
    });
  });

  it("markWroteInContext is a no-op outside a frame", () => {
    expect(() => markWroteInContext()).not.toThrow();
    expect(getRoutingContext()).toBeUndefined();
  });

  it("withPrimary pins the scope to primary", () => {
    withPrimary(() => {
      const ctx = getRoutingContext();
      expect(ctx?.forcePrimary).toBe(true);
      expect(ctx?.forceReplica).toBe(false);
    });
  });

  it("withReplica marks the scope replica-eligible", () => {
    withReplica(() => {
      const ctx = getRoutingContext();
      expect(ctx?.forceReplica).toBe(true);
      expect(ctx?.forcePrimary).toBe(false);
    });
  });

  it("nested withPrimary is independent of the outer frame's wroteInContext", () => {
    runWithDbRouting(() => {
      markWroteInContext();
      expect(getRoutingContext()?.wroteInContext).toBe(true);
      withReplica(() => {
        // A nested frame starts clean — it does not inherit the outer write pin.
        const ctx = getRoutingContext();
        expect(ctx?.wroteInContext).toBe(false);
        expect(ctx?.forceReplica).toBe(true);
      });
      // Outer frame unchanged after the nested block returns.
      expect(getRoutingContext()?.wroteInContext).toBe(true);
    });
  });
});
