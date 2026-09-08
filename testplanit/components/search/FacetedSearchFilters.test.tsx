import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "~/test/test-utils";
import { SearchableEntityType } from "~/types/search";
import { FacetedSearchFilters } from "./FacetedSearchFilters";

// ---------------------------------------------------------------------------
// Stable hook mock refs via vi.hoisted() to avoid OOM infinite re-renders
// ---------------------------------------------------------------------------
const {
  mockProjectsData,
  mockTagsData,
  mockWorkflowsData,
  mockTemplatesData,
  mockMilestonesData,
  mockProjectAssignmentData,
  mockFoldersData,
  mockUsersData,
  mockConfigurationsData,
  mockIssuesData,
  configurationsHookSpy,
} = vi.hoisted(() => ({
  mockProjectsData: { data: [] as any[] },
  mockTagsData: { data: [] as any[] },
  mockWorkflowsData: { data: [] as any[] },
  mockTemplatesData: { data: [] as any[] },
  mockMilestonesData: { data: [] as any[] },
  mockProjectAssignmentData: { data: [] as any[] },
  mockFoldersData: { data: [] as any[] },
  mockUsersData: { data: [] as any[] },
  mockConfigurationsData: { data: [] as any[] },
  mockIssuesData: { data: [] as any[] },
  configurationsHookSpy: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock hooks from ~/lib/hooks
// ---------------------------------------------------------------------------
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    projects: { useFindMany: () => mockProjectsData },
    tags: { useFindMany: () => mockTagsData },
    workflows: { useFindMany: () => mockWorkflowsData },
    templates: { useFindMany: () => mockTemplatesData },
    milestones: { useFindMany: () => mockMilestonesData },
    projectAssignment: { useFindMany: () => mockProjectAssignmentData },
    repositoryFolders: { useFindMany: () => mockFoldersData },
    user: { useFindMany: () => mockUsersData },
    issue: { useFindMany: () => mockIssuesData },
    configurations: {
      useFindMany: (args: unknown) => {
        configurationsHookSpy(args);
        return mockConfigurationsData;
      },
    },
  }),
}));

// ---------------------------------------------------------------------------
// Mock the issues server action — the issue picker pages against the server
// ---------------------------------------------------------------------------
const { mockSearchIssues } = vi.hoisted(() => ({
  mockSearchIssues: vi.fn(),
}));

vi.mock("~/app/actions/searchIssues", () => ({
  searchIssues: (...args: any[]) => mockSearchIssues(...args),
}));

// ---------------------------------------------------------------------------
// Mock next-intl
// ---------------------------------------------------------------------------
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key.split(".").pop() ?? key,
}));

// ---------------------------------------------------------------------------
// Mock next-auth/react
// ---------------------------------------------------------------------------
const mockSessionHolder = vi.hoisted(() => ({
  session: {
    data: {
      user: { id: "user-1", name: "Test User", access: "MEMBER" },
    },
  },
}));

vi.mock("next-auth/react", () => ({
  useSession: () => mockSessionHolder.session,
}));

// ---------------------------------------------------------------------------
// Mock ~/utils (includes isAdmin and cn) — FacetedSearchFilters imports from ~/utils
// ---------------------------------------------------------------------------
vi.mock("~/utils", () => ({
  isAdmin: (session: any) => session?.user?.access === "ADMIN",
  cn: (...args: any[]) => args.filter(Boolean).join(" "),
}));

// ---------------------------------------------------------------------------
// Mock DynamicIcon
// ---------------------------------------------------------------------------
vi.mock("@/components/DynamicIcon", () => ({
  default: ({ name }: { name: string }) => (
    <span data-testid={`icon-${name}`}>{name}</span>
  ),
}));

// ---------------------------------------------------------------------------
// Mock CustomFieldFilters
// ---------------------------------------------------------------------------
vi.mock("./CustomFieldFilters", () => ({
  CustomFieldFilters: () => (
    <div data-testid="custom-field-filters">Custom Fields</div>
  ),
}));

// ---------------------------------------------------------------------------
// Mock Radix Accordion to render all content expanded (avoids jsdom issues)
// ---------------------------------------------------------------------------
vi.mock("@/components/ui/accordion", () => ({
  Accordion: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="accordion">{children}</div>
  ),
  AccordionItem: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => <div data-testid={`accordion-item-${value}`}>{children}</div>,
  AccordionTrigger: ({ children }: { children: React.ReactNode }) => (
    <button data-testid="accordion-trigger">{children}</button>
  ),
  AccordionContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="accordion-content">{children}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Mock MultiAsyncCombobox with a flat list of option buttons — the popover and
// cmdk internals aren't what these tests are about, the filter wiring is.
// ---------------------------------------------------------------------------
vi.mock("@/components/ui/multi-async-combobox", () => ({
  MultiAsyncCombobox: ({
    value,
    onValueChange,
    fetchOptions,
    getOptionValue,
    getOptionLabel,
    placeholder,
  }: any) => {
    const [options, setOptions] = React.useState<any[]>([]);
    React.useEffect(() => {
      let ignore = false;
      void Promise.resolve(fetchOptions("", 0, 100)).then((result: any) => {
        if (!ignore) {
          setOptions(Array.isArray(result) ? result : result.results);
        }
      });
      return () => {
        ignore = true;
      };
    }, [fetchOptions]);

    return (
      <div data-testid={`combobox-${placeholder}`}>
        {options.map((option) => (
          <button
            key={getOptionValue(option)}
            type="button"
            onClick={() => onValueChange([...value, option])}
          >
            {getOptionLabel(option)}
          </button>
        ))}
      </div>
    );
  },
}));

// ---------------------------------------------------------------------------
// Mock ScrollArea to render children directly
// ---------------------------------------------------------------------------
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="scroll-area">{children}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Default props helpers
// ---------------------------------------------------------------------------
const defaultFilters = {};

const defaultProps = {
  entityTypes: [SearchableEntityType.REPOSITORY_CASE],
  filters: defaultFilters,
  onFiltersChange: vi.fn(),
};

describe("FacetedSearchFilters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to non-admin session
    mockSessionHolder.session = {
      data: {
        user: { id: "user-1", name: "Test User", access: "MEMBER" },
      },
    } as any;
    // Reset all data arrays to empty
    mockProjectsData.data = [];
    mockTagsData.data = [];
    mockWorkflowsData.data = [];
    mockTemplatesData.data = [];
    mockMilestonesData.data = [];
    mockProjectAssignmentData.data = [];
    mockFoldersData.data = [];
    mockUsersData.data = [];
    mockConfigurationsData.data = [];
    mockIssuesData.data = [];
    mockSearchIssues.mockResolvedValue({ results: [], total: 0 });
  });

  it("renders the filter container", () => {
    render(<FacetedSearchFilters {...defaultProps} />);

    expect(screen.getByTestId("faceted-search-filters")).toBeInTheDocument();
  });

  it("offers projects from hook data as filter options", async () => {
    mockProjectsData.data = [
      { id: 1, name: "Project A", isCompleted: false },
      { id: 2, name: "Project B", isCompleted: false },
    ];

    render(<FacetedSearchFilters {...defaultProps} />);

    expect(
      await screen.findByRole("button", { name: "Project A" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Project B" })
    ).toBeInTheDocument();
  });

  it("calls onFiltersChange when a project is selected", async () => {
    const onFiltersChange = vi.fn();
    mockProjectsData.data = [{ id: 1, name: "Project A", isCompleted: false }];

    render(
      <FacetedSearchFilters
        {...defaultProps}
        onFiltersChange={onFiltersChange}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Project A" }));

    expect(onFiltersChange).toHaveBeenCalled();
    const calledFilters = onFiltersChange.mock.calls[0][0];
    // For REPOSITORY_CASE entity type, projectIds go into repositoryCase
    expect(calledFilters.repositoryCase?.projectIds).toContain(1);
  });

  it("offers tags from hook data as filter options", async () => {
    mockTagsData.data = [
      { id: 1, name: "Tag A" },
      { id: 2, name: "Tag B" },
    ];

    render(<FacetedSearchFilters {...defaultProps} />);

    expect(
      await screen.findByRole("button", { name: "Tag A" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tag B" })).toBeInTheDocument();
  });

  it("calls onFiltersChange when a tag is selected", async () => {
    const onFiltersChange = vi.fn();
    mockTagsData.data = [{ id: 1, name: "Tag A" }];

    render(
      <FacetedSearchFilters
        {...defaultProps}
        onFiltersChange={onFiltersChange}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Tag A" }));

    expect(onFiltersChange).toHaveBeenCalled();
    const calledFilters = onFiltersChange.mock.calls[0][0];
    expect(calledFilters.repositoryCase?.tagIds).toContain(1);
  });

  it("filters issues by the ones picked from the server-backed combobox", async () => {
    const onFiltersChange = vi.fn();
    mockSearchIssues.mockResolvedValue({
      results: [
        { id: 5, name: "AB-5", title: "Login fails", externalKey: "AB-5" },
      ],
      total: 1,
    });

    render(
      <FacetedSearchFilters
        {...defaultProps}
        entityTypes={[SearchableEntityType.ISSUE]}
        onFiltersChange={onFiltersChange}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "AB-5" }));

    expect(onFiltersChange.mock.calls[0][0].issue?.issueIds).toEqual([5]);
  });

  /**
   * Every remaining picker: selecting an option has to land on the right
   * filter key for the right entity. Base filters (states, creators) fan out
   * to every selected entity type; the rest are entity-scoped.
   */
  describe("picker wiring", () => {
    const pick = async (optionName: string, props: any = {}) => {
      const onFiltersChange = vi.fn();
      render(
        <FacetedSearchFilters
          {...defaultProps}
          onFiltersChange={onFiltersChange}
          {...props}
        />
      );
      fireEvent.click(await screen.findByRole("button", { name: optionName }));
      return onFiltersChange.mock.calls[0][0];
    };

    it("routes workflow states to stateIds", async () => {
      mockWorkflowsData.data = [
        { id: 11, name: "In Progress", scope: "CASES" },
      ];

      const filters = await pick("In Progress");

      expect(filters.repositoryCase?.stateIds).toEqual([11]);
    });

    it("routes created-by to creatorIds", async () => {
      mockUsersData.data = [{ id: "user-7", name: "Alice" }];

      const filters = await pick("Alice");

      expect(filters.repositoryCase?.creatorIds).toEqual(["user-7"]);
    });

    it("fans base filters out to every selected entity type", async () => {
      mockTagsData.data = [{ id: 11, name: "Smoke" }];

      const filters = await pick("Smoke", {
        entityTypes: [
          SearchableEntityType.REPOSITORY_CASE,
          SearchableEntityType.TEST_RUN,
        ],
      });

      expect(filters.repositoryCase?.tagIds).toEqual([11]);
      expect(filters.testRun?.tagIds).toEqual([11]);
    });

    it("keeps workflow states out of the other entities' filters", async () => {
      mockWorkflowsData.data = [{ id: 11, name: "In Progress", scope: "RUNS" }];

      const filters = await pick("In Progress", {
        entityTypes: [
          SearchableEntityType.REPOSITORY_CASE,
          SearchableEntityType.TEST_RUN,
        ],
      });

      expect(filters.testRun?.stateIds).toEqual([11]);
      expect(filters.repositoryCase?.stateIds).toBeUndefined();
    });

    it("routes folders to repositoryCase.folderIds", async () => {
      mockFoldersData.data = [{ id: 21, name: "Smoke" }];

      const filters = await pick("Smoke");

      expect(filters.repositoryCase?.folderIds).toEqual([21]);
    });

    it("routes templates to repositoryCase.templateIds", async () => {
      mockTemplatesData.data = [{ id: 31, templateName: "Exploratory" }];

      const filters = await pick("Exploratory");

      expect(filters.repositoryCase?.templateIds).toEqual([31]);
    });

    it("routes configurations to testRun.configurationIds", async () => {
      mockConfigurationsData.data = [{ id: 41, name: "Chrome" }];

      const filters = await pick("Chrome", {
        entityTypes: [SearchableEntityType.TEST_RUN],
      });

      expect(filters.testRun?.configurationIds).toEqual([41]);
    });

    it("routes milestones to testRun.milestoneIds", async () => {
      mockMilestonesData.data = [{ id: 51, name: "Release 1" }];

      const filters = await pick("Release 1", {
        entityTypes: [SearchableEntityType.TEST_RUN],
      });

      expect(filters.testRun?.milestoneIds).toEqual([51]);
    });

    it("routes session templates to session.templateIds", async () => {
      mockTemplatesData.data = [{ id: 61, templateName: "Charter" }];

      const filters = await pick("Charter", {
        entityTypes: [SearchableEntityType.SESSION],
      });

      expect(filters.session?.templateIds).toEqual([61]);
    });

    it("routes assignees to session.assignedToIds", async () => {
      mockUsersData.data = [{ id: "user-8", name: "Bob" }];
      const onFiltersChange = vi.fn();

      render(
        <FacetedSearchFilters
          {...defaultProps}
          entityTypes={[SearchableEntityType.SESSION]}
          onFiltersChange={onFiltersChange}
        />
      );

      // The same user is offered twice: Created By (common) then Assigned To
      const buttons = await screen.findAllByRole("button", { name: "Bob" });
      expect(buttons).toHaveLength(2);
      fireEvent.click(buttons[1]);

      expect(onFiltersChange.mock.calls[0][0].session?.assignedToIds).toEqual([
        "user-8",
      ]);
    });
  });

  it("keeps ids that aren't in the loaded options when the selection changes", async () => {
    const onFiltersChange = vi.fn();
    mockTagsData.data = [{ id: 1, name: "Tag A" }];

    render(
      <FacetedSearchFilters
        {...defaultProps}
        filters={{ repositoryCase: { tagIds: [99] } }}
        onFiltersChange={onFiltersChange}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Tag A" }));

    const calledFilters = onFiltersChange.mock.calls[0][0];
    expect(calledFilters.repositoryCase?.tagIds).toEqual([99, 1]);
  });

  it("does not render include deleted switch for non-admin users", () => {
    // Session is already MEMBER from beforeEach
    render(<FacetedSearchFilters {...defaultProps} />);

    expect(
      screen.queryByTestId("include-deleted-toggle")
    ).not.toBeInTheDocument();
  });

  it("renders include deleted switch for admin users", () => {
    mockSessionHolder.session = {
      data: {
        user: { id: "admin-1", name: "Admin User", access: "ADMIN" },
      },
    } as any;

    render(<FacetedSearchFilters {...defaultProps} />);

    expect(screen.getByTestId("include-deleted-toggle")).toBeInTheDocument();
  });

  it("calls onFiltersChange with includeDeleted when toggle is switched", () => {
    const onFiltersChange = vi.fn();
    mockSessionHolder.session = {
      data: {
        user: { id: "admin-1", name: "Admin User", access: "ADMIN" },
      },
    } as any;

    render(
      <FacetedSearchFilters
        {...defaultProps}
        onFiltersChange={onFiltersChange}
      />
    );

    const toggle = screen.getByTestId("include-deleted-toggle");
    fireEvent.click(toggle);

    expect(onFiltersChange).toHaveBeenCalled();
    const calledFilters = onFiltersChange.mock.calls[0][0];
    expect(calledFilters.includeDeleted).toBe(true);
  });

  it("clears all filters when clear all button is clicked", () => {
    const onFiltersChange = vi.fn();
    // Pre-populate some filters
    const filtersWithData = {
      repositoryCase: {
        projectIds: [1],
        tagIds: [2],
      },
    };

    render(
      <FacetedSearchFilters
        entityTypes={[SearchableEntityType.REPOSITORY_CASE]}
        filters={filtersWithData}
        onFiltersChange={onFiltersChange}
      />
    );

    // There may be multiple clearAll-named buttons (one in header area)
    const clearButtons = screen.getAllByRole("button", { name: /clearAll/i });
    fireEvent.click(clearButtons[0]);

    expect(onFiltersChange).toHaveBeenCalled();
    const clearedFilters = onFiltersChange.mock.calls[0][0];
    expect(clearedFilters.repositoryCase?.projectIds).toBeUndefined();
    expect(clearedFilters.repositoryCase?.tagIds).toBeUndefined();
  });

  it("renders entity type badge for REPOSITORY_CASE", () => {
    render(
      <FacetedSearchFilters
        entityTypes={[SearchableEntityType.REPOSITORY_CASE]}
        filters={defaultFilters}
        onFiltersChange={vi.fn()}
      />
    );

    // The searching-in label
    expect(screen.getByText("searchingIn")).toBeInTheDocument();
  });

  it("renders filters for multiple entity types", () => {
    render(
      <FacetedSearchFilters
        entityTypes={[
          SearchableEntityType.REPOSITORY_CASE,
          SearchableEntityType.TEST_RUN,
        ]}
        filters={defaultFilters}
        onFiltersChange={vi.fn()}
      />
    );

    expect(screen.getByTestId("faceted-search-filters")).toBeInTheDocument();
  });

  it("gives each entity its own workflow state picker instead of one mixed list", async () => {
    mockWorkflowsData.data = [
      { id: 1, name: "Case Draft", scope: "CASES" },
      { id: 2, name: "Run Blocked", scope: "RUNS" },
      { id: 3, name: "Session Paused", scope: "SESSIONS" },
    ];

    render(
      <FacetedSearchFilters
        entityTypes={[
          SearchableEntityType.REPOSITORY_CASE,
          SearchableEntityType.TEST_RUN,
          SearchableEntityType.SESSION,
        ]}
        filters={defaultFilters}
        onFiltersChange={vi.fn()}
      />
    );

    const caseStates = within(await screen.findByTestId("case-states-filter"));
    expect(
      await caseStates.findByRole("button", { name: "Case Draft" })
    ).toBeInTheDocument();
    expect(
      caseStates.queryByRole("button", { name: "Run Blocked" })
    ).not.toBeInTheDocument();
    expect(
      caseStates.queryByRole("button", { name: "Session Paused" })
    ).not.toBeInTheDocument();

    const runStates = within(screen.getByTestId("run-states-filter"));
    expect(
      await runStates.findByRole("button", { name: "Run Blocked" })
    ).toBeInTheDocument();
    expect(
      runStates.queryByRole("button", { name: "Case Draft" })
    ).not.toBeInTheDocument();

    const sessionStates = within(screen.getByTestId("session-states-filter"));
    expect(
      await sessionStates.findByRole("button", { name: "Session Paused" })
    ).toBeInTheDocument();
    expect(
      sessionStates.queryByRole("button", { name: "Run Blocked" })
    ).not.toBeInTheDocument();
  });

  it("keeps other entities' state selections when one scoped picker changes", async () => {
    const onFiltersChange = vi.fn();
    mockWorkflowsData.data = [
      { id: 1, name: "Case Draft", scope: "CASES" },
      { id: 2, name: "Run Blocked", scope: "RUNS" },
    ];

    render(
      <FacetedSearchFilters
        entityTypes={[
          SearchableEntityType.REPOSITORY_CASE,
          SearchableEntityType.TEST_RUN,
        ]}
        filters={{
          repositoryCase: { stateIds: [2] },
          testRun: { stateIds: [2] },
        }}
        onFiltersChange={onFiltersChange}
      />
    );

    const caseStates = within(await screen.findByTestId("case-states-filter"));
    fireEvent.click(
      await caseStates.findByRole("button", { name: "Case Draft" })
    );

    const calledFilters = onFiltersChange.mock.calls[0][0];
    expect(calledFilters.repositoryCase?.stateIds).toEqual([2, 1]);
  });

  it("does not offer workflow states for entities that have none", () => {
    mockWorkflowsData.data = [{ id: 1, name: "Case Draft", scope: "CASES" }];

    render(
      <FacetedSearchFilters
        entityTypes={[SearchableEntityType.REPOSITORY_CASE]}
        filters={defaultFilters}
        onFiltersChange={vi.fn()}
      />
    );

    expect(screen.queryByTestId("run-states-filter")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("session-states-filter")
    ).not.toBeInTheDocument();
  });

  it("scopes the configuration facet to the project when searching within one", () => {
    render(
      <FacetedSearchFilters
        entityTypes={[SearchableEntityType.TEST_RUN]}
        filters={defaultFilters}
        onFiltersChange={vi.fn()}
        projectId={5}
      />
    );

    const where = configurationsHookSpy.mock.calls.at(-1)?.[0]?.where;
    expect(where).toMatchObject({
      isDeleted: false,
      projects: { some: { projectId: 5 } },
    });
  });

  it("does not scope the configuration facet in a global (cross-project) search", () => {
    render(
      <FacetedSearchFilters
        entityTypes={[SearchableEntityType.TEST_RUN]}
        filters={defaultFilters}
        onFiltersChange={vi.fn()}
      />
    );

    const where = configurationsHookSpy.mock.calls.at(-1)?.[0]?.where;
    expect(where).not.toHaveProperty("projects");
  });
});
