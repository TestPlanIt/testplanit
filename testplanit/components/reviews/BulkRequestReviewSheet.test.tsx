import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BulkRequestReviewSheet,
  type BulkRequestReviewSheetProps,
} from "./BulkRequestReviewSheet";
import type { AssigneeOption } from "./AssigneeCombobox";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockBulkRequestReview = vi.fn();
vi.mock("~/app/actions/reviews", () => ({
  bulkRequestReview: (...args: unknown[]) => mockBulkRequestReview(...args),
}));

const mockInvalidateQueries = vi.fn().mockResolvedValue(undefined);
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

// Picker internals are covered in AssigneeCombobox.test.tsx; these tests are
// about submit wiring. The stub selects a user by default and a role when
// clicked with `data-pick="role"` set by the test.
vi.mock("./AssigneeCombobox", () => ({
  AssigneeCombobox: ({
    value,
    onValueChange,
  }: {
    value: AssigneeOption | null;
    onValueChange: (v: AssigneeOption | null) => void;
  }) => (
    <>
      <button
        type="button"
        data-testid="pick-user"
        data-value={value ? `${value.kind}:${value.id}` : ""}
        onClick={() =>
          onValueChange({
            kind: "user",
            id: "user-1",
            name: "Alice",
            image: null,
            roleName: null,
          })
        }
      >
        pick-user
      </button>
      <button
        type="button"
        data-testid="pick-role"
        onClick={() =>
          onValueChange({
            kind: "role",
            id: 5,
            name: "QA Lead",
            notifyCount: 3,
          })
        }
      >
        pick-role
      </button>
      <button
        type="button"
        data-testid="pick-self"
        onClick={() =>
          onValueChange({
            kind: "user",
            // Matches the globally-mocked session user in vitest.setup.tsx.
            id: "test-user-id",
            name: "Test User",
            image: null,
            roleName: null,
          })
        }
      >
        pick-self
      </button>
    </>
  ),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeProps(
  overrides: Partial<BulkRequestReviewSheetProps> = {}
): BulkRequestReviewSheetProps {
  return {
    open: true,
    onOpenChange: vi.fn(),
    entityType: "CASE",
    projectId: 42,
    entityIds: [1, 2, 3],
    toStateId: 60,
    targetStateName: "Approved",
    breakdown: [
      {
        gateId: 30,
        gateName: "Ready",
        gateIcon: "Eye",
        gateColor: "#888888",
        count: 2,
      },
      {
        gateId: 50,
        gateName: "Approved",
        gateIcon: "Check",
        gateColor: "#00aa00",
        count: 1,
      },
    ],
    onSuccess: vi.fn(),
    ...overrides,
  };
}

describe("BulkRequestReviewSheet", () => {
  beforeEach(() => {
    mockBulkRequestReview.mockReset();
    mockBulkRequestReview.mockResolvedValue({
      success: true,
      created: 3,
      reviewRequestIds: ["r1", "r2", "r3"],
      skippedPending: [],
      skippedNotBlocked: [],
    });
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
    mockInvalidateQueries.mockClear();
  });

  it("renders one breakdown row per gate", () => {
    render(<BulkRequestReviewSheet {...makeProps()} />);

    expect(screen.getByTestId("bulk-request-review-sheet")).toBeInTheDocument();
    expect(
      screen.getByTestId("bulk-request-review-breakdown-30")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("bulk-request-review-breakdown-50")
    ).toBeInTheDocument();
  });

  it("submits every entity id and the bulk target state", async () => {
    render(<BulkRequestReviewSheet {...makeProps()} />);

    fireEvent.click(screen.getByTestId("pick-user"));
    fireEvent.click(screen.getByTestId("bulk-request-review-submit"));

    await waitFor(() => expect(mockBulkRequestReview).toHaveBeenCalled());
    expect(mockBulkRequestReview.mock.calls[0]?.[0]).toMatchObject({
      projectId: 42,
      entityType: "CASE",
      entityIds: [1, 2, 3],
      // The per-entity gate is resolved server-side; the client sends only
      // the state the bulk edit was aiming for.
      toStateId: 60,
      assigneeUserId: "user-1",
      assigneeRoleId: null,
    });
  });

  it("sends a role assignee as assigneeRoleId", async () => {
    render(<BulkRequestReviewSheet {...makeProps()} />);

    fireEvent.click(screen.getByTestId("pick-role"));
    fireEvent.click(screen.getByTestId("bulk-request-review-submit"));

    await waitFor(() => expect(mockBulkRequestReview).toHaveBeenCalled());
    expect(mockBulkRequestReview.mock.calls[0]?.[0]).toMatchObject({
      assigneeUserId: null,
      assigneeRoleId: 5,
    });
  });

  it("blocks submit with an inline error when no assignee is chosen", async () => {
    render(<BulkRequestReviewSheet {...makeProps()} />);

    fireEvent.click(screen.getByTestId("bulk-request-review-submit"));

    await waitFor(() =>
      expect(
        screen.getByTestId("bulk-request-review-assignee-error")
      ).toBeInTheDocument()
    );
    expect(mockBulkRequestReview).not.toHaveBeenCalled();
  });

  it("blocks self-assignment before hitting the server", async () => {
    render(<BulkRequestReviewSheet {...makeProps()} />);

    fireEvent.click(screen.getByTestId("pick-self"));
    fireEvent.click(screen.getByTestId("bulk-request-review-submit"));

    await waitFor(() =>
      expect(
        screen.getByTestId("bulk-request-review-assignee-error")
      ).toBeInTheDocument()
    );
    expect(mockBulkRequestReview).not.toHaveBeenCalled();
  });

  it("applies field edits before raising requests", async () => {
    const order: string[] = [];
    const onBeforeSubmit = vi.fn(async () => {
      order.push("edits");
      return true;
    });
    mockBulkRequestReview.mockImplementation(async () => {
      order.push("requests");
      return {
        success: true,
        created: 3,
        reviewRequestIds: [],
        skippedPending: [],
        skippedNotBlocked: [],
      };
    });

    render(<BulkRequestReviewSheet {...makeProps({ onBeforeSubmit })} />);

    fireEvent.click(screen.getByTestId("pick-user"));
    fireEvent.click(screen.getByTestId("bulk-request-review-submit"));

    await waitFor(() => expect(mockBulkRequestReview).toHaveBeenCalled());
    expect(order).toEqual(["edits", "requests"]);
  });

  it("raises no requests when the field edits fail", async () => {
    // Requests for edits that never landed would be worse than none.
    const onBeforeSubmit = vi.fn(async () => false);
    const onSuccess = vi.fn();

    render(
      <BulkRequestReviewSheet {...makeProps({ onBeforeSubmit, onSuccess })} />
    );

    fireEvent.click(screen.getByTestId("pick-user"));
    fireEvent.click(screen.getByTestId("bulk-request-review-submit"));

    await waitFor(() => expect(onBeforeSubmit).toHaveBeenCalled());
    expect(mockBulkRequestReview).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("closes and refetches on success", async () => {
    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();
    render(
      <BulkRequestReviewSheet {...makeProps({ onOpenChange, onSuccess })} />
    );

    fireEvent.click(screen.getByTestId("pick-user"));
    fireEvent.click(screen.getByTestId("bulk-request-review-submit"));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["zenstack", "ReviewRequest"],
    });
    expect(mockToastSuccess).toHaveBeenCalled();
  });

  it("reports skipped already-pending cases in the success toast", async () => {
    mockBulkRequestReview.mockResolvedValue({
      success: true,
      created: 2,
      reviewRequestIds: ["r1", "r2"],
      skippedPending: [3],
      skippedNotBlocked: [],
    });

    render(<BulkRequestReviewSheet {...makeProps()} />);

    fireEvent.click(screen.getByTestId("pick-user"));
    fireEvent.click(screen.getByTestId("bulk-request-review-submit"));

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
    // The test harness renders translation keys verbatim, so assert on the
    // key that carries the skip count rather than on English copy.
    expect(String(mockToastSuccess.mock.calls[0]?.[0])).toContain(
      "submitSuccessWithSkips"
    );
  });

  it("surfaces an ineligible assignee inline rather than as a toast", async () => {
    mockBulkRequestReview.mockResolvedValue({
      success: false,
      error: "INELIGIBLE_ASSIGNEE",
    });

    render(<BulkRequestReviewSheet {...makeProps()} />);

    fireEvent.click(screen.getByTestId("pick-user"));
    fireEvent.click(screen.getByTestId("bulk-request-review-submit"));

    await waitFor(() =>
      expect(
        screen.getByTestId("bulk-request-review-assignee-error")
      ).toBeInTheDocument()
    );
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("shows the pending-skip note when some cases are already awaiting review", () => {
    render(
      <BulkRequestReviewSheet {...makeProps({ alreadyPendingCount: 4 })} />
    );

    expect(
      screen.getByTestId("bulk-request-review-pending-note")
    ).toBeInTheDocument();
  });

  it("omits the pending-skip note when nothing is pending", () => {
    render(<BulkRequestReviewSheet {...makeProps()} />);

    expect(
      screen.queryByTestId("bulk-request-review-pending-note")
    ).not.toBeInTheDocument();
  });

  it("disables submit when the breakdown is empty", () => {
    render(<BulkRequestReviewSheet {...makeProps({ breakdown: [] })} />);

    expect(screen.getByTestId("bulk-request-review-submit")).toBeDisabled();
  });
});
