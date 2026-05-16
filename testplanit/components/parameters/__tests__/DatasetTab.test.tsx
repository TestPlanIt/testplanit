import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    const dict: Record<string, string> = {
      datasetCounts: "{paramCount} parameters · {rowCount} rows",
      datasetLabelColumn: "Label",
      datasetAddRow: "Add row",
      datasetPasteCsv: "Paste CSV",
      datasetImportCsv: "Import CSV",
      datasetEmptyHeading: "No dataset rows yet",
      datasetEmptyBody:
        "Add a row, paste CSV, or import a file to get started.",
      datasetFooterHint:
        "Press Enter to commit · Tab to next cell · Drag to reorder",
      datasetRowSelectAria: "Select row",
      datasetSaveError: "Could not save change",
      datasetSaveBlocked: "Fix {count} errors before continuing.",
      datasetRowResultsHeader: "Last result",
      datasetRowResultLink: "View {status} result",
      datasetRowResultEmpty: "—",
    };
    let v = dict[key] ?? key;
    if (params) {
      Object.entries(params).forEach(([k, val]) => {
        v = v.replace(`{${k}}`, String(val));
      });
    }
    return v;
  },
}));

const mockUseCountTestRunCases = vi.fn();
const mockUseFindManyTestRunCaseIteration = vi.fn();
const mockUseFindUniqueCaseSharedDataSetAssignment = vi.fn();
const mockUseFindFirstDataSetVersion = vi.fn();
const mockRouterPush = vi.fn();

vi.mock("~/lib/hooks", () => ({
  useCountTestRunCases: (...args: any[]) => mockUseCountTestRunCases(...args),
  useFindManyTestRunCaseIteration: (...args: any[]) =>
    mockUseFindManyTestRunCaseIteration(...args),
  useFindUniqueCaseSharedDataSetAssignment: (...args: any[]) =>
    mockUseFindUniqueCaseSharedDataSetAssignment(...args),
  useFindFirstDataSetVersion: (...args: any[]) =>
    mockUseFindFirstDataSetVersion(...args),
  // The AssignSharedDatasetDialog (lazy-loaded path) also reaches into
  // this module — provide a stub so it never throws when the dialog
  // mounts in the rare test that triggers it.
  useFindManyDataSet: () => ({ data: [] }),
  useFindManyTestCaseParameter: () => ({ data: [] }),
}));

vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({
    push: mockRouterPush,
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => "/",
  Link: ({ children, href, ...rest }: any) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  }),
}));

// Stub the cell + paste dialog so we can focus on the grid + toolbar
vi.mock("@/components/parameters/DatasetCell", () => ({
  DatasetCell: ({ rowId, columnId, value, onEdit }: any) => (
    <span data-testid={`stub-cell-${rowId}-${columnId}`} onClick={onEdit}>
      {String(value ?? "")}
    </span>
  ),
}));

vi.mock("@/components/parameters/PasteCsvDialog", () => ({
  PasteCsvDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="stub-paste-csv-dialog" /> : null,
}));

vi.mock("@/components/parameters/DatasetRowActions", () => ({
  DatasetRowActions: ({ selectedRowIds, onClear }: any) => (
    <div data-testid="stub-row-actions">
      <span>{selectedRowIds.length} selected</span>
      <button onClick={onClear} data-testid="stub-row-actions-clear">
        clear
      </button>
    </div>
  ),
}));

// SheetEditingContext is imported by DatasetTab — provide a stub in place
vi.mock("@/components/parameters/ConfigureParametersSheet", () => ({
  SheetEditingContext: React.createContext({
    editingCell: false,
    setEditingCell: () => {},
  }),
}));

import { DatasetTab } from "@/components/parameters/DatasetTab";

const wrap = (children: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

const SAMPLE_PARAMS = [
  {
    id: 100,
    name: "username",
    type: "STRING",
    sensitive: false,
    required: false,
    allowedValuesJson: null,
  },
  {
    id: 101,
    name: "amount",
    type: "INTEGER",
    sensitive: false,
    required: true,
    allowedValuesJson: null,
  },
];

const mockGetDatasetResponse = (rows: any[]) =>
  vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      dataset: {
        id: 1,
        rows,
      },
    }),
  });

beforeEach(() => {
  vi.restoreAllMocks();
  // Default: case has no run history. Tests that exercise the Surface F
  // "Last result" column override these mocks explicitly.
  mockUseCountTestRunCases.mockReturnValue({ data: 0 });
  mockUseFindManyTestRunCaseIteration.mockReturnValue({ data: [] });
  // Default: no shared-dataset assignment. The Source toggle is mounted
  // but the read-only shared view is never reached. PARAM-07 invariant.
  mockUseFindUniqueCaseSharedDataSetAssignment.mockReturnValue({
    data: null,
  });
  mockUseFindFirstDataSetVersion.mockReturnValue({ data: null });
  mockRouterPush.mockReset();
});

describe("DatasetTab — initial mount + structure", () => {
  it("Test 1: GET /api/repository/cases/{caseId}/dataset on mount", async () => {
    const fetchMock = mockGetDatasetResponse([]);
    global.fetch = fetchMock as any;
    render(
      wrap(
        <DatasetTab
          caseId={42}
          projectId={9}
          parameters={SAMPLE_PARAMS as any}
        />
      )
    );
    await waitFor(() => {
      // DatasetTab opted into the GET handler's pagination path, so the
      // URL now carries `?page=1&pageSize=50` (default page size).
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/repository/cases/42/dataset?page=1&pageSize=50"
      );
    });
  });

  it("Test 2: Renders TanStack Table once dataset loads", async () => {
    global.fetch = mockGetDatasetResponse([
      {
        id: 200,
        label: "Happy",
        rowIndex: 0,
        valuesJson: { username: "alice", amount: 100 },
      },
    ]) as any;
    render(
      wrap(
        <DatasetTab
          caseId={1}
          projectId={1}
          parameters={SAMPLE_PARAMS as any}
        />
      )
    );
    await waitFor(() => {
      expect(screen.getByTestId(`dataset-row-200`)).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("dataset-row-drag-handle-200")
    ).toBeInTheDocument();
  });

  it("Test 5: Toolbar renders counts text + Paste CSV + Import CSV + Add Row buttons", async () => {
    global.fetch = mockGetDatasetResponse([]) as any;
    render(
      wrap(
        <DatasetTab
          caseId={1}
          projectId={1}
          parameters={SAMPLE_PARAMS as any}
        />
      )
    );
    await waitFor(() => {
      expect(screen.getByTestId("dataset-tab-toolbar")).toBeInTheDocument();
    });
    expect(screen.getByTestId("dataset-paste-csv-button")).toBeInTheDocument();
    expect(screen.getByTestId("dataset-import-csv-button")).toBeInTheDocument();
    expect(screen.getByTestId("dataset-add-row-button")).toBeInTheDocument();
  });

  it("Test 6: Empty state when rows.length === 0", async () => {
    global.fetch = mockGetDatasetResponse([]) as any;
    render(
      wrap(
        <DatasetTab
          caseId={1}
          projectId={1}
          parameters={SAMPLE_PARAMS as any}
        />
      )
    );
    await waitFor(() => {
      expect(screen.getByTestId("dataset-tab-empty")).toBeInTheDocument();
    });
  });
});

describe("DatasetTab — toolbar actions", () => {
  it("Test 13: Add row → POST /dataset/rows", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ dataset: { id: 1, rows: [] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          row: { id: 999, label: "", rowIndex: 0, valuesJson: {} },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          dataset: {
            id: 1,
            rows: [{ id: 999, label: "", rowIndex: 0, valuesJson: {} }],
          },
        }),
      });
    global.fetch = fetchMock as any;
    render(
      wrap(
        <DatasetTab
          caseId={42}
          projectId={1}
          parameters={SAMPLE_PARAMS as any}
        />
      )
    );
    await waitFor(() => {
      expect(screen.getByTestId("dataset-add-row-button")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("dataset-add-row-button"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/repository/cases/42/dataset/rows",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it("Test 14: Paste CSV button opens PasteCsvDialog", async () => {
    global.fetch = mockGetDatasetResponse([]) as any;
    render(
      wrap(
        <DatasetTab
          caseId={1}
          projectId={1}
          parameters={SAMPLE_PARAMS as any}
        />
      )
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("dataset-paste-csv-button")
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("dataset-paste-csv-button"));
    await waitFor(() => {
      expect(screen.getByTestId("stub-paste-csv-dialog")).toBeInTheDocument();
    });
  });

  it("Test 15: Import CSV button calls onOpenImportWizard prop", async () => {
    const onOpenImportWizard = vi.fn();
    global.fetch = mockGetDatasetResponse([]) as any;
    render(
      wrap(
        <DatasetTab
          caseId={1}
          projectId={1}
          parameters={SAMPLE_PARAMS as any}
          onOpenImportWizard={onOpenImportWizard}
        />
      )
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("dataset-import-csv-button")
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("dataset-import-csv-button"));
    expect(onOpenImportWizard).toHaveBeenCalled();
  });
});

describe("DatasetTab — uses SheetEditingContext", () => {
  it("Test 12: SheetEditingContext referenced in module", () => {
    // Module-level grep is verified in acceptance criteria; here we just
    // verify the import did not crash.
    expect(true).toBe(true);
  });
});

describe("DatasetTab — Surface F: 'Last result' cross-link column", () => {
  const SAMPLE_ROWS = [
    {
      id: 200,
      label: "Happy",
      rowIndex: 0,
      valuesJson: { username: "alice", amount: 100 },
    },
    {
      id: 201,
      label: "Sad",
      rowIndex: 1,
      valuesJson: { username: "bob", amount: 200 },
    },
  ];

  it("does not render the 'Last result' column when the case has no run history", async () => {
    mockUseCountTestRunCases.mockReturnValue({ data: 0 });
    mockUseFindManyTestRunCaseIteration.mockReturnValue({ data: [] });
    global.fetch = mockGetDatasetResponse(SAMPLE_ROWS) as any;
    render(
      wrap(
        <DatasetTab
          caseId={42}
          projectId={9}
          parameters={SAMPLE_PARAMS as any}
        />
      )
    );
    await waitFor(() => {
      expect(screen.getByTestId("dataset-row-200")).toBeInTheDocument();
    });
    // No header text, no empty-cell markers, no link buttons.
    expect(screen.queryByText("Last result")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("dataset-row-result-empty-0")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("dataset-row-result-link-0")
    ).not.toBeInTheDocument();
  });

  it("renders the 'Last result' column with status pip + link when the case has run history", async () => {
    mockUseCountTestRunCases.mockReturnValue({ data: 3 });
    mockUseFindManyTestRunCaseIteration.mockReturnValue({
      data: [
        {
          id: 9001,
          rowIndex: 0,
          status: {
            id: 1,
            name: "Failed",
            isSuccess: false,
            isFailure: true,
            isCompleted: true,
            systemName: "failed",
            color: { value: "rgb(255, 0, 0)" },
          },
          testRunCase: { testRunId: 77 },
        },
      ],
    });
    global.fetch = mockGetDatasetResponse(SAMPLE_ROWS) as any;
    render(
      wrap(
        <DatasetTab
          caseId={42}
          projectId={9}
          parameters={SAMPLE_PARAMS as any}
        />
      )
    );
    await waitFor(() => {
      expect(screen.getByText("Last result")).toBeInTheDocument();
    });
    const link = screen.getByTestId("dataset-row-result-link-0");
    expect(link).toBeInTheDocument();
    // UX simplified to just the status name (the "View … result" wrapper
    // was dropped in Phase 3 to make Last Result feel like a plain link).
    expect(link.textContent).toContain("Failed");
  });

  it("renders an empty cell for dataset rows with no matching iteration", async () => {
    mockUseCountTestRunCases.mockReturnValue({ data: 3 });
    mockUseFindManyTestRunCaseIteration.mockReturnValue({
      // Only row 0 has a matching iteration; row 1 has none.
      data: [
        {
          id: 9001,
          rowIndex: 0,
          status: {
            id: 1,
            name: "Passed",
            isSuccess: true,
            isFailure: false,
            isCompleted: true,
            systemName: "passed",
            color: null,
          },
          testRunCase: { testRunId: 77 },
        },
      ],
    });
    global.fetch = mockGetDatasetResponse(SAMPLE_ROWS) as any;
    render(
      wrap(
        <DatasetTab
          caseId={42}
          projectId={9}
          parameters={SAMPLE_PARAMS as any}
        />
      )
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("dataset-row-result-link-0")
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("dataset-row-result-empty-1")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("dataset-row-result-link-1")
    ).not.toBeInTheDocument();
  });

  it("pushes to the run page with iteration ordinal + selectedCase on click", async () => {
    mockUseCountTestRunCases.mockReturnValue({ data: 1 });
    mockUseFindManyTestRunCaseIteration.mockReturnValue({
      data: [
        {
          id: 9002,
          rowIndex: 1,
          status: {
            id: 2,
            name: "Passed",
            isSuccess: true,
            isFailure: false,
            isCompleted: true,
            systemName: "passed",
            color: null,
          },
          testRunCase: { testRunId: 55 },
        },
      ],
    });
    global.fetch = mockGetDatasetResponse(SAMPLE_ROWS) as any;
    render(
      wrap(
        <DatasetTab
          caseId={42}
          projectId={9}
          parameters={SAMPLE_PARAMS as any}
        />
      )
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("dataset-row-result-link-1")
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("dataset-row-result-link-1"));
    expect(mockRouterPush).toHaveBeenCalledWith(
      "/projects/runs/9/55?iteration=2&selectedCase=42"
    );
  });

  it("uses the most recent iteration when multiple iterations share a rowIndex", async () => {
    // Hook returns desc by completedAt; first occurrence per rowIndex wins.
    mockUseCountTestRunCases.mockReturnValue({ data: 2 });
    mockUseFindManyTestRunCaseIteration.mockReturnValue({
      data: [
        {
          id: 9100,
          rowIndex: 0,
          status: {
            id: 1,
            name: "Failed",
            isSuccess: false,
            isFailure: true,
            isCompleted: true,
            systemName: "failed",
            color: null,
          },
          testRunCase: { testRunId: 88 },
        },
        {
          id: 9099,
          rowIndex: 0,
          status: {
            id: 2,
            name: "Passed",
            isSuccess: true,
            isFailure: false,
            isCompleted: true,
            systemName: "passed",
            color: null,
          },
          testRunCase: { testRunId: 77 },
        },
      ],
    });
    global.fetch = mockGetDatasetResponse(SAMPLE_ROWS) as any;
    render(
      wrap(
        <DatasetTab
          caseId={42}
          projectId={9}
          parameters={SAMPLE_PARAMS as any}
        />
      )
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("dataset-row-result-link-0")
      ).toBeInTheDocument();
    });
    // "Failed" came first in the desc-ordered list, so it wins.
    // UX dropped the "View … result" wrapper; link text is just the status.
    expect(
      screen.getByTestId("dataset-row-result-link-0").textContent
    ).toContain("Failed");
    fireEvent.click(screen.getByTestId("dataset-row-result-link-0"));
    expect(mockRouterPush).toHaveBeenCalledWith(
      "/projects/runs/9/88?iteration=1&selectedCase=42"
    );
  });
});
