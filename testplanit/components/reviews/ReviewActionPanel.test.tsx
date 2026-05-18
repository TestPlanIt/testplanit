import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ReviewActionPanel,
  type ReviewActionPanelProps,
} from "./ReviewActionPanel";

/**
 * Tests for ReviewActionPanel — the sticky cluster of three decision
 * Buttons rendered on entity-detail pages when the auto-detect visibility
 * predicate matches (D-11 / D-12).
 *
 * Visibility predicate (all must hold):
 *   1. useReviewFeatureEnabled(projectId).enabled === true
 *   2. A PENDING ReviewRequest exists for (entityType, entityId)
 *   3. Viewer is NOT the requester (D-12: requester sees banner only)
 *   4. Viewer is eligible: direct assignee OR effective-role holder OR ADMIN
 */

// ─────────────────────────────────────────────────────────────────────────────
// Mocks (declared before component import so vi.mock hoists correctly)
// ─────────────────────────────────────────────────────────────────────────────

const mockUseFindFirstReviewRequest = vi.fn();
const mockInvalidateQueries = vi.fn();

vi.mock("~/lib/hooks", () => ({
  useFindFirstReviewRequest: (...args: unknown[]) =>
    mockUseFindFirstReviewRequest(...args),
}));

const mockUseSession = vi.fn();
vi.mock("next-auth/react", async (importOriginal) => {
  const original = await importOriginal<typeof import("next-auth/react")>();
  return {
    ...original,
    useSession: () => mockUseSession(),
  };
});

const mockUseReviewFeatureEnabled = vi.fn();
vi.mock("~/hooks/useReviewFeatureEnabled", () => ({
  useReviewFeatureEnabled: (...args: unknown[]) =>
    mockUseReviewFeatureEnabled(...args),
}));

const mockUseEffectiveRoleOnProject = vi.fn();
vi.mock("~/hooks/useEffectiveRoleOnProject", () => ({
  useEffectiveRoleOnProject: (...args: unknown[]) =>
    mockUseEffectiveRoleOnProject(...args),
}));

// Stub the dialogs so this test only validates panel composition + open-state.
vi.mock("./ReviewDecisionDialogs", () => ({
  ApproveDialog: ({
    open,
    onSuccess,
  }: {
    open: boolean;
    onSuccess?: () => void;
  }) => (
    <div
      data-testid="approve-dialog-stub"
      data-open={String(open)}
      onClick={() => onSuccess?.()}
    />
  ),
  RequestChangesDialog: ({
    open,
    onSuccess,
  }: {
    open: boolean;
    onSuccess?: () => void;
  }) => (
    <div
      data-testid="request-changes-dialog-stub"
      data-open={String(open)}
      onClick={() => onSuccess?.()}
    />
  ),
  RejectDialog: ({
    open,
    onSuccess,
  }: {
    open: boolean;
    onSuccess?: () => void;
  }) => (
    <div
      data-testid="reject-dialog-stub"
      data-open={String(open)}
      onClick={() => onSuccess?.()}
    />
  ),
}));

// Stub useQueryClient → returns an object with our invalidateQueries spy
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...original,
    useQueryClient: () => ({
      invalidateQueries: (...args: unknown[]) =>
        mockInvalidateQueries(...args),
    }),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const VIEWER_ID = "viewer-1";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return Wrapper;
}

function makeProps(
  overrides: Partial<ReviewActionPanelProps> = {},
): ReviewActionPanelProps {
  return {
    entityType: "CASE",
    entityId: 100,
    projectId: 42,
    ...overrides,
  };
}

interface PendingReviewFixture {
  id: string;
  status: "PENDING";
  requestedByUserId: string;
  assigneeUserId: string | null;
  assigneeRoleId: number | null;
  toState: { id: number; name: string };
  requestedBy?: { name: string | null };
}

function mockPendingReview(overrides: Partial<PendingReviewFixture> = {}) {
  const fixture: PendingReviewFixture = {
    id: "rev-1",
    status: "PENDING",
    requestedByUserId: "requester-1",
    assigneeUserId: "assignee-1",
    assigneeRoleId: null,
    toState: { id: 11, name: "In Review" },
    requestedBy: { name: "Alice" },
    ...overrides,
  };
  mockUseFindFirstReviewRequest.mockReturnValue({
    data: fixture,
    isLoading: false,
    refetch: vi.fn(),
  });
}

function mockNoPendingReview() {
  mockUseFindFirstReviewRequest.mockReturnValue({
    data: null,
    isLoading: false,
    refetch: vi.fn(),
  });
}

function mockSession(
  user: { id?: string; access?: string } | null = { id: VIEWER_ID },
) {
  if (user === null) {
    mockUseSession.mockReturnValue({ data: null, status: "unauthenticated" });
    return;
  }
  mockUseSession.mockReturnValue({
    data: { user },
    status: "authenticated",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("ReviewActionPanel", () => {
  beforeEach(() => {
    mockUseFindFirstReviewRequest.mockReset();
    mockUseSession.mockReset();
    mockUseReviewFeatureEnabled.mockReset();
    mockUseEffectiveRoleOnProject.mockReset();
    mockInvalidateQueries.mockReset();

    // Defaults — eligible viewer + feature on + pending request exists with
    // viewer as direct assignee. Individual tests override what they need.
    mockUseReviewFeatureEnabled.mockReturnValue({
      enabled: true,
      isLoading: false,
    });
    mockUseEffectiveRoleOnProject.mockReturnValue({
      roleId: null,
      isLoading: false,
    });
    mockSession();
    mockPendingReview({ assigneeUserId: VIEWER_ID });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("(a) returns null when feature flag is disabled", () => {
    mockUseReviewFeatureEnabled.mockReturnValue({
      enabled: false,
      isLoading: false,
    });

    const { container } = render(<ReviewActionPanel {...makeProps()} />, {
      wrapper: createWrapper(),
    });
    expect(container.firstChild).toBeNull();
  });

  it("(b) returns null when no PENDING ReviewRequest exists", () => {
    mockNoPendingReview();

    const { container } = render(<ReviewActionPanel {...makeProps()} />, {
      wrapper: createWrapper(),
    });
    expect(container.firstChild).toBeNull();
  });

  it("(c) returns null when viewer is the requester (D-12 — requester sees banner only)", () => {
    mockPendingReview({
      requestedByUserId: VIEWER_ID,
      assigneeUserId: "other-1",
    });

    const { container } = render(<ReviewActionPanel {...makeProps()} />, {
      wrapper: createWrapper(),
    });
    expect(container.firstChild).toBeNull();
  });

  it("(d) returns null when viewer is uninvolved (not assignee, no role match, not admin)", () => {
    mockPendingReview({ assigneeUserId: "other-1", assigneeRoleId: 7 });
    mockUseEffectiveRoleOnProject.mockReturnValue({
      roleId: 9, // not 7
      isLoading: false,
    });

    const { container } = render(<ReviewActionPanel {...makeProps()} />, {
      wrapper: createWrapper(),
    });
    expect(container.firstChild).toBeNull();
  });

  it("(e) renders the panel when viewer is the direct assignee", () => {
    mockPendingReview({ assigneeUserId: VIEWER_ID });

    render(<ReviewActionPanel {...makeProps()} />, {
      wrapper: createWrapper(),
    });

    expect(screen.getByTestId("review-action-panel")).toBeInTheDocument();
    expect(screen.getByTestId("review-approve-button")).toBeInTheDocument();
    expect(
      screen.getByTestId("review-request-changes-button"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("review-reject-button")).toBeInTheDocument();
  });

  it("(f) renders the panel when viewer is a role-holder (effective role matches assigneeRoleId)", () => {
    mockPendingReview({
      assigneeUserId: null,
      assigneeRoleId: 7,
    });
    mockUseEffectiveRoleOnProject.mockReturnValue({
      roleId: 7,
      isLoading: false,
    });

    render(<ReviewActionPanel {...makeProps()} />, {
      wrapper: createWrapper(),
    });

    expect(screen.getByTestId("review-action-panel")).toBeInTheDocument();
  });

  it("(g) renders the panel when viewer is system ADMIN even if not assignee", () => {
    mockPendingReview({ assigneeUserId: "other-1", assigneeRoleId: 7 });
    mockSession({ id: VIEWER_ID, access: "ADMIN" });
    mockUseEffectiveRoleOnProject.mockReturnValue({
      roleId: null,
      isLoading: false,
    });

    render(<ReviewActionPanel {...makeProps()} />, {
      wrapper: createWrapper(),
    });

    expect(screen.getByTestId("review-action-panel")).toBeInTheDocument();
  });

  it("(h) clicking Approve opens the ApproveDialog (mocked stub flips data-open)", () => {
    render(<ReviewActionPanel {...makeProps()} />, {
      wrapper: createWrapper(),
    });

    const approveStub = screen.getByTestId("approve-dialog-stub");
    expect(approveStub.getAttribute("data-open")).toBe("false");

    fireEvent.click(screen.getByTestId("review-approve-button"));

    expect(approveStub.getAttribute("data-open")).toBe("true");
  });

  it("(i) clicking Request changes opens the RequestChangesDialog", () => {
    render(<ReviewActionPanel {...makeProps()} />, {
      wrapper: createWrapper(),
    });

    const stub = screen.getByTestId("request-changes-dialog-stub");
    expect(stub.getAttribute("data-open")).toBe("false");

    fireEvent.click(screen.getByTestId("review-request-changes-button"));

    expect(stub.getAttribute("data-open")).toBe("true");
  });

  it("(j) clicking Reject opens the RejectDialog", () => {
    render(<ReviewActionPanel {...makeProps()} />, {
      wrapper: createWrapper(),
    });

    const stub = screen.getByTestId("reject-dialog-stub");
    expect(stub.getAttribute("data-open")).toBe("false");

    fireEvent.click(screen.getByTestId("review-reject-button"));

    expect(stub.getAttribute("data-open")).toBe("true");
  });

  it("(k) onSuccess from any dialog triggers React Query invalidate on the ReviewRequest key", () => {
    render(<ReviewActionPanel {...makeProps()} />, {
      wrapper: createWrapper(),
    });

    // The mocked stubs call onSuccess on click — verify the panel wires
    // invalidateQueries through.
    fireEvent.click(screen.getByTestId("approve-dialog-stub"));

    expect(mockInvalidateQueries).toHaveBeenCalledTimes(1);
    const callArg = mockInvalidateQueries.mock.calls[0][0];
    // Accept any shape that mentions ReviewRequest in the queryKey.
    const serialized = JSON.stringify(callArg);
    expect(serialized).toContain("ReviewRequest");
  });
});
