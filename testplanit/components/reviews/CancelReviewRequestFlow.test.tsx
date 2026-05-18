import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewStatusBanner } from "./ReviewStatusBanner";

// ─────────────────────────────────────────────────────────────────────────────
// Integration test: ReviewStatusBanner (PENDING) → CancelRequestButton →
// AlertDialog → useUpdateReviewRequest({ status: 'CANCELLED' }) → banner
// disappears on rerender.
//
// Exercises the full requester-side cancel flow end-to-end, mirroring the
// VALIDATION.md TBD-cancel-status-mutation row.
// ─────────────────────────────────────────────────────────────────────────────

const mockUseFindFirstReviewRequest = vi.fn();
const mockUpdateMutateAsync = vi.fn();
const mockUseUpdateReviewRequest = vi.fn(() => ({
  mutateAsync: mockUpdateMutateAsync,
}));

vi.mock("~/lib/hooks", () => ({
  useFindFirstReviewRequest: (...args: unknown[]) =>
    mockUseFindFirstReviewRequest(...args),
  useUpdateReviewRequest: () => mockUseUpdateReviewRequest(),
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
  reachableGatedStates: [],
};

describe("CancelReviewRequestFlow (Banner + CancelRequestButton)", () => {
  beforeEach(() => {
    mockUseFindFirstReviewRequest.mockReset();
    mockUpdateMutateAsync.mockReset();
    mockUseReviewFeatureEnabled.mockReset();
    mockUseSession.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();

    mockUpdateMutateAsync.mockResolvedValue({ id: "rev-cancel-1" });
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

  it("PENDING → Cancel → confirm → status: CANCELLED → banner removed on rerender", async () => {
    mockUseFindFirstReviewRequest.mockReturnValue({
      data: pending(),
      isLoading: false,
    });

    const { rerender, container } = render(
      <ReviewStatusBanner {...bannerProps} />,
    );

    // Banner is visible; Cancel button is visible to the requester.
    expect(
      screen.getByTestId("review-status-banner-pending"),
    ).toBeInTheDocument();
    const cancelButton = screen.getByTestId("cancel-request-button");
    fireEvent.click(cancelButton);

    // AlertDialog content is rendered.
    expect(
      screen.getByTestId("cancel-request-dialog"),
    ).toBeInTheDocument();

    // Confirm the cancel.
    fireEvent.click(screen.getByTestId("cancel-request-confirm"));

    // Status mutation called with CANCELLED.
    await waitFor(() =>
      expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1),
    );
    const arg = mockUpdateMutateAsync.mock.calls[0]?.[0];
    expect(arg).toMatchObject({
      where: { id: "rev-cancel-1" },
      data: { status: "CANCELLED" },
    });

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
