import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewStatusBanner } from "./ReviewStatusBanner";

// ─────────────────────────────────────────────────────────────────────────────
// Integration test: ReviewStatusBanner (PENDING) → CancelRequestButton →
// AlertDialog → cancelReviewRequest server action → banner disappears on
// rerender.
//
// Exercises the full requester-side cancel flow end-to-end.
// ─────────────────────────────────────────────────────────────────────────────

const mockUseFindFirstReviewRequest = vi.fn();

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    reviewRequest: { useFindFirst: (...args: unknown[]) =>
    mockUseFindFirstReviewRequest(...args) },
  }),
}));

const mockCancelReviewRequest = vi.fn();
vi.mock("~/app/actions/reviews", () => ({
  cancelReviewRequest: (...args: unknown[]) => mockCancelReviewRequest(...args),
}));

const mockUseReviewFeatureEnabled = vi.fn();
vi.mock("~/hooks/useReviewFeatureEnabled", () => ({
  useReviewFeatureEnabled: (...args: unknown[]) =>
    mockUseReviewFeatureEnabled(...args),
}));

const mockUseSession = vi.fn();
vi.mock("next-auth/react", async (importOriginal) => {
  const original = await importOriginal<typeof import("next-auth/react")>();
  return {
    ...original,
    useSession: () => mockUseSession(),
  };
});

vi.mock("./RequestReviewSheet", () => ({
  RequestReviewSheet: () => null,
}));

// Stub UserNameCell — pulls the i18n navigation router which isn't
// available in the unit-test environment. Banner-flow assertions only
// care that the user-attribution chunk renders, not its full chrome.
vi.mock("~/components/tables/UserNameCell", () => ({
  UserNameCell: ({ userId }: { userId: string }) => (
    <span data-testid={`user-name-cell-${userId}`}>{userId}</span>
  ),
}));

// Same reason as UserNameCell — UserMention pulls `~/lib/navigation`.
vi.mock("~/components/UserMention", () => ({
  UserMention: ({ userId }: { userId: string }) => (
    <span data-testid={`user-mention-${userId}`}>{userId}</span>
  ),
}));

vi.mock("~/components/WorkflowStateDisplay", () => ({
  WorkflowStateDisplay: ({ state }: { state: { name?: string } | null }) => (
    <span data-testid="workflow-state-display">{state?.name ?? ""}</span>
  ),
}));

vi.mock("~/components/RelativeTimeTooltip", () => ({
  RelativeTimeTooltip: ({ date }: { date: Date | string }) => (
    <span data-testid="relative-time-tooltip">{String(date)}</span>
  ),
}));

vi.mock("./ReviewDecisionDialogs", () => ({
  ApproveDialog: () => null,
  RequestChangesDialog: () => null,
  RejectDialog: () => null,
}));

vi.mock("~/hooks/useEffectiveRoleOnProject", () => ({
  useEffectiveRoleOnProject: () => ({ roleId: null }),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

function pending() {
  return {
    id: "rev-cancel-1",
    status: "PENDING" as const,
    entityType: "CASE",
    entityId: 100,
    projectId: 42,
    fromStateId: 10,
    toStateId: 11,
    requestedByUserId: "requester-1",
    assigneeUserId: "assignee-1",
    assigneeRoleId: null,
    decisionComment: null,
    isDeleted: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 5),
    requestedBy: { id: "requester-1", name: "Alice", image: null },
    assigneeUser: { id: "assignee-1", name: "Bob", image: null },
    assigneeRole: null,
  };
}

const bannerProps = {
  entityType: "CASE" as const,
  entityId: 100,
  projectId: 42,
  entityName: "Test case 100",
  reachableGatedStates: [],
};

describe("CancelReviewRequestFlow (Banner + CancelRequestButton)", () => {
  beforeEach(() => {
    mockUseFindFirstReviewRequest.mockReset();
    mockCancelReviewRequest.mockReset();
    mockUseReviewFeatureEnabled.mockReset();
    mockUseSession.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();

    mockCancelReviewRequest.mockResolvedValue({
      success: true,
      reviewRequestId: "rev-cancel-1",
    });
    mockUseReviewFeatureEnabled.mockReturnValue({
      enabled: true,
      isLoading: false,
      systemEnabled: true,
      projectEnabled: true,
    });
    mockUseSession.mockReturnValue({
      data: { user: { id: "requester-1", access: "MEMBER" } },
      status: "authenticated",
    });
  });

  it("PENDING → Cancel → confirm → server action invoked → banner removed on rerender", async () => {
    mockUseFindFirstReviewRequest.mockReturnValue({
      data: pending(),
      isLoading: false,
    });

    const { rerender, container } = render(
      <ReviewStatusBanner {...bannerProps} />
    );

    // Banner is visible; Cancel button is visible to the requester.
    expect(
      screen.getByTestId("review-status-banner-pending")
    ).toBeInTheDocument();
    const cancelButton = screen.getByTestId("cancel-request-button");
    fireEvent.click(cancelButton);

    // AlertDialog content is rendered.
    expect(screen.getByTestId("cancel-request-dialog")).toBeInTheDocument();

    // Confirm the cancel.
    fireEvent.click(screen.getByTestId("cancel-request-confirm"));

    // Server action called with the request id.
    await waitFor(() =>
      expect(mockCancelReviewRequest).toHaveBeenCalledTimes(1)
    );
    expect(mockCancelReviewRequest.mock.calls[0]?.[0]).toBe("rev-cancel-1");

    // Simulate the post-mutation state — hook now returns the CANCELLED row.
    mockUseFindFirstReviewRequest.mockReturnValue({
      data: { ...pending(), status: "CANCELLED" },
      isLoading: false,
    });
    rerender(<ReviewStatusBanner {...bannerProps} />);

    // Banner disappears (status CANCELLED short-circuits to null).
    expect(container).toBeEmptyDOMElement();
  });
});
