import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CancelRequestButton } from "./CancelRequestButton";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockCancelReviewRequest = vi.fn();
vi.mock("~/app/actions/reviews", () => ({
  cancelReviewRequest: (...args: unknown[]) => mockCancelReviewRequest(...args),
}));

const mockInvalidateQueries = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const REVIEW_REQUEST_ID = "rev-123";

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    reviewRequestId: REVIEW_REQUEST_ID,
    canCancel: true,
    ...overrides,
  };
}

describe("CancelRequestButton", () => {
  beforeEach(() => {
    mockCancelReviewRequest.mockReset();
    mockCancelReviewRequest.mockResolvedValue({
      success: true,
      reviewRequestId: REVIEW_REQUEST_ID,
    });
    mockInvalidateQueries.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
  });

  it("(a) renders null when canCancel === false", () => {
    const { container } = render(
      <CancelRequestButton {...makeProps({ canCancel: false })} />
    );

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId("cancel-request-button")
    ).not.toBeInTheDocument();
  });

  it("(b) renders the cancel button when canCancel === true", () => {
    render(<CancelRequestButton {...makeProps()} />);

    expect(screen.getByTestId("cancel-request-button")).toBeInTheDocument();
  });

  it("(c) clicking the button opens the AlertDialog confirm", () => {
    render(<CancelRequestButton {...makeProps()} />);

    // Dialog not open yet — content portal not rendered.
    expect(
      screen.queryByTestId("cancel-request-dialog")
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("cancel-request-button"));

    expect(screen.getByTestId("cancel-request-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("cancel-request-confirm")).toBeInTheDocument();
  });

  it("(d) clicking confirm calls cancelReviewRequest with the request id", async () => {
    render(<CancelRequestButton {...makeProps()} />);

    fireEvent.click(screen.getByTestId("cancel-request-button"));
    fireEvent.click(screen.getByTestId("cancel-request-confirm"));

    await waitFor(() =>
      expect(mockCancelReviewRequest).toHaveBeenCalledTimes(1)
    );
    expect(mockCancelReviewRequest.mock.calls[0]?.[0]).toBe(REVIEW_REQUEST_ID);
  });

  it("(e) on success, toast.success fires and queries are invalidated", async () => {
    render(<CancelRequestButton {...makeProps()} />);

    fireEvent.click(screen.getByTestId("cancel-request-button"));
    fireEvent.click(screen.getByTestId("cancel-request-confirm"));

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledTimes(1));
    expect(mockToastSuccess.mock.calls[0]?.[0]).toContain(
      "reviews.cancel.success"
    );
    expect(mockInvalidateQueries).toHaveBeenCalled();
  });

  it("(f) on rejected promise, toast.error fires", async () => {
    mockCancelReviewRequest.mockReset();
    mockCancelReviewRequest.mockRejectedValueOnce(new Error("Network blew up"));

    render(<CancelRequestButton {...makeProps()} />);

    fireEvent.click(screen.getByTestId("cancel-request-button"));
    fireEvent.click(screen.getByTestId("cancel-request-confirm"));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
    expect(mockToastError.mock.calls[0]?.[0]).toContain("reviews.cancel.error");
  });

  it("(g) on success: false result, toast.error fires (no invalidate)", async () => {
    mockCancelReviewRequest.mockReset();
    mockCancelReviewRequest.mockResolvedValueOnce({
      success: false,
      error: "FORBIDDEN",
    });

    render(<CancelRequestButton {...makeProps()} />);

    fireEvent.click(screen.getByTestId("cancel-request-button"));
    fireEvent.click(screen.getByTestId("cancel-request-confirm"));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
    expect(mockInvalidateQueries).not.toHaveBeenCalled();
  });
});
