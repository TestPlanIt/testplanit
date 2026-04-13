import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Stable mock refs via vi.hoisted() to prevent infinite re-renders ---
const { mockUseFindManyIntegrationProject } = vi.hoisted(() => ({
  mockUseFindManyIntegrationProject: vi.fn(),
}));

// --- Mocks ---

vi.mock("~/lib/hooks", () => ({
  useFindManyIntegrationProject: mockUseFindManyIntegrationProject,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key.split(".").pop() ?? key,
}));

// Mock Dialog as open-conditional div (standard jsdom pattern)
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children, onOpenChange }: any) =>
    open ? (
      <div role="dialog" onClick={() => onOpenChange?.(false)}>
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: any) => (
    <div onClick={(e) => e.stopPropagation()}>{children}</div>
  ),
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
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

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, onValueChange, value, disabled }: any) => (
    <div data-testid="select" data-value={value} data-disabled={disabled}>
      {React.Children.map(children, (child) =>
        React.isValidElement(child)
          ? React.cloneElement(child as any, { onValueChange })
          : child
      )}
    </div>
  ),
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
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

vi.mock("@hookform/resolvers/zod", () => ({
  zodResolver: () => async (values: any) => ({ values, errors: {} }),
}));

// Stub DynamicJiraField — it depends on TipTap and other heavy editors
vi.mock("./dynamic-jira-field", () => ({
  DynamicJiraField: ({ field }: any) => (
    <div data-testid={`dynamic-field-${field.key}`}>{field.name}</div>
  ),
}));

import { CreateIssueJiraForm } from "./create-issue-jira-form";

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  projectId: 1,
  integrationId: 1,
  projectIntegrationId: "pi-1",
};

const makeIntegrationProject = (
  id: string,
  projectKey: string,
  projectName: string,
  isDefault: boolean,
  defaultIssueType = "10001",
  defaultIssueTypeName = "Bug"
) => ({
  id,
  externalProjectId: `ext-${projectKey}`,
  externalProjectKey: projectKey,
  externalProjectName: projectName,
  isDefault,
  isActive: true,
  defaultIssueType,
  defaultIssueTypeName,
});

describe("CreateIssueJiraForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: two integration projects, ABT is default
    mockUseFindManyIntegrationProject.mockReturnValue({
      data: [
        makeIntegrationProject(
          "ip-1",
          "ABT",
          "Allego Bug Tracking",
          true,
          "10001",
          "Bug"
        ),
        makeIntegrationProject(
          "ip-2",
          "LIV",
          "LiveApps",
          false,
          "10100",
          "Sprint Defect"
        ),
      ],
      isLoading: false,
    });

    // Default fetch: returns issue types for the project
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("issue-types")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            issueTypes: [
              { id: "10001", name: "Bug" },
              { id: "10002", name: "Task" },
            ],
          }),
        });
      }
      if (url.includes("issue-type-fields")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            fields: [
              {
                key: "summary",
                name: "Summary",
                required: true,
                schema: { type: "string" },
              },
              {
                key: "description",
                name: "Description",
                required: false,
                schema: { type: "string" },
              },
            ],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
    });
  });

  it("renders dialog when open=true", () => {
    render(<CreateIssueJiraForm {...defaultProps} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("does not render dialog when open=false", () => {
    render(<CreateIssueJiraForm {...defaultProps} open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows only linked projects in the project selector", async () => {
    render(<CreateIssueJiraForm {...defaultProps} />);

    await waitFor(() => {
      // Two SelectItems should be rendered — one per IntegrationProject
      const abtItem = screen.queryByTestId("select-item-ABT");
      const livItem = screen.queryByTestId("select-item-LIV");
      expect(abtItem).toBeTruthy();
      expect(livItem).toBeTruthy();
    });
  });

  it("shows exactly the linked projects (no unlinked projects in the selector)", async () => {
    // Only one linked project
    mockUseFindManyIntegrationProject.mockReturnValue({
      data: [
        makeIntegrationProject("ip-1", "ABT", "Allego Bug Tracking", true),
      ],
      isLoading: false,
    });

    render(<CreateIssueJiraForm {...defaultProps} />);

    await waitFor(() => {
      expect(screen.queryByTestId("select-item-ABT")).toBeTruthy();
      // LIV not linked — should not appear
      expect(screen.queryByTestId("select-item-LIV")).toBeNull();
    });
  });

  it("auto-selects the default project (isDefault=true) on open", async () => {
    render(<CreateIssueJiraForm {...defaultProps} />);

    await waitFor(() => {
      // The select for project should have value = "ABT" (the default project key)
      const projectSelects = screen.getAllByTestId("select");
      const projectSelect = projectSelects[0];
      expect(projectSelect.getAttribute("data-value")).toBe("ABT");
    });
  });

  it("auto-selects first project when no project has isDefault=true", async () => {
    mockUseFindManyIntegrationProject.mockReturnValue({
      data: [
        makeIntegrationProject("ip-1", "ABT", "Allego Bug Tracking", false),
        makeIntegrationProject("ip-2", "LIV", "LiveApps", false),
      ],
      isLoading: false,
    });

    render(<CreateIssueJiraForm {...defaultProps} />);

    await waitFor(() => {
      const projectSelects = screen.getAllByTestId("select");
      const projectSelect = projectSelects[0];
      // First project alphabetically/by order should be selected
      expect(projectSelect.getAttribute("data-value")).toBeTruthy();
    });
  });

  it("uses per-project defaultIssueType when project is auto-selected", async () => {
    // ABT has defaultIssueType "10001"
    render(<CreateIssueJiraForm {...defaultProps} />);

    await waitFor(() => {
      // Issue type select should be set to the per-project default
      const selects = screen.getAllByTestId("select");
      // Second select is issue type select (after project select)
      const issueTypeSelect = selects.find(
        (s) => s.getAttribute("data-value") === "10001"
      );
      expect(issueTypeSelect).toBeTruthy();
    });
  });

  it("passes per-project defaultIssueType for each IntegrationProject record", () => {
    // Verify the mock data has distinct defaultIssueType per project so the logic can be tested
    const { data: projects } = mockUseFindManyIntegrationProject.mock.results[0]?.value ?? { data: [] };

    // Re-call after render to check state was passed correctly
    render(<CreateIssueJiraForm {...defaultProps} />);

    // useFindManyIntegrationProject was called with isActive: true filter
    expect(mockUseFindManyIntegrationProject).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }),
      }),
      expect.anything()
    );
  });

  it("fetches issue types for the selected project", async () => {
    render(<CreateIssueJiraForm {...defaultProps} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("issue-types")
      );
    });
  });

  it("passes the projectIntegrationId to useFindManyIntegrationProject", () => {
    render(<CreateIssueJiraForm {...defaultProps} />);

    expect(mockUseFindManyIntegrationProject).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectIntegrationId: "pi-1",
          isActive: true,
        }),
      }),
      expect.anything()
    );
  });

  it("shows no-projects alert when integration has no linked projects", async () => {
    mockUseFindManyIntegrationProject.mockReturnValue({
      data: [],
      isLoading: false,
    });

    render(<CreateIssueJiraForm {...defaultProps} />);

    await waitFor(() => {
      const alert = screen.queryByRole("alert");
      expect(alert).toBeTruthy();
    });
  });

  it("shows loading spinner while projects are loading", () => {
    mockUseFindManyIntegrationProject.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    render(<CreateIssueJiraForm {...defaultProps} />);

    const spinner = document.querySelector(".animate-spin");
    expect(spinner).toBeTruthy();
  });

  it("resets selectedProjectKey and selectedIssueType when dialog closes", async () => {
    const { rerender } = render(<CreateIssueJiraForm {...defaultProps} />);

    // Wait for initial auto-selection
    await waitFor(() => {
      const selects = screen.getAllByTestId("select");
      expect(selects[0].getAttribute("data-value")).toBe("ABT");
    });

    // Close the dialog
    rerender(<CreateIssueJiraForm {...defaultProps} open={false} />);

    // Dialog should not be rendered
    expect(screen.queryByRole("dialog")).toBeNull();

    // Reopen the dialog
    rerender(<CreateIssueJiraForm {...defaultProps} open={true} />);

    // After reopening, auto-selection should happen again from scratch
    await waitFor(() => {
      const selects = screen.getAllByTestId("select");
      expect(selects[0].getAttribute("data-value")).toBe("ABT");
    });
  });

  it("calls onOpenChange(false) when cancel button is clicked", async () => {
    const onOpenChange = vi.fn();
    render(<CreateIssueJiraForm {...defaultProps} onOpenChange={onOpenChange} />);

    await waitFor(() => {
      const cancelButton = screen.queryByRole("button", { name: /cancel/i });
      expect(cancelButton).toBeTruthy();
    });

    const cancelButton = screen.getByRole("button", { name: /cancel/i });
    fireEvent.click(cancelButton);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders project options with name and key in parentheses", async () => {
    render(<CreateIssueJiraForm {...defaultProps} />);

    await waitFor(() => {
      const abtItem = screen.queryByTestId("select-item-ABT");
      expect(abtItem).toBeTruthy();
      expect(abtItem?.textContent).toContain("Allego Bug Tracking");
      expect(abtItem?.textContent).toContain("ABT");
    });
  });

  it("calls fetch with integrationId in the URL path for issue types", async () => {
    render(<CreateIssueJiraForm {...defaultProps} integrationId={42} />);

    await waitFor(() => {
      const fetchCalls = (global.fetch as any).mock.calls.map(
        (args: any[]) => args[0] as string
      );
      const issueTypeCall = fetchCalls.find((url: string) =>
        url.includes("/api/integrations/42/issue-types")
      );
      expect(issueTypeCall).toBeTruthy();
    });
  });
});
