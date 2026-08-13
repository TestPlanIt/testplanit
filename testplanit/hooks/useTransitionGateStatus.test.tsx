import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  useBulkTransitionGateStatus,
  useTransitionGateStatus,
} from "./useTransitionGateStatus";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks — mirror the server-side gate test pattern: hand-rolled responses
// per scenario so the assertions are scoped to the lookup logic itself,
// not to ZenStack hook internals.
// ─────────────────────────────────────────────────────────────────────────────

const mockUseFindManyWorkflows = vi.fn();
const mockUseFindManyReviewRequest = vi.fn();
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    workflows: {
      useFindMany: (...args: unknown[]) => mockUseFindManyWorkflows(...args),
    },
    reviewRequest: {
      useFindMany: (...args: unknown[]) =>
        mockUseFindManyReviewRequest(...args),
    },
  }),
}));

const mockUseReviewFeatureEnabled = vi.fn();
vi.mock("./useReviewFeatureEnabled", () => ({
  useReviewFeatureEnabled: (...args: unknown[]) =>
    mockUseReviewFeatureEnabled(...args),
}));

// Both hooks read the session to mirror the server's `userAccess === "ADMIN"`
// bypass. Defaults to a plain USER so the existing gating assertions below
// keep exercising the gate rather than the bypass.
const mockUseSession = vi.fn();
vi.mock("next-auth/react", () => ({
  useSession: () => mockUseSession(),
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
  /** `User.access` for the acting session. Defaults to a non-admin. */
  access?: string;
}

function setup({
  enabled = true,
  workflows = [],
  approvedToStateIds = [],
  access = "USER",
}: SetupOpts) {
  mockUseSession.mockReturnValue({ data: { user: { access } } });
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
    mockUseSession.mockReset();
  });

  describe("system-admin bypass", () => {
    it("allows a gated transition for an ADMIN with no approvals (mirrors assertReviewGatePasses)", () => {
      setup({
        access: "ADMIN",
        workflows: [
          workflow(10, 1, false),
          workflow(40, 4, true, "Ready For Review"),
          workflow(60, 6, false),
        ],
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

    it("keeps `enabled` reporting the real feature state for an ADMIN so the surrounding review UI still renders", () => {
      setup({
        access: "ADMIN",
        workflows: [workflow(10, 1, false), workflow(40, 4, true)],
      });
      const { result } = renderHook(() =>
        useTransitionGateStatus("CASE", 1, 10, 42)
      );

      expect(result.current.enabled).toBe(true);
    });

    it("still blocks a PROJECTADMIN — the bypass is system-admin only", () => {
      setup({
        access: "PROJECTADMIN",
        workflows: [workflow(10, 1, false), workflow(40, 4, true)],
      });
      const { result } = renderHook(() =>
        useTransitionGateStatus("CASE", 1, 10, 42)
      );

      expect(result.current.canTransitionTo(40).allowed).toBe(false);
    });
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

describe("useBulkTransitionGateStatus", () => {
  beforeEach(() => {
    mockUseReviewFeatureEnabled.mockReset();
    mockUseFindManyWorkflows.mockReset();
    mockUseFindManyReviewRequest.mockReset();
    mockUseSession.mockReset();
  });

  function setupBulk({
    enabled = true,
    workflows = [],
    approvedByEntity = {},
    access = "USER",
  }: {
    enabled?: boolean;
    workflows?: Array<{
      id: number;
      name: string;
      order: number;
      requiresReview: boolean;
    }>;
    /** Map of entityId → list of approved toStateIds. */
    approvedByEntity?: Record<number, number[]>;
    /** `User.access` for the acting session. Defaults to a non-admin. */
    access?: string;
  }) {
    mockUseSession.mockReturnValue({ data: { user: { access } } });
    mockUseReviewFeatureEnabled.mockReturnValue({ enabled, isLoading: false });
    mockUseFindManyWorkflows.mockReturnValue({
      data: workflows,
      isLoading: false,
    });
    const rows: Array<{
      id: string;
      entityId: number;
      toStateId: number;
    }> = [];
    for (const [entityIdStr, toStateIds] of Object.entries(approvedByEntity)) {
      const entityId = Number(entityIdStr);
      for (const toStateId of toStateIds) {
        rows.push({
          id: `approval-${entityId}-${toStateId}`,
          entityId,
          toStateId,
        });
      }
    }
    mockUseFindManyReviewRequest.mockReturnValue({
      data: rows,
      isLoading: false,
    });
  }

  it("returns allowed=true with no blocked cases for an ADMIN (matches assertBulkReviewGatePasses)", () => {
    setupBulk({
      access: "ADMIN",
      workflows: [workflow(10, 1, false), workflow(40, 4, true)],
      approvedByEntity: {},
    });
    const entities = [
      { id: 1, currentStateId: 10 },
      { id: 2, currentStateId: 10 },
    ];
    const { result } = renderHook(() =>
      useBulkTransitionGateStatus("CASE", entities, 42)
    );

    expect(result.current.canBulkTransitionTo(40)).toEqual({
      allowed: true,
      blocked: [],
    });
  });

  it("returns allowed=true with no blocked cases when feature is disabled (matches server short-circuit)", () => {
    setupBulk({
      enabled: false,
      workflows: [workflow(40, 4, true)],
    });
    const entities = [
      { id: 1, currentStateId: 10 },
      { id: 2, currentStateId: 10 },
    ];
    const { result } = renderHook(() =>
      useBulkTransitionGateStatus("CASE", entities, 42)
    );

    expect(result.current.canBulkTransitionTo(40)).toEqual({
      allowed: true,
      blocked: [],
    });
  });

  it("blocks each selected case that has no approval for the gate the target crosses", () => {
    setupBulk({
      workflows: [workflow(10, 1, false), workflow(40, 4, true, "Active")],
      // Only case 1 has approval for the gate; cases 2 and 3 are blocked.
      approvedByEntity: { 1: [40] },
    });
    const entities = [
      { id: 1, currentStateId: 10 },
      { id: 2, currentStateId: 10 },
      { id: 3, currentStateId: 10 },
    ];
    const { result } = renderHook(() =>
      useBulkTransitionGateStatus("CASE", entities, 42)
    );
    const check = result.current.canBulkTransitionTo(40);
    expect(check.allowed).toBe(false);
    expect(check.blocked).toHaveLength(2);
    expect(check.blocked.map((b) => b.entityId).sort()).toEqual([2, 3]);
    expect(check.blocked[0]!.blockingGate).toMatchObject({
      id: 40,
      name: "Active",
    });
  });

  it("backward / same-state transitions per entity never count as blocked", () => {
    setupBulk({
      workflows: [
        workflow(10, 1, false),
        workflow(40, 4, true),
        workflow(60, 6, false),
      ],
    });
    const entities = [
      // current=6, target=4 → backward → allowed regardless of approval.
      { id: 1, currentStateId: 60 },
      // current=4, target=4 → same-state → allowed.
      { id: 2, currentStateId: 40 },
    ];
    const { result } = renderHook(() =>
      useBulkTransitionGateStatus("CASE", entities, 42)
    );
    expect(result.current.canBulkTransitionTo(40)).toEqual({
      allowed: true,
      blocked: [],
    });
  });

  it("Scenario 3 strict: per-entity approval for a later gate does NOT satisfy an earlier gate", () => {
    setupBulk({
      workflows: [
        workflow(10, 1, false),
        workflow(40, 4, true),
        workflow(50, 5, true),
      ],
      // Case 1 has approval for gate 50 but NOT gate 40 — strict semantics
      // should still block on gate 40.
      approvedByEntity: { 1: [50] },
    });
    const entities = [{ id: 1, currentStateId: 10 }];
    const { result } = renderHook(() =>
      useBulkTransitionGateStatus("CASE", entities, 42)
    );
    const check = result.current.canBulkTransitionTo(50);
    expect(check.allowed).toBe(false);
    expect(check.blocked).toHaveLength(1);
    expect(check.blocked[0]!.blockingGate).toMatchObject({ id: 40, order: 4 });
  });

  it("empty entity list returns allowed=true (no work to do)", () => {
    setupBulk({
      workflows: [workflow(40, 4, true)],
    });
    const { result } = renderHook(() =>
      useBulkTransitionGateStatus("CASE", [], 42)
    );
    expect(result.current.canBulkTransitionTo(40)).toEqual({
      allowed: true,
      blocked: [],
    });
  });
});
