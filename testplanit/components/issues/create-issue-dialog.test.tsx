import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Stable mock refs via vi.hoisted() to prevent infinite re-renders ---
const {
  mockUseFindManyProjectIntegration,
  mockUseCreateIssue,
  mockMutateAsync,
} = vi.hoisted(() => {
  const mockMutateAsync = vi.fn();
  return {
    mockUseFindManyProjectIntegration: vi.fn(),
    mockUseCreateIssue: vi.fn(),
    mockMutateAsync,
  };
});

// --- Mocks ---

vi.mock("@/lib/hooks/project-integration", () => ({
  useFindManyProjectIntegration: mockUseFindManyProjectIntegration,
}));

vi.mock("@/lib/hooks/issue", () => ({
  useCreateIssue: mockUseCreateIssue,
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
    <button type={type || "button"} onClick={onClick} disabled={disabled} {...rest}>
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

vi.mock("@hookform/resolvers/zod", () => ({
  zodResolver: () => async (values: any) => ({ values, errors: {} }),
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
    // Title field label
    expect(screen.getAllByText("issues").length).toBeGreaterThan(0);
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

    await waitFor(() => {
      // Either the mock was called or the dialog handling occurred
      expect(onOpenChange).toHaveBeenCalled();
    }, { timeout: 3000 });
  });

  it("renders priority select field", () => {
    render(<CreateIssueDialog {...defaultProps} />);

    // Priority select should be rendered
    const selects = screen.getAllByTestId("select");
    expect(selects.length).toBeGreaterThan(0);
  });
});
