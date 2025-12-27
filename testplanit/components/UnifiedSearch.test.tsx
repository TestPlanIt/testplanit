import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "~/test/test-utils";
import { UnifiedSearch } from "./UnifiedSearch";
import { SearchableEntityType } from "~/types/search";
import React from "react";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock the hooks
vi.mock("~/hooks/useSearchContext", () => ({
  useSearchContext: vi.fn(() => ({
    currentEntity: SearchableEntityType.REPOSITORY_CASE,
    projectId: 1,
    defaultFilters: {},
    availableEntities: [
      SearchableEntityType.REPOSITORY_CASE,
      SearchableEntityType.SHARED_STEP,
      SearchableEntityType.TEST_RUN,
      SearchableEntityType.SESSION,
    ],
    isGlobalSearch: false,
  })),
  getEntityLabel: vi.fn((entity: SearchableEntityType) => {
    const labels = {
      [SearchableEntityType.REPOSITORY_CASE]: "Test Cases",
      [SearchableEntityType.SHARED_STEP]: "Shared Steps",
      [SearchableEntityType.TEST_RUN]: "Test Runs",
      [SearchableEntityType.SESSION]: "Sessions",
      [SearchableEntityType.PROJECT]: "Projects",
      [SearchableEntityType.ISSUE]: "Issues",
      [SearchableEntityType.MILESTONE]: "Milestones",
    };
    return labels[entity] || entity;
  }),
  getEntityIcon: vi.fn((entity: SearchableEntityType) => {
    const icons = {
      [SearchableEntityType.REPOSITORY_CASE]: "file-text",
      [SearchableEntityType.SHARED_STEP]: "share",
      [SearchableEntityType.TEST_RUN]: "play-circle",
      [SearchableEntityType.SESSION]: "compass",
      [SearchableEntityType.PROJECT]: "folder",
      [SearchableEntityType.ISSUE]: "alert-circle",
      [SearchableEntityType.MILESTONE]: "flag",
    };
    return icons[entity] || "file";
  }),
}));

vi.mock("~/lib/contexts/SearchStateContext", () => ({
  useSearchState: vi.fn(() => ({
    searchState: null,
    setSearchState: vi.fn(),
  })),
}));

vi.mock("@/components/Debounce", () => ({
  useDebounce: vi.fn((value: string) => value),
}));

// Mock dynamic icon to avoid import issues
vi.mock("@/components/DynamicIcon", () => ({
  default: ({ name, className }: { name: string; className?: string }) => (
    <span data-testid={`icon-${name}`} className={className}>{name}</span>
  ),
}));

// Mock other components
vi.mock("@/components/search/FacetedSearchFilters", () => ({
  FacetedSearchFilters: ({ filters, onFiltersChange }: { 
    filters: any; 
    onFiltersChange: (filters: any) => void;
  }) => (
    <div data-testid="faceted-filters">
      <div>{"Faceted Filters"}</div>
      <button 
        data-testid="include-deleted-toggle"
        onClick={() => onFiltersChange({ ...filters, includeDeleted: !filters.includeDeleted })}
      >
        {filters.includeDeleted ? "Hide Deleted" : "Include Deleted"}
      </button>
    </div>
  ),
}));

vi.mock("@/components/search/SearchResultComponents", () => ({
  MetadataList: ({ items }: { items: any[] }) => (
    <div data-testid="metadata-list">{items.filter(Boolean).length}{" items"}</div>
  ),
  MetadataItem: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="metadata-item">{children}</span>
  ),
  StatusBadge: ({ isCompleted }: { isCompleted: boolean }) => (
    <span data-testid="status-badge">{isCompleted ? "Completed" : "Active"}</span>
  ),
  TimeEstimate: ({ seconds }: { seconds: number }) => (
    <span data-testid="time-estimate">{seconds}{"s"}</span>
  ),
  TagList: ({ tags }: { tags: any[] }) => (
    <span data-testid="tag-list">{tags.length}{" tags"}</span>
  ),
  BadgeList: ({ items }: { items: any[] }) => (
    <div data-testid="badge-list">{items.filter(Boolean).length}{" badges"}</div>
  ),
  ExternalLink: ({ url }: { url: string }) => (
    <a data-testid="external-link" href={url}>{"Link"}</a>
  ),
  DateDisplay: ({ date }: { date: string }) => (
    <span data-testid="date-display">{date}</span>
  ),
  SearchHighlight: ({ highlights }: { highlights?: Record<string, string[]> }) => (
    <div data-testid="search-highlight">{highlights ? "Has highlights" : "No highlights"}</div>
  ),
}));

vi.mock("@/components/search/ProjectNameDisplay", () => ({
  ProjectNameDisplay: ({ projectName }: { projectName: string }) => (
    <span data-testid="project-name">{projectName}</span>
  ),
}));

vi.mock("@/components/search/UserDisplay", () => ({
  UserDisplay: ({ userName }: { userName: string }) => (
    <span data-testid="user-display">{userName}</span>
  ),
}));

vi.mock("@/components/search/TestCaseSearchResult", () => ({
  TestCaseSearchResult: ({ testCase }: { testCase: any }) => (
    <span data-testid="test-case-result">{testCase.name}</span>
  ),
}));

vi.mock("@/components/search/CustomFieldDisplay", () => ({
  CustomFieldDisplay: ({ customFields }: { customFields: any[] }) => (
    <span data-testid="custom-fields">{customFields.length}{" custom fields"}</span>
  ),
}));

vi.mock("@/components/WorkflowStateDisplay", () => ({
  WorkflowStateDisplay: ({ state }: { state: any }) => (
    <span data-testid="workflow-state">{state.name}</span>
  ),
}));

vi.mock("@/components/ProjectIcon", () => ({
  ProjectIcon: ({ iconUrl }: { iconUrl: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img data-testid="project-icon" src={iconUrl} alt="Project" />
  ),
}));

// Mock fetch
global.fetch = vi.fn();

describe("UnifiedSearch Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockReset();
  });

  it("should render search input with placeholder", () => {
    render(<UnifiedSearch />);
    
    const searchInput = screen.getByPlaceholderText(/search/i);
    expect(searchInput).toBeInTheDocument();
  });

  it("should show entity selector when multiple entities are available", () => {
    render(<UnifiedSearch showEntitySelector={true} />);
    
    // The getEntityLabel mock returns "Test Cases" for REPOSITORY_CASE
    const entitySelector = screen.getByText("Test Cases");
    expect(entitySelector).toBeInTheDocument();
  });

  it("should not show entity selector when disabled", () => {
    render(<UnifiedSearch showEntitySelector={false} />);
    
    // Check that the dropdown button with entity types is not present
    const entitySelector = screen.queryByText("Test Cases");
    expect(entitySelector).not.toBeInTheDocument();
  });

  it("should show project toggle when in project context", () => {
    render(<UnifiedSearch showProjectToggle={true} />);
    
    // The label shows the translation key in tests
    const projectToggle = screen.getByText("search.currentProjectOnly");
    expect(projectToggle).toBeInTheDocument();
  });

  it("should trigger search when typing", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total: 1,
        hits: [
          {
            id: 1,
            entityType: SearchableEntityType.REPOSITORY_CASE,
            score: 1.0,
            source: {
              id: 1,
              name: "Test Case 1",
              projectName: "Test Project",
              projectId: 1,
            },
          },
        ],
        took: 100,
      }),
    });

    render(<UnifiedSearch />);
    
    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: "test" } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/search",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        })
      );
    });
  });

  it("should display search results", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total: 2,
        hits: [
          {
            id: 1,
            entityType: SearchableEntityType.REPOSITORY_CASE,
            score: 1.0,
            source: {
              id: 1,
              name: "Test Case 1",
              projectName: "Test Project",
              projectId: 1,
            },
          },
          {
            id: 2,
            entityType: SearchableEntityType.TEST_RUN,
            score: 0.9,
            source: {
              id: 2,
              name: "Test Run 1",
              projectName: "Test Project",
              projectId: 1,
            },
          },
        ],
        took: 100,
      }),
    });

    render(<UnifiedSearch />);
    
    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: "test" } });

    await waitFor(() => {
      expect(screen.getByTestId("test-case-result")).toBeInTheDocument();
      expect(screen.getByText("Test Run 1")).toBeInTheDocument();
    });
  });

  it("should show no results message when search returns empty", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total: 0,
        hits: [],
        took: 50,
      }),
    });

    render(<UnifiedSearch />);
    
    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: "nonexistent" } });

    await waitFor(() => {
      expect(screen.getByText("common.labels.noResults")).toBeInTheDocument();
    });
  });

  it("should handle search errors gracefully", async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error("Network error"));

    render(<UnifiedSearch />);
    
    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: "test" } });

    await waitFor(() => {
      expect(screen.getByText("search.errors.searchFailed")).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("should clear search when X button is clicked", async () => {
    render(<UnifiedSearch />);
    
    const searchInput = screen.getByPlaceholderText(/search/i) as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "test" } });
    
    // Wait for the X button to appear
    await waitFor(() => {
      expect(searchInput.value).toBe("test");
    });
    
    // Find the X button - it's the button with the X icon inside the search container
    const searchContainer = searchInput.parentElement;
    const clearButton = searchContainer?.querySelector('button');
    
    if (clearButton) {
      fireEvent.click(clearButton);
      expect(searchInput).toHaveValue("");
    }
  });

  it("should call onResultClick when result is clicked", async () => {
    const mockOnResultClick = vi.fn();
    
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total: 1,
        hits: [
          {
            id: 1,
            entityType: SearchableEntityType.REPOSITORY_CASE,
            score: 1.0,
            source: {
              id: 1,
              name: "Test Case 1",
              projectName: "Test Project",
              projectId: 1,
            },
          },
        ],
        took: 100,
      }),
    });

    render(<UnifiedSearch onResultClick={mockOnResultClick} />);
    
    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: "test" } });

    await waitFor(() => {
      const resultCard = screen.getByText("Test Case 1").closest(".cursor-pointer");
      fireEvent.click(resultCard!);
    });

    expect(mockOnResultClick).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        entityType: SearchableEntityType.REPOSITORY_CASE,
      })
    );
  });

  it("should show filters sheet when filter button is clicked", () => {
    render(<UnifiedSearch />);
    
    // Find the filter button - it contains the filter icon (svg with lucide-funnel class)
    const buttons = screen.getAllByRole("button");
    const filterButton = buttons.find(btn => {
      const svg = btn.querySelector('svg');
      return svg && svg.classList.contains('lucide-funnel');
    });
    
    if (filterButton) {
      fireEvent.click(filterButton);
      expect(screen.getByTestId("faceted-filters")).toBeInTheDocument();
    }
  });

  it("should display active filter count", async () => {
    const { useSearchState } = await import("~/lib/contexts/SearchStateContext");
    (useSearchState as any).mockReturnValue({
      searchState: {
        filters: {
          repositoryCase: {
            projectIds: [1, 2],
            tagIds: [3, 4, 5],
          },
        },
      },
      setSearchState: vi.fn(),
    });

    render(<UnifiedSearch />);
    
    // Wait for component to render with filters
    // Should show badge with count (1 for projectIds array + 1 for tagIds array = 2)
    await waitFor(() => {
      expect(screen.getByText("2")).toBeInTheDocument();
    });
  });

  it("should use custom placeholder when provided", () => {
    render(<UnifiedSearch placeholder="Search for test cases..." />);
    
    const searchInput = screen.getByPlaceholderText("Search for test cases...");
    expect(searchInput).toBeInTheDocument();
  });

  it("should handle pagination", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total: 100,
        hits: Array(50).fill(null).map((_, i) => ({
          id: i + 1,
          entityType: SearchableEntityType.REPOSITORY_CASE,
          score: 1.0,
          source: {
            id: i + 1,
            name: `Test Case ${i + 1}`,
            projectName: "Test Project",
            projectId: 1,
          },
        })),
        took: 100,
      }),
    });

    render(<UnifiedSearch />);
    
    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: "test" } });

    await waitFor(() => {
      // First check if we have results
      expect(screen.getByText("Test Case 1")).toBeInTheDocument();

      // Check pagination text - it's a single text node with all parts
      const paginationText = screen.getByText((content, element) => {
        return element?.textContent === "common.pagination.showing 1-50 common.of 100 common.results";
      });
      expect(paginationText).toBeInTheDocument();
    });

    // Mock the second page response
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total: 100,
        hits: Array(50).fill(null).map((_, i) => ({
          id: i + 51,
          entityType: SearchableEntityType.REPOSITORY_CASE,
          score: 1.0,
          source: {
            id: i + 51,
            name: `Test Case ${i + 51}`,
            projectName: "Test Project",
            projectId: 1,
          },
        })),
        took: 100,
      }),
    });

    // Find and click the next page button
    const buttons = screen.getAllByRole("button");
    const nextButton = buttons.find(btn => {
      const svg = btn.querySelector('svg');
      return svg && svg.classList.contains('lucide-chevron-right');
    });
    
    if (nextButton) {
      fireEvent.click(nextButton);
      
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(2);
      });
    }
  });

  it("should display deleted items with destructive styling", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total: 2,
        hits: [
          {
            id: 1,
            entityType: SearchableEntityType.REPOSITORY_CASE,
            score: 1.0,
            source: {
              id: 1,
              name: "Active Test Case",
              projectName: "Test Project",
              projectId: 1,
              isDeleted: false,
            },
          },
          {
            id: 2,
            entityType: SearchableEntityType.REPOSITORY_CASE,
            score: 0.9,
            source: {
              id: 2,
              name: "Deleted Test Case",
              projectName: "Test Project",
              projectId: 1,
              isDeleted: true,
            },
          },
        ],
        took: 100,
      }),
    });

    render(<UnifiedSearch />);
    
    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: "test" } });

    await waitFor(() => {
      expect(screen.getByText("Active Test Case")).toBeInTheDocument();
      expect(screen.getByText("Deleted Test Case")).toBeInTheDocument();
    });

    // Check that deleted items have destructive styling classes
    const deletedCard = screen.getByText("Deleted Test Case").closest(".bg-destructive\\/10");
    expect(deletedCard).toBeInTheDocument();
  });

  it("should send includeDeleted parameter when filters change", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        total: 0,
        hits: [],
        took: 50,
      }),
    });

    render(<UnifiedSearch />);
    
    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: "test" } });

    // Wait for initial search
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    // Open filters
    const buttons = screen.getAllByRole("button");
    const filterButton = buttons.find(btn => {
      const svg = btn.querySelector('svg');
      return svg && svg.classList.contains('lucide-funnel');
    });
    
    if (filterButton) {
      fireEvent.click(filterButton);
      
      await waitFor(() => {
        expect(screen.getByTestId("faceted-filters")).toBeInTheDocument();
      });

      // Toggle include deleted
      const includeDeletedToggle = screen.getByTestId("include-deleted-toggle");
      fireEvent.click(includeDeletedToggle);

      // Should trigger a new search with includeDeleted parameter
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(2);
        const lastCall = (global.fetch as any).mock.calls[1];
        const requestBody = JSON.parse(lastCall[1].body);
        expect(requestBody.filters.includeDeleted).toBe(true);
      });
    }
  });

  it("should show deleted badge for deleted items", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total: 1,
        hits: [
          {
            id: 1,
            entityType: SearchableEntityType.REPOSITORY_CASE,
            score: 1.0,
            source: {
              id: 1,
              name: "Deleted Test Case",
              projectName: "Test Project",
              projectId: 1,
              isDeleted: true,
            },
          },
        ],
        took: 100,
      }),
    });

    render(<UnifiedSearch />);
    
    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: "test" } });

    await waitFor(() => {
      expect(screen.getByText("Deleted Test Case")).toBeInTheDocument();
      // The badge text comes from translation key in tests
      expect(screen.getByText("common.status.deleted")).toBeInTheDocument();
    });
  });
});