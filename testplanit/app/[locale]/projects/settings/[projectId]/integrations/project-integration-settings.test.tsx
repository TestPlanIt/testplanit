import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Stable mock refs via vi.hoisted() ---
const {
  mockFindMany,
  mockFindManyWebhookConfig,
  mockUpdate,
  mockUpsert,
  mockUpdatePI,
  mockRemoveIntegrationProjectMapping,
} = vi.hoisted(() => {
  return {
    mockFindMany: vi.fn(),
    mockFindManyWebhookConfig: vi.fn(() => ({
      data: [],
      refetch: vi.fn().mockResolvedValue({ data: [] }),
    })),
    mockUpdate: vi.fn(),
    mockUpsert: vi.fn(),
    mockUpdatePI: vi.fn(),
    mockRemoveIntegrationProjectMapping: vi.fn().mockResolvedValue({
      success: true,
      cascadedToParent: false,
      inboundWebhookDeletedCount: 0,
    }),
  };
});

// --- Mocks ---

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    integrationProject: {
      useFindMany: (...args: any[]) => mockFindMany(...args),
      useUpdate: () => ({ mutateAsync: mockUpdate }),
      useUpsert: () => ({ mutateAsync: mockUpsert }),
    },
    webhookConfig: { useFindMany: () => mockFindManyWebhookConfig() },
    projectIntegration: { useUpdate: () => ({ mutateAsync: mockUpdatePI }) },
    // Consumed by RequirementsConfigSettings, mounted as a section here.
    issue: { useCount: () => ({ data: 0 }) },
  }),
}));

vi.mock("~/app/actions/project-integration", () => ({
  removeIntegrationProjectMapping: (...args: any[]) =>
    mockRemoveIntegrationProjectMapping(...args),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

// Consumed by MilestoneSyncSettings, mounted as a section here.
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1" } } }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, any>) => {
    let result = key.split(".").pop() ?? key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        result = result.replace(`{${k}}`, String(v));
      });
    }
    return result;
  },
}));

// Mock shadcn/ui components to avoid JSDOM rendering issues
vi.mock("@/components/ui/card", () => ({
  Card: ({ children, className }: any) => (
    <div data-testid="card" className={className}>
      {children}
    </div>
  ),
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children, className }: any) => (
    <h2 className={className}>{children}</h2>
  ),
  CardDescription: ({ children }: any) => <p>{children}</p>,
  CardContent: ({ children, className }: any) => (
    <div className={className}>{children}</div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, variant, size, ...rest }: any) => (
    <button
      onClick={onClick}
      disabled={disabled}
      data-variant={variant}
      data-size={size}
      {...rest}
    >
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, variant, className }: any) => (
    <span data-testid="badge" data-variant={variant} className={className}>
      {children}
    </span>
  ),
}));

vi.mock("@/components/ui/alert", () => ({
  Alert: ({ children }: any) => <div role="alert">{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...rest }: any) => <label {...rest}>{children}</label>,
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: any) => <>{children}</>,
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children, asChild }: any) => {
    if (asChild && React.isValidElement(children)) {
      return children;
    }
    return <span>{children}</span>;
  },
  TooltipContent: ({ children }: any) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

vi.mock("@/components/ui/async-combobox", () => ({
  AsyncCombobox: ({ placeholder }: any) => (
    <div data-testid="async-combobox">{placeholder}</div>
  ),
}));

vi.mock("@/components/ui/multi-async-combobox", () => ({
  MultiAsyncCombobox: ({ placeholder, onValueChange }: any) => (
    <div data-testid="multi-async-combobox">
      <span>{placeholder}</span>
      <button
        data-testid="mock-select-project"
        onClick={() =>
          onValueChange?.([{ id: "ext-99", key: "NEW", name: "New Project" }])
        }
      >
        Select project
      </button>
    </div>
  ),
}));

// Import the component after all mocks
import { ProjectIntegrationSettings } from "./project-integration-settings";

// --- Default props ---

const defaultProps = {
  projectIntegration: {
    id: "pi-1",
    projectId: 1,
    integrationId: 1,
    config: {},
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any,
  integration: {
    id: 1,
    name: "Test Jira",
    provider: "JIRA",
  } as any,
};

// --- Helpers ---

function mockAuthSuccess() {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (String(url).includes("/auth/check")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ authenticated: true }),
      });
    }
    if (String(url).includes("/projects")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          projects: [
            { id: "ext-1", key: "EXT1", name: "External Project 1" },
            { id: "ext-2", key: "EXT2", name: "External Project 2" },
          ],
        }),
      });
    }
    return Promise.resolve({ ok: false, json: async () => ({}) });
  });
}

describe("ProjectIntegrationSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthSuccess();

    // Default: loaded with 2 projects
    mockFindMany.mockReturnValue({
      data: [
        {
          id: "ip-1",
          externalProjectName: "Project A",
          externalProjectKey: "PA",
          externalProjectId: "ext-a",
          isDefault: true,
          isActive: true,
          syncStatus: null,
          syncError: null,
          defaultIssueType: null,
          defaultIssueTypeName: null,
          projectIntegrationId: "pi-1",
        },
        {
          id: "ip-2",
          externalProjectName: "Project B",
          externalProjectKey: "PB",
          externalProjectId: "ext-b",
          isDefault: false,
          isActive: true,
          syncStatus: "completed",
          syncError: null,
          defaultIssueType: null,
          defaultIssueTypeName: null,
          projectIntegrationId: "pi-1",
        },
      ],
      isLoading: false,
    });
  });

  // --- Test 1: Renders linked projects list ---
  it("renders linked project names and key badges when data is loaded", () => {
    mockFindMany.mockReturnValue({
      data: [
        {
          id: "ip-1",
          externalProjectName: "Project A",
          externalProjectKey: "PA",
          externalProjectId: "ext-a",
          isDefault: true,
          isActive: true,
          syncStatus: null,
          syncError: null,
          defaultIssueType: null,
          defaultIssueTypeName: null,
          projectIntegrationId: "pi-1",
        },
        {
          id: "ip-2",
          externalProjectName: "Project B",
          externalProjectKey: "PB",
          externalProjectId: "ext-b",
          isDefault: false,
          isActive: true,
          syncStatus: null,
          syncError: null,
          defaultIssueType: null,
          defaultIssueTypeName: null,
          projectIntegrationId: "pi-1",
        },
        {
          id: "ip-3",
          externalProjectName: "Project C",
          externalProjectKey: "PC",
          externalProjectId: "ext-c",
          isDefault: false,
          isActive: true,
          syncStatus: null,
          syncError: null,
          defaultIssueType: null,
          defaultIssueTypeName: null,
          projectIntegrationId: "pi-1",
        },
      ],
      isLoading: false,
    });

    render(<ProjectIntegrationSettings {...defaultProps} />);

    expect(screen.getByText("Project A")).toBeTruthy();
    expect(screen.getByText("Project B")).toBeTruthy();
    expect(screen.getByText("Project C")).toBeTruthy();

    const badges = screen.getAllByTestId("badge");
    const badgeTexts = badges.map((b) => b.textContent);
    expect(badgeTexts).toContain("PA");
    expect(badgeTexts).toContain("PB");
    expect(badgeTexts).toContain("PC");
  });

  // --- Test 2: Shows empty state with Add Projects button ---
  it("shows Add Projects button when no linked projects exist", () => {
    mockFindMany.mockReturnValue({ data: [], isLoading: false });

    render(<ProjectIntegrationSettings {...defaultProps} />);

    // Should show "addProjects" button (translation returns last key segment)
    expect(screen.getByText("addProjects")).toBeTruthy();
  });

  // --- Test 3: Shows loading skeleton ---
  it("shows loading skeleton when isLoadingLinkedProjects is true", () => {
    mockFindMany.mockReturnValue({ data: undefined, isLoading: true });

    render(<ProjectIntegrationSettings {...defaultProps} />);

    // No project names rendered
    expect(screen.queryByText("Project A")).toBeNull();
    // No add projects button
    expect(screen.queryByText("addProjects")).toBeNull();

    // The skeleton divs have animate-pulse class
    const { container } = render(
      <ProjectIntegrationSettings {...defaultProps} />
    );
    const skeletons = container.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  // --- Test 4: Default star on default project ---
  it("renders a filled star (isDefault=true) for the default project", () => {
    render(<ProjectIntegrationSettings {...defaultProps} />);

    // Default project (ip-1) should show filled star via Lucide Star component.
    // The non-default project should show a button with an aria-label for setting default.
    const setDefaultButtons = screen.getAllByRole("button", {
      name: /setAsDefault/i,
    });
    // Only Project B (non-default) has the set-as-default button
    expect(setDefaultButtons.length).toBe(1);
  });

  // --- Test 5: Remove button triggers confirmation ---
  it("clicking Trash2 remove button shows inline confirmation text", () => {
    render(<ProjectIntegrationSettings {...defaultProps} />);

    // The remove buttons are destructive icon buttons (no accessible name — icon only)
    const removeButtons = document.querySelectorAll(
      'button[data-variant="destructive"][data-size="icon"]'
    );
    expect(removeButtons.length).toBeGreaterThan(0);

    // Click the first remove button (Project A)
    fireEvent.click(removeButtons[0]);

    // Should show confirmation text
    expect(screen.getByText("removeProjectConfirmation")).toBeTruthy();
  });

  // --- Test 6: Set default calls updateIntegrationProject ---
  it("clicking the outline star calls updateIntegrationProject with isDefault:true", async () => {
    mockUpdate.mockResolvedValue({});

    render(<ProjectIntegrationSettings {...defaultProps} />);

    const setDefaultButton = screen.getByRole("button", {
      name: /setAsDefault/i,
    });
    fireEvent.click(setDefaultButton);

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "ip-2" },
          data: { isDefault: true },
        })
      );
    });
  });

  // --- Test 7: Remove calls server-side cascade action ---
  it("confirming remove calls removeIntegrationProjectMapping with the IntegrationProject id", async () => {
    mockUpdate.mockResolvedValue({});

    const { container } = render(
      <ProjectIntegrationSettings {...defaultProps} />
    );

    // Click remove button for first project (destructive icon buttons have no accessible name)
    const removeButtons = container.querySelectorAll(
      'button[data-variant="destructive"][data-size="icon"]'
    );
    expect(removeButtons.length).toBeGreaterThan(0);
    fireEvent.click(removeButtons[0]);

    // Confirmation shown — click confirm button
    const confirmButton = screen.getByText("confirmRemove");
    fireEvent.click(confirmButton);

    await waitFor(() => {
      // The server action wraps mapping deactivation + cascade in a
      // transaction; client-side updateIntegrationProject is no longer
      // the deactivation path (it is still used for default-promotion
      // when other mappings remain).
      expect(mockRemoveIntegrationProjectMapping).toHaveBeenCalledWith("ip-1");
    });
  });

  // --- Test 8: Add Projects shows MultiAsyncCombobox ---
  it("clicking Add Projects reveals the MultiAsyncCombobox", () => {
    // Start with data (so add button is in 'has projects' state below list)
    render(<ProjectIntegrationSettings {...defaultProps} />);

    // The add-projects panel itself should not be showing yet. (Requirement
    // Types renders its own always-present MultiAsyncCombobox as a sibling
    // section now, so the bare "multi-async-combobox" testid is no longer
    // unique to this panel — scope through the panel's own testid instead.)
    expect(screen.queryByTestId("add-projects-panel")).toBeNull();

    const addButton = screen.getByText("addProjects");
    fireEvent.click(addButton);

    const panel = screen.getByTestId("add-projects-panel");
    expect(within(panel).getByTestId("multi-async-combobox")).toBeTruthy();
  });

  // --- Test 9: Handles undefined data gracefully ---
  it("shows Add Projects button (empty state) when data is undefined and not loading", () => {
    mockFindMany.mockReturnValue({ data: undefined, isLoading: false });

    render(<ProjectIntegrationSettings {...defaultProps} />);

    // Should show empty state with Add Projects button, not crash
    expect(screen.getByText("addProjects")).toBeTruthy();
  });

  // --- Test 10: Auth check failure shows authorization required screen ---
  it("shows authorization required screen when auth check fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false });

    render(<ProjectIntegrationSettings {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("authorizationRequired")).toBeTruthy();
    });
  });

  // --- Test 11: SIMPLE_URL provider does not show linked projects section ---
  it("does not show linked projects section for SIMPLE_URL provider", () => {
    const simpleUrlProps = {
      ...defaultProps,
      integration: { ...defaultProps.integration, provider: "SIMPLE_URL" },
    };

    render(<ProjectIntegrationSettings {...simpleUrlProps} />);

    // The linked projects card should not appear
    expect(screen.queryByText("linkedProjects")).toBeNull();
    // Should show simple URL description
    expect(screen.getByText("simpleUrlDescription")).toBeTruthy();
  });

  // --- Test 12: Sync status badges render correctly ---
  it("renders sync status badge for completed and syncing projects", () => {
    mockFindMany.mockReturnValue({
      data: [
        {
          id: "ip-1",
          externalProjectName: "Syncing Project",
          externalProjectKey: "SP",
          externalProjectId: "ext-sp",
          isDefault: true,
          isActive: true,
          syncStatus: "syncing",
          syncError: null,
          defaultIssueType: null,
          defaultIssueTypeName: null,
          projectIntegrationId: "pi-1",
        },
        {
          id: "ip-2",
          externalProjectName: "Done Project",
          externalProjectKey: "DP",
          externalProjectId: "ext-dp",
          isDefault: false,
          isActive: true,
          syncStatus: "completed",
          syncError: null,
          defaultIssueType: null,
          defaultIssueTypeName: null,
          projectIntegrationId: "pi-1",
        },
      ],
      isLoading: false,
    });

    render(<ProjectIntegrationSettings {...defaultProps} />);

    expect(screen.getByText("syncStatusSyncing")).toBeTruthy();
    expect(screen.getByText("syncStatusCompleted")).toBeTruthy();
  });

  // --- Test 13: handleAddProjects calls upsertIntegrationProject ---
  it("adding selected projects calls upsertIntegrationProject", async () => {
    mockUpsert.mockResolvedValue({});

    render(<ProjectIntegrationSettings {...defaultProps} />);

    // Open add panel
    const addButton = screen.getByText("addProjects");
    fireEvent.click(addButton);

    // Simulate selecting a project via the mock combobox, scoped to the add
    // panel (Requirement Types renders its own always-present combobox with
    // the same mock testids as a sibling section now).
    const panel = screen.getByTestId("add-projects-panel");
    const selectButton = within(panel).getByTestId("mock-select-project");
    fireEvent.click(selectButton);

    // Click Add Selected
    const addSelectedButton = screen.getByText("addSelected");
    fireEvent.click(addSelectedButton);

    await waitFor(() => {
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            externalProjectId: "ext-99",
            externalProjectKey: "NEW",
            externalProjectName: "New Project",
          }),
        })
      );
    });
  });

  // --- Test 14: Cancel in add panel hides the combobox ---
  it("clicking cancel in add panel hides the MultiAsyncCombobox", () => {
    render(<ProjectIntegrationSettings {...defaultProps} />);

    // Open add panel
    fireEvent.click(screen.getByText("addProjects"));
    expect(screen.getByTestId("add-projects-panel")).toBeTruthy();

    // Click cancel
    fireEvent.click(screen.getByText("cancel"));
    expect(screen.queryByTestId("add-projects-panel")).toBeNull();
  });

  // --- Test 15: Milestone Sync and Requirement Types render as sections
  // inside the same merged card ---
  it("renders Milestone Sync and Requirement Types as sections for a milestone+requirement-capable integration (JIRA)", () => {
    render(<ProjectIntegrationSettings {...defaultProps} />);

    expect(screen.getByTestId("milestone-sync-section")).toBeInTheDocument();
    expect(
      screen.getByTestId("requirements-config-section")
    ).toBeInTheDocument();
  });

  it("does not render Milestone Sync or Requirement Types sections for a non-capable integration (GITHUB)", () => {
    const githubProps = {
      ...defaultProps,
      integration: { ...defaultProps.integration, provider: "GITHUB" },
    };

    render(<ProjectIntegrationSettings {...githubProps} />);

    expect(
      screen.queryByTestId("milestone-sync-section")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("requirements-config-section")
    ).not.toBeInTheDocument();
  });

  // --- Test 16: Linked Projects save button dirty-tracking ---
  it("Linked Projects save button starts disabled, enables after an edit, and disables again after a successful save", async () => {
    mockUpdatePI.mockResolvedValue({});

    // Milestone Sync and Requirement Types render their own "save"-labeled
    // buttons as sibling sections now, so scope every query to this
    // section's own testid rather than a bare accessible-name lookup.
    const { rerender } = render(
      <ProjectIntegrationSettings {...defaultProps} />
    );
    const getSaveButton = () =>
      within(screen.getByTestId("linked-projects-section")).getByRole(
        "button",
        { name: "save" }
      );

    // No edits yet — starts disabled.
    expect(getSaveButton()).toBeDisabled();

    // A real edit to this section's Save-gated state: a mapping's default
    // issue type changes (the query refetches with the new value).
    mockFindMany.mockReturnValue({
      data: [
        {
          id: "ip-1",
          externalProjectName: "Project A",
          externalProjectKey: "PA",
          externalProjectId: "ext-a",
          isDefault: true,
          isActive: true,
          syncStatus: null,
          syncError: null,
          defaultIssueType: "epic-1",
          defaultIssueTypeName: "Epic",
          projectIntegrationId: "pi-1",
        },
        {
          id: "ip-2",
          externalProjectName: "Project B",
          externalProjectKey: "PB",
          externalProjectId: "ext-b",
          isDefault: false,
          isActive: true,
          syncStatus: "completed",
          syncError: null,
          defaultIssueType: null,
          defaultIssueTypeName: null,
          projectIntegrationId: "pi-1",
        },
      ],
      isLoading: false,
    });
    rerender(<ProjectIntegrationSettings {...defaultProps} />);

    expect(getSaveButton()).toBeEnabled();

    fireEvent.click(getSaveButton());

    await waitFor(() => expect(mockUpdatePI).toHaveBeenCalled());
    await waitFor(() => expect(getSaveButton()).toBeDisabled());
  });
});
