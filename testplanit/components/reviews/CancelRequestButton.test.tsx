import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CancelRequestButton } from "./CancelRequestButton";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockMutateAsync = vi.fn();
const mockUseUpdateReviewRequest = vi.fn(() => ({
  mutateAsync: mockMutateAsync,
}));

vi.mock("~/lib/hooks", () => ({
  useUpdateReviewRequest: () => mockUseUpdateReviewRequest(),
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
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue({ id: REVIEW_REQUEST_ID });
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
  });

  it("(a) renders null when canCancel === false", () => {
    const { container } = render(
      <CancelRequestButton {...makeProps({ canCancel: false })} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId("cancel-request-button"),
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
      screen.queryByTestId("cancel-request-dialog"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("cancel-request-button"));

    expect(screen.getByTestId("cancel-request-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("cancel-request-confirm")).toBeInTheDocument();
  });

  it("(d) clicking confirm calls useUpdateReviewRequest.mutateAsync with status: CANCELLED", async () => {
    render(<CancelRequestButton {...makeProps()} />);

    fireEvent.click(screen.getByTestId("cancel-request-button"));
    fireEvent.click(screen.getByTestId("cancel-request-confirm"));

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));

    const arg = mockMutateAsync.mock.calls[0]?.[0];
    expect(arg).toMatchObject({
      where: { id: REVIEW_REQUEST_ID },
      data: { status: "CANCELLED" },
    });
  });

  it("(e) on success, toast.success fires", async () => {
    render(<CancelRequestButton {...makeProps()} />);

    fireEvent.click(screen.getByTestId("cancel-request-button"));
    fireEvent.click(screen.getByTestId("cancel-request-confirm"));

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledTimes(1));
    expect(mockToastSuccess.mock.calls[0]?.[0]).toContain(
      "reviews.cancel.success",
    );
  });

  it("(f) on error, toast.error fires", async () => {
    mockMutateAsync.mockReset();
    mockMutateAsync.mockRejectedValueOnce(new Error("Network blew up"));

    render(<CancelRequestButton {...makeProps()} />);

    fireEvent.click(screen.getByTestId("cancel-request-button"));
    fireEvent.click(screen.getByTestId("cancel-request-confirm"));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
    expect(mockToastError.mock.calls[0]?.[0]).toContain(
      "reviews.cancel.error",
    );
  });
});
