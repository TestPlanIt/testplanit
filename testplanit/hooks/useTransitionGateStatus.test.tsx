import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTransitionGateStatus } from "./useTransitionGateStatus";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks — mirror the server-side gate test pattern: hand-rolled responses
// per scenario so the assertions are scoped to the lookup logic itself,
// not to ZenStack hook internals.
// ─────────────────────────────────────────────────────────────────────────────

const mockUseFindManyWorkflows = vi.fn();
const mockUseFindManyReviewRequest = vi.fn();
vi.mock("~/lib/hooks", () => ({
  useFindManyWorkflows: (...args: unknown[]) =>
    mockUseFindManyWorkflows(...args),
  useFindManyReviewRequest: (...args: unknown[]) =>
    mockUseFindManyReviewRequest(...args),
}));

const mockUseReviewFeatureEnabled = vi.fn();
vi.mock("./useReviewFeatureEnabled", () => ({
  useReviewFeatureEnabled: (...args: unknown[]) =>
    mockUseReviewFeatureEnabled(...args),
}));

interface SetupOpts {
  enabled?: boolean;
  workflows?: Array<{
    id: number;
    name: string;
    order: number;
    requiresReview: boolean;
  }>;
  approvedToStateIds?: number[];
}

function setup({
  enabled = true,
  workflows = [],
  approvedToStateIds = [],
}: SetupOpts) {
  mockUseReviewFeatureEnabled.mockReturnValue({ enabled, isLoading: false });
  mockUseFindManyWorkflows.mockReturnValue({
    data: workflows,
    isLoading: false,
  });
  mockUseFindManyReviewRequest.mockReturnValue({
    data: approvedToStateIds.map((id) => ({
      id: `approval-${id}`,
      toStateId: id,
    })),
    isLoading: false,
  });
}

const workflow = (
  id: number,
  order: number,
  requiresReview: boolean,
  name = `State ${order}`
) => ({ id, name, order, requiresReview });

describe("useTransitionGateStatus", () => {
  beforeEach(() => {
    mockUseReviewFeatureEnabled.mockReset();
    mockUseFindManyWorkflows.mockReset();
    mockUseFindManyReviewRequest.mockReset();
  });

  it("treats every transition as allowed when the feature is disabled", () => {
    setup({
      enabled: false,
      workflows: [workflow(1, 1, false), workflow(40, 4, true)],
    });
    const { result } = renderHook(() =>
      useTransitionGateStatus("CASE", 1, 1, 42)
    );

    expect(result.current.enabled).toBe(false);
    expect(result.current.canTransitionTo(40)).toEqual({
      allowed: true,
      blockingGate: null,
    });
  });

  describe("strict transitive gating", () => {
    it("Scenario 1 — single gate at 4 blocks 4, 5, and 6 from a current state of 1", () => {
      setup({
        workflows: [
          workflow(10, 1, false),
          workflow(20, 2, false),
          workflow(30, 3, false),
          workflow(40, 4, true, "Ready For Review"),
          workflow(50, 5, false),
          workflow(60, 6, false),
        ],
      });
      const { result } = renderHook(() =>
        useTransitionGateStatus("CASE", 1, 10, 42)
      );

      // States before the gate — allowed without approval.
      expect(result.current.canTransitionTo(20).allowed).toBe(true);
      expect(result.current.canTransitionTo(30).allowed).toBe(true);

      // States at and after the gate — blocked until 40 is approved.
      const at = result.current.canTransitionTo(40);
      expect(at.allowed).toBe(false);
      expect(at.blockingGate).toMatchObject({ id: 40, order: 4 });

      const past = result.current.canTransitionTo(60);
      expect(past.allowed).toBe(false);
      expect(past.blockingGate).toMatchObject({ id: 40, order: 4 });
    });

    it("Scenario 1 — once gate 4 is approved, all forward transitions become allowed", () => {
      setup({
        workflows: [
          workflow(10, 1, false),
          workflow(40, 4, true),
          workflow(60, 6, false),
        ],
        approvedToStateIds: [40],
      });
      const { result } = renderHook(() =>
        useTransitionGateStatus("CASE", 1, 10, 42)
      );

      expect(result.current.canTransitionTo(40)).toEqual({
        allowed: true,
        blockingGate: null,
      });
      expect(result.current.canTransitionTo(60)).toEqual({
        allowed: true,
        blockingGate: null,
      });
    });

    it("Scenario 2 — gates at 4 AND 5; approval for 4 alone does NOT unlock transitions past 5", () => {
      setup({
        workflows: [
          workflow(10, 1, false),
          workflow(40, 4, true),
          workflow(50, 5, true),
          workflow(60, 6, false),
        ],
        approvedToStateIds: [40],
      });
      const { result } = renderHook(() =>
        useTransitionGateStatus("CASE", 1, 10, 42)
      );

      expect(result.current.canTransitionTo(40)).toEqual({
        allowed: true,
        blockingGate: null,
      });
      const at5 = result.current.canTransitionTo(50);
      expect(at5.allowed).toBe(false);
      expect(at5.blockingGate).toMatchObject({ id: 50, order: 5 });

      const past = result.current.canTransitionTo(60);
      expect(past.allowed).toBe(false);
      expect(past.blockingGate).toMatchObject({ id: 50, order: 5 });
    });

    it("Scenario 3 — approval for the later gate (5) does NOT satisfy the earlier gate (4)", () => {
      setup({
        workflows: [
          workflow(10, 1, false),
          workflow(40, 4, true),
          workflow(50, 5, true),
        ],
        approvedToStateIds: [50],
      });
      const { result } = renderHook(() =>
        useTransitionGateStatus("CASE", 1, 10, 42)
      );

      // Strict: approval for 50 is NOT consumed by transitioning past gate 40.
      // The first missing gate (lowest order) is what surfaces.
      const at5 = result.current.canTransitionTo(50);
      expect(at5.allowed).toBe(false);
      expect(at5.blockingGate).toMatchObject({ id: 40, order: 4 });
    });
  });

  describe("backward / same-state / unknown / null target", () => {
    it("backward transition is never blocked", () => {
      setup({
        workflows: [
          workflow(10, 1, false),
          workflow(40, 4, true),
          workflow(60, 6, false),
        ],
      });
      const { result } = renderHook(() =>
        useTransitionGateStatus("CASE", 1, 60, 42)
      );

      // current state is order 6; target order 1 → backward → allowed.
      expect(result.current.canTransitionTo(10)).toEqual({
        allowed: true,
        blockingGate: null,
      });
    });

    it("same-state transition is never blocked", () => {
      setup({
        workflows: [workflow(40, 4, true)],
      });
      const { result } = renderHook(() =>
        useTransitionGateStatus("CASE", 1, 40, 42)
      );

      expect(result.current.canTransitionTo(40)).toEqual({
        allowed: true,
        blockingGate: null,
      });
    });

    it("unknown target stateId returns allowed (server FK violation will surface, not the gate)", () => {
      setup({
        workflows: [workflow(40, 4, true)],
      });
      const { result } = renderHook(() =>
        useTransitionGateStatus("CASE", 1, 10, 42)
      );

      expect(result.current.canTransitionTo(999)).toEqual({
        allowed: true,
        blockingGate: null,
      });
    });

    it("null target stateId returns allowed (form hasn't picked yet)", () => {
      setup({
        workflows: [workflow(40, 4, true)],
      });
      const { result } = renderHook(() =>
        useTransitionGateStatus("CASE", 1, 10, 42)
      );

      expect(result.current.canTransitionTo(null)).toEqual({
        allowed: true,
        blockingGate: null,
      });
    });

    it("unset currentStateId (e.g. new entity) treats current as before everything", () => {
      setup({
        workflows: [
          workflow(10, 1, false),
          workflow(40, 4, true),
          workflow(60, 6, false),
        ],
      });
      const { result } = renderHook(() =>
        useTransitionGateStatus("CASE", 1, null, 42)
      );

      // No backward shortcut — any target ≥ a gate fires.
      const at4 = result.current.canTransitionTo(40);
      expect(at4.allowed).toBe(false);
      expect(at4.blockingGate).toMatchObject({ id: 40, order: 4 });
    });
  });
});
