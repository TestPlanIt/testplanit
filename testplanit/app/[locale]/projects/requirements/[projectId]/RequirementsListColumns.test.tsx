import fs from "fs";
import path from "path";
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RequirementCoverageResponse } from "~/app/api/projects/[projectId]/requirements/coverage/route";
import type { RequirementCoverageBreakdown } from "~/lib/services/requirementCoverage";
import { ItemTypes } from "~/types/dndTypes";

import type { RequirementRow } from "./requirementsListRows";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${Object.values(params).join("·")}` : key,
  // CasesListDisplay (rendered for real -- see the async-combobox mock note
  // below) reads useLocale() for its toLocaleString() count formatting; the
  // bare useTranslations-only mock above leaves it undefined otherwise.
  useLocale: () => "en-US",
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

vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
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
  dragSpecRef.current = null;
  mockIsProjectAdmin = true;
  capturedFetchOptionsList.length = 0;
  global.fetch = mockCasesFetch();
});

describe("useRequirementsListColumns -- column contract", () => {
  it("returns name/status/coverage/linkedCases/coveringCases/source/actions in order when canAddEdit is true", () => {
    const { result } = renderHook(() => useRequirementsListColumns(baseArgs()));
    expect(result.current.map((col) => col.id)).toEqual([
      "name",
      "status",
      "coverage",
      "linkedCases",
      "coveringCases",
      "source",
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
      "linkedCases",
      "coveringCases",
      "source",
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

  it("the coveringCases cell's filter carries issueId: { in: [...] } with the requirement's own id FIRST, plus every descendant id", async () => {
    const coverage = makeCoverageResponse({
      1: makeBreakdown({ linkedCaseCount: 4, crossProjectCaseCount: 0 }),
    });
    const descendantIdsByRequirementId = new Map<number, number[]>([
      [1, [1, 2, 3]],
    ]);
    renderColumnCell("coveringCases", makeRow({ id: 1 }), {
      coverage,
      descendantIdsByRequirementId,
    });

    expect(capturedFetchOptionsList).toHaveLength(1);
    await capturedFetchOptionsList[0]!("", 0, 10);

    const findManyCall = (global.fetch as any).mock.calls.find(
      ([url]: [string]) => url.includes("/api/model/RepositoryCases/findMany")
    );
    expect(findManyCall).toBeDefined();
    const params = decodeQueryParam(findManyCall[0], "q");
    const filter = params.where.AND[1];
    expect(filter.caseIssues.some.issueId.in).toEqual([1, 2, 3]);
    expect(filter.caseIssues.some.issueId.in[0]).toBe(1);
  });

  it("falls back to [id] for the covering cell's filter when the descendant map has no entry for this row", async () => {
    const coverage = makeCoverageResponse({
      40: makeBreakdown({ linkedCaseCount: 2, crossProjectCaseCount: 0 }),
    });
    renderColumnCell("coveringCases", makeRow({ id: 40 }), {
      coverage,
      descendantIdsByRequirementId: new Map(),
    });

    await capturedFetchOptionsList[0]!("", 0, 10);
    const findManyCall = (global.fetch as any).mock.calls.find(
      ([url]: [string]) => url.includes("/api/model/RepositoryCases/findMany")
    );
    const params = decodeQueryParam(findManyCall[0], "q");
    expect(params.where.AND[1].caseIssues.some.issueId.in).toEqual([40]);
  });

  // The security assertion this boundary depends on: every one of the four
  // case-list filters (linkedCases in-project/cross-project, coveringCases
  // in-project/cross-project) narrows to this project (or explicitly
  // excludes it) and to non-archived cases -- the ZenStack model API is the
  // real enforcement point, but a filter that silently dropped `projectId`
  // would still hand back a project-unscoped read through a policy-scoped
  // route (T-26.2G-11-01). This test FAILS if `projectId` is dropped from
  // any one of the four filters -- see 26.2-11-SUMMARY.md for the recorded
  // RED.
  it("scopes every one of the four case-list filters to this project (or explicitly not-this-project) and to non-archived cases", async () => {
    const coverage = makeCoverageResponse({
      50: makeBreakdown({
        directCaseCount: 3,
        directCrossProjectCaseCount: 1,
        linkedCaseCount: 5,
        crossProjectCaseCount: 2,
      }),
    });
    const descendantIdsByRequirementId = new Map<number, number[]>([
      [50, [50, 51]],
    ]);

    renderColumnCell("linkedCases", makeRow({ id: 50 }), {
      coverage,
      projectId: 5,
    });
    renderColumnCell("coveringCases", makeRow({ id: 50 }), {
      coverage,
      projectId: 5,
      descendantIdsByRequirementId,
    });

    expect(capturedFetchOptionsList).toHaveLength(4);

    const filters = [];
    for (const fetchOptions of capturedFetchOptionsList) {
      await fetchOptions("", 0, 10);
      const findManyCall = (global.fetch as any).mock.calls.at(-1);
      const params = decodeQueryParam(findManyCall[0], "q");
      filters.push(params.where.AND[1]);
    }

    // [linkedCases in-project, linkedCases other-project, coveringCases
    // in-project, coveringCases other-project] -- DOM/render order.
    expect(filters[0]).toMatchObject({ projectId: 5, isArchived: false });
    expect(filters[1]).toMatchObject({
      projectId: { not: 5 },
      isArchived: false,
    });
    expect(filters[2]).toMatchObject({ projectId: 5, isArchived: false });
    expect(filters[3]).toMatchObject({
      projectId: { not: 5 },
      isArchived: false,
    });
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

  it("disallows dragging when the viewer cannot edit, and shows no grab handle (same case proves both)", () => {
    renderNameCell(makeRow({ id: 13 }), {
      canAddEdit: false,
      isFiltering: false,
    });
    expect(dragSpecRef.current.canDrag()).toBe(false);
    expect(
      screen.queryByTestId("requirement-drag-handle-13")
    ).not.toBeInTheDocument();
  });

  it("disallows dragging while filtering, and shows no grab handle (same case proves both)", () => {
    renderNameCell(makeRow({ id: 14 }), {
      canAddEdit: true,
      isFiltering: true,
    });
    expect(dragSpecRef.current.canDrag()).toBe(false);
    expect(
      screen.queryByTestId("requirement-drag-handle-14")
    ).not.toBeInTheDocument();
  });

  it("allows dragging when the viewer can edit and is not filtering, and shows the grab handle", () => {
    renderNameCell(makeRow({ id: 15 }), {
      canAddEdit: true,
      isFiltering: false,
    });
    expect(dragSpecRef.current.canDrag()).toBe(true);
    expect(screen.getByTestId("requirement-drag-handle-15")).toBeInTheDocument();
  });

  it("the grab handle is decorative: aria-hidden, not a button, and cursor-grab", () => {
    renderNameCell(makeRow({ id: 20 }), {
      canAddEdit: true,
      isFiltering: false,
    });
    const handle = screen.getByTestId("requirement-drag-handle-20");
    expect(handle).toHaveAttribute("aria-hidden", "true");
    expect(handle.tagName).not.toBe("BUTTON");
    expect(handle.getAttribute("class")).toContain("cursor-grab");
  });

  it("tags the drag item with ItemTypes.REQUIREMENT and carries the requirement id", () => {
    renderNameCell(makeRow({ id: 16, name: "Login flow" }));
    expect(dragSpecRef.current.type).toBe(ItemTypes.REQUIREMENT);
    expect(dragSpecRef.current.item).toEqual({
      requirementId: 16,
      name: "Login flow",
    });
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
