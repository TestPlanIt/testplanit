import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApproveDialog,
  RejectDialog,
  RequestChangesDialog,
} from "./ReviewDecisionDialogs";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const REVIEW_REQUEST_ID = "rev-123";

function mockDecideResponse(
  body: Record<string, unknown>,
  init: { status?: number } = {},
) {
  mockFetch.mockResolvedValueOnce({
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    json: async () => body,
  } as Response);
}

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    reviewRequestId: REVIEW_REQUEST_ID,
    open: true,
    onOpenChange: vi.fn(),
    entityType: "CASE" as const,
    targetStateName: "In Review",
    onSuccess: vi.fn(),
    ...overrides,
  };
}

describe("ReviewDecisionDialogs", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────
  // ApproveDialog
  // ───────────────────────────────────────────────────────────────────────

  describe("ApproveDialog", () => {
    it("(a) renders title + description when open", () => {
      render(<ApproveDialog {...baseProps()} />);

      expect(screen.getByTestId("approve-dialog")).toBeInTheDocument();
      // Description re-iterates "approval = permission" framing per D-13 + CONTEXT.
      expect(
        screen.getByText(
          /Approving will permit the requester to transition this CASE to In Review/i,
        ),
      ).toBeInTheDocument();
    });

    it("(b) Approval note is optional — submit succeeds when note is empty", async () => {
      mockDecideResponse({
        decision: "APPROVED",
        reviewRequestId: REVIEW_REQUEST_ID,
      });

      const props = baseProps();
      render(<ApproveDialog {...props} />);

      fireEvent.click(screen.getByTestId("approve-confirm"));

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(`/api/reviews/${REVIEW_REQUEST_ID}/decide`);
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ decision: "APPROVED" });

      await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledTimes(1));
      expect(props.onSuccess).toHaveBeenCalledTimes(1);
      expect(props.onOpenChange).toHaveBeenCalledWith(false);
    });

    it("(c) submit forwards the optional note as `comment` when filled", async () => {
      mockDecideResponse({
        decision: "APPROVED",
        reviewRequestId: REVIEW_REQUEST_ID,
        comment: "LGTM",
      });

      const props = baseProps();
      render(<ApproveDialog {...props} />);

      fireEvent.change(screen.getByTestId("approve-note-input"), {
        target: { value: "LGTM" },
      });
      fireEvent.click(screen.getByTestId("approve-confirm"));

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      const [, init] = mockFetch.mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({
        decision: "APPROVED",
        comment: "LGTM",
      });
    });

    it("(d) 403 INELIGIBLE_REVIEWER → toast.error + dialog stays open + onSuccess not called", async () => {
      mockDecideResponse(
        { error: { code: "INELIGIBLE_REVIEWER" } },
        { status: 403 },
      );

      const props = baseProps();
      render(<ApproveDialog {...props} />);

      fireEvent.click(screen.getByTestId("approve-confirm"));

      await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
      expect(props.onSuccess).not.toHaveBeenCalled();
      expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
    });

    it("(e) 409 ALREADY_DECIDED → toast.error + dialog closes + onSuccess fires (so banner refetches)", async () => {
      mockDecideResponse(
        { error: { code: "ALREADY_DECIDED" } },
        { status: 409 },
      );

      const props = baseProps();
      render(<ApproveDialog {...props} />);

      fireEvent.click(screen.getByTestId("approve-confirm"));

      await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(props.onSuccess).toHaveBeenCalledTimes(1));
      expect(props.onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // RequestChangesDialog
  // ───────────────────────────────────────────────────────────────────────

  describe("RequestChangesDialog", () => {
    it("(a) submit button is disabled while comment is empty", () => {
      render(<RequestChangesDialog {...baseProps()} />);

      const submit = screen.getByTestId("request-changes-submit");
      expect(submit).toBeDisabled();
    });

    it("(b) submit becomes enabled once a non-empty comment is entered", () => {
      render(<RequestChangesDialog {...baseProps()} />);

      fireEvent.change(
        screen.getByTestId("request-changes-comment-input"),
        { target: { value: "Please reword step 3." } },
      );

      expect(screen.getByTestId("request-changes-submit")).not.toBeDisabled();
    });

    it("(c) submit POSTs decision CHANGES_REQUESTED with the comment + toast.success + onSuccess + close", async () => {
      mockDecideResponse({
        decision: "CHANGES_REQUESTED",
        reviewRequestId: REVIEW_REQUEST_ID,
        comment: "Please reword step 3.",
      });

      const props = baseProps();
      render(<RequestChangesDialog {...props} />);

      fireEvent.change(
        screen.getByTestId("request-changes-comment-input"),
        { target: { value: "Please reword step 3." } },
      );
      fireEvent.click(screen.getByTestId("request-changes-submit"));

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(`/api/reviews/${REVIEW_REQUEST_ID}/decide`);
      expect(JSON.parse(init.body)).toEqual({
        decision: "CHANGES_REQUESTED",
        comment: "Please reword step 3.",
      });

      await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledTimes(1));
      expect(props.onSuccess).toHaveBeenCalledTimes(1);
      expect(props.onOpenChange).toHaveBeenCalledWith(false);
    });

    it("(d) 403 INELIGIBLE_REVIEWER → toast.error + dialog stays open + onSuccess not called", async () => {
      mockDecideResponse(
        { error: { code: "INELIGIBLE_REVIEWER" } },
        { status: 403 },
      );

      const props = baseProps();
      render(<RequestChangesDialog {...props} />);

      fireEvent.change(
        screen.getByTestId("request-changes-comment-input"),
        { target: { value: "More detail needed." } },
      );
      fireEvent.click(screen.getByTestId("request-changes-submit"));

      await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
      expect(props.onSuccess).not.toHaveBeenCalled();
    });

    it("(e) 409 ALREADY_DECIDED → toast.error + dialog closes + onSuccess fires", async () => {
      mockDecideResponse(
        { error: { code: "ALREADY_DECIDED" } },
        { status: 409 },
      );

      const props = baseProps();
      render(<RequestChangesDialog {...props} />);

      fireEvent.change(
        screen.getByTestId("request-changes-comment-input"),
        { target: { value: "More detail needed." } },
      );
      fireEvent.click(screen.getByTestId("request-changes-submit"));

      await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(props.onSuccess).toHaveBeenCalledTimes(1));
      expect(props.onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // RejectDialog
  // ───────────────────────────────────────────────────────────────────────

  describe("RejectDialog", () => {
    it("(a) renders title + destructive confirm + required comment", () => {
      render(<RejectDialog {...baseProps()} />);

      expect(screen.getByTestId("reject-dialog")).toBeInTheDocument();
      expect(screen.getByTestId("reject-confirm")).toBeDisabled();
    });

    it("(b) submit becomes enabled once a non-empty comment is entered", () => {
      render(<RejectDialog {...baseProps()} />);

      fireEvent.change(screen.getByTestId("reject-comment-input"), {
        target: { value: "Out of scope." },
      });

      expect(screen.getByTestId("reject-confirm")).not.toBeDisabled();
    });

    it("(c) submit POSTs decision REJECTED with the comment + toast.success + onSuccess + close", async () => {
      mockDecideResponse({
        decision: "REJECTED",
        reviewRequestId: REVIEW_REQUEST_ID,
        comment: "Out of scope.",
      });

      const props = baseProps();
      render(<RejectDialog {...props} />);

      fireEvent.change(screen.getByTestId("reject-comment-input"), {
        target: { value: "Out of scope." },
      });
      fireEvent.click(screen.getByTestId("reject-confirm"));

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(`/api/reviews/${REVIEW_REQUEST_ID}/decide`);
      expect(JSON.parse(init.body)).toEqual({
        decision: "REJECTED",
        comment: "Out of scope.",
      });

      await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledTimes(1));
      expect(props.onSuccess).toHaveBeenCalledTimes(1);
      expect(props.onOpenChange).toHaveBeenCalledWith(false);
    });

    it("(d) 403 INELIGIBLE_REVIEWER → toast.error + dialog stays open + onSuccess not called", async () => {
      mockDecideResponse(
        { error: { code: "INELIGIBLE_REVIEWER" } },
        { status: 403 },
      );

      const props = baseProps();
      render(<RejectDialog {...props} />);

      fireEvent.change(screen.getByTestId("reject-comment-input"), {
        target: { value: "Not appropriate." },
      });
      fireEvent.click(screen.getByTestId("reject-confirm"));

      await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
      expect(props.onSuccess).not.toHaveBeenCalled();
    });

    it("(e) 409 ALREADY_DECIDED → toast.error + dialog closes + onSuccess fires", async () => {
      mockDecideResponse(
        { error: { code: "ALREADY_DECIDED" } },
        { status: 409 },
      );

      const props = baseProps();
      render(<RejectDialog {...props} />);

      fireEvent.change(screen.getByTestId("reject-comment-input"), {
        target: { value: "Not appropriate." },
      });
      fireEvent.click(screen.getByTestId("reject-confirm"));

      await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(props.onSuccess).toHaveBeenCalledTimes(1));
      expect(props.onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
