import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("~/lib/hooks", () => ({
  useCountProjects: vi.fn(() => ({ data: 2, isLoading: false })),
  useFindManyRepositoryFolders: vi.fn(() => ({ data: [], isLoading: false })),
  useCountRepositoryCases: vi.fn(() => ({ data: 0, isLoading: false, refetch: vi.fn() })),
  useFindManyTemplates: vi.fn(() => ({ data: [], isLoading: false })),
  useFindUniqueProjects: vi.fn(() => ({ data: null, isLoading: false })),
  useFindManyProjectLlmIntegration: vi.fn(() => ({ data: [], isLoading: false })),
  useFindFirstTestRuns: vi.fn(() => ({ data: null, isLoading: false })),
  useCountTestRunCases: vi.fn(() => ({ data: 0, isLoading: false })),
  useFindManyTestRunCases: vi.fn(() => ({ data: [], isLoading: false, refetch: vi.fn() })),
  useUpdateRepositoryCases: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUpdateTestRunCases: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock("~/hooks/useRepositoryCasesWithFilteredFields", () => ({
  useFindManyRepositoryCasesFiltered: vi.fn(() => ({
    data: [],
    isLoading: false,
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

vi.mock("~/lib/utils/computeLastTestResult", () => ({
  computeLastTestResult: vi.fn(() => null),
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
    <div data-testid="data-table" data-loading={isLoading} data-count={data?.length ?? 0}>
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
    <div data-testid="selected-test-cases-drawer">SelectedTestCasesDrawer stub</div>
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
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import * as NextAuth from "next-auth/react";
import { useFindManyRepositoryCasesFiltered } from "~/hooks/useRepositoryCasesWithFilteredFields";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { usePagination } from "~/lib/contexts/PaginationContext";
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
  lastTestResult: null,
};

const defaultProps = {
  folderId: null,
  viewType: "all",
  filterId: null,
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
  (useFindManyRepositoryCasesFiltered as any).mockReturnValue({
    data,
    isLoading,
    error: null,
    totalCount: data.length,
    refetch: vi.fn(),
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
    setupMocks({ data: [mockCase, { ...mockCase, id: 2, name: "Test Case 2" }] });

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
      expect(screen.getByTestId("selected-test-cases-drawer")).toBeInTheDocument();
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

    expect(screen.queryByTestId("selected-test-cases-drawer")).not.toBeInTheDocument();
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

    render(
      <Cases
        {...defaultProps}
        isRunMode={true}
        canAddEditRun={true}
      />
    );

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
        folderPathMap={new Map([[10, "Parent"], [20, "Parent > Child"], [30, "Parent > Other"]])}
      />
    );

    // DataTable should render with the cases from multiple folders
    const dataTable = await screen.findByTestId("data-table");
    expect(dataTable).toBeInTheDocument();
    expect(dataTable.getAttribute("data-count")).toBe("2");
  });

  it("renders without descendant props (default behavior)", async () => {
    setupMocks({ data: [mockCase] });

    render(
      <Cases
        {...defaultProps}
        folderId={10}
        viewType="folders"
      />
    );

    const dataTable = await screen.findByTestId("data-table");
    expect(dataTable).toBeInTheDocument();
    expect(dataTable.getAttribute("data-count")).toBe("1");
  });
});
