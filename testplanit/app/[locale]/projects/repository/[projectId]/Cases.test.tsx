import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// ---- Mocks (must come before imports) ----

vi.mock("~/utils/extractTextFromJson", () => ({
  extractTextFromNode: vi.fn((node: any) => {
    if (typeof node === "string") return node;
    return node?.toString() || "";
  }),
}));

vi.mock("next/navigation", () => ({
  useParams: vi.fn(() => ({ projectId: "42" })),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  })),
  usePathname: vi.fn(() => "/"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));

vi.mock("~/lib/navigation", () => ({
  Link: vi.fn(({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  )),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  })),
  usePathname: vi.fn(() => "/"),
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: vi.fn((namespace?: string) => {
    return (key: string) => (namespace ? `${namespace}.${key}` : key);
  }),
  useLocale: vi.fn(() => "en-US"),
}));

vi.mock("next-auth/react", async (importOriginal) => {
  const original = await importOriginal<typeof import("next-auth/react")>();
  return {
    ...original,
    useSession: vi.fn(() => ({
      data: {
        user: {
          id: "user-test",
          name: "Test User",
          email: "test@example.com",
        },
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
      status: "authenticated",
      update: vi.fn(),
    })),
  };
});

// Mock all ZenStack hooks from ~/lib/hooks
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    projects: {
      useCount: vi.fn(() => ({ data: 2, isLoading: false })),
      useFindUnique: vi.fn(() => ({ data: null, isLoading: false })),
    },
    repositoryFolders: {
      useFindMany: vi.fn(() => ({ data: [], isLoading: false })),
    },
    repositoryCases: {
      useCount: vi.fn(() => ({
        data: 0,
        isLoading: false,
        refetch: vi.fn(),
      })),
      useUpdate: vi.fn(() => ({
        mutateAsync: vi.fn(),
        isPending: false,
      })),
      // ids-only query backing the docked panel's prev/next (allCaseIds)
      useFindMany: vi.fn(() => ({ data: [], isLoading: false })),
    },
    templates: { useFindMany: vi.fn(() => ({ data: [], isLoading: false })) },
    projectLlmIntegration: {
      useFindMany: vi.fn(() => ({
        data: [],
        isLoading: false,
      })),
    },
    testRuns: { useFindFirst: vi.fn(() => ({ data: null, isLoading: false })) },
    testRunCases: {
      useCount: vi.fn(() => ({ data: 0, isLoading: false })),
      useFindMany: vi.fn(() => ({
        data: [],
        isLoading: false,
        refetch: vi.fn(),
      })),
      useUpdate: vi.fn(() => ({
        mutateAsync: vi.fn(),
        isPending: false,
      })),
    },
    reviewRequest: {
      useFindMany: vi.fn(() => ({ data: [], isLoading: false })),
    },
  }),
}));

vi.mock("~/hooks/useLatestTestResults", () => ({
  useLatestTestResults: () => ({}),
}));

// Plain holders rather than vi.fn: afterEach's vi.clearAllMocks() would strip
// a mock implementation, and these hooks are read on every render.
const idSortHolder = vi.hoisted(() => ({
  latest: { pageIds: null as number[] | null, isFetching: false },
  fieldOption: { pageIds: null as number[] | null, isFetching: false },
  latestArgs: [] as any[],
  fieldOptionArgs: [] as any[],
}));

vi.mock("~/hooks/useCaseIdsByLatestStatus", () => ({
  useCaseIdsByLatestStatus: (args: any) => {
    idSortHolder.latestArgs.push(args);
    return idSortHolder.latest;
  },
}));

vi.mock("~/hooks/useCaseIdsByFieldOption", () => ({
  useCaseIdsByFieldOption: (args: any) => {
    idSortHolder.fieldOptionArgs.push(args);
    return idSortHolder.fieldOption;
  },
}));

vi.mock("~/hooks/useReviewFeatureEnabled", () => ({
  useReviewFeatureEnabled: vi.fn(() => ({
    enabled: false,
    isLoading: false,
  })),
}));

// Cases no longer reads the ZenStack GET wrapper — only the post-fetch matcher
// types, which are erased. The mock stays so the real module (and the ZenStack
// client it pulls in) is never loaded by this suite.
vi.mock("~/hooks/useRepositoryCasesWithFilteredFields", () => ({
  useFindManyRepositoryCasesFiltered: vi.fn(),
  filterOrphanedFieldValues: (row: unknown) => row,
  matchesPostFetchFilters: () => true,
}));

const invalidateCaseListMock = vi.fn(() => Promise.resolve());

vi.mock("~/hooks/useRepositoryCasesQuery", () => ({
  useRepositoryCasesQuery: vi.fn(() => ({
    data: [],
    ids: undefined,
    caseIds: undefined,
    totalCount: 0,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  })),
  // Returns a STABLE invalidator — Cases puts it in effect/callback dep lists.
  useRepositoryCasesInvalidation: vi.fn(() => invalidateCaseListMock),
  invalidateRepositoryCasesQueries: vi.fn(() => Promise.resolve()),
  notifyRepositoryCasesChanged: vi.fn(),
}));

vi.mock("~/hooks/useRepositoryCasesByDescendants", () => ({
  useFindManyRepositoryCasesByDescendants: vi.fn(() => ({
    data: [],
    isLoading: false,
    isFetching: false,
    error: null,
    totalCount: 0,
    refetch: vi.fn(),
  })),
}));

vi.mock("~/hooks/useProjectPermissions", () => ({
  useProjectPermissions: vi.fn(() => ({
    permissions: { canAddEdit: true, canDelete: true },
    isLoading: false,
  })),
}));

vi.mock("~/hooks/useExportData", () => ({
  useExportData: vi.fn(() => ({
    handleExport: vi.fn(),
    isExporting: false,
  })),
}));

vi.mock("~/lib/contexts/PaginationContext", () => ({
  usePagination: vi.fn(() => ({
    currentPage: 1,
    setCurrentPage: vi.fn(),
    pageSize: 25,
    setPageSize: vi.fn(),
    totalItems: 0,
    setTotalItems: vi.fn(),
    totalPages: 1,
    startIndex: 0,
    endIndex: 0,
  })),
}));

vi.mock("~/app/actions/exportActions", () => ({
  fetchAllCasesForExport: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock complex child components as simple stubs
vi.mock("@/components/tables/DataTable", () => ({
  DataTable: vi.fn(({ data, isLoading }: any) => (
    <div
      data-testid="data-table"
      data-loading={isLoading}
      data-count={data?.length ?? 0}
    >
      DataTable stub ({data?.length ?? 0} rows)
    </div>
  )),
}));

vi.mock("@/components/tables/Pagination", () => ({
  PaginationComponent: vi.fn(() => (
    <div data-testid="pagination-component">Pagination stub</div>
  )),
}));

vi.mock("@/components/tables/PaginationControls", () => ({
  PaginationInfo: vi.fn(() => (
    <div data-testid="pagination-info">PaginationInfo stub</div>
  )),
}));

vi.mock("@/components/tables/Filter", () => ({
  Filter: vi.fn(() => <div data-testid="filter-component">Filter stub</div>),
}));

vi.mock("@/components/tables/ColumnSelection", () => ({
  ColumnSelection: vi.fn(() => (
    <div data-testid="column-selection">ColumnSelection stub</div>
  )),
  readStoredColumnSort: vi.fn(() => null),
  writeStoredColumnSort: vi.fn(),
}));

vi.mock("./BulkEditModal", () => ({
  BulkEditModal: vi.fn(() => (
    <div data-testid="bulk-edit-modal">BulkEditModal stub</div>
  )),
}));

vi.mock("./ExportModal", () => ({
  ExportModal: vi.fn(() => (
    <div data-testid="export-modal">ExportModal stub</div>
  )),
}));

vi.mock("./QuickScriptModal", () => ({
  QuickScriptModal: vi.fn(() => (
    <div data-testid="quick-script-modal">QuickScriptModal stub</div>
  )),
}));

vi.mock("./AddCaseRow", () => ({
  AddCaseRow: vi.fn(() => (
    <div data-testid="add-case-row">AddCaseRow stub</div>
  )),
}));

vi.mock("./AddResultModal", () => ({
  AddResultModal: vi.fn(() => (
    <div data-testid="add-result-modal">AddResultModal stub</div>
  )),
}));

vi.mock("@/components/SelectedTestCasesDrawer", () => ({
  SelectedTestCasesDrawer: vi.fn(() => (
    <div data-testid="selected-test-cases-drawer">
      SelectedTestCasesDrawer stub
    </div>
  )),
}));

vi.mock("@/components/AttachmentsCarousel", () => ({
  AttachmentsCarousel: vi.fn(() => (
    <div data-testid="attachments-carousel">AttachmentsCarousel stub</div>
  )),
}));

vi.mock("@/components/auto-tag/AutoTagWizardDialog", () => ({
  AutoTagWizardDialog: vi.fn(() => (
    <div data-testid="auto-tag-wizard">AutoTagWizardDialog stub</div>
  )),
}));

vi.mock("@/components/copy-move/CopyMoveDialog", () => ({
  CopyMoveDialog: vi.fn(() => (
    <div data-testid="copy-move-dialog">CopyMoveDialog stub</div>
  )),
}));

vi.mock("@/components/Debounce", () => ({
  useDebounce: vi.fn((value: any) => value),
}));

// Mock columns with at least one column so columnVisibility initializes properly
vi.mock("./columns", () => ({
  getColumns: vi.fn(() => [
    {
      id: "name",
      enableHiding: false,
      meta: { isVisible: true },
      accessorKey: "name",
      header: "Name",
      cell: ({ row }: any) => row.original.name,
    },
  ]),
}));

// ---- Imports ----
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { DataTable } from "@/components/tables/DataTable";
import React from "react";
import * as NextAuth from "next-auth/react";
import { useFindManyRepositoryCasesByDescendants } from "~/hooks/useRepositoryCasesByDescendants";
import { useRepositoryCasesQuery } from "~/hooks/useRepositoryCasesQuery";
import { useExportData } from "~/hooks/useExportData";
import { fetchAllCasesForExport } from "~/app/actions/exportActions";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { usePagination } from "~/lib/contexts/PaginationContext";
import { getColumns } from "./columns";
import { buildFilterDimensions } from "~/lib/repository/filterDimensions";
import { canonicalPredicateKey } from "~/lib/repository/filterUrlCodec";
import type { FilterPredicate } from "~/lib/schemas/repositoryFilterPredicates";
import Cases from "./Cases";

// ---- Test Fixtures ----

const mockCase = {
  id: 1,
  name: "Test Case 1",
  projectId: 42,
  templateId: null,
  folderId: null,
  stateId: null,
  order: 1,
  automated: false,
  isArchived: false,
  isDeleted: false,
  tags: [],
  steps: [],
  caseFieldValues: [],
  attachments: [],
  issues: [],
  template: null,
  state: null,
  folder: null,
  creator: null,
  createdAt: new Date(),
};

const testRegistry = buildFilterDimensions({
  dynamicFields: [
    { fieldId: 15, type: "Text Long" },
    { fieldId: 3, type: "Steps" },
  ],
});

const predicateProps = (predicates: FilterPredicate[]) => ({
  predicates,
  filterRegistry: testRegistry,
  predicatesKey: canonicalPredicateKey(predicates),
});

const defaultProps = {
  folderId: null,
  viewType: "all",
  ...predicateProps([]),
  canAddEdit: true,
  canAddEditRun: false,
  canDelete: true,
};

function setupMocks({
  isLoading = false,
  data = [] as any[],
  canAddEdit = true,
  paginationOverrides = {},
}: {
  isLoading?: boolean;
  data?: any[];
  canAddEdit?: boolean;
  paginationOverrides?: Record<string, any>;
} = {}) {
  (useFindManyRepositoryCasesByDescendants as any).mockReturnValue({
    data,
    isLoading,
    isFetching: false,
    error: null,
    totalCount: data.length,
    refetch: vi.fn(),
  });

  (useRepositoryCasesQuery as any).mockReturnValue({
    data,
    ids: data.map((row: any) => row.id),
    isLoading,
    isFetching: false,
    error: null,
    totalCount: data.length,
    refetch: vi.fn(),
  });

  (useExportData as any).mockReturnValue({
    handleExport: vi.fn(),
    isExporting: false,
  });

  (useProjectPermissions as any).mockReturnValue({
    permissions: { canAddEdit, canDelete: true },
    isLoading: false,
  });

  (usePagination as any).mockReturnValue({
    currentPage: 1,
    setCurrentPage: vi.fn(),
    pageSize: 25,
    setPageSize: vi.fn(),
    totalItems: data.length,
    setTotalItems: vi.fn(),
    totalPages: 1,
    startIndex: data.length > 0 ? 1 : 0,
    endIndex: data.length,
    ...paginationOverrides,
  });
}

beforeAll(() => {
  // Mock pointer capture APIs needed by Radix UI
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = vi.fn();
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = vi.fn();
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
});

beforeEach(() => {
  setupMocks();
  idSortHolder.latest = { pageIds: null, isFetching: false };
  idSortHolder.fieldOption = { pageIds: null, isFetching: false };
  idSortHolder.latestArgs.length = 0;
  idSortHolder.fieldOptionArgs.length = 0;
  // Re-set session mock since vi.clearAllMocks() removes implementations
  (NextAuth.useSession as any).mockReturnValue({
    data: {
      user: {
        id: "user-test",
        name: "Test User",
        email: "test@example.com",
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
    status: "authenticated",
    update: vi.fn(),
  });
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
    status: 200,
    statusText: "OK",
    headers: new Headers(),
  } as Response);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---- Tests ----

// The select-all ids request among the POST-route calls: it names its select
// shape "ids" (no post-fetch filter) or "selectAll:<fields>" (with one).
const selectAllIdsArgs = () =>
  (useRepositoryCasesQuery as any).mock.calls.find(([args]: any[]) => {
    const key = String(args?.selectKey ?? "");
    return key === "ids" || key.startsWith("selectAll:");
  })?.[0];

const selectAllIdsSelect = () => selectAllIdsArgs()?.select;

describe("Select all ids query", () => {
  it("asks only for ids when no post-fetch filter is active", async () => {
    setupMocks({ data: [mockCase] });

    render(<Cases {...defaultProps} viewType="folders" folderId={1} />);
    await screen.findByTestId("data-table");

    // Nothing has to be matched in memory, so the route returns bare ids and
    // no row is hydrated at all.
    const args = selectAllIdsArgs();
    expect(args.idsOnly).toBe(true);
    expect(args.select).toBeUndefined();
    expect(args.selectKey).toBe("ids");
  });

  it("includes the field values a text filter is applied to", async () => {
    setupMocks({ data: [mockCase] });

    render(
      <Cases
        {...defaultProps}
        viewType="dynamic_15_Text Long"
        {...predicateProps([
          { dimension: "field_15", operator: "contains", values: ["hello"] },
        ])}
      />
    );
    await screen.findByTestId("data-table");

    const select = selectAllIdsSelect();
    expect(select.caseFieldValues.where.fieldId).toEqual({ in: [15] });
    expect(select.caseFieldValues.select).toEqual({
      fieldId: true,
      value: true,
    });
    // Orphaned values are stripped against the template before filtering.
    expect(select.template).toBeDefined();
    expect(select.steps).toBeUndefined();
  });

  it("includes steps when a steps filter is applied", async () => {
    setupMocks({ data: [mockCase] });

    render(
      <Cases
        {...defaultProps}
        viewType="dynamic_3_Steps"
        {...predicateProps([
          { dimension: "field_3", operator: "gte", values: [1] },
        ])}
      />
    );
    await screen.findByTestId("data-table");

    const select = selectAllIdsSelect();
    expect(select.steps.where.isDeleted).toBe(false);
    expect(select.caseFieldValues).toBeUndefined();
  });
});

describe("Cases component", () => {
  it("renders loading state when data is loading", async () => {
    setupMocks({ isLoading: true, data: [] });

    render(<Cases {...defaultProps} />);

    // When loading, DataTable is rendered with isLoading=true
    const dataTable = await screen.findByTestId("data-table");
    expect(dataTable).toBeInTheDocument();
    expect(dataTable.getAttribute("data-loading")).toBe("true");
  });

  it("renders DataTable with case data when loaded", async () => {
    setupMocks({
      data: [mockCase, { ...mockCase, id: 2, name: "Test Case 2" }],
    });

    render(<Cases {...defaultProps} />);

    const dataTable = await screen.findByTestId("data-table");
    expect(dataTable).toBeInTheDocument();
    // DataTable should show data count
    expect(dataTable.getAttribute("data-count")).toBe("2");
  });

  it("renders pagination controls", async () => {
    setupMocks({ data: [mockCase] });

    render(<Cases {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId("pagination-component")).toBeInTheDocument();
    });
    expect(screen.getByTestId("pagination-info")).toBeInTheDocument();
  });

  it("renders filter/search component", async () => {
    setupMocks({ data: [] });

    render(<Cases {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId("filter-component")).toBeInTheDocument();
    });
  });

  it("renders empty state when no cases returned", async () => {
    setupMocks({ data: [], isLoading: false });

    render(<Cases {...defaultProps} viewType="all" folderId={1} />);

    // When no cases exist and loading is done, the component shows empty state message
    // (not a DataTable) — the card structure and header components should be rendered
    await waitFor(() => {
      // The filter, pagination and column-selection stubs should still be present
      expect(screen.getByTestId("filter-component")).toBeInTheDocument();
      expect(screen.getByTestId("column-selection")).toBeInTheDocument();
      // DataTable should NOT be shown when there are no cases
      expect(screen.queryByTestId("data-table")).toBeNull();
    });
  });

  it("renders AddCaseRow when canAddEdit=true and folderId is provided", async () => {
    setupMocks({ data: [mockCase], canAddEdit: true });

    render(
      <Cases
        {...defaultProps}
        folderId={1}
        viewType="folders"
        canAddEdit={true}
        canAddEditRun={false}
        isRunMode={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("add-case-row")).toBeInTheDocument();
    });
  });

  it("does not render AddCaseRow when canAddEdit=false", async () => {
    setupMocks({ data: [mockCase], canAddEdit: false });

    render(
      <Cases
        {...defaultProps}
        folderId={1}
        viewType="folders"
        canAddEdit={false}
        canAddEditRun={false}
        isRunMode={false}
      />
    );

    await waitFor(() => {
      // DataTable should render (cases loaded)
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("add-case-row")).not.toBeInTheDocument();
  });

  it("renders SelectedTestCasesDrawer in selection mode", async () => {
    setupMocks({ data: [mockCase] });
    const onSelectionChange = vi.fn();

    render(
      <Cases
        {...defaultProps}
        isSelectionMode={true}
        selectedTestCases={[]}
        onSelectionChange={onSelectionChange}
        hideHeader={false}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("selected-test-cases-drawer")
      ).toBeInTheDocument();
    });
  });

  it("does not render SelectedTestCasesDrawer when hideHeader=true", async () => {
    setupMocks({ data: [mockCase] });
    const onSelectionChange = vi.fn();

    render(
      <Cases
        {...defaultProps}
        isSelectionMode={true}
        selectedTestCases={[]}
        onSelectionChange={onSelectionChange}
        hideHeader={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });

    expect(
      screen.queryByTestId("selected-test-cases-drawer")
    ).not.toBeInTheDocument();
  });

  it("renders BulkEditModal and ExportModal when project is valid", async () => {
    setupMocks({ data: [mockCase] });

    render(<Cases {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId("bulk-edit-modal")).toBeInTheDocument();
      expect(screen.getByTestId("export-modal")).toBeInTheDocument();
    });
  });

  it("renders column selection component", async () => {
    setupMocks({ data: [] });

    render(<Cases {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId("column-selection")).toBeInTheDocument();
    });
  });

  it("redirects to home when session is not authenticated", async () => {
    const mockPush = vi.fn();
    const { useRouter } = await import("~/lib/navigation");
    (useRouter as any).mockReturnValue({
      push: mockPush,
      replace: vi.fn(),
      refresh: vi.fn(),
    });

    (NextAuth.useSession as any).mockReturnValue({
      data: null,
      status: "unauthenticated",
      update: vi.fn(),
    });

    render(<Cases {...defaultProps} />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/");
    });
  });

  it("renders nothing while session is loading", () => {
    (NextAuth.useSession as any).mockReturnValue({
      data: null,
      status: "loading",
      update: vi.fn(),
    });

    const { container } = render(<Cases {...defaultProps} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders in isRunMode without crashing and shows UI controls", async () => {
    // In run mode, cases come from useFindManyTestRunCases, not the filtered hook.
    // With no runId in params and empty testRunCases, the empty run state is shown.
    setupMocks({ data: [] });

    render(<Cases {...defaultProps} isRunMode={true} canAddEditRun={true} />);

    // The card structure with filter and column selection should still render
    await waitFor(() => {
      expect(screen.getByTestId("filter-component")).toBeInTheDocument();
      expect(screen.getByTestId("column-selection")).toBeInTheDocument();
    });
  });

  it("shows select folder message when viewType is folders and no folderId", async () => {
    setupMocks({ data: [] });

    render(
      <Cases
        {...defaultProps}
        viewType="folders"
        folderId={null}
        searchResultIds={undefined}
      />
    );

    await waitFor(() => {
      // When viewType is "folders" and no folderId and no searchResultIds
      // the component shows a "select folder" message
      expect(screen.queryByTestId("data-table")).not.toBeInTheDocument();
    });
  });

  it("bypasses the select-folder wall and queries project-wide when predicates are active", async () => {
    setupMocks({ data: [mockCase] });

    render(
      <Cases
        {...defaultProps}
        viewType="folders"
        folderId={null}
        searchResultIds={undefined}
        {...predicateProps([
          { dimension: "templates", operator: "in", values: [7] },
        ])}
      />
    );

    // Spec §7.1: with ≥1 active predicate and no folder selected, the wall is
    // bypassed — the table renders instead of the "select folder" message.
    const dataTable = await screen.findByTestId("data-table");
    expect(dataTable.getAttribute("data-count")).toBe("1");

    // The list query ran (not disabled by the folder gate) and its where has
    // no folder scoping — project-wide, with the predicate fragment applied.
    const listCall = postListCall();
    expect(listCall).toBeDefined();
    expect(listCall.enabled).toBe(true);
    expect(JSON.stringify(listCall.where)).not.toContain("folderId");
    expect(listCall.where.AND).toContainEqual({
      templateId: { in: [7] },
    });
  });

  it("renders with showDescendants and descendantFolderIds props", async () => {
    const casesInMultipleFolders = [
      { ...mockCase, id: 1, name: "Case in Parent", folderId: 10 },
      { ...mockCase, id: 2, name: "Case in Child", folderId: 20 },
    ];
    setupMocks({ data: casesInMultipleFolders });

    render(
      <Cases
        {...defaultProps}
        folderId={10}
        viewType="folders"
        showDescendants={true}
        descendantFolderIds={[10, 20, 30]}
        folderPathMap={
          new Map([
            [10, "Parent"],
            [20, "Parent > Child"],
            [30, "Parent > Other"],
          ])
        }
      />
    );

    // DataTable should render with the cases from multiple folders
    const dataTable = await screen.findByTestId("data-table");
    expect(dataTable).toBeInTheDocument();
    expect(dataTable.getAttribute("data-count")).toBe("2");
  });

  it("renders without descendant props (default behavior)", async () => {
    setupMocks({ data: [mockCase] });

    render(<Cases {...defaultProps} folderId={10} viewType="folders" />);

    const dataTable = await screen.findByTestId("data-table");
    expect(dataTable).toBeInTheDocument();
    expect(dataTable.getAttribute("data-count")).toBe("1");
  });

  // The default DataTable stub does not render interactive rows. Swap in a stub
  // that exposes a button to drive the table's row-selection callback, so a test
  // can simulate selecting the first visible case. Returns a restore function;
  // afterEach's clearAllMocks does not reset implementations, so callers must
  // restore to avoid leaking the stub into later tests.
  function installSelectableDataTable() {
    const dataTableMock = vi.mocked(DataTable);
    const originalImpl = dataTableMock.getMockImplementation();
    dataTableMock.mockImplementation(({ onRowSelectionChange }: any) => (
      <button
        data-testid="simulate-select-first-row"
        onClick={() => onRowSelectionChange?.(() => ({ "0": true }))}
      >
        select first row
      </button>
    ));
    return () => dataTableMock.mockImplementation(originalImpl!);
  }

  it("clears the bulk-edit selection when switching folders", async () => {
    const restoreDataTable = installSelectableDataTable();
    try {
      setupMocks({ data: [{ ...mockCase, id: 101, folderId: 1 }] });

      const { rerender } = render(
        <Cases {...defaultProps} viewType="folders" folderId={1} />
      );

      // Selecting a case in folder 1 surfaces the bulk-edit action.
      fireEvent.click(await screen.findByTestId("simulate-select-first-row"));
      expect(await screen.findByTestId("bulk-edit-button")).toBeInTheDocument();

      // Navigating to a different folder must clear the selection so a bulk
      // action can't silently span cases the user can no longer see.
      setupMocks({ data: [{ ...mockCase, id: 202, folderId: 2 }] });
      rerender(<Cases {...defaultProps} viewType="folders" folderId={2} />);

      await waitFor(() => {
        expect(
          screen.queryByTestId("bulk-edit-button")
        ).not.toBeInTheDocument();
      });
    } finally {
      restoreDataTable();
    }
  });

  it("keeps the bulk-edit selection when paginating within the same folder", async () => {
    const restoreDataTable = installSelectableDataTable();
    try {
      setupMocks({ data: [{ ...mockCase, id: 101, folderId: 1 }] });

      const { rerender } = render(
        <Cases {...defaultProps} viewType="folders" folderId={1} />
      );

      fireEvent.click(await screen.findByTestId("simulate-select-first-row"));
      expect(await screen.findByTestId("bulk-edit-button")).toBeInTheDocument();

      // Changing pages within the same folder must NOT clear the selection —
      // the cross-page merge logic depends on it persisting across pages.
      setupMocks({
        data: [{ ...mockCase, id: 101, folderId: 1 }],
        paginationOverrides: { currentPage: 2 },
      });
      rerender(<Cases {...defaultProps} viewType="folders" folderId={1} />);

      // Give effects a chance to (incorrectly) clear before asserting it stayed.
      await waitFor(() => {
        expect(screen.getByTestId("bulk-edit-button")).toBeInTheDocument();
      });
    } finally {
      restoreDataTable();
    }
  });

  it("clears the bulk-edit selection when the filter changes", async () => {
    const restoreDataTable = installSelectableDataTable();
    try {
      setupMocks({ data: [{ ...mockCase, id: 101, folderId: 1 }] });

      const { rerender } = render(
        <Cases
          {...defaultProps}
          viewType="folders"
          folderId={1}
          {...predicateProps([])}
        />
      );

      fireEvent.click(await screen.findByTestId("simulate-select-first-row"));
      expect(await screen.findByTestId("bulk-edit-button")).toBeInTheDocument();

      // Changing the filter swaps which cases are visible, so the selection is
      // scoped out the same way a folder switch is.
      setupMocks({ data: [{ ...mockCase, id: 202, folderId: 1 }] });
      rerender(
        <Cases
          {...defaultProps}
          viewType="folders"
          folderId={1}
          {...predicateProps([
            { dimension: "templates", operator: "in", values: [7] },
          ])}
        />
      );

      await waitFor(() => {
        expect(
          screen.queryByTestId("bulk-edit-button")
        ).not.toBeInTheDocument();
      });
    } finally {
      restoreDataTable();
    }
  });

  it("clears the bulk-edit selection when the search changes", async () => {
    const restoreDataTable = installSelectableDataTable();
    try {
      setupMocks({ data: [{ ...mockCase, id: 101, folderId: 1 }] });

      const { rerender } = render(
        <Cases
          {...defaultProps}
          viewType="folders"
          folderId={1}
          searchResultIds={[101]}
          searchKey="login"
          searchText="login"
        />
      );

      fireEvent.click(await screen.findByTestId("simulate-select-first-row"));
      expect(await screen.findByTestId("bulk-edit-button")).toBeInTheDocument();

      // The search narrows the visible set exactly like a predicate does, so
      // the selection is scoped out the same way — a bulk action must not span
      // cases the new search excludes.
      setupMocks({ data: [{ ...mockCase, id: 202, folderId: 1 }] });
      rerender(
        <Cases
          {...defaultProps}
          viewType="folders"
          folderId={1}
          searchResultIds={[202]}
          searchKey="checkout"
          searchText="checkout"
        />
      );

      await waitFor(() => {
        expect(
          screen.queryByTestId("bulk-edit-button")
        ).not.toBeInTheDocument();
      });
    } finally {
      restoreDataTable();
    }
  });

  it("does not clear the parent-owned selection on folder switch in selection mode", async () => {
    const onSelectionChange = vi.fn();
    setupMocks({ data: [{ ...mockCase, id: 101, folderId: 1 }] });

    const { rerender } = render(
      <Cases
        {...defaultProps}
        isSelectionMode={true}
        selectedTestCases={[101]}
        onSelectionChange={onSelectionChange}
        viewType="folders"
        folderId={1}
      />
    );

    await screen.findByTestId("data-table");

    // Run-mode selection is owned by the parent and may legitimately span
    // folders, so switching folders must not reset it.
    setupMocks({ data: [{ ...mockCase, id: 202, folderId: 2 }] });
    rerender(
      <Cases
        {...defaultProps}
        isSelectionMode={true}
        selectedTestCases={[101]}
        onSelectionChange={onSelectionChange}
        viewType="folders"
        folderId={2}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });
    expect(onSelectionChange).not.toHaveBeenCalledWith([]);
  });
});

// The list request among the POST-route calls: it is the one carrying the row
// select (the ids-only / count-only calls do not).
const postListCall = () =>
  (useRepositoryCasesQuery as any).mock.calls.find(
    ([args]: any[]) => args?.select?.name === true
  )?.[0];

const postCallsEnabled = () =>
  (useRepositoryCasesQuery as any).mock.calls.filter(
    ([args]: any[]) => args?.enabled
  );

describe("Search x filter intersection (spec §9)", () => {
  it("routes the list through the POST query route, composing predicates with the search ids", async () => {
    setupMocks({ data: [mockCase] });

    render(
      <Cases
        {...defaultProps}
        viewType="folders"
        folderId={1}
        searchResultIds={[7, 3, 9]}
        searchKey="login"
        {...predicateProps([
          { dimension: "templates", operator: "in", values: [7] },
        ])}
      />
    );
    await screen.findByTestId("data-table");

    const listCall = postListCall();
    expect(listCall.enabled).toBe(true);
    expect(listCall.searchCaseIds).toEqual([7, 3, 9]);
    expect(listCall.searchKey).toBe("login");
    // The predicates and the folder scope ride in the same where — search
    // intersects, it does not bypass.
    expect(listCall.where.AND).toContainEqual({ templateId: { in: [7] } });
    expect(JSON.stringify(listCall.where)).toContain("folderId");
    // Default sort => relevance order, which the route only applies when no
    // orderBy is given.
    expect(listCall.orderBy).toBeUndefined();

    // There is no second transport left to disagree with: the count rides on
    // this very response.
    expect(postListCall().selectKey).toBe("list");
  });

  it("hands the table sort to the DB instead of relevance once the user has sorted", async () => {
    const { readStoredColumnSort } =
      await import("@/components/tables/ColumnSelection");
    (readStoredColumnSort as any).mockReturnValue({
      column: "name",
      direction: "desc",
    });
    try {
      setupMocks({ data: [mockCase] });

      render(
        <Cases
          {...defaultProps}
          viewType="folders"
          folderId={1}
          searchResultIds={[7, 3]}
          searchKey="login"
        />
      );
      await screen.findByTestId("data-table");

      expect(postListCall().orderBy).toEqual({ name: "desc" });
      expect(screen.queryByTestId("sorted-by-relevance")).toBeNull();
    } finally {
      (readStoredColumnSort as any).mockReturnValue(null);
    }
  });

  it("surfaces the active relevance order and disables reordering during search", async () => {
    setupMocks({ data: [mockCase] });

    render(
      <Cases
        {...defaultProps}
        viewType="folders"
        folderId={1}
        searchResultIds={[1]}
        searchKey="login"
      />
    );
    await screen.findByTestId("data-table");

    expect(screen.getByTestId("sorted-by-relevance")).toBeInTheDocument();
    const tableProps = vi.mocked(DataTable).mock.calls.at(-1)?.[0] as any;
    expect(tableProps.enableReorder).toBe(false);
  });

  it("keeps reordering enabled when only filter chips are active", async () => {
    setupMocks({ data: [mockCase] });

    render(
      <Cases
        {...defaultProps}
        viewType="folders"
        folderId={1}
        {...predicateProps([
          { dimension: "templates", operator: "in", values: [7] },
        ])}
      />
    );
    await screen.findByTestId("data-table");

    const tableProps = vi.mocked(DataTable).mock.calls.at(-1)?.[0] as any;
    expect(tableProps.enableReorder).toBe(true);
  });

  it("takes the total from the route, not from the raw search id count", async () => {
    setupMocks({ data: [mockCase] });
    const setTotalItems = vi.fn();
    (usePagination as any).mockReturnValue({
      currentPage: 1,
      setCurrentPage: vi.fn(),
      pageSize: 25,
      setPageSize: vi.fn(),
      totalItems: 1,
      setTotalItems,
      totalPages: 1,
      startIndex: 1,
      endIndex: 1,
    });
    // The route intersected 4 raw hits down to 1 readable, unarchived case.
    (useRepositoryCasesQuery as any).mockReturnValue({
      data: [mockCase],
      ids: [1],
      isLoading: false,
      isFetching: false,
      error: null,
      totalCount: 1,
      refetch: vi.fn(),
    });

    render(
      <Cases
        {...defaultProps}
        viewType="folders"
        folderId={1}
        searchResultIds={[1, 2, 3, 4]}
        searchKey="login"
      />
    );
    await screen.findByTestId("data-table");

    expect(setTotalItems).toHaveBeenCalledWith(1);
    expect(setTotalItems).not.toHaveBeenCalledWith(4);
  });

  it("intersects an all-filtered export with the active search", async () => {
    setupMocks({ data: [mockCase] });

    render(
      <Cases
        {...defaultProps}
        viewType="folders"
        folderId={1}
        searchResultIds={[7, 3]}
        searchKey="login"
      />
    );
    await screen.findByTestId("data-table");

    (fetchAllCasesForExport as any).mockResolvedValue({
      success: true,
      data: [],
    });
    const exportArgs = (useExportData as any).mock.calls.at(-1)[0];
    await exportArgs.fetchAllData({ scope: "allFiltered" });

    expect(
      (fetchAllCasesForExport as any).mock.calls.at(-1)[0].searchCaseIds
    ).toEqual([7, 3]);
  });

  it("shows the filters-aware empty state when the intersection is empty", async () => {
    setupMocks({ data: [] });

    render(
      <Cases
        {...defaultProps}
        viewType="folders"
        folderId={1}
        searchResultIds={[]}
        searchKey="nothing"
        {...predicateProps([
          { dimension: "templates", operator: "in", values: [7] },
        ])}
      />
    );

    expect(
      await screen.findByText("repository.filterBar.noMatchingCases")
    ).toBeInTheDocument();
  });
});

// The POST select-all request (idsOnly), whose `enabled` mirrors the in-flight
// select-all state.
const idsOnlyCall = () =>
  (useRepositoryCasesQuery as any).mock.calls
    .filter(([args]: any[]) => args?.idsOnly === true)
    .at(-1)?.[0];

describe("Unresolved search never falls back to the unfiltered list (spec §9)", () => {
  it("shows loading, not the whole repository, while the search ids resolve", async () => {
    setupMocks({ data: [mockCase] });

    render(
      <Cases
        {...defaultProps}
        viewType="folders"
        folderId={1}
        searchText="login"
        searchPending
      />
    );
    await screen.findByTestId("data-table");

    // Every list query is gated off: none of their where clauses carry the
    // search ids, so their rows would be the unfiltered repository presented
    // as the search result.
    expect(postCallsEnabled()).toHaveLength(0);

    const tableProps = vi.mocked(DataTable).mock.calls.at(-1)?.[0] as any;
    expect(tableProps.isLoading).toBe(true);
    expect(tableProps.data).toEqual([]);
  });

  it("does not fall back to the select-folder wall on a shared ?q= link", async () => {
    setupMocks({ data: [] });

    render(
      <Cases
        {...defaultProps}
        viewType="folders"
        folderId={null}
        searchText="login"
        searchPending
      />
    );

    expect(screen.queryByText("repository.cases.selectFolder")).toBeNull();
    const tableProps = vi.mocked(DataTable).mock.calls.at(-1)?.[0] as any;
    expect(tableProps.isLoading).toBe(true);
  });

  it("renders the error state instead of a list when the search failed", async () => {
    setupMocks({ data: [mockCase] });

    render(
      <Cases
        {...defaultProps}
        viewType="folders"
        folderId={1}
        searchText="login"
        searchFailed
      />
    );

    expect(
      await screen.findByTestId("search-failed-message")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("data-table")).toBeNull();
    expect(postCallsEnabled()).toHaveLength(0);
  });

  it("abandons an in-flight select-all when the search changes", async () => {
    setupMocks({ data: [mockCase] });
    // Keep the select-all ids request in flight (no ids yet) so its `enabled`
    // flag stays observable; the list request keeps its rows.
    (useRepositoryCasesQuery as any).mockImplementation((args: any) =>
      args?.idsOnly
        ? {
            data: undefined,
            ids: undefined,
            isLoading: true,
            isFetching: true,
            error: null,
            totalCount: 0,
            refetch: vi.fn(),
          }
        : {
            data: [mockCase],
            ids: [1],
            isLoading: false,
            isFetching: false,
            error: null,
            totalCount: 1,
            refetch: vi.fn(),
          }
    );

    const { rerender } = render(
      <Cases
        {...defaultProps}
        viewType="folders"
        folderId={1}
        searchResultIds={[1]}
        searchKey="login"
        searchText="login"
      />
    );
    await screen.findByTestId("data-table");

    // Shift+click select-all: handleSelectAllClick is the 16th positional
    // argument getColumns receives.
    const selectAllClick = (getColumns as any).mock.calls.at(-1)[15];
    expect(typeof selectAllClick).toBe("function");
    await act(async () => {
      selectAllClick({ shiftKey: true });
    });
    expect(idsOnlyCall()?.enabled).toBe(true);

    // A different search is a different view: the ids now in flight belong to
    // the previous one and must never be applied to what is on screen.
    rerender(
      <Cases
        {...defaultProps}
        viewType="folders"
        folderId={1}
        searchResultIds={[2]}
        searchKey="checkout"
        searchText="checkout"
      />
    );

    await waitFor(() => {
      expect(idsOnlyCall()?.enabled).toBe(false);
    });
  });
});

describe("Id-resolved sorts under filters and search", () => {
  const useLatestResultsSort = async () => {
    const { readStoredColumnSort } =
      await import("@/components/tables/ColumnSelection");
    (readStoredColumnSort as any).mockReturnValue({
      column: "latestResults",
      direction: "asc",
    });
    return () => (readStoredColumnSort as any).mockReturnValue(null);
  };

  it("keeps the predicates in the POST where alongside the resolved page ids", async () => {
    const restoreSort = await useLatestResultsSort();
    try {
      idSortHolder.latest = { pageIds: [1], isFetching: false };
      setupMocks({ data: [mockCase] });

      render(
        <Cases
          {...defaultProps}
          viewType="folders"
          folderId={1}
          searchResultIds={[1, 4, 7]}
          searchKey="login"
          searchText="login"
          {...predicateProps([
            { dimension: "templates", operator: "in", values: [7] },
          ])}
        />
      );
      await screen.findByTestId("data-table");

      // The page ids narrow the fetch, but the predicates travel with them:
      // between a predicate edit and the ids re-resolving, an id-only where
      // would hydrate rows the active filters exclude.
      const listCall = postListCall();
      expect(listCall.where.id).toEqual({ in: [1] });
      expect(listCall.where.AND).toContainEqual({ templateId: { in: [7] } });
    } finally {
      restoreSort();
    }
  });

  it("resolves the ordered page against the search ids instead of degrading to default order", async () => {
    const restoreSort = await useLatestResultsSort();
    try {
      idSortHolder.latest = { pageIds: [1], isFetching: false };
      setupMocks({ data: [mockCase] });

      render(
        <Cases
          {...defaultProps}
          viewType="folders"
          folderId={1}
          searchResultIds={[1, 4, 7]}
          searchKey="login"
          searchText="login"
        />
      );
      await screen.findByTestId("data-table");

      // The paginated resolver (the one carrying skip/take) is the list's;
      // the unpaginated twin drives the details panel's prev/next.
      const args = idSortHolder.latestArgs
        .filter((a) => a.skip !== undefined)
        .at(-1);
      expect(args.enabled).toBe(true);
      expect(args.where.AND).toContainEqual({ id: { in: [1, 4, 7] } });
      // The sort really is what's on screen, so the relevance pill stays away.
      expect(screen.queryByTestId("sorted-by-relevance")).toBeNull();
    } finally {
      restoreSort();
    }
  });

  it("stops resolving the ordered page while the search is unresolved", async () => {
    const restoreSort = await useLatestResultsSort();
    try {
      setupMocks({ data: [mockCase] });

      render(
        <Cases
          {...defaultProps}
          viewType="folders"
          folderId={1}
          searchText="login"
          searchPending
        />
      );

      // Resolving here would order the un-searched superset.
      expect(idSortHolder.latestArgs.every((a) => a.enabled === false)).toBe(
        true
      );
    } finally {
      restoreSort();
    }
  });
});

describe("One transport for the list", () => {
  // 800 tag ids serialize well past any GET budget. The clause size used to
  // decide the transport; now it decides nothing, which is the point — there is
  // no threshold left for the list query and the count query to answer
  // differently.
  const heavyPredicate = {
    dimension: "tags",
    operator: "any",
    values: Array.from({ length: 800 }, (_, i) => i + 1),
  } as FilterPredicate;

  it("takes the list and its total from one POST response when the where is oversized", async () => {
    setupMocks({ data: [mockCase] });
    const setTotalItems = vi.fn();
    (usePagination as any).mockReturnValue({
      currentPage: 1,
      setCurrentPage: vi.fn(),
      pageSize: 25,
      setPageSize: vi.fn(),
      totalItems: 97,
      setTotalItems,
      totalPages: 4,
      startIndex: 1,
      endIndex: 25,
    });
    (useRepositoryCasesQuery as any).mockReturnValue({
      data: [mockCase],
      ids: [1],
      caseIds: undefined,
      isLoading: false,
      isFetching: false,
      error: null,
      totalCount: 97,
      refetch: vi.fn(),
    });

    render(
      <Cases
        {...defaultProps}
        viewType="folders"
        folderId={1}
        {...predicateProps([heavyPredicate])}
      />
    );
    await screen.findByTestId("data-table");

    const listCall = postListCall();
    expect(listCall.enabled).toBe(true);
    expect(listCall.searchCaseIds).toBeUndefined();
    // The total published to the pagination context came from the list
    // response — list and count share one source, so they cannot disagree.
    expect(setTotalItems).toHaveBeenCalledWith(97);
  });

  it("routes an ordinary filter set through the same POST call", async () => {
    setupMocks({ data: [mockCase] });

    render(
      <Cases
        {...defaultProps}
        viewType="folders"
        folderId={1}
        {...predicateProps([
          { dimension: "templates", operator: "in", values: [7] },
        ])}
      />
    );
    await screen.findByTestId("data-table");

    const listCall = postListCall();
    expect(listCall.enabled).toBe(true);
    expect(listCall.testRunIds).toBeUndefined();
    expect(listCall.where.AND).toContainEqual({ templateId: { in: [7] } });
  });

  it("reads the run list from the same route, scoped to the run", async () => {
    setupMocks({ data: [] });

    render(
      <Cases
        {...defaultProps}
        isRunMode
        selectedRunIds={[31, 32]}
        viewType="all"
      />
    );
    await screen.findByTestId("column-selection");

    const runCall = (useRepositoryCasesQuery as any).mock.calls.find(
      ([args]: any[]) => args?.selectKey === "runList"
    )?.[0];
    expect(runCall).toBeDefined();
    expect(runCall.enabled).toBe(true);
    // The run scope is a first-class parameter, not something smuggled into
    // the repository predicate.
    expect(runCall.testRunIds).toEqual([31, 32]);
    // The repository half travels nested, so the route can AND it under
    // `repositoryCase`.
    expect(JSON.stringify(runCall.repositoryCaseWhere)).toContain("projectId");
    expect(runCall.where.isDeleted).toBe(false);
  });
});
