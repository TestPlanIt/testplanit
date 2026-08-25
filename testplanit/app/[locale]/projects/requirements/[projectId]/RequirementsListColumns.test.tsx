import fs from "fs";
import path from "path";
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RequirementCoverageResponse } from "~/app/api/projects/[projectId]/requirements/coverage/route";
import type { RequirementCoveringCaseRow } from "~/app/api/projects/[projectId]/requirements/[issueId]/covering-cases/route";
import type { RequirementCoverageBreakdown } from "~/lib/services/requirementCoverage";
import { ItemTypes } from "~/types/dndTypes";

import type { RequirementRow } from "./requirementsListRows";

// The covering column's drill-down seam (gap closure 26.2-15) -- mocked at
// the hook level (not react-query/global.fetch) so a test can assert the
// EXACT arguments the cell calls it with, proving the fetch is disabled
// (both ids undefined) until the cell is expanded, per the hook's own
// "enabled on both ids finite" contract.
const mockUseRequirementCoveringCases = vi.fn();
vi.mock("~/hooks/useRequirementCoveringCases", () => ({
  useRequirementCoveringCases: (
    projectId: number | undefined,
    requirementId: number | undefined
  ) => mockUseRequirementCoveringCases(projectId, requirementId),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${Object.values(params).join("·")}` : key,
  // CasesListDisplay (rendered for real -- see the async-combobox mock note
  // below) reads useLocale() for its toLocaleString() count formatting; the
  // bare useTranslations-only mock above leaves it undefined otherwise.
  // Gap closure 26.2-17: DateFormatter (the new createdAt cell) reads it too.
  useLocale: () => "en-US",
}));

// DateFormatter's own dependency (gap closure 26.2-17's createdAt cell) --
// mirrors RequirementCoveragePanel.test.tsx's own convention for this exact
// primitive in this same folder.
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null }),
}));

// CasesListDisplay itself is NOT mocked (its trigger badge, count-hiding-at-
// zero rule, and the where-filter it builds from `filter` are all part of
// what this file proves) -- only its own internal search-dropdown seam,
// AsyncCombobox, is stubbed, matching LinkedRequirementCasesPanel.test.tsx's
// established convention for this exact primitive. The stub still calls the
// REAL `renderTrigger` callback CasesListDisplay passes in, so the visible
// badge markup is untouched; it additionally captures `fetchOptions` so a
// test can invoke the real fetch-building code path directly instead of
// driving a real Radix popover through jsdom.
const capturedFetchOptionsList: Array<
  (query: string, page: number, size: number) => Promise<unknown>
> = [];
vi.mock("@/components/ui/async-combobox", () => ({
  AsyncCombobox: ({
    fetchOptions,
    renderTrigger,
    triggerLabel,
  }: {
    fetchOptions: (
      query: string,
      page: number,
      size: number
    ) => Promise<unknown>;
    renderTrigger: (args: { triggerLabel: unknown }) => unknown;
    triggerLabel: unknown;
  }) => {
    capturedFetchOptionsList.push(fetchOptions);
    return renderTrigger({ triggerLabel });
  },
}));

/** Decodes the `q` query param a CasesListDisplay fetch call encodes --
 *  mirrors LinkedRequirementCasesPanel.test.tsx's own helper of the same
 *  name. */
function decodeQueryParam(url: string, param: string): any {
  const raw = new URL(url, "http://localhost").searchParams.get(param);
  return raw ? JSON.parse(raw) : null;
}

function mockCasesFetch() {
  return vi.fn(async (url: string) => {
    if (url.includes("/api/model/RepositoryCases/count")) {
      return { ok: true, json: async () => ({ data: 0 }) } as Response;
    }
    return { ok: true, json: async () => ({ data: [] }) } as Response;
  }) as unknown as typeof fetch;
}

let mockIsProjectAdmin = true;
vi.mock("~/hooks/useProjectPermissions", () => ({
  useProjectPermissions: () => ({
    permissions: null,
    isProjectAdmin: mockIsProjectAdmin,
    isLoading: false,
  }),
}));

// The coverage column mounts the status-dot legend through the engine's
// meta.headerExtra slot; its data hook is outside this file's mock set.
vi.mock("@/components/iterations/IterationStatusLegendPopover", () => ({
  IterationStatusLegendPopover: () => <span data-testid="mock-status-legend" />,
}));

vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  // The new covering-cases drill-down popover renders `TestCaseNameDisplay`,
  // which links through this seam -- mirrors RequirementCoveragePanel.test
  // .tsx's own plain-anchor stub for the same primitive.
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Capture the useDrag spec factory's result directly rather than trying to
// simulate a real HTML5 drag sequence (unassertable in jsdom) -- mirrors
// RequirementsListView.test.tsx's own dropSpecRef convention for useDrop.
const { dragSpecRef } = vi.hoisted(() => ({
  dragSpecRef: { current: null as any },
}));

vi.mock("react-dnd", () => ({
  useDrag: (specFactory: () => any) => {
    dragSpecRef.current = specFactory();
    return [{ isDragging: false }, vi.fn()];
  },
}));

// Do NOT mock CoverageChip or RequirementProvenanceBadge --
// their presence and their own test ids are part of what this file proves.
import { useRequirementsListColumns } from "./RequirementsListColumns";

const translations = {
  columnName: "Name",
  columnStatus: "Status",
  columnCoverage: "Coverage",
  columnLinkedCases: "Linked Test Cases",
  columnCoveringCases: "Covering Test Cases",
  columnSource: "Source",
  columnCreatedAt: "Created At",
  actionsLabel: "Actions",
};

// Local fixture factory -- deliberately not a full ZenStack model object,
// only the fields the columns/cells actually read. Mirrors
// requirementsListRows.test.ts's own `makeRequirement` convention.
function makeRow(args: {
  id: number;
  name?: string;
  title?: string | null;
  depth?: number;
  hasChildren?: boolean;
  parentId?: number | null;
  integrationId?: number | null;
  requirementDetachedAt?: Date | string | null;
  isRequirement?: boolean;
  externalStatus?: string | null;
  status?: string | null;
  issueTypeName?: string | null;
  issueTypeIconUrl?: string | null;
  externalUrl?: string | null;
  externalKey?: string | null;
  createdAt?: Date | string | null;
}): RequirementRow {
  const name = args.name ?? `Requirement ${args.id}`;
  return {
    id: args.id,
    name,
    title: args.title ?? name,
    depth: args.depth ?? 0,
    hasChildren: args.hasChildren ?? false,
    parentId: args.parentId ?? null,
    integrationId: args.integrationId ?? null,
    requirementDetachedAt: args.requirementDetachedAt ?? null,
    isRequirement: args.isRequirement ?? true,
    externalStatus: args.externalStatus ?? null,
    status: args.status ?? null,
    issueTypeName: args.issueTypeName ?? null,
    issueTypeIconUrl: args.issueTypeIconUrl ?? null,
    externalUrl: args.externalUrl ?? null,
    externalKey: args.externalKey ?? null,
    createdAt: args.createdAt ?? null,
  } as unknown as RequirementRow;
}

// Established fixture shape for RequirementCoverageBreakdown, shared with
// requirementsListRows.test.ts's identical factory.
function makeBreakdown(
  overrides: Partial<RequirementCoverageBreakdown> = {}
): RequirementCoverageBreakdown {
  return {
    linkedCaseCount: 0,
    crossProjectCaseCount: 0,
    directCaseCount: 0,
    directCrossProjectCaseCount: 0,
    passed: 0,
    failed: 0,
    inProgress: 0,
    notRun: 0,
    statuses: [],
    untested: 0,
    uncovered: true,
    status: "UNCOVERED",
    ...overrides,
  };
}

function makeCoverageResponse(
  entries: Record<number, RequirementCoverageBreakdown>
): RequirementCoverageResponse {
  const coverage: Record<string, RequirementCoverageBreakdown> = {};
  Object.entries(entries).forEach(([id, breakdown]) => {
    coverage[id] = breakdown;
  });
  return { projectId: 5, coverage };
}

type ColumnsArgs = Parameters<typeof useRequirementsListColumns>[0];

const onToggleExpand = vi.fn();
const onSelectRequirement = vi.fn();
const onRenameCommit = vi.fn();
const onRenameCancel = vi.fn();
const onAddChild = vi.fn();
const onRequestRename = vi.fn();
const onRequestDelete = vi.fn();
const onDetached = vi.fn();
const markDragActive = vi.fn();
const clearDragActive = vi.fn();

function baseArgs(overrides: Partial<ColumnsArgs> = {}): ColumnsArgs {
  return {
    translations,
    projectId: 5,
    canAddEdit: true,
    isFiltering: false,
    normalizedFilter: "",
    coverage: undefined,
    expandedByIssueId: {},
    editingRequirementId: null,
    onToggleExpand,
    onSelectRequirement,
    onRenameCommit,
    onRenameCancel,
    onAddChild,
    onRequestRename,
    onRequestDelete,
    onDetached,
    markDragActive,
    clearDragActive,
    ...overrides,
  };
}

function renderNameCell(
  row: RequirementRow,
  overrides: Partial<ColumnsArgs> = {}
) {
  const { result } = renderHook(() =>
    useRequirementsListColumns(baseArgs(overrides))
  );
  const nameCol = result.current.find((col) => col.id === "name")!;
  const cell = (nameCol as any).cell({
    row: { original: row, id: String(row.id) },
    column: { getSize: () => 64 },
  });
  return render(cell);
}

function renderActionsCell(
  row: RequirementRow,
  overrides: Partial<ColumnsArgs> = {}
) {
  const { result } = renderHook(() =>
    useRequirementsListColumns(baseArgs({ canAddEdit: true, ...overrides }))
  );
  const actionsCol = result.current.find((col) => col.id === "actions")!;
  const cell = (actionsCol as any).cell({
    row: { original: row, id: String(row.id) },
    column: { getSize: () => 64 },
  });
  return render(cell);
}

/** Opens the Radix DropdownMenu trigger -- fireEvent.click alone doesn't
 *  dispatch the pointerdown/pointerup sequence Radix listens for in jsdom.
 *  Mirrors RequirementProvenanceBadge.test.tsx's own helper. */
function openMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
  fireEvent.pointerUp(trigger, { button: 0, pointerId: 1 });
}

function renderColumnCell(
  columnId: string,
  row: RequirementRow,
  overrides: Partial<ColumnsArgs> = {}
) {
  const { result } = renderHook(() =>
    useRequirementsListColumns(baseArgs(overrides))
  );
  const col = result.current.find((c) => c.id === columnId)!;
  const cell = (col as any).cell({
    row: { original: row, id: String(row.id) },
    column: { getSize: () => 64 },
  });
  return render(cell);
}

beforeEach(() => {
  onToggleExpand.mockReset();
  onSelectRequirement.mockReset();
  onRenameCommit.mockReset();
  onRenameCancel.mockReset();
  onAddChild.mockReset();
  onRequestRename.mockReset();
  onRequestDelete.mockReset();
  onDetached.mockReset();
  markDragActive.mockReset();
  clearDragActive.mockReset();
  dragSpecRef.current = null;
  mockIsProjectAdmin = true;
  capturedFetchOptionsList.length = 0;
  global.fetch = mockCasesFetch();
  mockUseRequirementCoveringCases.mockReset();
  mockUseRequirementCoveringCases.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
  });
});

/** `RequirementCoveringCaseRow` fixture factory -- only the fields the
 *  covering-cases cell actually reads. */
function makeCoveringCase(
  overrides: Partial<RequirementCoveringCaseRow> & {
    caseId: number;
  }
): RequirementCoveringCaseRow {
  return {
    caseName: `Case ${overrides.caseId}`,
    projectId: 5,
    projectName: "Current Project",
    lastStatusName: null,
    lastStatusColor: null,
    lastStatusIsSuccess: null,
    lastStatusIsFailure: null,
    lastExecutedAt: null,
    direct: true,
    ...overrides,
  };
}

describe("useRequirementsListColumns -- column contract", () => {
  it("returns name/status/coverage/coveringCases/linkedCases/source/createdAt/actions in order when canAddEdit is true", () => {
    const { result } = renderHook(() => useRequirementsListColumns(baseArgs()));
    expect(result.current.map((col) => col.id)).toEqual([
      "name",
      "status",
      "coverage",
      "coveringCases",
      "linkedCases",
      "source",
      "createdAt",
      "actions",
    ]);
  });

  it("omits the actions column when canAddEdit is false (no dead column for a viewer)", () => {
    const { result } = renderHook(() =>
      useRequirementsListColumns(baseArgs({ canAddEdit: false }))
    );
    expect(result.current.map((col) => col.id)).toEqual([
      "name",
      "status",
      "coverage",
      "coveringCases",
      "linkedCases",
      "source",
      "createdAt",
    ]);
  });

  it("every returned column has a non-empty string id and a numeric size (the header-disappears trap)", () => {
    const { result } = renderHook(() => useRequirementsListColumns(baseArgs()));
    result.current.forEach((col) => {
      expect(typeof col.id).toBe("string");
      expect((col.id as string).length).toBeGreaterThan(0);
      expect(typeof col.size).toBe("number");
    });
  });

  it("size/minSize/maxSize match UI-SPEC §3's table exactly", () => {
    const { result } = renderHook(() => useRequirementsListColumns(baseArgs()));
    const expected: Record<
      string,
      { size: number; minSize: number; maxSize: number }
    > = {
      name: { size: 320, minSize: 240, maxSize: 640 },
      status: { size: 120, minSize: 80, maxSize: 200 },
      coverage: { size: 170, minSize: 150, maxSize: 420 },
      linkedCases: { size: 110, minSize: 80, maxSize: 160 },
      coveringCases: { size: 120, minSize: 90, maxSize: 200 },
      source: { size: 140, minSize: 60, maxSize: 260 },
      createdAt: { size: 130, minSize: 100, maxSize: 200 },
      actions: { size: 64, minSize: 56, maxSize: 100 },
    };
    result.current.forEach((col) => {
      const exp = expected[col.id as string];
      expect(exp).toBeDefined();
      expect(col.size).toBe(exp.size);
      expect(col.minSize).toBe(exp.minSize);
      expect(col.maxSize).toBe(exp.maxSize);
    });
  });

  it("actions disables sorting/resizing/hiding and pins right; the other four allow sorting", () => {
    const { result } = renderHook(() => useRequirementsListColumns(baseArgs()));
    const actionsCol = result.current.find((col) => col.id === "actions")!;
    expect(actionsCol.enableSorting).toBe(false);
    expect(actionsCol.enableResizing).toBe(false);
    expect(actionsCol.enableHiding).toBe(false);
    expect((actionsCol.meta as any)?.isPinned).toBe("right");

    [
      "name",
      "status",
      "coverage",
      "linkedCases",
      "coveringCases",
      "source",
      "createdAt",
    ].forEach((id) => {
      const col = result.current.find((c) => c.id === id)!;
      expect(col.enableSorting).toBe(true);
    });
  });

  it("coverage accessorFn ranks uncovered below failed below passed, and -1 for a row absent from the map", () => {
    const coverage = makeCoverageResponse({
      1: makeBreakdown({ status: "UNCOVERED", uncovered: true }),
      2: makeBreakdown({ status: "FAILED", uncovered: false, passed: 1 }),
      3: makeBreakdown({ status: "PASSED", uncovered: false, passed: 5 }),
    });
    const { result } = renderHook(() =>
      useRequirementsListColumns(baseArgs({ coverage }))
    );
    const accessorFn = (result.current.find((c) => c.id === "coverage") as any)
      .accessorFn;

    const uncoveredValue = accessorFn(makeRow({ id: 1 }));
    const failedValue = accessorFn(makeRow({ id: 2 }));
    const passedValue = accessorFn(makeRow({ id: 3 }));
    const absentValue = accessorFn(makeRow({ id: 99 }));

    expect(uncoveredValue).toBeLessThan(failedValue);
    expect(failedValue).toBeLessThan(passedValue);
    expect(absentValue).toBe(-1);
  });

  it("status accessorFn prefers externalStatus over status and returns an empty string when both are null", () => {
    const { result } = renderHook(() => useRequirementsListColumns(baseArgs()));
    const accessorFn = (result.current.find((c) => c.id === "status") as any)
      .accessorFn;

    expect(
      accessorFn(
        makeRow({ id: 1, externalStatus: "In Review", status: "open" })
      )
    ).toBe("In Review");
    expect(
      accessorFn(makeRow({ id: 1, externalStatus: null, status: "open" }))
    ).toBe("open");
    expect(
      accessorFn(makeRow({ id: 1, externalStatus: null, status: null }))
    ).toBe("");
  });

  it("source accessorFn ranks native below detached below synced", () => {
    const { result } = renderHook(() => useRequirementsListColumns(baseArgs()));
    const accessorFn = (result.current.find((c) => c.id === "source") as any)
      .accessorFn;

    const nativeValue = accessorFn(makeRow({ id: 1, integrationId: null }));
    const detachedValue = accessorFn(
      makeRow({
        id: 2,
        integrationId: 9,
        requirementDetachedAt: new Date().toISOString(),
      })
    );
    const syncedValue = accessorFn(
      makeRow({ id: 3, integrationId: 9, requirementDetachedAt: null })
    );

    expect(nativeValue).toBeLessThan(detachedValue);
    expect(detachedValue).toBeLessThan(syncedValue);
  });

  it("coverage cell mounts the real CoverageChip, not a mock", () => {
    const coverage = makeCoverageResponse({
      20: makeBreakdown({
        status: "PASSED",
        uncovered: false,
        passed: 3,
        linkedCaseCount: 3,
        statuses: [{ statusId: 1, name: "Passed", color: "#22c55e", count: 3 }],
      }),
    });
    const { result } = renderHook(() =>
      useRequirementsListColumns(baseArgs({ coverage }))
    );
    const coverageCol = result.current.find((c) => c.id === "coverage")!;
    const cell = (coverageCol as any).cell({
      row: { original: makeRow({ id: 20 }), id: "20" },
      column: { getSize: () => 64 },
    });
    render(cell);
    expect(
      screen.getByTestId("requirement-coverage-cell-20")
    ).toBeInTheDocument();
    expect(screen.getByTestId("coverage-pips")).toBeInTheDocument();
    expect(screen.getByLabelText("Passed: 3")).toBeInTheDocument();
  });

  it("a breakdown with two statuses renders two pips plus the count text", () => {
    const coverage = makeCoverageResponse({
      24: makeBreakdown({
        status: "FAILED",
        uncovered: false,
        linkedCaseCount: 3,
        statuses: [
          { statusId: 1, name: "Passed", color: "#22c55e", count: 2 },
          { statusId: 2, name: "Failed", color: "#ef4444", count: 1 },
        ],
      }),
    });
    const { result } = renderHook(() =>
      useRequirementsListColumns(baseArgs({ coverage }))
    );
    const coverageCol = result.current.find((c) => c.id === "coverage")!;
    const cell = (coverageCol as any).cell({
      row: { original: makeRow({ id: 24 }), id: "24" },
      column: { getSize: () => 64 },
    });
    render(cell);
    expect(screen.getByLabelText("Passed: 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Failed: 1")).toBeInTheDocument();
  });

  it("a linkedCaseCount: 0 breakdown renders the Uncovered badge", () => {
    const coverage = makeCoverageResponse({
      25: makeBreakdown({
        status: "UNCOVERED",
        uncovered: true,
        linkedCaseCount: 0,
      }),
    });
    const { result } = renderHook(() =>
      useRequirementsListColumns(baseArgs({ coverage }))
    );
    const coverageCol = result.current.find((c) => c.id === "coverage")!;
    const cell = (coverageCol as any).cell({
      row: { original: makeRow({ id: 25 }), id: "25" },
      column: { getSize: () => 64 },
    });
    render(cell);
    expect(screen.getByText("coverageUncovered")).toBeInTheDocument();
  });

  // Regresses to the milestone surface's own definition of Uncovered (no
  // COMPLETED outcome) if `uncoveredWhen` is ever dropped from the cell --
  // observed RED with the prop removed, see 26.2-10-SUMMARY.md.
  it("a linkedCaseCount: 2, statuses: [], untested: 2 breakdown renders pips, not the Uncovered badge", () => {
    const coverage = makeCoverageResponse({
      26: makeBreakdown({
        status: "NOT_RUN",
        uncovered: false,
        linkedCaseCount: 2,
        statuses: [],
        untested: 2,
      }),
    });
    const { result } = renderHook(() =>
      useRequirementsListColumns(baseArgs({ coverage }))
    );
    const coverageCol = result.current.find((c) => c.id === "coverage")!;
    const cell = (coverageCol as any).cell({
      row: { original: makeRow({ id: 26 }), id: "26" },
      column: { getSize: () => 64 },
    });
    render(cell);
    expect(screen.queryByText("coverageUncovered")).not.toBeInTheDocument();
    expect(screen.getByLabelText("labels.untested: 2")).toBeInTheDocument();
  });

  it("source cell mounts the real RequirementProvenanceBadge, not a mock", () => {
    const { result } = renderHook(() => useRequirementsListColumns(baseArgs()));
    const sourceCol = result.current.find((c) => c.id === "source")!;
    const cell = (sourceCol as any).cell({
      row: { original: makeRow({ id: 21, integrationId: null }), id: "21" },
      column: { getSize: () => 64 },
    });
    render(cell);
    expect(
      screen.getByTestId("requirement-provenance-native")
    ).toBeInTheDocument();
  });
});

// Gap closure 26.2-17: only `createdAt` ships -- `Issue` has no `updatedAt`
// column, and adding one is the schema change this gap-closure plan
// explicitly ruled out (see 26.2-17-SUMMARY.md).
describe("createdAt column (gap closure 26.2-17)", () => {
  it("is hidden by default (meta.isVisible === false)", () => {
    const { result } = renderHook(() => useRequirementsListColumns(baseArgs()));
    const col = result.current.find((c) => c.id === "createdAt")!;
    expect((col.meta as any)?.isVisible).toBe(false);
  });

  it("accessorFn reads the row's own createdAt timestamp", () => {
    const createdAt = new Date("2026-01-15T12:00:00.000Z");
    const { result } = renderHook(() => useRequirementsListColumns(baseArgs()));
    const accessorFn = (
      result.current.find((c) => c.id === "createdAt") as any
    ).accessorFn;

    expect(accessorFn(makeRow({ id: 40, createdAt }))).toBe(createdAt);
  });

  it("renders a locale-formatted date, never the raw ISO string, in the DOM", () => {
    const isoDate = "2026-01-15T12:00:00.000Z";
    renderColumnCell("createdAt", makeRow({ id: 41, createdAt: isoDate }));

    const cell = screen.getByTestId("requirement-createdAt-cell-41");
    // Date-only, no time component (DateFormatter's default "MM-dd-yyyy") --
    // exact day/timezone rendering is DateFormatter's own tested contract
    // (DateFormatter.test.tsx); this only proves the cell wires it in rather
    // than ever printing the raw ISO string.
    expect(cell.textContent).toMatch(/^\d{2}-\d{2}-\d{4}$/);
    expect(cell.textContent).not.toContain(isoDate);
  });

  it("renders nothing for a null createdAt rather than throwing", () => {
    renderColumnCell("createdAt", makeRow({ id: 42, createdAt: null }));
    const cell = screen.getByTestId("requirement-createdAt-cell-42");
    expect(cell.textContent).toBe("");
  });
});

describe("linkedCases / coveringCases columns", () => {
  it("a directCaseCount: 3, directCrossProjectCaseCount: 1 breakdown renders an in-project badge of 2 and a +1", () => {
    const coverage = makeCoverageResponse({
      30: makeBreakdown({ directCaseCount: 3, directCrossProjectCaseCount: 1 }),
    });
    renderColumnCell("linkedCases", makeRow({ id: 30 }), { coverage });

    expect(screen.getByTestId("requirement-linked-cases-30")).toHaveTextContent(
      "2"
    );
    expect(
      screen.getByTestId("requirement-linked-cases-other-30")
    ).toHaveTextContent("+1");
  });

  it("a directCrossProjectCaseCount: 0 breakdown renders no +N element at all (not a zero badge)", () => {
    const coverage = makeCoverageResponse({
      31: makeBreakdown({ directCaseCount: 3, directCrossProjectCaseCount: 0 }),
    });
    renderColumnCell("linkedCases", makeRow({ id: 31 }), { coverage });

    expect(
      screen.queryByTestId("requirement-linked-cases-other-31")
    ).not.toBeInTheDocument();
  });

  // The security assertion this boundary depends on: both linkedCases
  // filters (direct links only, never inherited from a descendant) narrow to
  // this project (or explicitly exclude it) and to non-archived cases -- the
  // ZenStack model API is the real enforcement point, but a filter that
  // silently dropped `projectId` would still hand back a project-unscoped
  // read through a policy-scoped route (T-26.2G-11-01). `coveringCases` no
  // longer builds a client-side filter at all (gap closure 26.2-15) -- its
  // own security boundary is the covering-cases route's own viewer-scope
  // check (T-26.2G-15-01), asserted in that route's own test, not here.
  it("scopes both linkedCases filters to this project (or explicitly not-this-project) and to non-archived cases", async () => {
    const coverage = makeCoverageResponse({
      50: makeBreakdown({
        directCaseCount: 3,
        directCrossProjectCaseCount: 1,
      }),
    });

    renderColumnCell("linkedCases", makeRow({ id: 50 }), {
      coverage,
      projectId: 5,
    });

    expect(capturedFetchOptionsList).toHaveLength(2);

    const filters = [];
    for (const fetchOptions of capturedFetchOptionsList) {
      await fetchOptions("", 0, 10);
      const findManyCall = (global.fetch as any).mock.calls.at(-1);
      const params = decodeQueryParam(findManyCall[0], "q");
      filters.push(params.where.AND[1]);
    }

    // [in-project, other-project] -- DOM/render order.
    expect(filters[0]).toMatchObject({ projectId: 5, isArchived: false });
    expect(filters[1]).toMatchObject({
      projectId: { not: 5 },
      isArchived: false,
    });
  });
});

describe("coveringCases cell -- drill-down expansion (gap closure 26.2-15, UAT gap 11)", () => {
  it("ABT-47193 shape: 8 covering cases reached only through a non-requirement descendant render as 8/8 in the other-project expansion, not 0-of-8 -- FAILS against the old descendant-filter implementation (mutation proof recorded in 26.2-15-SUMMARY.md)", () => {
    const otherProjectCases = Array.from({ length: 8 }, (_, i) =>
      makeCoveringCase({
        caseId: 100 + i,
        caseName: `Other Case ${i}`,
        projectId: 9,
        projectName: "Other Project",
        direct: false,
      })
    );
    mockUseRequirementCoveringCases.mockReturnValue({
      data: { requirementId: 1, cases: otherProjectCases },
      isLoading: false,
      isError: false,
    });
    // linkedCaseCount === crossProjectCaseCount: every covering case is in
    // another project, so inProjectCount is 0 and only the other-project
    // badge renders -- exactly ABT-47193's own shape.
    const coverage = makeCoverageResponse({
      1: makeBreakdown({ linkedCaseCount: 8, crossProjectCaseCount: 8 }),
    });

    renderColumnCell("coveringCases", makeRow({ id: 1 }), {
      coverage,
      projectId: 5,
    });

    const otherBadge = screen.getByTestId("requirement-covering-cases-other-1");
    expect(otherBadge).toHaveTextContent("+8");
    expect(
      screen.queryByTestId("requirement-covering-cases-trigger-1")
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId("requirement-covering-cases-other-trigger-1")
    );

    otherProjectCases.forEach((row) => {
      expect(screen.getByText(row.caseName)).toBeInTheDocument();
    });
    expect(screen.getAllByText("Other Project")).toHaveLength(8);
  });

  function mixedRows() {
    return [
      makeCoveringCase({
        caseId: 1,
        caseName: "In-project case",
        projectId: 5,
        projectName: "Current Project",
      }),
      makeCoveringCase({
        caseId: 2,
        caseName: "Other-project case",
        projectId: 9,
        projectName: "Other Project",
        direct: false,
      }),
    ];
  }

  it("the drill-down never fires (both ids stay undefined) until the cell is expanded, then fires with this row's own ids", () => {
    mockUseRequirementCoveringCases.mockReturnValue({
      data: { requirementId: 1, cases: mixedRows() },
      isLoading: false,
      isError: false,
    });
    const coverage = makeCoverageResponse({
      1: makeBreakdown({ linkedCaseCount: 2, crossProjectCaseCount: 1 }),
    });

    renderColumnCell("coveringCases", makeRow({ id: 1 }), {
      coverage,
      projectId: 5,
    });

    // Every pre-expand call is disabled (both args undefined) -- the fetch
    // itself never fires merely because the row is visible in the
    // virtualized table.
    const callsThatWouldFetch =
      mockUseRequirementCoveringCases.mock.calls.filter(
        ([projectIdArg, requirementIdArg]) =>
          projectIdArg !== undefined || requirementIdArg !== undefined
      );
    expect(callsThatWouldFetch).toHaveLength(0);

    fireEvent.click(screen.getByTestId("requirement-covering-cases-trigger-1"));

    expect(mockUseRequirementCoveringCases).toHaveBeenCalledWith(5, 1);
  });

  it("mixed projectIds: the in-project list shows only the in-project row once expanded", () => {
    mockUseRequirementCoveringCases.mockReturnValue({
      data: { requirementId: 1, cases: mixedRows() },
      isLoading: false,
      isError: false,
    });
    const coverage = makeCoverageResponse({
      1: makeBreakdown({ linkedCaseCount: 2, crossProjectCaseCount: 1 }),
    });

    renderColumnCell("coveringCases", makeRow({ id: 1 }), {
      coverage,
      projectId: 5,
    });

    fireEvent.click(screen.getByTestId("requirement-covering-cases-trigger-1"));

    expect(screen.getByText("In-project case")).toBeInTheDocument();
    expect(screen.queryByText("Other-project case")).not.toBeInTheDocument();
    // showProject is off for the in-project list.
    expect(screen.queryByText("Current Project")).not.toBeInTheDocument();
  });

  it("mixed projectIds: the other-project list shows only the other-project row, with its own project name, once expanded", () => {
    mockUseRequirementCoveringCases.mockReturnValue({
      data: { requirementId: 1, cases: mixedRows() },
      isLoading: false,
      isError: false,
    });
    const coverage = makeCoverageResponse({
      1: makeBreakdown({ linkedCaseCount: 2, crossProjectCaseCount: 1 }),
    });

    renderColumnCell("coveringCases", makeRow({ id: 1 }), {
      coverage,
      projectId: 5,
    });

    fireEvent.click(
      screen.getByTestId("requirement-covering-cases-other-trigger-1")
    );

    expect(screen.getByText("Other-project case")).toBeInTheDocument();
    expect(screen.getByText("Other Project")).toBeInTheDocument();
    expect(screen.queryByText("In-project case")).not.toBeInTheDocument();
  });

  it("the linked column's cell is untouched by this gap closure (byte-identical column definition)", () => {
    const coverage = makeCoverageResponse({
      60: makeBreakdown({ directCaseCount: 2, directCrossProjectCaseCount: 0 }),
    });
    renderColumnCell("linkedCases", makeRow({ id: 60 }), { coverage });

    expect(screen.getByTestId("requirement-linked-cases-60")).toHaveTextContent(
      "2"
    );
    // The linked column still renders through CasesListDisplay's own
    // AsyncCombobox seam (captured by the stub above) -- proof it was never
    // rerouted onto the covering-cases hook.
    expect(mockUseRequirementCoveringCases).not.toHaveBeenCalledWith(
      expect.any(Number),
      60
    );
  });

  it("a failed drill-down renders the trusted rollup count as plain, non-interactive text -- never an empty list passed off as the truth", () => {
    mockUseRequirementCoveringCases.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    const coverage = makeCoverageResponse({
      70: makeBreakdown({ linkedCaseCount: 5, crossProjectCaseCount: 2 }),
    });

    renderColumnCell("coveringCases", makeRow({ id: 70 }), {
      coverage,
      projectId: 5,
    });

    // Expand first -- the error only exists once the drill-down actually
    // ran and failed.
    fireEvent.click(
      screen.getByTestId("requirement-covering-cases-trigger-70")
    );

    expect(
      screen.queryByTestId("requirement-covering-cases-trigger-70")
    ).not.toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(
      screen.queryByTestId("requirement-covering-cases-other-trigger-70")
    ).not.toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("shows the loading affordance while the drill-down is in flight after expansion", () => {
    mockUseRequirementCoveringCases.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    const coverage = makeCoverageResponse({
      80: makeBreakdown({ linkedCaseCount: 3, crossProjectCaseCount: 0 }),
    });

    renderColumnCell("coveringCases", makeRow({ id: 80 }), {
      coverage,
      projectId: 5,
    });

    fireEvent.click(
      screen.getByTestId("requirement-covering-cases-trigger-80")
    );

    expect(
      screen.getByTestId("requirement-covering-cases-popover-loading")
    ).toBeInTheDocument();
  });
});

describe("RequirementNameCell", () => {
  it("indents by depth * 24px via inline style", () => {
    renderNameCell(makeRow({ id: 1, depth: 2 }));
    const wrapper = screen.getByTestId("requirement-name-cell-1");
    expect(wrapper.style.paddingInlineStart).toBe("48px");
  });

  it("renders zero indent at depth 0", () => {
    renderNameCell(makeRow({ id: 2, depth: 0 }));
    const wrapper = screen.getByTestId("requirement-name-cell-2");
    expect(wrapper.style.paddingInlineStart).toBe("0px");
  });

  it("renders a chevron for a row with children", () => {
    renderNameCell(makeRow({ id: 3, hasChildren: true }));
    expect(screen.getByTestId("requirement-chevron-3")).toBeInTheDocument();
  });

  it("renders no chevron for a leaf row", () => {
    renderNameCell(makeRow({ id: 4, hasChildren: false }));
    expect(
      screen.queryByTestId("requirement-chevron-4")
    ).not.toBeInTheDocument();
  });

  it("chevron aria-label resolves the expand key when collapsed, never the old togglePanel key", () => {
    renderNameCell(makeRow({ id: 5, hasChildren: true, name: "Login flow" }), {
      expandedByIssueId: {},
    });
    const chevron = screen.getByTestId("requirement-chevron-5");
    expect(chevron).toHaveAttribute(
      "aria-label",
      "requirements.list.expandRow:Login flow"
    );
    expect(chevron.getAttribute("aria-label")).not.toBe(
      "common.aria.togglePanel"
    );
  });

  it("chevron aria-label resolves the collapse key when expanded", () => {
    renderNameCell(makeRow({ id: 6, hasChildren: true, name: "Login flow" }), {
      expandedByIssueId: { 6: true },
    });
    const chevron = screen.getByTestId("requirement-chevron-6");
    expect(chevron).toHaveAttribute(
      "aria-label",
      "requirements.list.collapseRow:Login flow"
    );
  });

  it("clicking the chevron toggles expand and does not select the requirement", () => {
    renderNameCell(makeRow({ id: 7, hasChildren: true }));
    fireEvent.click(screen.getByTestId("requirement-chevron-7"));
    expect(onToggleExpand).toHaveBeenCalledWith(7);
    expect(onSelectRequirement).not.toHaveBeenCalled();
  });

  it("clicking the label selects the requirement", () => {
    renderNameCell(makeRow({ id: 8, name: "Login flow" }));
    fireEvent.click(screen.getByText("Login flow"));
    expect(onSelectRequirement).toHaveBeenCalledWith(8);
  });

  it("renders the rename input for the row being edited", () => {
    renderNameCell(makeRow({ id: 9, name: "Login flow" }), {
      editingRequirementId: 9,
    });
    expect(
      screen.getByTestId("requirement-rename-input-9")
    ).toBeInTheDocument();
  });

  it("commits a trimmed, non-blank value on Enter", () => {
    renderNameCell(makeRow({ id: 10, name: "Login flow" }), {
      editingRequirementId: 10,
    });
    const input = screen.getByTestId("requirement-rename-input-10");
    fireEvent.change(input, { target: { value: "  New name  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRenameCommit).toHaveBeenCalledWith(10, "New name");
    expect(onRenameCancel).not.toHaveBeenCalled();
  });

  it("cancels rather than commits on Enter with only whitespace", () => {
    renderNameCell(makeRow({ id: 11, name: "Login flow" }), {
      editingRequirementId: 11,
    });
    const input = screen.getByTestId("requirement-rename-input-11");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRenameCancel).toHaveBeenCalled();
    expect(onRenameCommit).not.toHaveBeenCalled();
  });

  it("cancels on Escape", () => {
    renderNameCell(makeRow({ id: 12, name: "Login flow" }), {
      editingRequirementId: 12,
    });
    const input = screen.getByTestId("requirement-rename-input-12");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onRenameCancel).toHaveBeenCalled();
  });

  it("disallows dragging when the viewer cannot edit", () => {
    renderNameCell(makeRow({ id: 13 }), {
      canAddEdit: false,
      isFiltering: false,
    });
    expect(dragSpecRef.current.canDrag()).toBe(false);
  });

  it("disallows dragging while filtering", () => {
    renderNameCell(makeRow({ id: 14 }), {
      canAddEdit: true,
      isFiltering: true,
    });
    expect(dragSpecRef.current.canDrag()).toBe(false);
  });

  it("allows dragging when the viewer can edit and is not filtering", () => {
    renderNameCell(makeRow({ id: 15 }), {
      canAddEdit: true,
      isFiltering: false,
    });
    expect(dragSpecRef.current.canDrag()).toBe(true);
  });

  it("tags the drag item with ItemTypes.REQUIREMENT and carries the requirement id", () => {
    renderNameCell(makeRow({ id: 16, name: "Login flow" }));
    expect(dragSpecRef.current.type).toBe(ItemTypes.REQUIREMENT);
    // `item` is a FUNCTION, not a static object (gap closure 26.2-16): react-
    // dnd calls it once at dragstart, which is exactly where the
    // markDragActive side effect below must run.
    expect(dragSpecRef.current.item()).toEqual({
      requirementId: 16,
      name: "Login flow",
    });
  });

  it("renders a grab handle when the row can be dragged", () => {
    renderNameCell(makeRow({ id: 20 }), {
      canAddEdit: true,
      isFiltering: false,
    });
    expect(
      screen.getByTestId("requirement-drag-handle-20")
    ).toBeInTheDocument();
  });

  it("omits the grab handle when the viewer cannot edit", () => {
    renderNameCell(makeRow({ id: 21 }), { canAddEdit: false });
    expect(
      screen.queryByTestId("requirement-drag-handle-21")
    ).not.toBeInTheDocument();
  });

  it("a hidden grab handle leaves a same-width spacer so icon/name alignment matches draggable rows (gap 15a)", () => {
    renderNameCell(makeRow({ id: 21 }), { canAddEdit: false });
    const spacer = screen.getByTestId("requirement-drag-handle-spacer-21");
    // Same footprint classes as the grip itself -- the name never shifts.
    expect(spacer.className).toContain("h-4");
    expect(spacer.className).toContain("w-4");
    expect(spacer.className).toContain("shrink-0");
  });

  it("omits the grab handle while filtering", () => {
    renderNameCell(makeRow({ id: 22 }), {
      canAddEdit: true,
      isFiltering: true,
    });
    expect(
      screen.queryByTestId("requirement-drag-handle-22")
    ).not.toBeInTheDocument();
  });

  it("dragstart (item()) calls markDragActive with this row's id; end() calls clearDragActive", () => {
    renderNameCell(makeRow({ id: 23, name: "Login flow" }));

    dragSpecRef.current.item();
    expect(markDragActive).toHaveBeenCalledWith(23);
    expect(clearDragActive).not.toHaveBeenCalled();

    dragSpecRef.current.end();
    expect(clearDragActive).toHaveBeenCalledTimes(1);

    // Belt-and-braces: a second end() (mirroring the native dragend path
    // this cell also wires) must not throw and stays a no-op on the mock's
    // own call count assertion above -- idempotency is `clearDragActive`'s
    // own contract (RequirementsListView.tsx), this only proves the cell
    // calls it again rather than skipping cleanup.
    expect(() => dragSpecRef.current.end()).not.toThrow();
    expect(clearDragActive).toHaveBeenCalledTimes(2);
  });

  // Gap closure 26.2-16 (UAT gap 14 follow-up): the provenance gate. Each
  // case pairs grip visibility with `canDrag()`'s outcome in the SAME test
  // -- the shared-predicate discipline the reverted work got right (only its
  // useDragLayer mechanism was poison).
  it("locked (synced, not detached): no grip, canDrag() false, tooltip explains why", () => {
    const row = makeRow({
      id: 24,
      integrationId: 9,
      requirementDetachedAt: null,
      isRequirement: true,
    });
    renderNameCell(row);
    expect(
      screen.queryByTestId("requirement-drag-handle-24")
    ).not.toBeInTheDocument();
    expect(dragSpecRef.current.canDrag()).toBe(false);
    expect(screen.getByTestId("requirement-name-cell-24")).toHaveAttribute(
      "title",
      "requirements.list.dragLockedSynced"
    );
  });

  it("detached (previously synced, now free): grip present, canDrag() true", () => {
    const row = makeRow({
      id: 25,
      integrationId: 9,
      requirementDetachedAt: new Date("2026-01-01"),
      isRequirement: true,
    });
    renderNameCell(row);
    expect(
      screen.getByTestId("requirement-drag-handle-25")
    ).toBeInTheDocument();
    expect(dragSpecRef.current.canDrag()).toBe(true);
  });

  it("native (never synced): grip present, canDrag() true", () => {
    const row = makeRow({ id: 26, integrationId: null, isRequirement: true });
    renderNameCell(row);
    expect(
      screen.getByTestId("requirement-drag-handle-26")
    ).toBeInTheDocument();
    expect(dragSpecRef.current.canDrag()).toBe(true);
  });
});

describe("RequirementRowActionsMenu", () => {
  it("renders the three ported action test ids", () => {
    renderActionsCell(makeRow({ id: 17 }));
    openMenu(screen.getByTestId("requirement-actions-trigger-17"));
    expect(
      screen.getByTestId("requirement-action-add-child-17")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("requirement-action-rename-17")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("requirement-action-delete-17")
    ).toBeInTheDocument();
  });

  it("disables the rename item for a locked (synced, not-detached) requirement", () => {
    renderActionsCell(
      makeRow({
        id: 18,
        integrationId: 9,
        requirementDetachedAt: null,
        isRequirement: true,
      })
    );
    openMenu(screen.getByTestId("requirement-actions-trigger-18"));
    expect(screen.getByTestId("requirement-action-rename-18")).toHaveAttribute(
      "aria-disabled",
      "true"
    );
  });

  it("enables the rename item for a native requirement", () => {
    renderActionsCell(makeRow({ id: 19, integrationId: null }));
    openMenu(screen.getByTestId("requirement-actions-trigger-19"));
    expect(
      screen.getByTestId("requirement-action-rename-19")
    ).not.toHaveAttribute("aria-disabled");
  });
});

describe("D-5 fix-by-construction guard", () => {
  it("never paints a row-level bg-secondary/bg-accent fill (the third instance of this bug class this milestone)", () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        "app/[locale]/projects/requirements/[projectId]/RequirementsListColumns.tsx"
      ),
      "utf8"
    );
    const codeOnly = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    expect(codeOnly).not.toMatch(/bg-secondary/);
    expect(codeOnly).not.toMatch(/bg-accent/);
  });
});
