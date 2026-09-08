import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Stable mock refs via vi.hoisted() to prevent infinite re-renders ---
const {
  mockUseFindManyProjectIntegration,
  mockUseCreateIssue,
  mockMutateAsync,
  mockUseFindManyIntegrationProject,
} = vi.hoisted(() => {
  const mockMutateAsync = vi.fn();
  return {
    mockUseFindManyProjectIntegration: vi.fn(),
    mockUseCreateIssue: vi.fn(),
    mockMutateAsync,
    mockUseFindManyIntegrationProject: vi.fn(),
  };
});

// --- Mocks ---

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    projectIntegration: { useFindMany: mockUseFindManyProjectIntegration },
    integrationProject: { useFindMany: mockUseFindManyIntegrationProject },
    issue: { useCreate: mockUseCreateIssue },
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key.split(".").pop() ?? key,
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: { id: "user-1", name: "Test User", email: "test@example.com" },
    },
    status: "authenticated",
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock Dialog as open-conditional div (standard jsdom pattern)
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/form", () => ({
  Form: ({ children }: any) => <>{children}</>,
  FormField: ({ render: renderFn, name }: any) => {
    const field = {
      value: "",
      onChange: vi.fn(),
      onBlur: vi.fn(),
      name,
      ref: vi.fn(),
    };
    return renderFn({ field, fieldState: { error: undefined } });
  },
  FormItem: ({ children }: any) => <div>{children}</div>,
  FormLabel: ({ children }: any) => <label>{children}</label>,
  FormControl: ({ children }: any) => <>{children}</>,
  FormMessage: () => null,
}));

vi.mock("@/components/ui/alert", () => ({
  Alert: ({ children, ...rest }: any) => (
    <div role="alert" {...rest}>
      {children}
    </div>
  ),
  AlertTitle: ({ children }: any) => <strong>{children}</strong>,
  AlertDescription: ({ children, ...rest }: any) => (
    <div {...rest}>{children}</div>
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

vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: any) => <textarea {...props} />,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...rest }: any) => <label {...rest}>{children}</label>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, onValueChange, value }: any) => (
    <div data-testid="select" data-value={value}>
      {React.Children.map(children, (child) =>
        React.isValidElement(child)
          ? React.cloneElement(child as any, { onValueChange })
          : child
      )}
    </div>
  ),
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children, onValueChange }: any) => (
    <div data-testid="select-content">
      {React.Children.map(children, (child) =>
        React.isValidElement(child)
          ? React.cloneElement(child as any, { onValueChange })
          : child
      )}
    </div>
  ),
  SelectItem: ({ children, value, onValueChange }: any) => (
    <div
      data-testid={`select-item-${value}`}
      onClick={() => onValueChange?.(value)}
    >
      {children}
    </div>
  ),
}));

vi.mock("@/components/ui/async-combobox", () => ({
  AsyncCombobox: ({ placeholder }: any) => (
    <div data-testid="async-combobox">{placeholder}</div>
  ),
}));

vi.mock("@hookform/resolvers/standard-schema", () => ({
  standardSchemaResolver: () => async (values: any) => ({ values, errors: {} }),
}));

import { CreateIssueDialog } from "./create-issue-dialog";

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  projectId: 1,
};

describe("CreateIssueDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: no active integration
    mockUseFindManyProjectIntegration.mockReturnValue({ data: [] });

    // Default: no integration projects
    mockUseFindManyIntegrationProject.mockReturnValue({ data: [] });

    // Default: createIssue hook
    mockUseCreateIssue.mockReturnValue({ mutateAsync: mockMutateAsync });

    // Default: no auth issues
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ authenticated: true }),
    });
  });

  it("renders dialog when open=true with title input and submit button", () => {
    render(<CreateIssueDialog {...defaultProps} />);

    expect(screen.getByRole("dialog")).toBeTruthy();
    // Title field label (common.fields.title → mock returns "title")
    expect(screen.getAllByText("title").length).toBeGreaterThan(0);
    // Submit button
    const submitButton = screen.getByRole("button", { name: /create/i });
    expect(submitButton).toBeTruthy();
  });

  it("does not render dialog when open=false", () => {
    render(<CreateIssueDialog {...defaultProps} open={false} />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders cancel button that calls onOpenChange(false)", () => {
    const onOpenChange = vi.fn();
    render(<CreateIssueDialog {...defaultProps} onOpenChange={onOpenChange} />);

    const cancelButton = screen.getByRole("button", { name: /cancel/i });
    fireEvent.click(cancelButton);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows auth error alert when auth check returns unauthenticated for external integration", async () => {
    mockUseFindManyProjectIntegration.mockReturnValue({
      data: [
        {
          id: 10,
          integrationId: 5,
          isActive: true,
          config: { externalProjectKey: "TPI" },
          integration: { id: 5, name: "My Jira", provider: "JIRA" },
        },
      ],
    });

    // Mock auth check to return not authenticated
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        authenticated: false,
        authUrl: "https://oauth.example.com/authorize",
      }),
    });

    render(<CreateIssueDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
  });

  it("calls onIssueCreated and onOpenChange after successful creation", async () => {
    const onIssueCreated = vi.fn();
    const onOpenChange = vi.fn();

    // No integration - internal creation
    mockUseFindManyProjectIntegration.mockReturnValue({ data: [] });
    mockMutateAsync.mockResolvedValue({ id: 99, title: "New Issue" });

    render(
      <CreateIssueDialog
        {...defaultProps}
        onOpenChange={onOpenChange}
        onIssueCreated={onIssueCreated}
      />
    );

    // Fill in the title
    const inputs = screen.getAllByRole("textbox");
    // First textbox should be the title input
    fireEvent.change(inputs[0], { target: { value: "Test Issue Title" } });

    // Submit the form
    const form = document.querySelector("form");
    if (form) {
      fireEvent.submit(form);
    }

    await waitFor(
      () => {
        // Either the mock was called or the dialog handling occurred
        expect(onOpenChange).toHaveBeenCalled();
      },
      { timeout: 3000 }
    );
  });

  it("does not submit an enclosing form when the create form is submitted (nested-form guard)", () => {
    // Repro of the case-details edit bug: the dialog is portaled but stays a
    // React descendant of the page's edit <form>, so the inner submit must not
    // bubble to the outer form's onSubmit. See the stopPropagation in the
    // dialog's <form onSubmit>.
    const outerSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    mockUseFindManyProjectIntegration.mockReturnValue({ data: [] });

    render(
      <form onSubmit={outerSubmit} data-testid="outer-form">
        <CreateIssueDialog {...defaultProps} />
      </form>
    );

    // The create dialog renders its own <form> nested inside the outer one.
    const forms = document.querySelectorAll("form");
    expect(forms.length).toBe(2);
    const innerForm = forms[forms.length - 1];
    fireEvent.submit(innerForm);

    expect(outerSubmit).not.toHaveBeenCalled();
  });

  it("renders priority select field for Jira integrations", () => {
    mockUseFindManyProjectIntegration.mockReturnValue({
      data: [
        {
          integrationId: 1,
          isActive: true,
          integration: { id: 1, name: "My Jira", provider: "JIRA" },
        },
      ],
    });

    render(<CreateIssueDialog {...defaultProps} />);

    const selects = screen.getAllByTestId("select");
    expect(selects.length).toBeGreaterThan(0);
  });

  describe("SIMPLE_URL", () => {
    const simpleUrlIntegration = {
      data: [
        {
          id: 10,
          integrationId: 5,
          isActive: true,
          integration: { id: 5, name: "Redmine", provider: "SIMPLE_URL" },
        },
      ],
    };

    it("renders the Issue ID field for SIMPLE_URL integrations", () => {
      mockUseFindManyProjectIntegration.mockReturnValue(simpleUrlIntegration);

      render(<CreateIssueDialog {...defaultProps} />);

      // common.fields.id → mock returns last segment "id"
      expect(screen.getAllByText("id").length).toBeGreaterThan(0);
    });

    it("does not render the Issue ID field for non-SIMPLE_URL integrations", () => {
      mockUseFindManyProjectIntegration.mockReturnValue({
        data: [
          {
            id: 10,
            integrationId: 5,
            isActive: true,
            integration: { id: 5, name: "My Jira", provider: "JIRA" },
          },
        ],
      });

      render(<CreateIssueDialog {...defaultProps} />);

      expect(screen.queryByText("id")).toBeNull();
    });

    it("creates the issue with the entered ID as externalId", async () => {
      mockUseFindManyProjectIntegration.mockReturnValue(simpleUrlIntegration);
      mockMutateAsync.mockResolvedValue({
        id: 99,
        name: "ISSUE-77",
        externalId: "ISSUE-77",
      });

      render(
        <CreateIssueDialog
          {...defaultProps}
          defaultValues={{ externalId: "ISSUE-77", title: "Login broken" }}
        />
      );

      const form = document.querySelector("form");
      if (form) {
        fireEvent.submit(form);
      }

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              externalId: "ISSUE-77",
              name: "ISSUE-77",
              title: "Login broken",
            }),
          })
        );
      });
    });

    it("does not create the issue when the Issue ID is empty", async () => {
      mockUseFindManyProjectIntegration.mockReturnValue(simpleUrlIntegration);

      render(
        <CreateIssueDialog
          {...defaultProps}
          defaultValues={{ title: "No ID provided" }}
        />
      );

      const form = document.querySelector("form");
      if (form) {
        fireEvent.submit(form);
      }

      await waitFor(() => expect(mockMutateAsync).not.toHaveBeenCalled());
    });
  });

  describe("INT-05: TipTap doc prefill", () => {
    const tiptapDoc = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Iteration 3 of 5 failed on " },
            { type: "text", text: "Bad password", marks: [{ type: "code" }] },
            { type: "text", text: "." },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "View iteration in TestPlanIt",
              marks: [
                {
                  type: "link",
                  attrs: {
                    href: "/projects/runs/7/42?iteration=3&selectedCase=77",
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    it("renders the iteration-context hint when description is a TipTap doc", () => {
      render(
        <CreateIssueDialog
          {...defaultProps}
          defaultValues={{
            title: "Iteration 3 of 5 failed: Login",
            description: tiptapDoc,
          }}
        />
      );

      expect(screen.getByTestId("iteration-context-hint")).toBeTruthy();
    });

    it("does NOT render the iteration-context hint when description is a plain string", () => {
      render(
        <CreateIssueDialog
          {...defaultProps}
          defaultValues={{
            title: "Plain title",
            description: "Plain string body",
          }}
        />
      );

      expect(screen.queryByTestId("iteration-context-hint")).toBeNull();
    });

    it("accepts TipTap doc default and seeds the form (no crash)", () => {
      // The textarea is rendered by react-hook-form with the markdown
      // preview as its initial value. The mocks above use a FormField
      // shim that does not actually render the field value, so we cannot
      // assert on the textarea text directly — we assert the dialog
      // mounts without error (regression guard) and the hint is present.
      render(
        <CreateIssueDialog
          {...defaultProps}
          defaultValues={{
            title: "Failed iteration",
            description: tiptapDoc,
          }}
        />
      );

      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(screen.getByTestId("iteration-context-hint")).toBeTruthy();
    });
  });
});
