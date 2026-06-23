import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseFindManyIssue, mockUseUpsertIssue, mockUpsertAsync } =
  vi.hoisted(() => ({
    mockUseFindManyIssue: vi.fn(),
    mockUseUpsertIssue: vi.fn(),
    mockUpsertAsync: vi.fn(),
  }));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    issue: { useFindMany: mockUseFindManyIssue, useUpsert: mockUseUpsertIssue },
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key.split(".").pop() ?? key,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Expose externalUrl through the DOM so tests can assert on it.
vi.mock("@/components/tables/IssuesDisplay", () => ({
  IssuesDisplay: ({ id, externalUrl }: any) => (
    <a data-testid={`issue-${id}`} data-external-url={externalUrl ?? ""}>
      issue-{id}
    </a>
  ),
}));

vi.mock("@/components/ui/async-combobox", () => ({
  AsyncCombobox: ({ placeholder }: any) => (
    <div data-testid="async-combobox">{placeholder}</div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, type, disabled, ...rest }: any) => (
    <button
      type={type || "button"}
      onClick={onClick}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/input", () => ({
  Input: React.forwardRef<HTMLInputElement, any>((props, ref) => (
    <input ref={ref} {...props} />
  )),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...rest }: any) => <label {...rest}>{children}</label>,
}));

import { ManageSimpleUrlIssues } from "./ManageSimpleUrlIssues";

const BASE_URL = "https://tracker.test/issues/{issueId}";

const baseProps = {
  projectId: 1,
  projectIntegrationId: 10,
  integrationId: 20,
  linkedIssueIds: [] as number[],
  setLinkedIssueIds: vi.fn(),
};

function openAddDialog() {
  // Link Issue → Create New Issue → Add dialog
  fireEvent.click(screen.getByRole("button", { name: /linkIssue/i }));
  fireEvent.click(screen.getByRole("button", { name: /createNewIssue/i }));
}

describe("ManageSimpleUrlIssues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseFindManyIssue.mockReturnValue({ data: [], refetch: vi.fn() });
    mockUseUpsertIssue.mockReturnValue({ mutateAsync: mockUpsertAsync });
    mockUpsertAsync.mockResolvedValue({ id: 99 });
  });

  it("creates an issue WITHOUT an externalUrl field", async () => {
    render(
      <ManageSimpleUrlIssues {...baseProps} config={{ baseUrl: BASE_URL }} />
    );

    openAddDialog();

    // Two text inputs in the add dialog: issueId, issueTitle
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "ISSUE-42" } });
    fireEvent.change(inputs[1], { target: { value: "Broken login" } });

    const form = document.querySelector("form");
    if (!form) throw new Error("add-issue form not rendered");
    fireEvent.submit(form);

    await waitFor(() => expect(mockUpsertAsync).toHaveBeenCalled());

    const callArg = mockUpsertAsync.mock.calls[0][0];
    expect(callArg.create).not.toHaveProperty("externalUrl");
    expect(callArg.update).not.toHaveProperty("externalUrl");
    expect(callArg.create.externalId).toBe("ISSUE-42");
  });

  it("renders issue links from config.baseUrl, not from issue.externalUrl", () => {
    mockUseFindManyIssue.mockReturnValue({
      data: [
        {
          id: 7,
          name: "ISSUE-7",
          externalId: "ISSUE-7",
          // Stale stored value from before the render-time fix — must be ignored.
          externalUrl: "https://OLD-tracker.test/issues/ISSUE-7",
          title: "Broken login",
        },
      ],
      refetch: vi.fn(),
    });

    render(
      <ManageSimpleUrlIssues
        {...baseProps}
        linkedIssueIds={[7]}
        config={{ baseUrl: BASE_URL }}
      />
    );

    const link = screen.getByTestId("issue-7");
    expect(link.getAttribute("data-external-url")).toBe(
      "https://tracker.test/issues/ISSUE-7"
    );
  });

  it("updates rendered link when baseUrl changes (admin edits Base URL)", () => {
    mockUseFindManyIssue.mockReturnValue({
      data: [
        {
          id: 7,
          name: "ISSUE-7",
          externalId: "ISSUE-7",
          externalUrl: null,
          title: "Broken login",
        },
      ],
      refetch: vi.fn(),
    });

    const { rerender } = render(
      <ManageSimpleUrlIssues
        {...baseProps}
        linkedIssueIds={[7]}
        config={{ baseUrl: "https://v1.test/{issueId}" }}
      />
    );

    expect(
      screen.getByTestId("issue-7").getAttribute("data-external-url")
    ).toBe("https://v1.test/ISSUE-7");

    rerender(
      <ManageSimpleUrlIssues
        {...baseProps}
        linkedIssueIds={[7]}
        config={{ baseUrl: "https://v2.test/{issueId}" }}
      />
    );

    expect(
      screen.getByTestId("issue-7").getAttribute("data-external-url")
    ).toBe("https://v2.test/ISSUE-7");
  });

  it("add-dialog URL preview reflects the typed issue ID", async () => {
    render(
      <ManageSimpleUrlIssues {...baseProps} config={{ baseUrl: BASE_URL }} />
    );

    openAddDialog();

    // Placeholder ID before typing
    expect(
      screen.getByText(/https:\/\/tracker\.test\/issues\/ISSUE-123/)
    ).toBeTruthy();

    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "FOO-9" } });

    await waitFor(() =>
      expect(
        screen.getByText(/https:\/\/tracker\.test\/issues\/FOO-9/)
      ).toBeTruthy()
    );
  });
});
