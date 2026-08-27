import fs from "fs";
import path from "path";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RequirementCoverageResponse } from "~/app/api/projects/[projectId]/requirements/coverage/route";
import type { RequirementCoverageBreakdown } from "~/lib/services/requirementCoverage";
import {
  buildRequirementMaps,
  computeVisibleRequirementIds,
} from "./requirementsListRows";

// --- Hoisted mock scaffolding -------------------------------------------
// Adapted from the earlier react-arborist tree component's own test file's
// module-mock set (this file's read_first analog, since deleted in this
// same plan) rather than inventing a second convention.

const { useFindManyIssueMock } = vi.hoisted(() => ({
  useFindManyIssueMock: vi.fn(
    (
      _args?: {
        where?: Record<string, unknown>;
        orderBy?: unknown;
      },
      // 28-13: the real call site's second argument now also carries
      // `enabled` (the mode-gate) alongside `optimisticUpdate` -- typed here
      // so tests can assert on it; this mock's own return value still
      // ignores both arguments entirely, unchanged runtime behavior.
      _options?: {
        optimisticUpdate?: boolean;
        enabled?: boolean;
      }
    ): {
      data: Record<string, unknown>[] | undefined;
      isLoading: boolean;
      error: unknown;
      refetch: () => void;
    } => ({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
  ),
}));

const { useCreateIssueMock, useUpdateIssueMock } = vi.hoisted(() => ({
  useCreateIssueMock: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({ id: 1 }),
  })),
  useUpdateIssueMock: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    issue: {
      useFindMany: useFindManyIssueMock,
      useCreate: useCreateIssueMock,
      useUpdate: useUpdateIssueMock,
    },
  }),
}));

// 27-10: CreateRequirementDialog now mounts DeferredIssueManager for its
// references affordance. That component (and the SearchIssuesDialog it
// always renders) reaches several ZenStack models this file's issue-only
// mock above doesn't expose (issue.useUpsert, projectIntegration,
// integrationProject, ...). This file's own scope is the coverage-rollup
// invalidation/toolbar-ref behavior, not DeferredIssueManager's internals
// (covered by DeferredIssueManager.test.tsx) -- same stand-in convention
// UnifiedIssueManager.test.tsx and caseIssueLinkSave.test.tsx already use
// for this exact component.
vi.mock("@/components/issues/DeferredIssueManager", () => ({
  DeferredIssueManager: () => <div data-testid="deferred-issue-manager" />,
}));

// F10-style rollup invalidation proof, never a hand-rolled predicate stand-in.
const mockInvalidateQueries = vi.fn();
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
  };
});

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "test-user-1" } } }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, any>) =>
    params ? `${key}:${Object.values(params).join("·")}` : key,
  // The real RequirementsListColumns (rendered here, not mocked) now mounts
  // CasesListDisplay for the linkedCases/coveringCases cells, which reads
  // useLocale() for its count formatting -- the bare useTranslations-only
  // mock above left it undefined otherwise.
  useLocale: () => "en-US",
}));

vi.mock("~/lib/navigation", () => ({
  // `replace`/`usePathname` are ColumnSelection's URL-sync seam; `refresh` is
  // the provenance badge's post-detach seam.
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/test",
  // The covering cell's drill-down popover renders `TestCaseNameDisplay`
  // (gap closure 26.2-15), which links through this seam.
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// ColumnSelection reads the shareable `?columns=` param through this seam.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

let mockIsProjectAdmin = true;
vi.mock("~/hooks/useProjectPermissions", () => ({
  useProjectPermissions: () => ({
    permissions: null,
    isProjectAdmin: mockIsProjectAdmin,
    isLoading: false,
  }),
}));

const { useRequirementCoverageMock } = vi.hoisted(() => ({
  useRequirementCoverageMock: vi.fn(() => ({
    data: undefined as unknown,
    isError: false,
  })),
}));
vi.mock("~/hooks/useRequirementCoverage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/hooks/useRequirementCoverage")>();
  return {
    ...actual,
    useRequirementCoverage: useRequirementCoverageMock,
  };
});

// The covering column's drill-down seam (gap closure 26.2-15) -- mocked the
// same way as `useRequirementCoverage` above: this suite exercises the REAL
// RequirementsListColumns/DataTable, so without a mock every visible row's
// covering cell would call the real `useQuery` with no QueryClientProvider
// ancestor. Its own expand/split/error behavior is RequirementsListColumns
// .test.tsx's responsibility -- this suite only needs a default, configurable
// per test that never crashes.
const { useRequirementCoveringCasesMock } = vi.hoisted(() => ({
  useRequirementCoveringCasesMock: vi.fn(() => ({
    data: undefined as unknown,
    isLoading: false,
    isError: false,
  })),
}));
vi.mock("~/hooks/useRequirementCoveringCases", () => ({
  useRequirementCoveringCases: useRequirementCoveringCasesMock,
}));

// The real hook owns TanStack Virtual + an IntersectionObserver, neither of
// which produce layout under jsdom -- replace with a pass-through that
// renders every flattened row (DataTable.virtualized.test.tsx's own
// convention, lines 7-42), so this suite exercises the REAL DataTable and
// the REAL column defs rather than a stubbed table.
const virtualizedHookMock = vi.hoisted(() => ({
  scrollToIndex: vi.fn(),
}));
vi.mock("~/hooks/useVirtualizedInfiniteList", () => ({
  useVirtualizedInfiniteList: (opts: {
    count: number;
    onLoadMore: () => void;
  }) => ({
    scrollRef: () => {},
    sentinelRef: { current: null },
    virtualizer: { scrollToIndex: virtualizedHookMock.scrollToIndex },
    virtualItems: Array.from({ length: opts.count }, (_, i) => ({
      key: i,
      index: i,
      start: i * 48,
      size: 48,
      end: (i + 1) * 48,
      lane: 0,
    })),
    totalSize: opts.count * 48,
    measureElement: () => {},
    maxHeight: null,
  }),
}));

// IssueStatusDisplay's own useIssueColors() hook fetches Color rows through
// useClientQueries(schema).color.useFindMany(...) -- a model this file's
// issue-only useClientQueries mock above does not expose. A passthrough
// mock is the seam UI-SPEC/the plan explicitly permits for this reason (see
// SUMMARY.md "IssueStatusDisplay mock" note).
// The status-dot legend (transplanted from Milestone > Issues in scope)
// reads status rows through its own data hook -- a seam outside this file's
// issue-only ZenStack mock, so stub it like IssueStatusDisplay below.
vi.mock("@/components/iterations/IterationStatusLegendPopover", () => ({
  IterationStatusLegendPopover: () => <span data-testid="mock-status-legend" />,
}));

vi.mock("@/components/IssueStatusDisplay", () => ({
  IssueStatusDisplay: ({ status }: { status: string | null }) => (
    <span data-testid="mock-issue-status">{status ?? ""}</span>
  ),
}));

// D-17's priority column cell renders IssuePriorityDisplay, which reads
// Color rows through the SAME useClientQueries(schema).color.useFindMany
// seam IssueStatusDisplay does above -- identical passthrough mock for the
// identical reason.
vi.mock("@/components/IssuePriorityDisplay", () => ({
  IssuePriorityDisplay: ({ priority }: { priority: string | null }) => (
    <span data-testid="mock-issue-priority">{priority ?? ""}</span>
  ),
}));

// CasesListDisplay itself stays real (its trigger badge and count-hiding-at-
// zero rule are exercised through the real columns); only its own internal
// search-dropdown seam, AsyncCombobox, is stubbed -- the SAME convention
// RequirementsListColumns.test.tsx established for this exact primitive, so
// a test here can invoke the real fetch-building code path directly instead
// of driving a real Radix popover through jsdom.
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

// Capture the useDrop spec factories (one per call site: the list-level
// target is always registered before the bottom-of-list root zone, since
// React calls hooks in stable source order every render) and the useDrag
// spec the name cell's drag source produces -- jsdom cannot drive real HTML5
// drag choreography, so this file drives the reparent branches through the
// captured spec objects directly, mirroring the earlier tree component's
// own dropSpecRef / RequirementsListColumns.test.tsx's dragSpecRef
// conventions.
const { dropSpecs, dropCallCount, dragSpecRef } = vi.hoisted(() => ({
  dropSpecs: { list: null as any, bottom: null as any },
  dropCallCount: { current: 0 },
  dragSpecRef: { current: null as any },
}));

vi.mock("react-dnd", () => ({
  useDragDropManager: () => ({ __mockDndManager: true }),
  useDrop: (specFactory: () => any) => {
    const spec = specFactory();
    if (dropCallCount.current % 2 === 0) {
      dropSpecs.list = spec;
    } else {
      dropSpecs.bottom = spec;
    }
    dropCallCount.current += 1;
    return [{ isOverList: false, isOverBottom: false }, vi.fn()];
  },
  useDrag: (specFactory: () => any) => {
    dragSpecRef.current = specFactory();
    return [{ isDragging: false }, vi.fn()];
  },
}));

import RequirementsListView, {
  type RequirementsListViewHandle,
} from "./RequirementsListView";

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false);
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

function makeRequirement(
  overrides: Partial<Record<string, any>> & { id: number }
) {
  const name = overrides.name ?? `Requirement ${overrides.id}`;
  return {
    name,
    title: name,
    parentId: null,
    projectId: 42,
    isDeleted: false,
    isRequirement: true,
    integrationId: null,
    requirementDetachedAt: null,
    externalKey: null,
    externalUrl: null,
    externalStatus: null,
    status: null,
    issueTypeName: null,
    issueTypeIconUrl: null,
    ...overrides,
  };
}

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
  return { projectId: 42, coverage };
}

/** A `RequirementTreeRow` fixture (28-08's shape) -- the shape both the
 *  hook's roots-page and children-page responses carry per row. */
function makeLazyRow(
  overrides: Partial<Record<string, unknown>> & { id: number }
) {
  const name = overrides.name ?? `Lazy Requirement ${overrides.id}`;
  return {
    name,
    title: name,
    status: null,
    externalStatus: null,
    priority: null,
    externalId: null,
    externalKey: null,
    externalUrl: null,
    issueTypeId: null,
    issueTypeName: null,
    issueTypeIconUrl: null,
    contentUpdatedAt: null,
    createdAt: new Date().toISOString(),
    projectId: 42,
    integrationId: null,
    parentId: null,
    isRequirement: true,
    requirementDetachedAt: null,
    isDeleted: false,
    hasChildren: false,
    ...overrides,
  };
}

/** Routes a fake `fetch` by URL: the count round trip (`?countOnly=1`),
 *  the roots-window page (a plain GET to the tree route), a node's
 *  children (`/tree/{id}/children`), and anything else (reparent/create/
 *  delete/etc.) falls through to a bare `{ ok: true }`, mirroring this
 *  file's own pre-existing default. */
function makeTreeFetchMock(options: {
  mode: "all" | "lazy";
  total: number;
  rootsRows?: Array<Record<string, unknown>>;
  childrenByParentId?: Record<number, Array<Record<string, unknown>>>;
  countOk?: boolean;
  /** A sequence of filter/match-endpoint (POST) pages, consumed one per
   *  call (the last is reused if exhausted) -- 28-14's filtered fetch. */
  matchPages?: Array<{
    matchedTotal: number;
    matchedIds: number[];
    ancestorIds: number[];
    rows?: Array<Record<string, unknown>>;
    nextCursor?: unknown;
    expandMatchedSubtrees?: boolean;
  }>;
}) {
  let matchPageIndex = 0;
  return vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (typeof url === "string" && url.includes("/requirements/tree")) {
      if (url.includes("countOnly=1")) {
        if (options.countOk === false) {
          return Promise.resolve({ ok: false, status: 500 });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            total: options.total,
            threshold: 500,
            mode: options.mode,
          }),
        });
      }
      const childrenMatch = url.match(/\/tree\/(\d+)\/children/);
      if (childrenMatch) {
        const parentId = Number(childrenMatch[1]);
        return Promise.resolve({
          ok: true,
          json: async () => ({
            rows: options.childrenByParentId?.[parentId] ?? [],
          }),
        });
      }
      if (method === "POST") {
        const page = options.matchPages?.[
          Math.min(matchPageIndex, options.matchPages.length - 1)
        ] ?? {
          matchedTotal: 0,
          matchedIds: [],
          ancestorIds: [],
          rows: [],
          nextCursor: null,
          expandMatchedSubtrees: false,
        };
        matchPageIndex += 1;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            total: options.total,
            matchedTotal: page.matchedTotal,
            matchedIds: page.matchedIds,
            ancestorIds: page.ancestorIds,
            rows: page.rows ?? [],
            nextCursor: page.nextCursor ?? null,
            expandMatchedSubtrees: page.expandMatchedSubtrees ?? false,
          }),
        });
      }
      if (method === "GET") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            total: options.total,
            rows: options.rootsRows ?? [],
            nextCursor: null,
          }),
        });
      }
    }
    return Promise.resolve({ ok: true });
  });
}

/** 28-14: filters/search moved server-side (D-04) -- the pre-existing
 *  "filters (gap closure 26.2-12)" fixtures below still assert the SAME
 *  visible-row-set behavior, but that set now arrives through a (mocked)
 *  server round trip rather than a purely local computation. This helper
 *  reproduces the round trip by calling the UNTOUCHED oracle
 *  (`computeVisibleRequirementIds`) against the SAME fixture data the test
 *  already sets up, and reports its whole output as `matchedIds` (leaving
 *  `ancestorIds` empty) -- below the threshold this component only ever
 *  unions the two back together (`RequirementsListView.tsx`'s own
 *  `visibleRequirementIds` memo), so which bucket an id lands in makes no
 *  rendering difference here. This proves every pre-existing assertion's
 *  INTENT (which rows end up visible) through the new architecture without
 *  re-implementing the oracle's own intersection/ancestor logic a second
 *  time in this file. */
function makeLegacyFilterFetchMock(
  requirements: Array<Record<string, any>>,
  coverage: RequirementCoverageResponse | undefined,
  coverageError = false
) {
  return vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (typeof url === "string" && url.includes("/requirements/tree")) {
      if (url.includes("countOnly=1")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            total: requirements.length,
            threshold: 500,
            mode: "all",
          }),
        });
      }
      if (method === "POST") {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const normalizedSearch = String(body.search ?? "")
          .trim()
          .toLowerCase();
        const { requirementMap, childrenMap } = buildRequirementMaps(
          requirements as any
        );
        const visible = computeVisibleRequirementIds({
          requirements: requirements as any,
          requirementMap,
          childrenMap,
          normalizedFilter: normalizedSearch,
          filters: {
            coverage: body.coverage ?? "",
            status: body.status ?? "",
            source: body.source ?? "",
          },
          coverage,
          coverageError,
        });
        const matchedIds = visible ? Array.from(visible) : [];
        return Promise.resolve({
          ok: true,
          json: async () => ({
            total: requirements.length,
            matchedTotal: matchedIds.length,
            matchedIds,
            ancestorIds: [],
            rows: [],
            nextCursor: null,
            expandMatchedSubtrees: false,
          }),
        });
      }
    }
    return Promise.resolve({ ok: true });
  });
}

/** 28-14: every filter/search request lands as a POST to the same tree
 *  route the roots pager GETs -- these two helpers isolate just those calls
 *  from whatever `global.fetch` mock a test installed, so a test can assert
 *  on request COUNT (the debounce burst proof) or on the latest request's
 *  BODY (which axis values were actually submitted) without re-deriving the
 *  same filter each time. */
function filterRequestCalls(): Array<[string, RequestInit | undefined]> {
  return (global.fetch as any).mock.calls.filter(
    ([url, init]: [string, RequestInit | undefined]) =>
      typeof url === "string" &&
      url.includes("/requirements/tree") &&
      (init?.method ?? "GET") === "POST"
  );
}

function lastFilterRequestBody(): Record<string, unknown> | null {
  const calls = filterRequestCalls();
  if (calls.length === 0) return null;
  const [, init] = calls.at(-1)!;
  return JSON.parse(String(init!.body));
}

function renderView(
  overrides: {
    selectedRequirementId?: number | null;
    onSelectRequirement?: (id: number | null) => void;
    ref?: React.Ref<RequirementsListViewHandle>;
  } = {}
) {
  const onSelectRequirement = overrides.onSelectRequirement ?? vi.fn();
  const utils = render(
    <RequirementsListView
      ref={overrides.ref}
      projectId="42"
      selectedRequirementId={overrides.selectedRequirementId ?? null}
      onSelectRequirement={onSelectRequirement}
    />
  );
  return { onSelectRequirement, ...utils };
}

/** Opens a Radix DropdownMenu trigger -- fireEvent.click alone doesn't
 *  dispatch the pointerdown/pointerup sequence Radix listens for in jsdom. */
function openMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
  fireEvent.pointerUp(trigger, { button: 0, pointerId: 1 });
}

/** Opens a shadcn/Radix Select by its trigger's testid and clicks the named
 *  option (matched by accessible name/role, so a same-text badge elsewhere
 *  in the row -- e.g. a provenance badge -- can never collide: only the
 *  Select's own `role="option"` items are candidates). Mirrors
 *  BulkEditModal.test.tsx's own established real-Radix-Select pattern
 *  (`fireEvent.click` wrapped in `act`, relying on the `hasPointerCapture`/
 *  `scrollIntoView` polyfills installed in `beforeAll` above). */
async function selectFilterOption(triggerTestId: string, optionName: string) {
  const trigger = screen.getByTestId(triggerTestId);
  await act(async () => {
    fireEvent.click(trigger);
  });
  const option = await screen.findByRole("option", { name: optionName });
  await act(async () => {
    fireEvent.click(option);
  });
}

/** The event sequence a pointer travelling off the last row into the
 *  wrapper's own blank strip produces: a `dragleave` whose `relatedTarget`
 *  is OUTSIDE the row. jsdom 30 has no `window.DragEvent`, so
 *  `fireEvent.dragLeave(el, { relatedTarget })` silently drops the init
 *  property (falls back to the plain `Event` constructor) -- synthesize
 *  manually per usePageFileDrop.test.ts's pattern instead. */
function dispatchDragLeave(el: Element, relatedTarget: EventTarget) {
  const ev = new Event("dragleave", { bubbles: true });
  Object.defineProperty(ev, "relatedTarget", {
    value: relatedTarget,
    writable: true,
  });
  fireEvent(el, ev);
}

beforeEach(() => {
  vi.clearAllMocks();
  // ColumnSelection remembers visibility per storageKey; a choice persisted
  // by one test must never leak into the next one's "default layout" checks.
  window.localStorage.clear();
  mockIsProjectAdmin = true;
  dropSpecs.list = null;
  dropSpecs.bottom = null;
  dropCallCount.current = 0;
  dragSpecRef.current = null;
  capturedFetchOptionsList.length = 0;
  global.fetch = vi.fn().mockResolvedValue({ ok: true }) as any;
  useFindManyIssueMock.mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  useCreateIssueMock.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({ id: 1 }),
  });
  useUpdateIssueMock.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({}),
  });
  useRequirementCoverageMock.mockReturnValue({
    data: undefined,
    isError: false,
  });
  useRequirementCoveringCasesMock.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
  });
});

describe("RequirementsListView", () => {
  it("scopes the requirement query to this project, live rows, requirement role, name asc", () => {
    renderView();

    expect(useFindManyIssueMock).toHaveBeenCalled();
    const [args] = useFindManyIssueMock.mock.calls[0]!;
    expect(args!.where).toEqual({
      projectId: 42,
      isDeleted: false,
      isRequirement: true,
    });
    expect(args!.orderBy).toEqual({ name: "asc" });
  });

  describe("hierarchy", () => {
    beforeEach(() => {
      useFindManyIssueMock.mockReturnValue({
        data: [
          makeRequirement({ id: 1, name: "Parent Requirement" }),
          makeRequirement({ id: 2, name: "Child A", parentId: 1 }),
          makeRequirement({ id: 3, name: "Child B", parentId: 1 }),
        ],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      useRequirementCoverageMock.mockReturnValue({
        data: makeCoverageResponse({
          1: makeBreakdown({
            status: "PASSED",
            uncovered: false,
            passed: 3,
            linkedCaseCount: 3,
            statuses: [
              { statusId: 1, name: "Passed", color: "#22c55e", count: 3 },
            ],
          }),
        }),
        isError: false,
      });
    });

    it("renders only the parent row while collapsed, then reveals both children on chevron click", () => {
      renderView();

      expect(screen.getByTestId("requirement-row-1")).toBeInTheDocument();
      expect(screen.queryByTestId("requirement-row-2")).not.toBeInTheDocument();
      expect(screen.queryByTestId("requirement-row-3")).not.toBeInTheDocument();

      const collapsedContent = screen.getByTestId(
        "requirement-coverage-cell-1"
      ).textContent;
      expect(screen.getByLabelText("Passed: 3")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("requirement-chevron-1"));

      expect(screen.getByTestId("requirement-row-2")).toBeInTheDocument();
      expect(screen.getByTestId("requirement-row-3")).toBeInTheDocument();

      // The parent's own coverage chip is server-supplied and unchanged by
      // expansion -- never re-derived from the now-rendered children.
      expect(screen.getByLabelText("Passed: 3")).toBeInTheDocument();
      expect(
        screen.getByTestId("requirement-coverage-cell-1").textContent
      ).toBe(collapsedContent);
    });
  });

  describe("column layout (gap closure 26.2-11)", () => {
    beforeEach(() => {
      useFindManyIssueMock.mockReturnValue({
        data: [makeRequirement({ id: 1, name: "Root A" })],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it("renders the eight column ids, in order, at the pane's default width", () => {
      renderView();

      const table = screen.getByTestId("requirements-list");
      const headerCells = Array.from(
        table.querySelectorAll('[role="columnheader"]')
      );
      expect(headerCells.length).toBeGreaterThanOrEqual(8);
      // Ported label text for every column in expected order -- proves
      // ordering, not just presence (a column inserted in the wrong place
      // is invisible to an id-only check).
      const labels = headerCells.map((cell) => cell.textContent);
      expect(labels[0]).toBe("requirements.list.columnName");
      expect(labels[1]).toBe("requirements.list.columnStatus");
      // D-17: Priority ships visible-by-default, immediately after Status
      // (operator direction 2026-08-25).
      expect(labels[2]).toBe("common.fields.priority");
      expect(labels[3]).toBe("requirements.coverage.title");
      expect(labels[4]).toBe("requirements.coverage.panelTitle");
      expect(labels[5]).toBe("requirements.linkedCases.title");
      expect(labels[6]).toBe("requirements.list.columnSource");
    });

    // Gap closure 26.2-17: createdAt ships hidden by default (meta.isVisible:
    // false) -- it must be ABSENT from the header row at default width, not
    // merely present-somewhere, since the assertion above only proves the
    // first six labels' order and would miss a hidden column rendering
    // anyway.
    it("does not render the hidden-by-default createdAt column as a header at the pane's default width", () => {
      renderView();

      const table = screen.getByTestId("requirements-list");
      const headerCells = Array.from(
        table.querySelectorAll('[role="columnheader"]')
      );
      // D-17 adds a ninth (visible-by-default) column def -- eight visible
      // headers now, createdAt still absent.
      expect(headerCells).toHaveLength(8);
      const labels = headerCells.map((cell) => cell.textContent);
      expect(labels).not.toContain("common.fields.createdAt");
    });

    // Cold-load race regression: on a real first load `useProjectPermissions`
    // resolves AFTER the visibility map is seeded, so `columns` omits
    // `actions` and createdAt IS the last column at seed time. The original
    // seed's first/last-always-visible clause therefore baked
    // `createdAt: true` permanently (live-confirmed bug, 2026-08-25). A
    // viewer (`isProjectAdmin: false`) reproduces the same "createdAt sits
    // last" configuration statically.
    it("keeps createdAt hidden when the actions column is absent (viewer / permissions still resolving)", () => {
      mockIsProjectAdmin = false;
      renderView();

      const table = screen.getByTestId("requirements-list");
      const labels = Array.from(
        table.querySelectorAll('[role="columnheader"]')
      ).map((cell) => cell.textContent);
      // D-17 adds Priority to the base (actions-absent) set: name/status/
      // coverage/coveringCases/linkedCases/source/priority = 7.
      expect(labels).toHaveLength(7);
      expect(labels).not.toContain("common.fields.createdAt");
    });

    it("keeps createdAt hidden across the permissions flip that appends the actions column after mount", () => {
      mockIsProjectAdmin = false;
      const onSelectRequirement = vi.fn();
      const { rerender } = render(
        <RequirementsListView
          projectId="42"
          selectedRequirementId={null}
          onSelectRequirement={onSelectRequirement}
        />
      );

      mockIsProjectAdmin = true;
      rerender(
        <RequirementsListView
          projectId="42"
          selectedRequirementId={null}
          onSelectRequirement={onSelectRequirement}
        />
      );

      const table = screen.getByTestId("requirements-list");
      const labels = Array.from(
        table.querySelectorAll('[role="columnheader"]')
      ).map((cell) => cell.textContent);
      // actions joined (8 headers again, D-17's priority column included),
      // createdAt stayed hidden.
      expect(labels).toHaveLength(8);
      expect(labels).not.toContain("common.fields.createdAt");
    });

    // The reveal path the hidden-by-default column depends on: the shared
    // Columns control (ColumnSelection) is mounted and wired. Its checkbox
    // mechanics are ColumnSelection.test.tsx's responsibility; this proves
    // the requirements toolbar actually offers it.
    it("renders the Columns control in the toolbar", () => {
      renderView();

      expect(
        screen.getByTestId("column-selection-trigger")
      ).toBeInTheDocument();
    });

    it("moves horizontal scroll onto the table body (enableColumnPinning), never overflow-x-hidden", () => {
      renderView();

      const scrollBody = screen.getByTestId("requirements-list-scroll");
      expect(scrollBody.className).toContain("overflow-auto");
      expect(scrollBody.className).not.toContain("overflow-x-hidden");

      const tableContainer = screen.getByTestId("requirements-list");
      expect(tableContainer.className).toContain("overflow-hidden");
      expect(tableContainer.className).not.toContain("overflow-x-auto");
    });

    it("does not stretch to 100% width (flexColumnId removed) -- the header row sits at its natural summed column width", () => {
      renderView();

      const headerRow = screen
        .getByTestId("requirements-list")
        .querySelector('[role="row"]') as HTMLElement;
      // A `flexColumnId="name"` table would render this as the literal
      // string "100%"; with it removed the row sits at the columns' summed
      // pixel width instead.
      expect(headerRow.style.width).not.toBe("100%");
      expect(headerRow.style.width).toMatch(/^\d+(\.\d+)?px$/);
    });
  });

  // Gap closure 26.2-15 (UAT gap 11) replaced the covering cell's client-side
  // descendant filter with the covering-cases drill-down -- this suite's own
  // proof of that filter (the retired "descendant map reaches the covering
  // cell" test, gap closure 26.2-11) is superseded by RequirementsListColumns
  // .test.tsx's "ABT-47193 shape" test at the unit level; this one proves the
  // SAME shape survives through the real, wired-up RequirementsListView.
  describe("covering cell drill-down (gap closure 26.2-15)", () => {
    it("the covering cell's other-project expansion renders a case reached only through a non-requirement descendant (ABT-47193 shape)", () => {
      useFindManyIssueMock.mockReturnValue({
        data: [makeRequirement({ id: 1, name: "Parent" })],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      useRequirementCoverageMock.mockReturnValue({
        data: makeCoverageResponse({
          1: makeBreakdown({ linkedCaseCount: 1, crossProjectCaseCount: 1 }),
        }),
        isError: false,
      });
      useRequirementCoveringCasesMock.mockReturnValue({
        data: {
          requirementId: 1,
          cases: [
            {
              caseId: 500,
              caseName: "Non-requirement descendant case",
              projectId: 99,
              projectName: "Other Project",
              lastStatusName: null,
              lastStatusColor: null,
              lastStatusIsSuccess: null,
              lastStatusIsFailure: null,
              lastExecutedAt: null,
              direct: false,
            },
          ],
        },
        isLoading: false,
        isError: false,
      });

      renderView();

      fireEvent.click(
        screen.getByTestId("requirement-covering-cases-other-trigger-1")
      );

      expect(
        screen.getByText("Non-requirement descendant case")
      ).toBeInTheDocument();
    });
  });

  describe("reparent", () => {
    beforeEach(() => {
      useFindManyIssueMock.mockReturnValue({
        data: [
          makeRequirement({ id: 1, name: "Root A" }),
          makeRequirement({ id: 7, name: "Root B" }),
        ],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it("success: fetch ok produces moveSuccess, refetches, and invalidates only the coverage rollup", async () => {
      const refetch = vi.fn();
      useFindManyIssueMock.mockReturnValue({
        data: [
          makeRequirement({ id: 1, name: "Root A" }),
          makeRequirement({ id: 7, name: "Root B" }),
        ],
        isLoading: false,
        error: null,
        refetch,
      });
      global.fetch = vi.fn().mockResolvedValue({ ok: true }) as any;

      renderView();

      fireEvent.dragEnter(screen.getByTestId("requirement-row-7"));
      await act(async () => {
        await dropSpecs.list.drop(
          { requirementId: 1, name: "Root A" },
          { didDrop: () => false }
        );
      });

      // Not `toHaveBeenCalledTimes(1)`: `global.fetch` is also the transport
      // `useRequirementsTree`'s own mode-count round trip uses (28-13), which
      // now fires once on every mount regardless of this drop -- a call-count
      // assertion here would be coupled to that unrelated request. The
      // reparent endpoint's own call is what this test actually verifies.
      await waitFor(() =>
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/projects/42/requirements/1/reparent",
          expect.anything()
        )
      );
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/projects/42/requirements/1/reparent",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ parentId: 7 }),
        })
      );

      const { toast } = await import("sonner");
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith(
          "requirements.tree.moveSuccess"
        )
      );
      expect(refetch).toHaveBeenCalled();

      await waitFor(() => expect(mockInvalidateQueries).toHaveBeenCalled());
      const [{ predicate }] = mockInvalidateQueries.mock.calls.at(-1)!;
      expect(predicate({ queryKey: ["requirementCoverage", 42] })).toBe(true);
      expect(predicate({ queryKey: ["requirementCoveringCases", 42, 7] })).toBe(
        false
      );
    });

    it("rejection: fetch ok:false surfaces the server message and never invalidates coverage", async () => {
      const refetch = vi.fn();
      useFindManyIssueMock.mockReturnValue({
        data: [
          makeRequirement({ id: 1, name: "Root A" }),
          makeRequirement({ id: 7, name: "Root B" }),
        ],
        isLoading: false,
        error: null,
        refetch,
      });
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "cycle" }),
      }) as any;

      renderView();

      fireEvent.dragEnter(screen.getByTestId("requirement-row-7"));
      await act(async () => {
        await dropSpecs.list.drop(
          { requirementId: 1, name: "Root A" },
          { didDrop: () => false }
        );
      });

      const { toast } = await import("sonner");
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          "requirements.tree.moveRejected cycle"
        )
      );
      expect(refetch).toHaveBeenCalled();
      expect(mockInvalidateQueries).not.toHaveBeenCalled();
    });

    it("network failure: a rejecting fetch produces moveFailed and no invalidation", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("offline")) as any;

      renderView();

      fireEvent.dragEnter(screen.getByTestId("requirement-row-7"));
      await act(async () => {
        await dropSpecs.list.drop(
          { requirementId: 1, name: "Root A" },
          { didDrop: () => false }
        );
      });

      const { toast } = await import("sonner");
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("requirements.tree.moveFailed")
      );
      expect(mockInvalidateQueries).not.toHaveBeenCalled();
    });

    it("no-op guard: dropping a requirement onto itself issues no fetch", async () => {
      renderView();

      fireEvent.dragEnter(screen.getByTestId("requirement-row-1"));
      await act(async () => {
        await dropSpecs.list.drop(
          { requirementId: 1, name: "Root A" },
          { didDrop: () => false }
        );
      });

      // Not a blanket "never called": `useRequirementsTree`'s own mode-count
      // request (28-13) fires on every mount regardless of this drop -- what
      // this guard actually proves is that the SELF-DROP never reaches the
      // reparent endpoint.
      expect(global.fetch).not.toHaveBeenCalledWith(
        "/api/projects/42/requirements/1/reparent",
        expect.anything()
      );
    });

    it("blank-area guard: a dragleave off the last row into the wrapper's empty strip issues no fetch", async () => {
      renderView();

      const lastRow = screen.getByTestId("requirement-row-7");
      fireEvent.dragEnter(lastRow);
      dispatchDragLeave(lastRow, document.body);

      await act(async () => {
        await dropSpecs.list.drop(
          { requirementId: 1, name: "Root A" },
          { didDrop: () => false }
        );
      });

      // See the no-op guard test's own comment above.
      expect(global.fetch).not.toHaveBeenCalledWith(
        "/api/projects/42/requirements/1/reparent",
        expect.anything()
      );
      const { toast } = await import("sonner");
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("flicker-guard companion: a dragleave onto a child node of the same row does not clear the hovered id", async () => {
      renderView();

      const lastRow = screen.getByTestId("requirement-row-7");
      fireEvent.dragEnter(lastRow);
      const childCell = lastRow.querySelector(
        "[data-testid^='requirement-name-cell-']"
      )!;
      dispatchDragLeave(lastRow, childCell);

      await act(async () => {
        await dropSpecs.list.drop(
          { requirementId: 1, name: "Root A" },
          { didDrop: () => false }
        );
      });

      // See the "success" reparent test's own comment above: `global.fetch`
      // now also carries `useRequirementsTree`'s unrelated mode-count
      // request (28-13), so this waits for the reparent call specifically
      // rather than an absolute call count.
      await waitFor(() =>
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/projects/42/requirements/1/reparent",
          expect.anything()
        )
      );
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/projects/42/requirements/1/reparent",
        expect.objectContaining({ body: JSON.stringify({ parentId: 7 }) })
      );
    });

    it("drop gate: canDrop() is false when the viewer is not a project admin", () => {
      mockIsProjectAdmin = false;
      renderView();
      expect(dropSpecs.list.canDrop()).toBe(false);
    });

    it("drop gate: canDrop() is false while a filter query is active", () => {
      renderView();
      fireEvent.change(screen.getByTestId("requirements-filter-input"), {
        target: { value: "root a" },
      });
      expect(dropSpecs.list.canDrop()).toBe(false);
    });
  });

  // Gap closure 26.2-16 (UAT gap 9 rebuild): the mechanism-level proof that
  // the drag affordances are direct DOM attributes/CSS, never React state.
  // jsdom cannot drive real HTML5 drag choreography or assert computed
  // visual state -- these tests drive the captured `useDrag` spec's
  // `item()`/`end()` directly (mirroring the reparent describe block above)
  // and assert only the DOM attributes/classes those calls produce. The
  // real-browser drag check remains mandatory UAT.
  describe("drag affordances (direct DOM attributes, no re-render)", () => {
    beforeEach(() => {
      useFindManyIssueMock.mockReturnValue({
        data: [makeRequirement({ id: 1, name: "Root A" })],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it("useDragLayer is structurally absent -- the mechanism that killed the gesture must never return", () => {
      const source = fs.readFileSync(
        path.join(
          process.cwd(),
          "app/[locale]/projects/requirements/[projectId]/RequirementsListView.tsx"
        ),
        "utf8"
      );
      expect(source).not.toContain("useDragLayer");
    });

    it("item() marks the container and the source row; end() clears both; a second end() is idempotent", () => {
      renderView();

      const container = screen.getByTestId("requirements-list-container");
      const row = screen.getByTestId("requirement-row-1");

      expect(container).not.toHaveAttribute("data-req-drag");
      expect(row).not.toHaveAttribute("data-req-dragged");

      dragSpecRef.current.item();

      expect(container).toHaveAttribute("data-req-drag", "active");
      expect(row).toHaveAttribute("data-req-dragged", "true");

      dragSpecRef.current.end();

      expect(container).not.toHaveAttribute("data-req-drag");
      expect(row).not.toHaveAttribute("data-req-dragged");

      // Belt-and-braces: a cancelled drag's native `dragend` firing on top
      // of react-dnd's own `end()` must never throw or leave a stray
      // attribute behind.
      expect(() => dragSpecRef.current.end()).not.toThrow();
      expect(container).not.toHaveAttribute("data-req-drag");
    });

    // Gap closure 26.2-15 (UAT gap 12) moved these classes off the row's own
    // box onto the engine's pointer-events-none ring overlay (a child of the
    // row, `requirement-row-{id}-ring`) so the ring paints above the pinned
    // Actions cell instead of losing to it.
    it("rows carry the static candidate-ring classes unconditionally on the ring overlay (never toggled by JS)", () => {
      renderView();
      const row = screen.getByTestId("requirement-row-1");
      const ring = row.querySelector(
        '[data-testid="requirement-row-1-ring"]'
      ) as HTMLElement;
      expect(ring).toBeInTheDocument();
      expect(ring.className).toContain(
        "[[data-req-drag=active]_&]:border-dashed"
      );
      // An ANCESTOR check, not a same-element compound one -- `data-req-
      // dragged` lives on the ROW (the overlay's parent), never on the
      // overlay itself.
      expect(ring.className).toContain("[[data-req-dragged]_&]:border-0");

      // Unchanged by the drag lifecycle -- these classes are static, so the
      // overlay's className string is identical before and after a drag
      // starts.
      const classNameBeforeDrag = ring.className;
      dragSpecRef.current.item();
      expect(
        (
          row.querySelector(
            '[data-testid="requirement-row-1-ring"]'
          ) as HTMLElement
        ).className
      ).toBe(classNameBeforeDrag);
      dragSpecRef.current.end();
    });

    // Gap closure 26.2-15 (UAT gap 12): the SAME overlay treatment applies to
    // the dynamic drag-over hover ring, not just the static candidate-ring
    // classes above.
    it("the drag-over hover ring renders on the row's ring overlay, not the row's own box", () => {
      renderView();
      const row = screen.getByTestId("requirement-row-1");

      fireEvent.dragEnter(row);

      const ring = row.querySelector(
        '[data-testid="requirement-row-1-ring"]'
      ) as HTMLElement;
      expect(ring.className).toContain("outline-2");
      expect(ring.className).toContain("outline-primary");
      expect(ring.className).toContain("-outline-offset-2");
      expect(row.className).not.toContain("outline-primary");
    });

    it("the bottom root strip carries the static drag classes and an always-mounted (CSS-hidden) hint", () => {
      renderView();
      const strip = screen.getByTestId("requirement-tree-end");
      expect(strip.className).toContain(
        "[[data-req-drag=active]_&]:outline-dashed"
      );
      const hint = screen.getByTestId("requirement-tree-end-hint");
      expect(hint).toBeInTheDocument();
      expect(hint.className).toContain("hidden");
      expect(hint.textContent).toBe("requirements.tree.dropToRootHint");
    });

    it("markDragActive/clearDragActive never call a state setter (plain DOM mutation only)", () => {
      const source = fs.readFileSync(
        path.join(
          process.cwd(),
          "app/[locale]/projects/requirements/[projectId]/RequirementsListView.tsx"
        ),
        "utf8"
      );
      const markerStart = source.indexOf("const markDragActive");
      const markerEnd = source.indexOf("const normalizedFilter");
      expect(markerStart).toBeGreaterThanOrEqual(0);
      expect(markerEnd).toBeGreaterThan(markerStart);
      const lifecycleSection = source.slice(markerStart, markerEnd);
      // Excludes DOM method calls like `container.setAttribute(...)` /
      // `?.setAttribute(...)` (preceded by `.`) -- only a BARE `setFoo(...)`
      // call (a React state setter, by this file's own naming convention)
      // would match here.
      expect(lifecycleSection).not.toMatch(/(?<!\.)\bset[A-Z][a-zA-Z]*\(/);
    });
  });

  describe("invalidat", () => {
    it("invalidates the coverage rollup after creating a requirement (onCreated)", async () => {
      const refetch = vi.fn();
      useFindManyIssueMock.mockReturnValue({
        data: [makeRequirement({ id: 1, name: "Root A" })],
        isLoading: false,
        error: null,
        refetch,
      });
      const mutateAsync = vi.fn().mockResolvedValue({ id: 99 });
      useCreateIssueMock.mockReturnValue({ mutateAsync });

      // The root-level Add Requirement trigger moved to the page action bar
      // (gap closure 26.2-16, UAT gap 13) -- this dialog's own `open` state
      // stays owned by the view, reached here through the same
      // `openCreateRoot` ref `RequirementsWorkspace.tsx` calls.
      const listRef = React.createRef<RequirementsListViewHandle>();
      renderView({ ref: listRef });

      act(() => {
        listRef.current?.openCreateRoot();
      });
      fireEvent.change(screen.getByTestId("create-requirement-name-input"), {
        target: { value: "New Root Requirement" },
      });
      fireEvent.click(screen.getByTestId("create-requirement-submit"));

      await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(mockInvalidateQueries).toHaveBeenCalled());

      const [{ predicate }] = mockInvalidateQueries.mock.calls.at(-1)!;
      expect(predicate({ queryKey: ["requirementCoverage", 42] })).toBe(true);
      expect(predicate({ queryKey: ["requirementCoveringCases", 42, 1] })).toBe(
        false
      );
    });

    it("invalidates the coverage rollup after deleting a requirement (onDeleted)", async () => {
      useFindManyIssueMock.mockReturnValue({
        data: [makeRequirement({ id: 1, name: "Root A" })],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ deletedIds: [1] }),
      }) as any;

      renderView();

      openMenu(screen.getByTestId("requirement-actions-trigger-1"));
      fireEvent.click(screen.getByTestId("requirement-action-delete-1"));
      fireEvent.click(screen.getByTestId("delete-requirement-confirm"));

      await waitFor(() => expect(mockInvalidateQueries).toHaveBeenCalled());
      const [{ predicate }] = mockInvalidateQueries.mock.calls.at(-1)!;
      expect(predicate({ queryKey: ["requirementCoverage", 42] })).toBe(true);
    });
  });

  // Gap closure 26.2-16 (UAT gap 13): the root-level Add Requirement trigger
  // moved to the page action bar in `RequirementsWorkspace.tsx`.
  describe("toolbar (gap closure 26.2-16, UAT gap 13)", () => {
    it("no longer renders the add-root button in the list toolbar", () => {
      useFindManyIssueMock.mockReturnValue({
        data: [makeRequirement({ id: 1, name: "Root A" })],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      renderView();
      expect(
        screen.queryByTestId("requirements-tree-add-root")
      ).not.toBeInTheDocument();
    });

    it("exposes openCreateRoot on its ref for the workspace's action bar button", () => {
      useFindManyIssueMock.mockReturnValue({
        data: [makeRequirement({ id: 1, name: "Root A" })],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      const listRef = React.createRef<RequirementsListViewHandle>();
      renderView({ ref: listRef });

      expect(
        screen.queryByTestId("create-requirement-name-input")
      ).not.toBeInTheDocument();

      act(() => {
        listRef.current?.openCreateRoot();
      });

      expect(
        screen.getByTestId("create-requirement-name-input")
      ).toBeInTheDocument();
    });
  });

  // The detail panel's own route to this list's existing delete dialog.
  // `openDeleteDialog` must reuse `handleRequestDelete` (not a second
  // `setDeleteDialogState` call), so the panel path and the row-action path
  // can never drift on the descendant count or the dialog's state shape.
  describe("openDeleteDialog (panel-driven delete)", () => {
    beforeEach(() => {
      useFindManyIssueMock.mockReturnValue({
        data: [
          makeRequirement({ id: 1, name: "Parent Requirement" }),
          makeRequirement({ id: 2, name: "Child A", parentId: 1 }),
        ],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it("resolves the same descendant count as the row action, for the same id", () => {
      // Row-action path: open through the row's own actions menu.
      const { unmount } = renderView();
      openMenu(screen.getByTestId("requirement-actions-trigger-1"));
      fireEvent.click(screen.getByTestId("requirement-action-delete-1"));
      const rowActionText = screen.getByTestId(
        "delete-requirement-dialog"
      ).textContent;
      unmount();

      // Panel path: open through the imperative handle, for the same id.
      const listRef = React.createRef<RequirementsListViewHandle>();
      renderView({ ref: listRef });
      act(() => {
        listRef.current?.openDeleteDialog(1);
      });
      const panelPathText = screen.getByTestId(
        "delete-requirement-dialog"
      ).textContent;

      // Not merely "both greater than zero" -- the SAME text (which
      // embeds the descendant count) proves the two entry points are
      // pinned to one number, not two that happen to agree today.
      expect(panelPathText).toBe(rowActionText);
    });

    it("clears the selection when the requirement deleted through openDeleteDialog is the selected one", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ deletedIds: [1, 2] }),
      }) as any;

      const onSelectRequirement = vi.fn();
      const listRef = React.createRef<RequirementsListViewHandle>();
      renderView({
        ref: listRef,
        selectedRequirementId: 1,
        onSelectRequirement,
      });

      act(() => {
        listRef.current?.openDeleteDialog(1);
      });
      fireEvent.click(screen.getByTestId("delete-requirement-confirm"));

      await waitFor(() =>
        expect(onSelectRequirement).toHaveBeenCalledWith(null)
      );
    });

    it("no-ops when the id is not present in this list's current requirement set", () => {
      const listRef = React.createRef<RequirementsListViewHandle>();
      renderView({ ref: listRef });

      act(() => {
        listRef.current?.openDeleteDialog(999);
      });

      expect(
        screen.queryByTestId("delete-requirement-dialog")
      ).not.toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("renders requirements-list-error (not a spinner) and retry calls refetch", () => {
      const refetch = vi.fn();
      useFindManyIssueMock.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error("network down"),
        refetch,
      });

      renderView();

      expect(screen.getByTestId("requirements-list-error")).toBeInTheDocument();
      expect(document.querySelector(".animate-spin")).not.toBeInTheDocument();

      fireEvent.click(
        screen.getByRole("button", { name: "search.errors.tryAgain" })
      );
      expect(refetch).toHaveBeenCalled();
    });
  });

  describe("empty states", () => {
    it("renders requirements-tree-empty when there are zero requirements", () => {
      useFindManyIssueMock.mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      renderView();

      expect(screen.getByTestId("requirements-tree-empty")).toBeInTheDocument();
    });

    it("renders the table's noResultsFound message (not requirements-tree-empty) when a filter matches nothing", async () => {
      const requirements = [makeRequirement({ id: 1, name: "Root A" })];
      useFindManyIssueMock.mockReturnValue({
        data: requirements,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      global.fetch = makeLegacyFilterFetchMock(requirements, undefined) as any;

      renderView();

      fireEvent.change(screen.getByTestId("requirements-filter-input"), {
        target: { value: "no such requirement" },
      });

      await waitFor(() => {
        expect(
          screen.getByText("common.ui.search.noResultsFound")
        ).toBeInTheDocument();
      });
      expect(
        screen.queryByTestId("requirements-tree-empty")
      ).not.toBeInTheDocument();
    });
  });

  describe("filters (gap closure 26.2-12)", () => {
    it("Coverage = Uncovered leaves an uncovered leaf visible and its covered ancestor visible (ancestor retention)", async () => {
      const requirements = [
        makeRequirement({ id: 1, name: "Root" }),
        makeRequirement({ id: 2, name: "Uncovered Leaf", parentId: 1 }),
        makeRequirement({ id: 3, name: "Covered Sibling", parentId: 1 }),
      ];
      useFindManyIssueMock.mockReturnValue({
        data: requirements,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      const coverage = makeCoverageResponse({
        1: makeBreakdown({
          status: "PASSED",
          uncovered: false,
          passed: 4,
          linkedCaseCount: 4,
        }),
        2: makeBreakdown({ status: "UNCOVERED", uncovered: true }),
        3: makeBreakdown({
          status: "PASSED",
          uncovered: false,
          passed: 2,
          linkedCaseCount: 2,
        }),
      });
      useRequirementCoverageMock.mockReturnValue({
        data: coverage,
        isError: false,
      });
      global.fetch = makeLegacyFilterFetchMock(requirements, coverage) as any;

      renderView();

      await selectFilterOption(
        "requirements-coverage-filter",
        "requirements.coverage.uncovered"
      );

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-2")).toBeInTheDocument();
      });
      // The covered Root is retained ONLY because it's id 2's ancestor.
      expect(screen.getByTestId("requirement-row-1")).toBeInTheDocument();
      expect(screen.queryByTestId("requirement-row-3")).not.toBeInTheDocument();
    });

    it("Coverage = status:<id> shows only requirements whose breakdown carries that status with a non-zero count, plus ancestors", async () => {
      const requirements = [
        makeRequirement({ id: 1, name: "Root" }),
        makeRequirement({ id: 2, name: "Failed Leaf", parentId: 1 }),
        makeRequirement({ id: 3, name: "Blocked Leaf", parentId: 1 }),
      ];
      useFindManyIssueMock.mockReturnValue({
        data: requirements,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      const coverage = makeCoverageResponse({
        1: makeBreakdown({
          status: "PASSED",
          uncovered: false,
          passed: 4,
          linkedCaseCount: 4,
        }),
        2: makeBreakdown({
          status: "FAILED",
          uncovered: false,
          statuses: [{ statusId: 7, name: "Failed", color: "#f00", count: 2 }],
          linkedCaseCount: 2,
        }),
        3: makeBreakdown({
          status: "NOT_RUN",
          uncovered: false,
          statuses: [{ statusId: 8, name: "Blocked", color: "#999", count: 1 }],
          linkedCaseCount: 1,
        }),
      });
      useRequirementCoverageMock.mockReturnValue({
        data: coverage,
        isError: false,
      });
      global.fetch = makeLegacyFilterFetchMock(requirements, coverage) as any;

      renderView();

      await selectFilterOption("requirements-coverage-filter", "Failed");

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-2")).toBeInTheDocument();
      });
      expect(screen.getByTestId("requirement-row-1")).toBeInTheDocument();
      expect(screen.queryByTestId("requirement-row-3")).not.toBeInTheDocument();
    });

    it("Source = Detached shows only detached requirements plus ancestors", async () => {
      const requirements = [
        makeRequirement({ id: 1, name: "Root" }),
        makeRequirement({
          id: 2,
          name: "Detached Child",
          parentId: 1,
          integrationId: 5,
          requirementDetachedAt: new Date(),
        }),
        makeRequirement({
          id: 3,
          name: "Synced Child",
          parentId: 1,
          integrationId: 5,
        }),
      ];
      useFindManyIssueMock.mockReturnValue({
        data: requirements,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      global.fetch = makeLegacyFilterFetchMock(requirements, undefined) as any;

      renderView();

      await selectFilterOption(
        "requirements-source-filter",
        "requirements.provenance.detachedLabel"
      );

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-2")).toBeInTheDocument();
      });
      expect(screen.getByTestId("requirement-row-1")).toBeInTheDocument();
      expect(screen.queryByTestId("requirement-row-3")).not.toBeInTheDocument();
    });

    it("Coverage + Status intersect: a row matching only one of them is absent", async () => {
      const requirements = [
        makeRequirement({ id: 1, name: "Root", externalStatus: "Open" }),
        makeRequirement({
          id: 2,
          name: "Both Match",
          parentId: 1,
          externalStatus: "Open",
        }),
        makeRequirement({
          id: 3,
          name: "Status Only",
          parentId: 1,
          externalStatus: "Open",
        }),
        makeRequirement({
          id: 4,
          name: "Coverage Only",
          parentId: 1,
          externalStatus: "Closed",
        }),
      ];
      useFindManyIssueMock.mockReturnValue({
        data: requirements,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      const coverage = makeCoverageResponse({
        1: makeBreakdown({
          status: "PASSED",
          uncovered: false,
          passed: 1,
          linkedCaseCount: 1,
        }),
        2: makeBreakdown({ status: "UNCOVERED", uncovered: true }),
        3: makeBreakdown({
          status: "PASSED",
          uncovered: false,
          passed: 1,
          linkedCaseCount: 1,
        }),
        4: makeBreakdown({ status: "UNCOVERED", uncovered: true }),
      });
      useRequirementCoverageMock.mockReturnValue({
        data: coverage,
        isError: false,
      });
      global.fetch = makeLegacyFilterFetchMock(requirements, coverage) as any;

      renderView();

      await selectFilterOption(
        "requirements-coverage-filter",
        "requirements.coverage.uncovered"
      );
      await selectFilterOption("requirements-status-filter", "Open");

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-2")).toBeInTheDocument();
      });
      expect(screen.getByTestId("requirement-row-1")).toBeInTheDocument();
      expect(screen.queryByTestId("requirement-row-3")).not.toBeInTheDocument();
      expect(screen.queryByTestId("requirement-row-4")).not.toBeInTheDocument();
    });

    it("with coverage unavailable, the Coverage Select is disabled and the other two still filter", async () => {
      const requirements = [
        makeRequirement({ id: 1, name: "Root", externalStatus: "Open" }),
        makeRequirement({
          id: 2,
          name: "Open Child",
          parentId: 1,
          externalStatus: "Open",
        }),
        makeRequirement({
          id: 3,
          name: "Closed Child",
          parentId: 1,
          externalStatus: "Closed",
        }),
      ];
      useFindManyIssueMock.mockReturnValue({
        data: requirements,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      useRequirementCoverageMock.mockReturnValue({
        data: undefined,
        isError: false,
      });
      global.fetch = makeLegacyFilterFetchMock(
        requirements,
        undefined,
        false
      ) as any;

      renderView();

      expect(screen.getByTestId("requirements-coverage-filter")).toBeDisabled();

      await selectFilterOption("requirements-status-filter", "Open");

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-2")).toBeInTheDocument();
      });
      expect(screen.getByTestId("requirement-row-1")).toBeInTheDocument();
      expect(screen.queryByTestId("requirement-row-3")).not.toBeInTheDocument();
    });

    it("clearing every filter restores the full unfiltered row set, including rows that were only present as retained ancestors", async () => {
      const requirements = [
        makeRequirement({ id: 1, name: "Root" }),
        makeRequirement({ id: 2, name: "Uncovered Leaf", parentId: 1 }),
        makeRequirement({ id: 3, name: "Covered Sibling", parentId: 1 }),
      ];
      useFindManyIssueMock.mockReturnValue({
        data: requirements,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      const coverage = makeCoverageResponse({
        1: makeBreakdown({
          status: "PASSED",
          uncovered: false,
          passed: 4,
          linkedCaseCount: 4,
        }),
        2: makeBreakdown({ status: "UNCOVERED", uncovered: true }),
        3: makeBreakdown({
          status: "PASSED",
          uncovered: false,
          passed: 2,
          linkedCaseCount: 2,
        }),
      });
      useRequirementCoverageMock.mockReturnValue({
        data: coverage,
        isError: false,
      });
      global.fetch = makeLegacyFilterFetchMock(requirements, coverage) as any;

      renderView();

      await selectFilterOption(
        "requirements-coverage-filter",
        "requirements.coverage.uncovered"
      );
      await waitFor(() => {
        expect(
          screen.queryByTestId("requirement-row-3")
        ).not.toBeInTheDocument();
      });

      await selectFilterOption(
        "requirements-coverage-filter",
        "milestones.members.filterAllCoverage"
      );

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-3")).toBeInTheDocument();
      });
      expect(screen.getByTestId("requirement-row-1")).toBeInTheDocument();
      expect(screen.getByTestId("requirement-row-2")).toBeInTheDocument();
    });
  });

  // 28-14 Task 1 (D-04): filters and text search submit to the server at
  // EVERY project size now -- `computeVisibleRequirementIds`'s call site is
  // gone from the component (the function and its own tests are untouched,
  // 28-09's oracle). Same convention as the mode-fork/expand-on-demand
  // blocks below: `useRequirementsTree` runs for real against a routed fake
  // `fetch`, never mocked itself.
  describe("server-side filtering (28-14)", () => {
    it("a burst of keystrokes in the search box produces exactly one filter request, after the debounce", async () => {
      global.fetch = makeTreeFetchMock({
        mode: "lazy",
        total: 600,
        matchPages: [
          {
            matchedTotal: 1,
            matchedIds: [501],
            ancestorIds: [],
            expandMatchedSubtrees: true,
            rows: [makeLazyRow({ id: 501, name: "Findme Match" })],
          },
        ],
      }) as any;

      renderView();

      // Mode resolves asynchronously (the count round trip); wait for the
      // toolbar to actually mount before typing rather than racing it.
      const input = await screen.findByTestId("requirements-filter-input");
      fireEvent.change(input, { target: { value: "f" } });
      fireEvent.change(input, { target: { value: "fi" } });
      fireEvent.change(input, { target: { value: "fin" } });
      fireEvent.change(input, { target: { value: "find" } });
      fireEvent.change(input, { target: { value: "findme" } });

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
      });

      expect(filterRequestCalls()).toHaveLength(1);
      expect(lastFilterRequestBody()?.search).toBe("findme");
    });

    it("each of Coverage, Status and Source submits to the server immediately on change (no debounce)", async () => {
      const requirements = [
        makeRequirement({ id: 1, name: "Root", externalStatus: "Open" }),
      ];
      useFindManyIssueMock.mockReturnValue({
        data: requirements,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      const coverage = makeCoverageResponse({
        1: makeBreakdown({
          status: "PASSED",
          uncovered: false,
          passed: 1,
          linkedCaseCount: 1,
        }),
      });
      useRequirementCoverageMock.mockReturnValue({
        data: coverage,
        isError: false,
      });
      global.fetch = makeLegacyFilterFetchMock(requirements, coverage) as any;

      renderView();

      await selectFilterOption(
        "requirements-coverage-filter",
        "requirements.coverage.uncovered"
      );
      await waitFor(() => {
        expect(lastFilterRequestBody()?.coverage).toBe("UNCOVERED");
      });

      await selectFilterOption("requirements-status-filter", "Open");
      await waitFor(() => {
        expect(lastFilterRequestBody()?.status).toBe("Open");
      });

      await selectFilterOption(
        "requirements-source-filter",
        "requirements.provenance.nativeLabel"
      );
      await waitFor(() => {
        expect(lastFilterRequestBody()?.source).toBe("MANUAL");
      });
    });

    it("below the threshold, a text-only filter renders matches + ancestors + descendants -- exactly the set captured before this plan", async () => {
      // Captured BEFORE this plan, by reasoning directly about
      // `computeVisibleRequirementIds`'s own documented semantics for this
      // exact fixture (id 2 matches "findme"; id 1 is its ancestor; id 3 is
      // its descendant; id 4 is an unrelated sibling): with only the text
      // axis active, the combined match set is {2}, the ancestor walk adds
      // {1}, and -- because NO non-text axis is active -- the descendant BFS
      // adds {3}. Id 4 is never matched, never an ancestor, never a
      // descendant of the match, so it must stay absent. This literal,
      // {1, 2, 3} vs. NOT 4, is the assertion below -- not re-derived from
      // the new implementation.
      const requirements = [
        makeRequirement({ id: 1, name: "Root" }),
        makeRequirement({ id: 2, name: "Findme Match", parentId: 1 }),
        makeRequirement({ id: 3, name: "Descendant", parentId: 2 }),
        makeRequirement({ id: 4, name: "Other", parentId: 1 }),
      ];
      useFindManyIssueMock.mockReturnValue({
        data: requirements,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      global.fetch = makeTreeFetchMock({
        mode: "all",
        total: 4,
        matchPages: [
          {
            matchedTotal: 1,
            matchedIds: [2],
            ancestorIds: [1],
            expandMatchedSubtrees: true,
          },
        ],
      }) as any;

      renderView();

      fireEvent.change(screen.getByTestId("requirements-filter-input"), {
        target: { value: "findme" },
      });

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-2")).toBeInTheDocument();
      });
      expect(screen.getByTestId("requirement-row-1")).toBeInTheDocument();
      expect(screen.getByTestId("requirement-row-3")).toBeInTheDocument();
      expect(screen.queryByTestId("requirement-row-4")).not.toBeInTheDocument();
    });

    it("above the threshold, a matched row under a filter still expands and fetches its children", async () => {
      global.fetch = makeTreeFetchMock({
        mode: "lazy",
        total: 600,
        matchPages: [
          {
            matchedTotal: 1,
            matchedIds: [501],
            ancestorIds: [],
            expandMatchedSubtrees: true,
            rows: [
              makeLazyRow({
                id: 501,
                name: "Findme Match",
                hasChildren: true,
              }),
            ],
          },
        ],
        childrenByParentId: {
          501: [makeLazyRow({ id: 502, name: "Findme Child", parentId: 501 })],
        },
      }) as any;

      renderView();

      fireEvent.change(await screen.findByTestId("requirements-filter-input"), {
        target: { value: "findme" },
      });

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("requirement-chevron-501"));

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-502")).toBeInTheDocument();
      });
    });

    it("clearing the search axis returns to the unfiltered roots list, not a stale match set", async () => {
      global.fetch = makeTreeFetchMock({
        mode: "lazy",
        total: 600,
        rootsRows: [
          makeLazyRow({ id: 501, name: "Root A" }),
          makeLazyRow({ id: 502, name: "Root B" }),
        ],
        matchPages: [
          {
            matchedTotal: 1,
            matchedIds: [501],
            ancestorIds: [],
            expandMatchedSubtrees: true,
            rows: [makeLazyRow({ id: 501, name: "Root A" })],
          },
        ],
      }) as any;

      renderView();
      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
      });
      expect(screen.getByTestId("requirement-row-502")).toBeInTheDocument();

      fireEvent.change(screen.getByTestId("requirements-filter-input"), {
        target: { value: "root a" },
      });

      await waitFor(() => {
        expect(
          screen.queryByTestId("requirement-row-502")
        ).not.toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("requirements-filter-clear"));

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-502")).toBeInTheDocument();
      });
      expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
    });

    it("a coverage rollup outage disables the Coverage select but the Source axis still filters, tree intact", async () => {
      global.fetch = makeTreeFetchMock({
        mode: "lazy",
        total: 600,
        rootsRows: [makeLazyRow({ id: 501, name: "Root A" })],
        matchPages: [
          {
            matchedTotal: 1,
            matchedIds: [501],
            ancestorIds: [],
            expandMatchedSubtrees: false,
            rows: [
              makeLazyRow({
                id: 501,
                name: "Root A",
                integrationId: 5,
                requirementDetachedAt: new Date().toISOString(),
              }),
            ],
          },
        ],
      }) as any;
      useRequirementCoverageMock.mockReturnValue({
        data: undefined,
        isError: true,
      });

      renderView();
      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
      });
      expect(screen.getByTestId("requirements-coverage-filter")).toBeDisabled();

      await selectFilterOption(
        "requirements-source-filter",
        "requirements.provenance.detachedLabel"
      );

      await waitFor(() => {
        expect(lastFilterRequestBody()?.source).toBe("DETACHED");
      });
      expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
    });

    it("every filter control keeps its existing test id and disabled rule", () => {
      useFindManyIssueMock.mockReturnValue({
        data: [makeRequirement({ id: 1, name: "Root A" })],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      renderView();

      expect(
        screen.getByTestId("requirements-coverage-filter")
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("requirements-status-filter")
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("requirements-source-filter")
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("requirements-filter-input")
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("requirements-filter-clear")
      ).not.toBeInTheDocument();

      fireEvent.change(screen.getByTestId("requirements-filter-input"), {
        target: { value: "x" },
      });
      expect(
        screen.getByTestId("requirements-filter-clear")
      ).toBeInTheDocument();

      // Coverage unavailable (default mock: `data: undefined, isError:
      // false`) is the same disabled rule the pre-existing "with coverage
      // unavailable" test proves in "all" mode -- unaffected by this plan.
      expect(screen.getByTestId("requirements-coverage-filter")).toBeDisabled();
    });
  });

  // 28-13: the server-decided mode fork. Per this file's own established
  // convention (25-15's UAT ruling), `useRequirementsTree` itself is never
  // mocked -- only `global.fetch`, so the hook's real fetch/merge/state
  // logic runs against a routed fake transport.
  describe("mode fork (28-13)", () => {
    it('mode: "all" -- the ZenStack load-all query is enabled and the roots-page route is never requested', async () => {
      global.fetch = makeTreeFetchMock({ mode: "all", total: 2 }) as any;
      useFindManyIssueMock.mockReturnValue({
        data: [makeRequirement({ id: 1, name: "Root A" })],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      renderView();

      await waitFor(() => {
        const lastCall = useFindManyIssueMock.mock.calls.at(-1)!;
        expect(lastCall[1]).toMatchObject({ enabled: true });
      });

      const treeGetCalls = (global.fetch as any).mock.calls.filter(
        ([url, init]: [string, RequestInit | undefined]) =>
          typeof url === "string" &&
          url.includes("/requirements/tree") &&
          !url.includes("countOnly") &&
          (init?.method ?? "GET") === "GET"
      );
      expect(treeGetCalls).toHaveLength(0);
    });

    it('mode: "lazy" -- the ZenStack load-all query is disabled and rows come from the roots-page route', async () => {
      global.fetch = makeTreeFetchMock({
        mode: "lazy",
        total: 600,
        rootsRows: [makeLazyRow({ id: 501, name: "Lazy Root" })],
      }) as any;

      renderView();

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
      });

      const lastCall = useFindManyIssueMock.mock.calls.at(-1)!;
      expect(lastCall[1]).toMatchObject({ enabled: false });
    });

    it("mode: null (the count round trip is pending) shows the loading state, never an empty tree", () => {
      useFindManyIssueMock.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
        refetch: vi.fn(),
      });
      // Never resolves -- `mode` stays null for the life of this test.
      global.fetch = vi.fn(() => new Promise(() => {})) as any;

      renderView();

      // `LoadingSpinner` itself has its own 500ms-delayed reveal (returns
      // `null` before then), so asserting its spin icon this early would
      // pass trivially in ANY not-yet-rendered state. What actually proves
      // this gate chose the loading branch (rather than empty/error/table)
      // is that none of the OTHER three render states mounted.
      expect(
        screen.queryByTestId("requirements-tree-empty")
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("requirements-list-container")
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("requirements-list-error")
      ).not.toBeInTheDocument();
    });

    it("the load-all query's options carry optimisticUpdate and an enabled gate reflecting the resolved mode -- nothing else changed", async () => {
      global.fetch = makeTreeFetchMock({ mode: "all", total: 1 }) as any;

      renderView();

      await waitFor(() => {
        const lastCall = useFindManyIssueMock.mock.calls.at(-1)!;
        expect(lastCall[1]).toEqual({ optimisticUpdate: true, enabled: true });
        const [args] = lastCall;
        expect((args as { where: unknown }).where).toEqual({
          projectId: 42,
          isDeleted: false,
          isRequirement: true,
        });
      });
    });

    it("in lazy mode, the error-state retry button refreshes through the hook's own refetch, never the disabled ZenStack query's", async () => {
      const zenRefetch = vi.fn();
      useFindManyIssueMock.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
        refetch: zenRefetch,
      });
      let rootsPageCallCount = 0;
      global.fetch = vi.fn((url: string) => {
        if (typeof url === "string" && url.includes("countOnly=1")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ total: 600, threshold: 500, mode: "lazy" }),
          });
        }
        if (typeof url === "string" && url.includes("/requirements/tree")) {
          rootsPageCallCount += 1;
          return Promise.resolve({ ok: false, status: 500 });
        }
        return Promise.resolve({ ok: true });
      }) as any;

      renderView();

      await waitFor(() => {
        expect(
          screen.getByTestId("requirements-list-error")
        ).toBeInTheDocument();
      });

      const callsBeforeRetry = rootsPageCallCount;
      fireEvent.click(
        screen.getByRole("button", { name: "search.errors.tryAgain" })
      );

      await waitFor(() =>
        expect(rootsPageCallCount).toBeGreaterThan(callsBeforeRetry)
      );
      expect(zenRefetch).not.toHaveBeenCalled();
    });
  });

  // 28-13 Task 2: expand-on-demand, with the chevron correct before any
  // click (D-02). Same convention as the mode-fork describe above --
  // `useRequirementsTree` runs for real against a routed fake `fetch`.
  describe("expand on demand (28-13)", () => {
    it("a lazy root the server marked hasChildren renders a chevron before any children are loaded, and fetches nothing yet", async () => {
      global.fetch = makeTreeFetchMock({
        mode: "lazy",
        total: 600,
        rootsRows: [
          makeLazyRow({ id: 501, name: "Lazy Root", hasChildren: true }),
        ],
      }) as any;

      renderView();

      await waitFor(() => {
        expect(
          screen.getByTestId("requirement-chevron-501")
        ).toBeInTheDocument();
      });

      const childrenCalls = (global.fetch as any).mock.calls.filter(
        ([url]: [string]) =>
          typeof url === "string" && url.includes("/children")
      );
      expect(childrenCalls).toHaveLength(0);
    });

    it("expanding a lazy root fetches its children once and renders them beneath it", async () => {
      global.fetch = makeTreeFetchMock({
        mode: "lazy",
        total: 600,
        rootsRows: [
          makeLazyRow({ id: 501, name: "Lazy Root", hasChildren: true }),
        ],
        childrenByParentId: {
          501: [makeLazyRow({ id: 502, name: "Lazy Child", parentId: 501 })],
        },
      }) as any;

      renderView();
      await waitFor(() => {
        expect(
          screen.getByTestId("requirement-chevron-501")
        ).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("requirement-chevron-501"));

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-502")).toBeInTheDocument();
      });
      const childrenCalls = (global.fetch as any).mock.calls.filter(
        ([url]: [string]) =>
          typeof url === "string" && url.includes("/tree/501/children")
      );
      expect(childrenCalls).toHaveLength(1);
    });

    it("collapsing and re-expanding a lazy root does not refetch its children", async () => {
      global.fetch = makeTreeFetchMock({
        mode: "lazy",
        total: 600,
        rootsRows: [
          makeLazyRow({ id: 501, name: "Lazy Root", hasChildren: true }),
        ],
        childrenByParentId: {
          501: [makeLazyRow({ id: 502, name: "Lazy Child", parentId: 501 })],
        },
      }) as any;

      renderView();
      await waitFor(() => {
        expect(
          screen.getByTestId("requirement-chevron-501")
        ).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("requirement-chevron-501"));
      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-502")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("requirement-chevron-501"));
      await waitFor(() => {
        expect(
          screen.queryByTestId("requirement-row-502")
        ).not.toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("requirement-chevron-501"));
      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-502")).toBeInTheDocument();
      });

      const childrenCalls = (global.fetch as any).mock.calls.filter(
        ([url]: [string]) =>
          typeof url === "string" && url.includes("/tree/501/children")
      );
      expect(childrenCalls).toHaveLength(1);
    });

    it("a lazy leaf (hasChildren: false) renders no chevron and never fetches children", async () => {
      global.fetch = makeTreeFetchMock({
        mode: "lazy",
        total: 600,
        rootsRows: [
          makeLazyRow({ id: 503, name: "Lazy Leaf", hasChildren: false }),
        ],
      }) as any;

      renderView();

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-503")).toBeInTheDocument();
      });
      expect(
        screen.queryByTestId("requirement-chevron-503")
      ).not.toBeInTheDocument();

      const childrenCalls = (global.fetch as any).mock.calls.filter(
        ([url]: [string]) =>
          typeof url === "string" && url.includes("/children")
      );
      expect(childrenCalls).toHaveLength(0);
    });

    it('in "all" mode, expanding a node never touches the tree data routes', () => {
      useFindManyIssueMock.mockReturnValue({
        data: [
          makeRequirement({ id: 1, name: "Parent Requirement" }),
          makeRequirement({ id: 2, name: "Child A", parentId: 1 }),
        ],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      renderView();

      fireEvent.click(screen.getByTestId("requirement-chevron-1"));

      expect(screen.getByTestId("requirement-row-2")).toBeInTheDocument();
      const treeDataCalls = (global.fetch as any).mock.calls.filter(
        ([url]: [string]) =>
          typeof url === "string" &&
          url.includes("/requirements/tree") &&
          !url.includes("countOnly")
      );
      expect(treeDataCalls).toHaveLength(0);
    });

    // 28-13 DECISION (see the auto-expand-ancestors effect's own comment):
    // an ancestor already present in the loaded partial forest is
    // auto-expanded when the selection arrives from outside this list; an
    // ancestor that isn't loaded yet is an accepted, documented gap rather
    // than a fetch-on-demand chain walk.
    it("auto-expands the selected requirement's already-loaded ancestor when the selection arrives from outside the list", async () => {
      global.fetch = makeTreeFetchMock({
        mode: "lazy",
        total: 600,
        rootsRows: [
          makeLazyRow({ id: 501, name: "Lazy Root", hasChildren: true }),
        ],
        childrenByParentId: {
          501: [
            makeLazyRow({
              id: 502,
              name: "Lazy Child",
              parentId: 501,
              hasChildren: false,
            }),
          ],
        },
      }) as any;

      const onSelectRequirement = vi.fn();
      const { rerender } = render(
        <RequirementsListView
          projectId="42"
          selectedRequirementId={null}
          onSelectRequirement={onSelectRequirement}
        />
      );

      await waitFor(() => {
        expect(
          screen.getByTestId("requirement-chevron-501")
        ).toBeInTheDocument();
      });
      // Bring 502 into the loaded partial forest, then collapse its parent
      // again -- this component's own chevron is the only route this test
      // has to load a child, and collapsing afterward proves the SELECTION
      // below (not the earlier click) is what re-reveals it.
      fireEvent.click(screen.getByTestId("requirement-chevron-501"));
      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-502")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("requirement-chevron-501"));
      await waitFor(() => {
        expect(
          screen.queryByTestId("requirement-row-502")
        ).not.toBeInTheDocument();
      });

      rerender(
        <RequirementsListView
          projectId="42"
          selectedRequirementId={502}
          onSelectRequirement={onSelectRequirement}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-502")).toBeInTheDocument();
      });
    });

    it("a selection whose ancestor chain is not loaded is a documented no-op -- no crash, nothing force-expanded", async () => {
      global.fetch = makeTreeFetchMock({
        mode: "lazy",
        total: 600,
        rootsRows: [
          makeLazyRow({ id: 501, name: "Lazy Root", hasChildren: true }),
        ],
      }) as any;

      const onSelectRequirement = vi.fn();
      const { rerender } = render(
        <RequirementsListView
          projectId="42"
          selectedRequirementId={null}
          onSelectRequirement={onSelectRequirement}
        />
      );

      await waitFor(() => {
        expect(
          screen.getByTestId("requirement-chevron-501")
        ).toBeInTheDocument();
      });

      // 999 was never loaded -- its ancestor chain is unknown to this list.
      expect(() =>
        rerender(
          <RequirementsListView
            projectId="42"
            selectedRequirementId={999}
            onSelectRequirement={onSelectRequirement}
          />
        )
      ).not.toThrow();

      expect(screen.getByTestId("requirement-chevron-501")).toHaveAttribute(
        "aria-label",
        "requirements.list.expandRow:Lazy Root"
      );
    });
  });
});
