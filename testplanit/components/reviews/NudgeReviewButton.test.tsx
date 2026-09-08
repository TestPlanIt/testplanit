import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NudgeReviewButton } from "./NudgeReviewButton";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockNudgeReviewRequest = vi.fn();
vi.mock("~/app/actions/reviews", () => ({
  nudgeReviewRequest: (...args: unknown[]) => mockNudgeReviewRequest(...args),
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

// Radix tooltips need a provider + portal; neither is under test here.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const REVIEW_REQUEST_ID = "rev-nudge-1";
const TEST_ID = `reviews-inbox-nudge-${REVIEW_REQUEST_ID}`;
const HOUR = 60 * 60 * 1000;

function renderButton(overrides: Record<string, unknown> = {}) {
  const onNudged = vi.fn();
  render(
    <NudgeReviewButton
      reviewRequestId={REVIEW_REQUEST_ID}
      lastRemindedAt={null}
      onNudged={onNudged}
      {...overrides}
    />
  );
  return { onNudged, button: screen.getByTestId(TEST_ID) };
}

describe("NudgeReviewButton", () => {
  beforeEach(() => {
    mockNudgeReviewRequest.mockReset();
    mockNudgeReviewRequest.mockResolvedValue({
      success: true,
      reviewRequestId: REVIEW_REQUEST_ID,
      recipientCount: 2,
    });
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
  });

  it("(a) fires the reminder immediately — no confirmation step", async () => {
    const { onNudged, button } = renderButton();
    fireEvent.click(button);

    await waitFor(() =>
      expect(mockNudgeReviewRequest).toHaveBeenCalledWith(REVIEW_REQUEST_ID)
    );
    expect(mockToastSuccess).toHaveBeenCalled();
    // The row's cooldown moved — the caller has to refetch to see it.
    await waitFor(() => expect(onNudged).toHaveBeenCalled());
  });

  it("(b) disables itself while a reminder for this request is still inside the cooldown", () => {
    const { button } = renderButton({
      lastRemindedAt: new Date(Date.now() - 10 * 60_000),
    });

    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(mockNudgeReviewRequest).not.toHaveBeenCalled();
  });

  it("(c) re-enables once the cooldown has elapsed", () => {
    const { button } = renderButton({
      lastRemindedAt: new Date(Date.now() - 2 * HOUR),
    });

    expect(button).not.toBeDisabled();
  });

  it("(d) treats a stale cooldown rejection from the server as a signal to refetch", async () => {
    mockNudgeReviewRequest.mockResolvedValue({
      success: false,
      error: "TOO_SOON",
      retryAt: new Date(Date.now() + HOUR).toISOString(),
    });
    const { onNudged, button } = renderButton();
    fireEvent.click(button);

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    expect(mockToastSuccess).not.toHaveBeenCalled();
    // The client cache was behind the database; refresh so the button
    // settles into its disabled state instead of inviting another click.
    await waitFor(() => expect(onNudged).toHaveBeenCalled());
  });

  it("(e) surfaces a distinct message when the request has no reachable reviewer", async () => {
    mockNudgeReviewRequest.mockResolvedValue({
      success: false,
      error: "NO_RECIPIENTS",
    });
    const { onNudged, button } = renderButton();
    fireEvent.click(button);

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith("reviews.nudge.noRecipients")
    );
    // Nothing about the row changed, so nothing to refetch.
    expect(onNudged).not.toHaveBeenCalled();
  });

  it("(f) reports a thrown action as a generic failure rather than crashing the row", async () => {
    mockNudgeReviewRequest.mockRejectedValue(new Error("network down"));
    const { button } = renderButton();
    fireEvent.click(button);

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith("reviews.nudge.error")
    );
  });
});
