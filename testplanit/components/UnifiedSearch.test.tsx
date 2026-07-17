import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "~/test/test-utils";
import { SearchableEntityType } from "~/types/search";
import { UnifiedSearch } from "./UnifiedSearch";

// The real hook owns TanStack Virtual + an IntersectionObserver, neither of
// which produces layout (or fires) under jsdom. Replace it with a pass-through
// that renders every loaded hit and exposes the latest `onLoadMore` so a test
// can simulate the sentinel firing. The hook has its own focused unit test
// (hooks/useVirtualizedInfiniteList.test.tsx) for the observer wiring.
const virtualListMock = vi.hoisted(() => ({
  lastOnLoadMore: null as null | (() => void),
  lastOptions: null as Record<string, unknown> | null,
}));

vi.mock("~/hooks/useRecordKeyHits", () => ({
  useRecordKeyHits: () => [],
}));

vi.mock("~/hooks/useVirtualizedInfiniteList", () => ({
  useVirtualizedInfiniteList: (opts: {
    count: number;
    onLoadMore: () => void;
  }) => {
    virtualListMock.lastOnLoadMore = opts.onLoadMore;
    virtualListMock.lastOptions = opts as unknown as Record<string, unknown>;
    return {
      scrollRef: { current: null },
      sentinelRef: { current: null },
      virtualizer: {},
      virtualItems: Array.from({ length: opts.count }, (_, i) => ({
        key: i,
        index: i,
        start: i * 120,
        size: 120,
        end: (i + 1) * 120,
        lane: 0,
      })),
      totalSize: opts.count * 120,
      measureElement: () => {},
      maxHeight: 600,
    };
  },
}));

// Simulate the infinite-scroll sentinel coming into view.
function triggerLoadMore() {
  act(() => {
    virtualListMock.lastOnLoadMore?.();
  });
}

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values?.count !== undefined ? `${key} (${values.count})` : key,
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));

// Mock i18n-aware navigation wrapper (next-intl/navigation needs an intl
// context we don't wire up in unit tests).
const mockRouterPush = vi.fn();
vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
  Link: ({ children }: { children: React.ReactNode }) => children,
  redirect: vi.fn(),
}));

// Mock BulkEditModal so we can assert it's mounted with the right props
// without pulling the entire repository-cases tree into the test.
vi.mock("@/projects/repository/[projectId]/BulkEditModal", () => ({
  BulkEditModal: ({
    isOpen,
    selectedCaseIds,
    projectId,
    onClose,
  }: {
    isOpen: boolean;
    selectedCaseIds: number[];
    projectId: number;
    onClose: () => void;
  }) =>
    isOpen ? (
      <div data-testid="bulk-edit-modal-mock">
        <span data-testid="bulk-edit-project">{projectId}</span>
        <span data-testid="bulk-edit-ids">{selectedCaseIds.join(",")}</span>
        <button onClick={onClose}>{"close"}</button>
      </div>
    ) : null,
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

// The saved-search controls pull in ZenStack hooks / next-auth / sonner that
// aren't wired in this suite. Stub them: the menu exposes a button that fires
// `onLoad` with a fixed criteria so we can assert the restore wiring; the
// dialog just reflects its `open` prop.
vi.mock("@/components/search/SavedSearchesMenu", () => ({
  SavedSearchesMenu: ({
    onLoad,
  }: {
    onLoad: (criteria: {
      query: string;
      selectedEntities: SearchableEntityType[];
      currentProjectOnly: boolean;
      filters: Record<string, unknown>;
    }) => void;
  }) => (
    <button
      data-testid="mock-load-saved-search"
      onClick={() =>
        onLoad({
          query: "restored query",
          selectedEntities: [SearchableEntityType.TEST_RUN],
          currentProjectOnly: false,
          filters: { testRun: { isCompleted: true } },
        })
      }
    >
      {"load saved"}
    </button>
  ),
}));

vi.mock("@/components/Debounce", () => ({
  useDebounce: vi.fn((value: string) => value),
}));

// Mock dynamic icon to avoid import issues
vi.mock("@/components/DynamicIcon", () => ({
  default: ({ name, className }: { name: string; className?: string }) => (
    <span data-testid={`icon-${name}`} className={className}>
      {name}
    </span>
  ),
}));

// Mock other components
vi.mock("@/components/search/FacetedSearchFilters", () => ({
  FacetedSearchFilters: ({
    filters,
    onFiltersChange,
  }: {
    filters: any;
    onFiltersChange: (filters: any) => void;
  }) => (
    <div data-testid="faceted-filters">
      <div>{"Faceted Filters"}</div>
      <button
        data-testid="include-deleted-toggle"
        onClick={() =>
          onFiltersChange({
            ...filters,
            includeDeleted: !filters.includeDeleted,
          })
        }
      >
        {filters.includeDeleted ? "Hide Deleted" : "Include Deleted"}
      </button>
    </div>
  ),
}));

vi.mock("@/components/search/SearchResultComponents", () => ({
  MetadataList: ({ items }: { items: any[] }) => (
    <div data-testid="metadata-list">
      {items.filter(Boolean).length}
      {" items"}
    </div>
  ),
  MetadataItem: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="metadata-item">{children}</span>
  ),
  StatusBadge: ({ isCompleted }: { isCompleted: boolean }) => (
    <span data-testid="status-badge">
      {isCompleted ? "Completed" : "Active"}
    </span>
  ),
  TimeEstimate: ({ seconds }: { seconds: number }) => (
    <span data-testid="time-estimate">
      {seconds}
      {"s"}
    </span>
  ),
  TagList: ({ tags }: { tags: any[] }) => (
    <span data-testid="tag-list">
      {tags.length}
      {" tags"}
    </span>
  ),
  BadgeList: ({ items }: { items: any[] }) => (
    <div data-testid="badge-list">
      {items.filter(Boolean).length}
      {" badges"}
    </div>
  ),
  ExternalLink: ({ url }: { url: string }) => (
    <a data-testid="external-link" href={url}>
      {"Link"}
    </a>
  ),
  DateDisplay: ({ date }: { date: string }) => (
    <span data-testid="date-display">{date}</span>
  ),
  SearchHighlight: ({
    highlights,
  }: {
    highlights?: Record<string, string[]>;
  }) => (
    <div data-testid="search-highlight">
      {highlights ? "Has highlights" : "No highlights"}
    </div>
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
    <span data-testid="custom-fields">
      {customFields.length}
      {" custom fields"}
    </span>
  ),
}));

vi.mock("@/components/WorkflowStateDisplay", () => ({
  WorkflowStateDisplay: ({ state }: { state: any }) => (
    <span data-testid="workflow-state">{state.name}</span>
  ),
}));

vi.mock("@/components/ProjectIcon", () => ({
  ProjectIcon: ({ iconUrl }: { iconUrl: string }) => (
    <img data-testid="project-icon" src={iconUrl} alt="Project" />
  ),
}));

// Mock fetch
global.fetch = vi.fn();

describe("UnifiedSearch Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockReset();
    virtualListMock.lastOnLoadMore = null;
    virtualListMock.lastOptions = null;
  });

  it("should render search input with placeholder", () => {
    render(<UnifiedSearch />);

    const searchInput = screen.getByPlaceholderText(/search/i);
    expect(searchInput).toBeInTheDocument();
  });

  it("restores a saved search into live state and re-runs the search as the viewer", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ total: 0, hits: [], took: 1 }),
    });

    render(<UnifiedSearch />);

    fireEvent.click(screen.getByTestId("mock-load-saved-search"));

    await waitFor(() => {
      expect(screen.getByDisplayValue("restored query")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const lastCall = (global.fetch as any).mock.calls.at(-1);
    const body = JSON.parse(lastCall[1].body as string);
    expect(body.filters.query).toBe("restored query");
    expect(body.filters.testRun).toEqual({ isCompleted: true });
    expect(body.filters.entityTypes).toEqual([SearchableEntityType.TEST_RUN]);
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

    await waitFor(
      () => {
        expect(
          screen.getByText("search.errors.searchFailed")
        ).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
  });

  it("should clear search when X button is clicked", async () => {
    render(<UnifiedSearch />);

    const searchInput = screen.getByPlaceholderText(
      /search/i
    ) as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "test" } });

    // Wait for the X button to appear
    await waitFor(() => {
      expect(searchInput.value).toBe("test");
    });

    // Find the X button - it's the button with the X icon inside the search container
    const searchContainer = searchInput.parentElement;
    const clearButton = searchContainer?.querySelector("button");

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
      const resultCard = screen
        .getByText("Test Case 1")
        .closest(".cursor-pointer");
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
    const filterButton = buttons.find((btn) => {
      const svg = btn.querySelector("svg");
      return svg && svg.classList.contains("lucide-funnel");
    });

    if (filterButton) {
      fireEvent.click(filterButton);
      expect(screen.getByTestId("faceted-filters")).toBeInTheDocument();
    }
  });

  it("should display active filter count", async () => {
    const { useSearchState } =
      await import("~/lib/contexts/SearchStateContext");
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

  it("appends the next page when the infinite-scroll sentinel fires", async () => {
    const page = (offset: number) => ({
      ok: true,
      json: async () => ({
        total: 100,
        hits: Array(50)
          .fill(null)
          .map((_, i) => ({
            id: offset + i + 1,
            entityType: SearchableEntityType.REPOSITORY_CASE,
            score: 1.0,
            source: {
              id: offset + i + 1,
              name: `Test Case ${offset + i + 1}`,
              projectName: "Test Project",
              projectId: 1,
            },
          })),
        took: 1,
      }),
    });

    (global.fetch as any).mockResolvedValueOnce(page(0));

    render(<UnifiedSearch />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), {
      target: { value: "test" },
    });

    await waitFor(() => {
      expect(screen.getByText("Test Case 1")).toBeInTheDocument();
      expect(screen.getByText("Test Case 50")).toBeInTheDocument();
    });
    // Page 2 hasn't loaded yet.
    expect(screen.queryByText("Test Case 51")).not.toBeInTheDocument();

    // Simulate the sentinel reaching the viewport.
    (global.fetch as any).mockResolvedValueOnce(page(50));
    triggerLoadMore();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Test Case 51")).toBeInTheDocument();
    });

    // Both pages are now accumulated in one continuous list (no page seam).
    expect(screen.getByText("Test Case 1")).toBeInTheDocument();
    expect(screen.getByText("Test Case 100")).toBeInTheDocument();

    // The next-page request carried the incremented page cursor.
    const secondBody = JSON.parse((global.fetch as any).mock.calls[1][1].body);
    expect(secondBody.pagination.page).toBe(2);
  });

  it("does not fetch more once every result is loaded", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        total: 2,
        hits: [
          {
            id: 1,
            entityType: SearchableEntityType.REPOSITORY_CASE,
            score: 1.0,
            source: { id: 1, name: "Only One", projectName: "P", projectId: 1 },
          },
          {
            id: 2,
            entityType: SearchableEntityType.REPOSITORY_CASE,
            score: 1.0,
            source: { id: 2, name: "Only Two", projectName: "P", projectId: 1 },
          },
        ],
        took: 1,
      }),
    });

    render(<UnifiedSearch />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), {
      target: { value: "test" },
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Only One")).toBeInTheDocument();
    });

    // All results are already loaded — the sentinel firing must be a no-op.
    triggerLoadMore();
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("resets the accumulated list when the query changes", async () => {
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
              name: "Alpha One",
              projectName: "P",
              projectId: 1,
            },
          },
        ],
        took: 1,
      }),
    });

    render(<UnifiedSearch />);
    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: "alpha" } });

    await waitFor(() => {
      expect(screen.getByText("Alpha One")).toBeInTheDocument();
    });

    // A new query replaces (does not append to) the prior results.
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total: 1,
        hits: [
          {
            id: 2,
            entityType: SearchableEntityType.REPOSITORY_CASE,
            score: 1.0,
            source: { id: 2, name: "Beta One", projectName: "P", projectId: 1 },
          },
        ],
        took: 1,
      }),
    });
    fireEvent.change(searchInput, { target: { value: "beta" } });

    await waitFor(() => {
      expect(screen.getByText("Beta One")).toBeInTheDocument();
      expect(screen.queryByText("Alpha One")).not.toBeInTheDocument();
    });
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
    const deletedCard = screen
      .getByText("Deleted Test Case")
      .closest(".bg-destructive\\/10");
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
    const filterButton = buttons.find((btn) => {
      const svg = btn.querySelector("svg");
      return svg && svg.classList.contains("lucide-funnel");
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

  describe("Advanced Search Operators and Highlighting", () => {
    it("should render ES-generated highlights for regular fields", async () => {
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
                name: "Test Case with Authentication",
                projectName: "Test Project",
                projectId: 1,
                description: "This is a test case for authentication flow",
              },
              highlights: {
                name: [
                  'Test Case with <mark class="search-highlight">Authentication</mark>',
                ],
                description: [
                  'This is a test case for <mark class="search-highlight">authentication</mark> flow',
                ],
              },
            },
          ],
          took: 100,
        }),
      });

      render(<UnifiedSearch />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      fireEvent.change(searchInput, { target: { value: "authentication" } });

      await waitFor(() => {
        expect(
          screen.getByText("Test Case with Authentication")
        ).toBeInTheDocument();
      });

      // Verify that the result is rendered with highlights
      // In the testing environment, dangerouslySetInnerHTML doesn't create actual DOM elements,
      // but we can verify that the highlight component receives the correct data
      expect(screen.getByTestId("search-highlight")).toBeInTheDocument();
    });

    it("should render ES-generated highlights for step fields", async () => {
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
                name: "Login Test",
                projectName: "Test Project",
                projectId: 1,
                steps: [
                  {
                    id: 1,
                    step: "Navigate to login page",
                    expectedResult: "Login page is displayed",
                  },
                  {
                    id: 2,
                    step: "Enter valid credentials",
                    expectedResult: "Credentials are accepted",
                  },
                ],
              },
              highlights: {
                "steps.step": [
                  'Navigate to <mark class="search-highlight">login</mark> page',
                ],
                "steps.expectedResult": [
                  '<mark class="search-highlight">Login</mark> page is displayed',
                ],
              },
            },
          ],
          took: 100,
        }),
      });

      render(<UnifiedSearch />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      fireEvent.change(searchInput, { target: { value: "login" } });

      await waitFor(() => {
        expect(screen.getByText("Login Test")).toBeInTheDocument();
      });

      // Verify that step highlights are present
      const highlightedElements =
        document.querySelectorAll(".search-highlight");
      expect(highlightedElements.length).toBeGreaterThan(0);
    });

    it("should render wildcard search highlights correctly", async () => {
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
                name: "Test Case for Alpha Testing",
                projectName: "Test Project",
                projectId: 1,
                steps: [
                  {
                    id: 1,
                    step: "As a Project Manager, create Project Alpha",
                    expectedResult: "Project Alpha is created",
                  },
                ],
              },
              highlights: {
                name: [
                  'Test Case for <mark class="search-highlight">Alpha</mark> Testing',
                ],
                "steps.step": [
                  'As a Project Manager, create Project <mark class="search-highlight">Alpha</mark>',
                ],
                "steps.expectedResult": [
                  'Project <mark class="search-highlight">Alpha</mark> is created',
                ],
              },
            },
          ],
          took: 100,
        }),
      });

      render(<UnifiedSearch />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      // Simulate wildcard search "alph*"
      fireEvent.change(searchInput, { target: { value: "alph*" } });

      await waitFor(() => {
        expect(
          screen.getByText("Test Case for Alpha Testing")
        ).toBeInTheDocument();
      });

      // Verify wildcard highlights are rendered
      const highlightedElements =
        document.querySelectorAll(".search-highlight");
      expect(highlightedElements.length).toBeGreaterThan(0);
    });

    it("should render exact phrase search highlights correctly", async () => {
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
                name: "Test Case for Login Flow",
                projectName: "Test Project",
                projectId: 1,
                description:
                  "This test verifies the login flow works correctly",
              },
              highlights: {
                description: [
                  'This test verifies the <mark class="search-highlight">login flow</mark> works correctly',
                ],
              },
            },
          ],
          took: 100,
        }),
      });

      render(<UnifiedSearch />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      // Simulate exact phrase search
      fireEvent.change(searchInput, { target: { value: '"login flow"' } });

      await waitFor(() => {
        expect(
          screen.getByText("Test Case for Login Flow")
        ).toBeInTheDocument();
      });

      // Verify the search query was sent to the API with quotes (escaped in JSON)
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/search",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('\\"login flow\\"'),
        })
      );
    });

    it("should highlight steps with yellow background when they contain matches", async () => {
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
                name: "Login Test",
                projectName: "Test Project",
                projectId: 1,
                steps: [
                  {
                    id: 1,
                    step: "Navigate to login page",
                    expectedResult: "Login page is displayed",
                  },
                  {
                    id: 2,
                    step: "Click the submit button",
                    expectedResult: "Form is submitted",
                  },
                ],
              },
              highlights: {
                "steps.step": [
                  'Navigate to <mark class="search-highlight">login</mark> page',
                ],
                "steps.expectedResult": [
                  '<mark class="search-highlight">Login</mark> page is displayed',
                ],
              },
            },
          ],
          took: 100,
        }),
      });

      render(<UnifiedSearch />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      fireEvent.change(searchInput, { target: { value: "login" } });

      await waitFor(() => {
        expect(screen.getByText("Login Test")).toBeInTheDocument();
      });

      // Verify that the step with highlights has yellow background
      const stepWithHighlight = document.querySelector(".bg-yellow-50");
      expect(stepWithHighlight).toBeInTheDocument();
    });

    it("should handle field-specific search queries", async () => {
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
                name: "Dashboard Login Test",
                projectName: "Test Project",
                projectId: 1,
                description: "Test for other features",
              },
              highlights: {
                name: [
                  '<mark class="search-highlight">Dashboard</mark> Login Test',
                ],
              },
            },
          ],
          took: 100,
        }),
      });

      render(<UnifiedSearch />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      // Simulate field-specific search
      fireEvent.change(searchInput, { target: { value: "name:dashboard" } });

      await waitFor(() => {
        expect(screen.getByText("Dashboard Login Test")).toBeInTheDocument();
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/search",
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining("name:dashboard"),
          })
        );
      });
    });

    it("should handle required terms (+) search operator", async () => {
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
                name: "Login with Password Test",
                projectName: "Test Project",
                projectId: 1,
              },
              highlights: {
                name: [
                  '<mark class="search-highlight">Login</mark> with <mark class="search-highlight">Password</mark> Test',
                ],
              },
            },
          ],
          took: 100,
        }),
      });

      render(<UnifiedSearch />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      fireEvent.change(searchInput, { target: { value: "+login +password" } });

      await waitFor(() => {
        expect(
          screen.getByText("Login with Password Test")
        ).toBeInTheDocument();
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/search",
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining("+login +password"),
          })
        );
      });
    });

    it("should handle excluded terms (-) search operator", async () => {
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
                name: "Manual Login Test",
                projectName: "Test Project",
                projectId: 1,
              },
              highlights: {
                name: [
                  'Manual <mark class="search-highlight">Login</mark> Test',
                ],
              },
            },
          ],
          took: 100,
        }),
      });

      render(<UnifiedSearch />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      fireEvent.change(searchInput, { target: { value: "login -automated" } });

      await waitFor(() => {
        expect(screen.getByText("Manual Login Test")).toBeInTheDocument();
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/search",
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining("login -automated"),
          })
        );
      });
    });

    it("should handle boolean AND/OR operators", async () => {
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
                name: "Login and Authentication Test",
                projectName: "Test Project",
                projectId: 1,
              },
              highlights: {
                name: [
                  '<mark class="search-highlight">Login</mark> and <mark class="search-highlight">Authentication</mark> Test',
                ],
              },
            },
          ],
          took: 100,
        }),
      });

      render(<UnifiedSearch />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      fireEvent.change(searchInput, {
        target: { value: "login AND authentication" },
      });

      await waitFor(() => {
        expect(
          screen.getByText("Login and Authentication Test")
        ).toBeInTheDocument();
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/search",
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining("login AND authentication"),
          })
        );
      });
    });
  });

  describe("Bulk actions on search results", () => {
    function caseHit(id: number, projectId: number, name = `Case ${id}`) {
      return {
        id,
        entityType: SearchableEntityType.REPOSITORY_CASE,
        score: 1.0,
        source: { id, name, projectId, projectName: `Project ${projectId}` },
      };
    }
    function nonCaseHit(id: number, projectId: number) {
      return {
        id,
        entityType: SearchableEntityType.TEST_RUN,
        score: 1.0,
        source: { id, name: `Run ${id}`, projectId },
      };
    }

    async function renderWithHits(hits: any[]) {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ total: hits.length, hits, took: 1 }),
      });
      render(<UnifiedSearch />);
      const input = screen.getByPlaceholderText(/search/i);
      fireEvent.change(input, { target: { value: "anything" } });
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
      return input;
    }

    it("renders a selection checkbox on RepositoryCase rows only", async () => {
      await renderWithHits([caseHit(1, 100), nonCaseHit(2, 100)]);
      await waitFor(() => {
        expect(
          screen.getByTestId("bulk-select-repository_case-1")
        ).toBeInTheDocument();
        expect(
          screen.queryByTestId("bulk-select-test_run-2")
        ).not.toBeInTheDocument();
      });
    });

    it("shows the bulk toolbar with the selected count after toggling a case", async () => {
      await renderWithHits([caseHit(1, 100), caseHit(2, 100)]);
      await waitFor(() => {
        expect(
          screen.getByTestId("bulk-select-repository_case-1")
        ).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("bulk-select-repository_case-1"));
      await waitFor(() => {
        expect(screen.getByTestId("bulk-action-toolbar")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("bulk-select-repository_case-2"));
      // Plural-form rendering uses the `#` placeholder for the count value.
      await waitFor(() => {
        expect(screen.getByTestId("bulk-action-toolbar").textContent).toContain(
          "2"
        );
      });
    });

    it("disables both bulk actions when the selection spans multiple projects", async () => {
      await renderWithHits([caseHit(1, 100), caseHit(2, 200)]);
      await waitFor(() => {
        expect(
          screen.getByTestId("bulk-select-repository_case-1")
        ).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("bulk-select-repository_case-1"));
      fireEvent.click(screen.getByTestId("bulk-select-repository_case-2"));
      await waitFor(() => {
        expect(screen.getByTestId("bulk-edit-button")).toBeDisabled();
        expect(
          screen.getByTestId("bulk-create-test-run-button")
        ).toBeDisabled();
      });
    });

    it("opens BulkEditModal with the selected case ids + single projectId when selection is same-project", async () => {
      await renderWithHits([caseHit(1, 100), caseHit(2, 100)]);
      await waitFor(() => {
        expect(
          screen.getByTestId("bulk-select-repository_case-1")
        ).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("bulk-select-repository_case-1"));
      fireEvent.click(screen.getByTestId("bulk-select-repository_case-2"));
      fireEvent.click(screen.getByTestId("bulk-edit-button"));
      await waitFor(() => {
        expect(screen.getByTestId("bulk-edit-modal-mock")).toBeInTheDocument();
      });
      expect(screen.getByTestId("bulk-edit-project").textContent).toBe("100");
      expect(screen.getByTestId("bulk-edit-ids").textContent).toBe("1,2");
    });

    it("seeds sessionStorage + navigates to /projects/runs/<projectId>?openAddRun=true on Create Test Run", async () => {
      mockRouterPush.mockReset();
      const setItem = vi.spyOn(Storage.prototype, "setItem");
      await renderWithHits([caseHit(7, 42)]);
      await waitFor(() => {
        expect(
          screen.getByTestId("bulk-select-repository_case-7")
        ).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("bulk-select-repository_case-7"));
      fireEvent.click(screen.getByTestId("bulk-create-test-run-button"));
      await waitFor(() => {
        expect(setItem).toHaveBeenCalledWith(
          "createTestRun_selectedCases",
          "[7]"
        );
        expect(mockRouterPush).toHaveBeenCalledWith(
          "/projects/runs/42?openAddRun=true"
        );
      });
      setItem.mockRestore();
    });

    it("clears the selection via the Clear button (toolbar disappears)", async () => {
      await renderWithHits([caseHit(1, 100)]);
      await waitFor(() => {
        expect(
          screen.getByTestId("bulk-select-repository_case-1")
        ).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("bulk-select-repository_case-1"));
      expect(screen.getByTestId("bulk-action-toolbar")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("bulk-clear-button"));
      await waitFor(() => {
        expect(
          screen.queryByTestId("bulk-action-toolbar")
        ).not.toBeInTheDocument();
      });
    });

    it("retains a selection made on an earlier page after more pages load", async () => {
      // Page 1: cases 1 & 2 of a 4-result set, all in project 100.
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          total: 4,
          hits: [caseHit(1, 100), caseHit(2, 100)],
          took: 1,
        }),
      });
      render(<UnifiedSearch />);
      fireEvent.change(screen.getByPlaceholderText(/search/i), {
        target: { value: "anything" },
      });
      await waitFor(() => {
        expect(
          screen.getByTestId("bulk-select-repository_case-1")
        ).toBeInTheDocument();
      });

      // Select a case on page 1.
      fireEvent.click(screen.getByTestId("bulk-select-repository_case-1"));
      expect(screen.getByTestId("bulk-action-toolbar")).toBeInTheDocument();

      // Scroll past the seam — page 2 appends cases 3 & 4.
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          total: 4,
          hits: [caseHit(3, 100), caseHit(4, 100)],
          took: 1,
        }),
      });
      triggerLoadMore();
      await waitFor(() => {
        expect(
          screen.getByTestId("bulk-select-repository_case-4")
        ).toBeInTheDocument();
      });

      // The page-1 selection survived the append, and we can add a page-2 case.
      fireEvent.click(screen.getByTestId("bulk-select-repository_case-4"));
      await waitFor(() => {
        expect(screen.getByTestId("bulk-action-toolbar").textContent).toContain(
          "2"
        );
      });

      // Both ids reach the bulk editor — selection genuinely spans the pages.
      fireEvent.click(screen.getByTestId("bulk-edit-button"));
      await waitFor(() => {
        expect(screen.getByTestId("bulk-edit-modal-mock")).toBeInTheDocument();
      });
      expect(screen.getByTestId("bulk-edit-ids").textContent).toBe("1,4");
    });
  });
});
