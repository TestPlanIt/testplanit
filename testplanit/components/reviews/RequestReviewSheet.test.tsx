import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  RequestReviewSheet,
  type RequestReviewSheetProps,
} from "./RequestReviewSheet";
import type { AssigneeOption } from "./AssigneeCombobox";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockMutateAsync = vi.fn();
const mockUseCreateReviewRequest = vi.fn(() => ({
  mutateAsync: mockMutateAsync,
}));

vi.mock("~/lib/hooks", () => ({
  useCreateReviewRequest: () => mockUseCreateReviewRequest(),
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

// Stub the AssigneeCombobox so the parent form tests focus on submit wiring,
// not picker internals (tested separately in AssigneeCombobox.test.tsx).
vi.mock("./AssigneeCombobox", () => ({
  AssigneeCombobox: ({
    value,
    onValueChange,
  }: {
    value: AssigneeOption | null;
    onValueChange: (v: AssigneeOption | null) => void;
  }) => (
    <button
      type="button"
      data-testid="request-review-assignee"
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
      assignee-stub
    </button>
  ),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const reachableState = (
  overrides: Partial<{
    id: number;
    name: string;
    iconName: string;
    colorValue: string;
  }> = {},
) => ({
  id: 11,
  name: "In Review",
  icon: { name: "Eye" },
  color: { value: "#888888" },
  ...overrides,
});

function makeProps(
  overrides: Partial<RequestReviewSheetProps> = {},
): RequestReviewSheetProps {
  return {
    open: true,
    onOpenChange: vi.fn(),
    entityType: "CASE",
    entityId: 100,
    projectId: 42,
    currentStateId: 10,
    reachableGatedStates: [reachableState()],
    ...overrides,
  };
}

describe("RequestReviewSheet", () => {
  beforeEach(() => {
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue({ id: "rev-1" });
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
  });

  it("(a) renders the Sheet container when open=true", () => {
    render(<RequestReviewSheet {...makeProps()} />);

    expect(
      screen.getByTestId("request-review-sheet"),
    ).toBeInTheDocument();
  });

  it("(b) blocks submit until comment is non-empty", async () => {
    render(<RequestReviewSheet {...makeProps()} />);

    // Select an assignee but leave comment empty.
    fireEvent.click(screen.getByTestId("request-review-assignee"));

    const submitButton = screen.getByTestId(
      "request-review-submit",
    ) as HTMLButtonElement;
    fireEvent.click(submitButton);

    // mutateAsync should NOT be called when validation fails.
    await new Promise((r) => setTimeout(r, 30));
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("(c) target-state defaults to the single reachable gated state", async () => {
    const onSingle = makeProps({
      reachableGatedStates: [reachableState({ id: 99 })],
    });
    render(<RequestReviewSheet {...onSingle} />);

    // Select assignee, fill comment.
    fireEvent.click(screen.getByTestId("request-review-assignee"));
    fireEvent.change(screen.getByTestId("request-review-comment"), {
      target: { value: "Please review" },
    });

    fireEvent.click(screen.getByTestId("request-review-submit"));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalled();
    });
    const arg = mockMutateAsync.mock.calls[0]?.[0];
    expect(arg.data.toStateId).toBe(99);
  });

  it("(d) submitting with user assignee + state + comment calls useCreateReviewRequest with expected payload", async () => {
    render(<RequestReviewSheet {...makeProps()} />);

    fireEvent.click(screen.getByTestId("request-review-assignee"));
    fireEvent.change(screen.getByTestId("request-review-comment"), {
      target: { value: "Please review carefully" },
    });
    fireEvent.click(screen.getByTestId("request-review-submit"));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalled();
    });

    const arg = mockMutateAsync.mock.calls[0]?.[0];
    expect(arg.data).toMatchObject({
      projectId: 42,
      entityType: "CASE",
      entityId: 100,
      fromStateId: 10,
      toStateId: 11,
      assigneeUserId: "user-1",
      assigneeRoleId: null,
      decisionComment: "Please review carefully",
      status: "PENDING",
    });
    // Requester captured from useSession (vitest.setup.tsx mocks user "test-user-id").
    expect(arg.data.requestedByUserId).toBe("test-user-id");
  });

  it("(e) on mutateAsync resolve, toast.success fires and onOpenChange(false) is called", async () => {
    const onOpenChange = vi.fn();
    render(<RequestReviewSheet {...makeProps({ onOpenChange })} />);

    fireEvent.click(screen.getByTestId("request-review-assignee"));
    fireEvent.change(screen.getByTestId("request-review-comment"), {
      target: { value: "Please review" },
    });
    fireEvent.click(screen.getByTestId("request-review-submit"));

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalled();
    });
    expect(mockToastSuccess.mock.calls[0]?.[0]).toContain(
      "reviews.requester.submitSuccess",
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("(f) on AlreadyPending error, toast.error fires with the alreadyPendingError key", async () => {
    // Shape mimics the server-side AlreadyPendingError that flows through
    // ZenStack's error surface — `info.message` includes the marker so
    // RequestReviewSheet's detector can branch.
    mockMutateAsync.mockRejectedValueOnce({
      info: { message: "A pending review request already exists" },
      message: "Conflict",
    });

    render(<RequestReviewSheet {...makeProps()} />);

    fireEvent.click(screen.getByTestId("request-review-assignee"));
    fireEvent.change(screen.getByTestId("request-review-comment"), {
      target: { value: "Please review" },
    });
    fireEvent.click(screen.getByTestId("request-review-submit"));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
    expect(mockToastError.mock.calls[0]?.[0]).toContain(
      "reviews.requester.alreadyPendingError",
    );
  });

  it("(f.5) WR-03 — picking yourself as user assignee renders inline self-assign error and does NOT submit", async () => {
    // The schema @@validate rejects requester == assigneeUserId server-side,
    // but ZenStack RPC surfaces it as a generic "Something went wrong" toast.
    // The sheet pre-checks the same condition client-side and renders an
    // inline form error keyed on `reviews.requester.cannotSelfAssign`.
    //
    // Custom AssigneeCombobox mock: picks the session user (test-user-id)
    // rather than the default `user-1`. We swap the mock by re-mocking the
    // module for this single test via vi.doMock — the parent vi.mock at
    // top-level captures the default stub.
    vi.resetModules();
    vi.doMock("./AssigneeCombobox", () => ({
      AssigneeCombobox: ({
        value,
        onValueChange,
      }: {
        value: AssigneeOption | null;
        onValueChange: (v: AssigneeOption | null) => void;
      }) => (
        <button
          type="button"
          data-testid="request-review-assignee"
          data-value={value ? `${value.kind}:${value.id}` : ""}
          onClick={() =>
            onValueChange({
              kind: "user",
              id: "test-user-id", // matches vitest.setup.tsx session.user.id
              name: "Self",
              image: null,
              roleName: null,
            })
          }
        >
          assignee-self-stub
        </button>
      ),
    }));
    // Re-import after the override so the new mock is wired.
    const { RequestReviewSheet: SheetWithSelfMock } = await import(
      "./RequestReviewSheet"
    );

    render(<SheetWithSelfMock {...makeProps()} />);

    fireEvent.click(screen.getByTestId("request-review-assignee"));
    fireEvent.change(screen.getByTestId("request-review-comment"), {
      target: { value: "trying to self-review" },
    });
    fireEvent.click(screen.getByTestId("request-review-submit"));

    // Submit must NOT reach the create mutation.
    await new Promise((r) => setTimeout(r, 50));
    expect(mockMutateAsync).not.toHaveBeenCalled();

    // Localized inline error is rendered (FormMessage shows the i18n key in
    // tests since useTranslations returns the key path as the value).
    expect(
      screen.getByText(/reviews\.requester\.cannotSelfAssign/),
    ).toBeInTheDocument();

    // Restore the default AssigneeCombobox mock for the remaining tests.
    vi.doUnmock("./AssigneeCombobox");
    vi.resetModules();
  });

  it("(g) initialValues prefills assignee + targetStateId but not comment", () => {
    const initialAssignee: AssigneeOption = {
      kind: "role",
      id: 7,
      name: "Tester",
      userCount: 3,
    };
    render(
      <RequestReviewSheet
        {...makeProps({
          reachableGatedStates: [
            reachableState({ id: 11 }),
            reachableState({ id: 22, name: "Final Review" }),
          ],
          initialValues: { assignee: initialAssignee, targetStateId: 22 },
        })}
      />,
    );

    // Assignee stub renders the pre-filled value as data-value attribute.
    const assignee = screen.getByTestId("request-review-assignee");
    expect(assignee.getAttribute("data-value")).toBe("role:7");

    // Comment is reset (D-08 pre-fill rule).
    const comment = screen.getByTestId(
      "request-review-comment",
    ) as HTMLTextAreaElement;
    expect(comment.value).toBe("");
  });
});
