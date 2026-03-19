import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "~/test/test-utils";
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
}));

// ---------------------------------------------------------------------------
// Mock hooks from ~/lib/hooks
// ---------------------------------------------------------------------------
vi.mock("~/lib/hooks", () => ({
  useFindManyProjects: () => mockProjectsData,
  useFindManyTags: () => mockTagsData,
  useFindManyWorkflows: () => mockWorkflowsData,
  useFindManyTemplates: () => mockTemplatesData,
  useFindManyMilestones: () => mockMilestonesData,
  useFindManyProjectAssignment: () => mockProjectAssignmentData,
  useFindManyRepositoryFolders: () => mockFoldersData,
  useFindManyUser: () => mockUsersData,
  useFindManyConfigurations: () => mockConfigurationsData,
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
  }) => (
    <div data-testid={`accordion-item-${value}`}>{children}</div>
  ),
  AccordionTrigger: ({ children }: { children: React.ReactNode }) => (
    <button data-testid="accordion-trigger">{children}</button>
  ),
  AccordionContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="accordion-content">{children}</div>
  ),
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
  });

  it("renders the filter container", () => {
    render(<FacetedSearchFilters {...defaultProps} />);

    expect(
      screen.getByTestId("faceted-search-filters")
    ).toBeInTheDocument();
  });

  it("renders project checkboxes from hook data", () => {
    mockProjectsData.data = [
      { id: 1, name: "Project A", isCompleted: false },
      { id: 2, name: "Project B", isCompleted: false },
    ];

    render(<FacetedSearchFilters {...defaultProps} />);

    expect(screen.getByLabelText("Project A")).toBeInTheDocument();
    expect(screen.getByLabelText("Project B")).toBeInTheDocument();
  });

  it("calls onFiltersChange when a project filter checkbox is toggled", () => {
    const onFiltersChange = vi.fn();
    mockProjectsData.data = [
      { id: 1, name: "Project A", isCompleted: false },
    ];

    render(
      <FacetedSearchFilters
        {...defaultProps}
        onFiltersChange={onFiltersChange}
      />
    );

    const checkbox = screen.getByRole("checkbox", { name: /Project A/i });
    fireEvent.click(checkbox);

    expect(onFiltersChange).toHaveBeenCalled();
    const calledFilters = onFiltersChange.mock.calls[0][0];
    // For REPOSITORY_CASE entity type, projectIds go into repositoryCase
    expect(calledFilters.repositoryCase?.projectIds).toContain(1);
  });

  it("renders tag checkboxes from hook data", () => {
    mockTagsData.data = [
      { id: 1, name: "Tag A" },
      { id: 2, name: "Tag B" },
    ];

    render(<FacetedSearchFilters {...defaultProps} />);

    expect(screen.getByLabelText("Tag A")).toBeInTheDocument();
    expect(screen.getByLabelText("Tag B")).toBeInTheDocument();
  });

  it("calls onFiltersChange when a tag filter checkbox is toggled", () => {
    const onFiltersChange = vi.fn();
    mockTagsData.data = [{ id: 1, name: "Tag A" }];

    render(
      <FacetedSearchFilters
        {...defaultProps}
        onFiltersChange={onFiltersChange}
      />
    );

    const checkbox = screen.getByRole("checkbox", { name: /Tag A/i });
    fireEvent.click(checkbox);

    expect(onFiltersChange).toHaveBeenCalled();
    const calledFilters = onFiltersChange.mock.calls[0][0];
    expect(calledFilters.repositoryCase?.tagIds).toContain(1);
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

    expect(
      screen.getByTestId("include-deleted-toggle")
    ).toBeInTheDocument();
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

    expect(
      screen.getByTestId("faceted-search-filters")
    ).toBeInTheDocument();
  });
});
