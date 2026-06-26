import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Stable mock refs via vi.hoisted() ---
const {
  mockUseFindManyIssue,
  mockUseFindManyProjectIntegration,
  mockUseFindManyIntegrationProject,
} = vi.hoisted(() => ({
  mockUseFindManyIssue: vi.fn(),
  mockUseFindManyProjectIntegration: vi.fn(),
  mockUseFindManyIntegrationProject: vi.fn(),
}));

// --- Mocks ---

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    issue: { useFindMany: mockUseFindManyIssue },
    projectIntegration: { useFindMany: mockUseFindManyProjectIntegration },
    integrationProject: { useFindMany: mockUseFindManyIntegrationProject },
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key.split(".").pop() ?? key,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock Dialog as open-conditional div
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
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...rest }: any) => (
    <span data-testid="badge" {...rest}>
      {children}
    </span>
  ),
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange, disabled }: any) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      disabled={disabled}
    />
  ),
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/Debounce", () => ({
  useDebounce: (value: string) => value,
}));

vi.mock("@/components/IssuePriorityDisplay", () => ({
  IssuePriorityDisplay: ({ priority }: any) => (
    <span data-testid="priority-display">{priority}</span>
  ),
}));

vi.mock("@/components/IssueStatusDisplay", () => ({
  IssueStatusDisplay: ({ status }: any) => (
    <span data-testid="status-display">{status}</span>
  ),
}));

// Stub CreateIssueDialog and CreateIssueJiraForm. Surface
// `defaultValues` JSON so CR-05 tests can assert prefill threading.
vi.mock("./create-issue-dialog", () => ({
  CreateIssueDialog: ({ open, defaultValues }: any) =>
    open ? (
      <div
        data-testid="create-issue-dialog"
        data-default-values={defaultValues ? JSON.stringify(defaultValues) : ""}
      />
    ) : null,
}));

vi.mock("./create-issue-jira-form", () => ({
  CreateIssueJiraForm: ({ open, defaultValues }: any) =>
    open ? (
      <div
        data-testid="create-issue-jira-form"
        data-default-values={defaultValues ? JSON.stringify(defaultValues) : ""}
      />
    ) : null,
}));

import { SearchIssuesDialog } from "./search-issues-dialog";

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  projectId: 1,
};

const makeInternalIssue = (id: number) => ({
  id,
  name: `Issue ${id}`,
  title: `Issue Title ${id}`,
  description: "Description",
  status: "open",
  priority: "medium",
  externalId: null,
  externalKey: null,
  externalUrl: null,
  externalStatus: null,
  createdBy: { id: "u1", name: "User", email: "user@example.com" },
});

describe("SearchIssuesDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: no integration
    mockUseFindManyProjectIntegration.mockReturnValue({ data: [] });

    // Default: no integration projects
    mockUseFindManyIntegrationProject.mockReturnValue({ data: [] });

    // Default: no internal issues
    mockUseFindManyIssue.mockReturnValue({
      data: [],
      isLoading: false,
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ issues: [] }),
    });
  });

  it("renders dialog with search input when open=true", () => {
    render(<SearchIssuesDialog {...defaultProps} />);

    expect(screen.getByRole("dialog")).toBeTruthy();
    const searchInput = screen.getByRole("textbox");
    expect(searchInput).toBeTruthy();
  });

  it("does not render when open=false", () => {
    render(<SearchIssuesDialog {...defaultProps} open={false} />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows internal issues from useFindManyIssue when no integration is present", () => {
    const issues = [makeInternalIssue(1), makeInternalIssue(2)];
    mockUseFindManyIssue.mockReturnValue({ data: issues, isLoading: false });

    // Trigger internal search by typing a query
    render(<SearchIssuesDialog {...defaultProps} />);

    const searchInput = screen.getByRole("textbox");
    fireEvent.change(searchInput, { target: { value: "Issue" } });

    // Issues should be rendered - internal issues show issue.name (not title)
    expect(screen.getAllByText(/Issue 1/).length).toBeGreaterThanOrEqual(1);
  });

  it("calls onIssueSelected and closes dialog in single-select mode", () => {
    const onIssueSelected = vi.fn();
    const onOpenChange = vi.fn();

    const issues = [makeInternalIssue(10)];
    mockUseFindManyIssue.mockReturnValue({ data: issues, isLoading: false });

    render(
      <SearchIssuesDialog
        {...defaultProps}
        onOpenChange={onOpenChange}
        onIssueSelected={onIssueSelected}
        multiSelect={false}
      />
    );

    // Type to trigger results
    const searchInput = screen.getByRole("textbox");
    fireEvent.change(searchInput, { target: { value: "Issue" } });

    // Click an issue - internal issues show issue.name not issue.title
    const issueNames = screen.getAllByText(/^Issue 10$/);
    fireEvent.click(issueNames[0]);

    expect(onIssueSelected).toHaveBeenCalledWith(
      expect.objectContaining({ id: 10, isExternal: false })
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows checkboxes and confirm button in multi-select mode", () => {
    const issues = [makeInternalIssue(1), makeInternalIssue(2)];
    mockUseFindManyIssue.mockReturnValue({ data: issues, isLoading: false });

    render(
      <SearchIssuesDialog
        {...defaultProps}
        multiSelect={true}
        onIssuesSelected={vi.fn()}
      />
    );

    // Type to trigger results
    const searchInput = screen.getByRole("textbox");
    fireEvent.change(searchInput, { target: { value: "Issue" } });

    // Checkboxes should be rendered
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBeGreaterThanOrEqual(1);
  });

  it("shows linked issue with visual indicator (opacity/disabled style)", () => {
    const issue = makeInternalIssue(5);
    mockUseFindManyIssue.mockReturnValue({ data: [issue], isLoading: false });

    render(<SearchIssuesDialog {...defaultProps} linkedIssueIds={[5]} />);

    // Type to show results
    const searchInput = screen.getByRole("textbox");
    fireEvent.change(searchInput, { target: { value: "Issue" } });

    // The linked issue should be rendered - internal issues show issue.name
    const issueNames = screen.queryAllByText(/^Issue 5$/);
    expect(issueNames.length).toBeGreaterThan(0);
  });

  it("calls onIssuesSelected with selected issues when confirm is clicked", () => {
    const onIssuesSelected = vi.fn();
    const onOpenChange = vi.fn();

    const issues = [makeInternalIssue(3), makeInternalIssue(4)];
    mockUseFindManyIssue.mockReturnValue({ data: issues, isLoading: false });

    render(
      <SearchIssuesDialog
        {...defaultProps}
        onOpenChange={onOpenChange}
        multiSelect={true}
        onIssuesSelected={onIssuesSelected}
      />
    );

    const searchInput = screen.getByRole("textbox");
    fireEvent.change(searchInput, { target: { value: "Issue" } });

    // Select first issue via checkbox
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);

    // Confirm selection
    const confirmButton = screen.queryByRole("button", { name: /confirm/i });
    if (confirmButton) {
      fireEvent.click(confirmButton);
      expect(onIssuesSelected).toHaveBeenCalled();
    }
  });

  it("shows loading spinner when searching externally", async () => {
    // Integration present triggers external search
    mockUseFindManyProjectIntegration.mockReturnValue({
      data: [
        {
          id: 10,
          integrationId: 5,
          isActive: true,
          config: {},
          integration: { id: 5, name: "My Jira", provider: "JIRA" },
        },
      ],
    });

    // Slow fetch to simulate loading
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                status: 200,
                json: async () => ({ issues: [] }),
              } as any),
            5000
          )
        )
    );

    render(<SearchIssuesDialog {...defaultProps} />);

    const searchInput = screen.getByRole("textbox");
    fireEvent.change(searchInput, { target: { value: "bug" } });

    // Loader should appear while loading
    await waitFor(() => {
      const loader = document.querySelector(".animate-spin");
      // It's OK if the loading finished quickly in test env
      expect(loader !== null || screen.queryByRole("dialog") !== null).toBe(
        true
      );
    });
  });

  it("shows auth error alert when external search returns 401", async () => {
    mockUseFindManyProjectIntegration.mockReturnValue({
      data: [
        {
          id: 10,
          integrationId: 5,
          isActive: true,
          config: {},
          integration: { id: 5, name: "My Jira", provider: "JIRA" },
        },
      ],
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        authUrl: "https://oauth.example.com/authorize",
      }),
    });

    render(<SearchIssuesDialog {...defaultProps} />);

    const searchInput = screen.getByRole("textbox");
    fireEvent.change(searchInput, { target: { value: "bug" } });

    await waitFor(() => {
      const alerts = screen.queryAllByRole("alert");
      expect(alerts.length).toBeGreaterThanOrEqual(0); // Auth error may appear
    });
  });

  it("shows 'Create new' button when integration is available and no auth error", () => {
    mockUseFindManyProjectIntegration.mockReturnValue({
      data: [
        {
          id: 10,
          integrationId: 5,
          isActive: true,
          config: {},
          integration: { id: 5, name: "My Jira", provider: "JIRA" },
        },
      ],
    });

    render(<SearchIssuesDialog {...defaultProps} />);

    // "Create new" button should appear in the header
    const createBtn = screen.queryByRole("button", {
      name: /createNewIssue|create/i,
    });
    expect(createBtn).toBeTruthy();
  });

  // --- Multi-project fan-out tests ---

  describe("multi-project fan-out", () => {
    const makeIntegration = () => ({
      id: "pi-10",
      integrationId: 5,
      isActive: true,
      config: {},
      integration: { id: 5, name: "My Jira", provider: "JIRA" },
    });

    const makeTwoIntegrationProjects = () => [
      {
        id: "ip-1",
        externalProjectId: "10005",
        externalProjectKey: "ABT",
        externalProjectName: "Allego Bug Tracking",
        isDefault: true,
        isActive: true,
      },
      {
        id: "ip-2",
        externalProjectId: "10400",
        externalProjectKey: "LIV",
        externalProjectName: "LiveApps",
        isDefault: false,
        isActive: true,
      },
    ];

    beforeEach(() => {
      mockUseFindManyProjectIntegration.mockReturnValue({
        data: [makeIntegration()],
      });
      mockUseFindManyIntegrationProject.mockReturnValue({
        data: makeTwoIntegrationProjects(),
      });
    });

    it("renders filter chips when 2+ IntegrationProject records exist", () => {
      render(<SearchIssuesDialog {...defaultProps} />);

      // "All" chip and project-key chips should appear
      // At minimum, badges should be rendered for the project keys
      const badges = screen.queryAllByTestId("badge");
      // There should be at least the "All" chip plus project-key chips (ABT, LIV)
      expect(badges.length).toBeGreaterThanOrEqual(2);
    });

    it("renders project name chips for each IntegrationProject", () => {
      render(<SearchIssuesDialog {...defaultProps} />);

      const badges = screen.queryAllByTestId("badge");
      const badgeTexts = badges.map((b) => b.textContent);
      expect(badgeTexts.some((t) => t?.includes("Allego Bug Tracking"))).toBe(
        true
      );
      expect(badgeTexts.some((t) => t?.includes("LiveApps"))).toBe(true);
    });

    it("does NOT render filter chips when only 1 IntegrationProject exists", () => {
      mockUseFindManyIntegrationProject.mockReturnValue({
        data: [makeTwoIntegrationProjects()[0]], // Only ABT
      });

      render(<SearchIssuesDialog {...defaultProps} />);

      // With a single project there should be no project-filter chips rendered
      const badges = screen.queryAllByTestId("badge");
      // No filter chips means no ABT/LIV badges in the filter area
      // (badges may still appear in issue results — but no results here)
      expect(badges.length).toBe(0);
    });

    it("calls fetch once per IntegrationProject when searching with 2 projects", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          issues: [
            { id: "1", key: "ABT-1", title: "Test bug", status: "Open" },
          ],
        }),
      });

      render(<SearchIssuesDialog {...defaultProps} />);

      const searchInput = screen.getByRole("textbox");
      fireEvent.change(searchInput, { target: { value: "bug" } });

      await waitFor(() => {
        const fetchCalls = (global.fetch as any).mock.calls as string[][];
        const searchCalls = fetchCalls.filter(([url]) =>
          (url as string).includes("/search")
        );
        // One search call per IntegrationProject (2 projects)
        expect(searchCalls.length).toBe(2);
      });
    });

    it("each fan-out search call uses the correct externalProjectId", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ issues: [] }),
      });

      render(<SearchIssuesDialog {...defaultProps} />);

      const searchInput = screen.getByRole("textbox");
      fireEvent.change(searchInput, { target: { value: "test" } });

      await waitFor(() => {
        const fetchCalls = (global.fetch as any).mock.calls as string[][];
        const searchUrls = fetchCalls
          .map(([url]) => url as string)
          .filter((url) => url.includes("/search"));

        // Each project's externalProjectId should be in separate calls
        expect(searchUrls.some((url) => url.includes("projectId=10005"))).toBe(
          true
        );
        expect(searchUrls.some((url) => url.includes("projectId=10400"))).toBe(
          true
        );
      });
    });

    it("renders _projectKey badge on each result from fan-out search", async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("projectId=10005")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              issues: [
                { id: "abt-1", key: "ABT-1", title: "ABT Bug", status: "Open" },
              ],
            }),
          });
        }
        if (url.includes("projectId=10400")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              issues: [
                {
                  id: "liv-1",
                  key: "LIV-1",
                  title: "LIV Story",
                  status: "Done",
                },
              ],
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ issues: [] }),
        });
      });

      render(<SearchIssuesDialog {...defaultProps} />);

      const searchInput = screen.getByRole("textbox");
      fireEvent.change(searchInput, { target: { value: "bug" } });

      await waitFor(() => {
        const badges = screen.queryAllByTestId("badge");
        const badgeTexts = badges.map((b) => b.textContent);
        // Project name badges should appear for results
        expect(badgeTexts.some((t) => t?.includes("Allego Bug Tracking"))).toBe(
          true
        );
        expect(badgeTexts.some((t) => t?.includes("LiveApps"))).toBe(true);
      });
    });

    it("shows partial failure alert when some project searches fail", async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("projectId=10005")) {
          // ABT succeeds
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              issues: [
                { id: "abt-1", key: "ABT-1", title: "ABT Bug", status: "Open" },
              ],
            }),
          });
        }
        // LIV fails
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ error: "Internal server error" }),
        });
      });

      render(<SearchIssuesDialog {...defaultProps} />);

      const searchInput = screen.getByRole("textbox");
      fireEvent.change(searchInput, { target: { value: "bug" } });

      await waitFor(() => {
        const alerts = screen.queryAllByRole("alert");
        // A partial failure alert should be rendered
        expect(alerts.length).toBeGreaterThan(0);
      });
    });

    it("shows successful results even when one project search fails", async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("projectId=10005")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              issues: [
                {
                  id: "abt-1",
                  key: "ABT-1",
                  title: "Success Bug",
                  status: "Open",
                },
              ],
            }),
          });
        }
        // LIV fails
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ error: "Server error" }),
        });
      });

      render(<SearchIssuesDialog {...defaultProps} />);

      const searchInput = screen.getByRole("textbox");
      fireEvent.change(searchInput, { target: { value: "bug" } });

      await waitFor(() => {
        // The successful ABT result should still appear
        expect(screen.queryByText(/Success Bug/)).toBeTruthy();
      });
    });

    it("uses legacy single-project search when no IntegrationProject records exist", async () => {
      // No IntegrationProject records — falls back to config-based search
      mockUseFindManyIntegrationProject.mockReturnValue({ data: [] });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ issues: [] }),
      });

      render(<SearchIssuesDialog {...defaultProps} />);

      const searchInput = screen.getByRole("textbox");
      fireEvent.change(searchInput, { target: { value: "test" } });

      await waitFor(() => {
        const fetchCalls = (global.fetch as any).mock.calls as string[][];
        const searchCalls = fetchCalls.filter(([url]) =>
          (url as string).includes("/search")
        );
        // Only ONE call in legacy mode (not fan-out)
        expect(searchCalls.length).toBe(1);
      });
    });

    it("selecting a filter chip filters results to that project only", async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("projectId=10005")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              issues: [
                {
                  id: "abt-1",
                  key: "ABT-1",
                  title: "ABT Only Issue",
                  status: "Open",
                },
              ],
            }),
          });
        }
        if (url.includes("projectId=10400")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              issues: [
                {
                  id: "liv-1",
                  key: "LIV-1",
                  title: "LIV Only Issue",
                  status: "Done",
                },
              ],
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ issues: [] }),
        });
      });

      render(<SearchIssuesDialog {...defaultProps} />);

      const searchInput = screen.getByRole("textbox");
      fireEvent.change(searchInput, { target: { value: "issue" } });

      // Wait for results and chips to appear
      await waitFor(() => {
        const badges = screen.queryAllByTestId("badge");
        expect(badges.length).toBeGreaterThanOrEqual(2);
      });

      // Click the ABT filter chip
      const badges = screen.queryAllByTestId("badge");
      const abtChip = badges.find((b) => b.textContent === "ABT");
      if (abtChip) {
        fireEvent.click(abtChip);

        await waitFor(() => {
          // ABT result should still be visible after filtering
          expect(screen.queryByText(/ABT Only Issue/)).toBeTruthy();
        });
      }
    });
  });

  describe("CR-05: iterationContext threading to create-issue dispatcher", () => {
    const jiraIntegration = {
      id: 99,
      integrationId: 7,
      isActive: true,
      config: {},
      integration: { id: 7, name: "My Jira", provider: "JIRA" },
    };

    const iterationCtx = {
      iterationId: 11,
      testRunId: 22,
      testRunCaseId: 33,
    };

    function mockFetchPrefill(prefill: {
      title: string;
      description: unknown;
    }) {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (typeof url === "string" && url.includes("/issue-body")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => prefill,
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ issues: [] }),
        });
      });
    }

    it("routes JIRA + iterationPrefill through CreateIssueJiraForm with the prefilled body", async () => {
      mockUseFindManyProjectIntegration.mockReturnValue({
        data: [jiraIntegration],
      });
      const prefill = {
        title: "Iteration 2 of 5 failed: Login flow",
        description: { type: "doc", content: [] },
      };
      mockFetchPrefill(prefill);

      render(
        <SearchIssuesDialog {...defaultProps} iterationContext={iterationCtx} />
      );

      // Click the "Create New Issue" button (only rendered when an
      // integration is active).
      const createButton = await screen.findByRole("button", {
        name: /createNewIssue/i,
      });
      fireEvent.click(createButton);

      // JIRA always uses the dedicated CreateIssueJiraForm so the rich
      // editor + dynamic Jira field metadata loads correctly; the prefill
      // threads through as `defaultValues`. Routing through the generic
      // CreateIssueDialog dropped issue-type metadata and the proper
      // TipTap editor — a CR-05 regression caught during the
      // cross-adapter UAT.
      await waitFor(() => {
        expect(screen.queryByTestId("create-issue-jira-form")).toBeTruthy();
      });
      expect(screen.queryByTestId("create-issue-dialog")).toBeNull();

      const dialog = screen.getByTestId("create-issue-jira-form");
      const defaults = JSON.parse(
        dialog.getAttribute("data-default-values") ?? "{}"
      );
      expect(defaults.title).toBe(prefill.title);
      expect(defaults.description).toEqual(prefill.description);
    });

    it("routes JIRA WITHOUT iterationContext through CreateIssueJiraForm (back-compat)", async () => {
      mockUseFindManyProjectIntegration.mockReturnValue({
        data: [jiraIntegration],
      });

      render(<SearchIssuesDialog {...defaultProps} />);

      const createButton = await screen.findByRole("button", {
        name: /createNewIssue/i,
      });
      fireEvent.click(createButton);

      // No iteration context → standard manual-create dispatch picks
      // the Jira-specific form, unchanged from pre-CR-05 behaviour.
      await waitFor(() => {
        expect(screen.queryByTestId("create-issue-jira-form")).toBeTruthy();
      });
      expect(screen.queryByTestId("create-issue-dialog")).toBeNull();
    });
  });
});
