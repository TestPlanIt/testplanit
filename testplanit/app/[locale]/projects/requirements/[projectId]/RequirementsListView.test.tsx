import fs from "fs";
import path from "path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RequirementCoverageResponse } from "~/app/api/projects/[projectId]/requirements/coverage/route";
import type { RequirementCoverageBreakdown } from "~/lib/services/requirementCoverage";
import {
  buildRequirementMaps,
  collectCoverageStatusOptions,
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
// The create dialog's promotion picker (mounted only on its promote tab)
// runs integration + issue queries this view's ZenStack stub does not
// serve — stubbed out the same way DeferredIssueManager is below.
vi.mock("@/components/issues/requirement-reference-search-dialog", () => ({
  RequirementReferenceSearchDialog: () => (
    <div data-testid="mock-promotion-picker" />
  ),
}));

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
// renders every flattened row and captures the latest `onLoadMore`/options
// (DataTable.virtualized.test.tsx's own convention, lines 12-42), so a test
// can simulate the sentinel firing by calling `lastOnLoadMore()` directly,
// and this suite still exercises the REAL DataTable and the REAL column
// defs rather than a stubbed table.
const virtualizedHookMock = vi.hoisted(() => ({
  scrollToIndex: vi.fn(),
  lastOnLoadMore: null as null | (() => void),
  lastOpts: null as Record<string, unknown> | null,
}));
vi.mock("~/hooks/useVirtualizedInfiniteList", () => ({
  useVirtualizedInfiniteList: (opts: {
    count: number;
    onLoadMore: () => void;
  }) => {
    virtualizedHookMock.lastOnLoadMore = opts.onLoadMore;
    virtualizedHookMock.lastOpts = opts as unknown as Record<string, unknown>;
    return {
      scrollRef: () => {},
      sentinelRef: { current: null },
      // The engine's deep-link retry reads `getOffsetForIndex` and
      // `scrollOffset` to decide whether its scroll landed. Stub them as
      // "already there" so the retry settles on its first frame.
      virtualizer: {
        scrollToIndex: virtualizedHookMock.scrollToIndex,
        getOffsetForIndex: () => [0, "center"] as const,
        scrollOffset: 0,
      },
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
    };
  },
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

// The three filter axes are `MultiAsyncCombobox`es (Radix Popover + cmdk).
// Stubbed for the SAME reason -- and by the same convention -- as
// AsyncCombobox immediately above: this file's subject is which options the
// list OFFERS and which filter state a selection produces, not whether a
// real popover opens in jsdom (the primitive has its own suite for that,
// `components/ui/multi-async-combobox.test.tsx`). The stub keeps the parts
// the tests actually assert against: a `role="combobox"` trigger carrying
// `ariaLabel`/`disabled`, and `role="option"` rows -- rendered only while
// open, toggled by the trigger and dismissed by Escape, so a test that
// reads two axes' option lists in a row behaves like the real thing.
vi.mock("@/components/ui/multi-async-combobox", () => ({
  MultiAsyncCombobox: ({
    value,
    onValueChange,
    fetchOptions,
    getOptionValue,
    getOptionLabel,
    ariaLabel,
    placeholder,
    disabled,
  }: any) => {
    const [open, setOpen] = React.useState(false);
    const [options, setOptions] = React.useState<any[]>([]);
    React.useEffect(() => {
      let cancelled = false;
      void Promise.resolve(fetchOptions("", 0, 1000)).then((result: any) => {
        if (cancelled) return;
        setOptions(Array.isArray(result) ? result : (result?.results ?? []));
      });
      return () => {
        cancelled = true;
      };
    }, [fetchOptions]);
    const selectedValues = (value ?? []).map((v: any) =>
      String(getOptionValue(v))
    );
    return (
      <span
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <button
          type="button"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          disabled={disabled}
          onClick={() => setOpen((prev) => !prev)}
        >
          {selectedValues.length === 0
            ? placeholder
            : (value ?? []).map((v: any) => getOptionLabel(v)).join(", ")}
        </button>
        {open &&
          options.map((option) => {
            const optionValue = String(getOptionValue(option));
            const isSelected = selectedValues.includes(optionValue);
            return (
              <button
                key={optionValue}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() =>
                  onValueChange(
                    isSelected
                      ? (value ?? []).filter(
                          (v: any) => String(getOptionValue(v)) !== optionValue
                        )
                      : [...(value ?? []), option]
                  )
                }
              >
                {getOptionLabel(option)}
              </button>
            );
          })}
      </span>
    );
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
    // The requirement's own project; only the cross-project reports
    // read it, but the breakdown always carries it.
    projectId: 1,
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
  /** The project's ROOT count, as the live count round trip always reports
   *  it. Defaults to `total` -- a flat project, where every requirement is
   *  a root. Set it BELOW `total` to model a project with nested children,
   *  which is what separates the two candidate denominators. */
  rootTotal?: number;
  rootsRows?: Array<Record<string, unknown>>;
  /** A sequence of roots-window pages, consumed one per GET (the last is
   *  reused if a test calls `onLoadMore` beyond the queue's length) -- lets
   *  a test prove `hasMore`/pagination/dedup across a real `onLoadMore`
   *  round trip rather than a single static page. Takes precedence over
   *  `rootsRows` when both are supplied. */
  rootsPages?: Array<{
    rows: Array<Record<string, unknown>>;
    nextCursor?: unknown;
  }>;
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
  /** 28-19: the facets GET's own fixture -- defaults to both lists empty
   *  when a test doesn't care about facet content. Given its own case here
   *  (not left to fall through to the roots-page branch below) because
   *  that branch's response shape (`{ total, rows, nextCursor }`) has no
   *  `statuses`/`coverageStatuses` keys at all -- falling through would
   *  silently hand the component `undefined` for both, exactly the crash
   *  this dedicated branch exists to prevent. */
  facets?: {
    statuses: string[];
    coverageStatuses: Array<Record<string, unknown>>;
  };
}) {
  let rootsPageIndex = 0;
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
            // The live route returns `rootTotal` in BOTH modes, so this
            // fixture must too. Omitting it left `projectRootTotal` null in
            // every test, which meant the consumer's `?? projectTotal`
            // fallback always fired here and never in production -- the
            // difference the "x of y" denominator turns on.
            rootTotal: options.rootTotal ?? options.total,
            threshold: 500,
            mode: options.mode,
          }),
        });
      }
      if (url.includes("facetsOnly=1")) {
        return Promise.resolve({
          ok: true,
          json: async () =>
            options.facets ?? { statuses: [], coverageStatuses: [] },
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
        if (options.rootsPages) {
          const page =
            options.rootsPages[
              Math.min(rootsPageIndex, options.rootsPages.length - 1)
            ];
          rootsPageIndex += 1;
          return Promise.resolve({
            ok: true,
            json: async () => ({
              total: options.total,
              rows: page.rows,
              nextCursor: page.nextCursor ?? null,
            }),
          });
        }
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

/** 28-15: layers the delete dialog's descendant-count route
 *  (`/requirements/{id}/descendant-count`) on top of `makeTreeFetchMock`'s
 *  routing -- kept as its own wrapper (not folded into `makeTreeFetchMock`
 *  itself) since only the delete-confirmation describe block below needs
 *  it. `descendantCounts` maps a requirement id to the count the SERVER
 *  reports for it; any id absent from the map reports 0, mirroring the
 *  real route's shape (`{ count: number }`). */
function makeTreeFetchMockWithDescendantCount(
  options: Parameters<typeof makeTreeFetchMock>[0] & {
    descendantCounts?: Record<number, number>;
    descendantCountOk?: boolean;
  }
) {
  const treeFetchMock = makeTreeFetchMock(options);
  return vi.fn((url: string, init?: RequestInit) => {
    const match =
      typeof url === "string" &&
      url.match(/\/requirements\/(\d+)\/descendant-count$/);
    if (match) {
      if (options.descendantCountOk === false) {
        return Promise.resolve({ ok: false, status: 500 });
      }
      const id = Number(match[1]);
      return Promise.resolve({
        ok: true,
        json: async () => ({ count: options.descendantCounts?.[id] ?? 0 }),
      });
    }
    return treeFetchMock(url, init);
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
  // The list has ONE row source now -- the server -- so this fixture has to
  // answer every tree endpoint the component actually calls, not just the
  // filter POST. It still derives the match set from the client oracle
  // (`computeVisibleRequirementIds`), which is what lets these tests keep
  // stating filter semantics in terms the oracle's own suite already pins.
  const childrenByParentId: Record<number, Array<Record<string, any>>> = {};
  for (const row of requirements) {
    if (row.parentId == null) continue;
    (childrenByParentId[row.parentId as number] ??= []).push(row);
  }
  const withHasChildren = (row: Record<string, any>) => ({
    ...row,
    hasChildren: (childrenByParentId[row.id as number]?.length ?? 0) > 0,
  });
  const roots = requirements.filter((row) => row.parentId == null);

  return vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (typeof url === "string" && url.includes("/requirements/tree")) {
      if (url.includes("countOnly=1")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            total: requirements.length,
            rootTotal: roots.length,
            threshold: 500,
            mode: "all",
          }),
        });
      }
      if (url.includes("facetsOnly=1")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            statuses: Array.from(
              new Set(
                requirements
                  .map((row) => (row.externalStatus ?? row.status) as string)
                  .filter(Boolean)
              )
            ).sort(),
            // Derived with the same collector the client used to run on its
            // in-memory copy, so these tests keep stating option lists in
            // the terms their own fixtures already express.
            coverageStatuses: collectCoverageStatusOptions(
              requirements as any,
              coverage
            ),
          }),
        });
      }
      const childrenMatch = url.match(/\/tree\/(\d+)\/children/);
      if (childrenMatch) {
        const parentId = Number(childrenMatch[1]);
        return Promise.resolve({
          ok: true,
          json: async () => ({
            rows: (childrenByParentId[parentId] ?? []).map(withHasChildren),
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
        const visibleIds = visible ? Array.from(visible) : [];
        // A retained ancestor has to come back as an ANCESTOR, not just as a
        // visible id: that set is what force-opens the chain, and without it
        // a matched child renders nowhere because its parent stays collapsed.
        // The client used to expand every visible id itself, from a complete
        // in-memory tree it no longer holds.
        const ancestorIds = visibleIds.filter((id) =>
          requirements.some(
            (row) =>
              visible?.has(row.id as number) &&
              row.id !== id &&
              (function isDescendantOf(candidate: any): boolean {
                let parentId = candidate.parentId as number | null | undefined;
                while (parentId != null) {
                  if (parentId === id) return true;
                  parentId = requirements.find((r) => r.id === parentId)
                    ?.parentId as number | null | undefined;
                }
                return false;
              })(row)
          )
        );
        const matchedIds = visibleIds.filter((id) => !ancestorIds.includes(id));
        return Promise.resolve({
          ok: true,
          json: async () => ({
            total: requirements.length,
            matchedTotal: matchedIds.length,
            matchedIds,
            ancestorIds,
            // Rows travel with the match set now: nothing else holds them.
            rows: requirements
              .filter((row) => visibleIds.includes(row.id as number))
              .map(withHasChildren),
            nextCursor: null,
            expandMatchedSubtrees: false,
          }),
        });
      }
      // The unfiltered roots window.
      return Promise.resolve({
        ok: true,
        json: async () => ({
          total: requirements.length,
          rows: roots.map(withHasChildren),
          nextCursor: null,
        }),
      });
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

/**
 * The list reads every row from the tree endpoints, at every project size.
 * Most tests here still express their fixture as the flat array they used to
 * hand the ZenStack query, so when a test has not installed its own fetch
 * mock, serve that same array through the tree routes: roots on the roots
 * page, the rest per parent on the children endpoint, with `hasChildren`
 * computed the way the server computes it.
 */
function seedTreeFromIssueMock(
  nonTreeResponse?: () => Promise<unknown> | unknown
) {
  // Read through a non-`use` binding: this is a vi.fn(), not a hook, and the
  // hooks lint rule keys off the call expression's name.
  const readConfiguredIssueMock = useFindManyIssueMock as unknown as () =>
    { data?: unknown } | undefined;
  const configured = readConfiguredIssueMock();
  const all = Array.isArray(configured?.data)
    ? (configured!.data as Array<Record<string, unknown>>)
    : [];

  const childrenByParentId: Record<number, Array<Record<string, unknown>>> = {};
  for (const row of all) {
    const parentId = row.parentId as number | null | undefined;
    if (parentId == null) continue;
    (childrenByParentId[parentId] ??= []).push(row);
  }
  const withHasChildren = (row: Record<string, unknown>) => ({
    ...row,
    hasChildren: (childrenByParentId[row.id as number]?.length ?? 0) > 0,
  });
  const roots = all.filter((row) => row.parentId == null);

  const treeFetch = makeTreeFetchMock({
    mode: "lazy",
    total: all.length,
    rootTotal: roots.length,
    rootsRows: roots.map(withHasChildren),
    childrenByParentId: Object.fromEntries(
      Object.entries(childrenByParentId).map(([parentId, rows]) => [
        parentId,
        rows.map(withHasChildren),
      ])
    ),
    facets: {
      statuses: Array.from(
        new Set(
          all
            .map((row) => (row.externalStatus ?? row.status) as string | null)
            .filter((status): status is string => Boolean(status))
        )
      ).sort(),
      coverageStatuses: [],
    },
  });

  // The delete dialog's descendant count is a server round trip now, at
  // every project size -- without it the confirm never leaves its disabled
  // "count unknown" state.
  const countDescendantsOf = (id: number): number =>
    (childrenByParentId[id] ?? []).reduce(
      (total, child) => total + 1 + countDescendantsOf(child.id as number),
      0
    );

  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    if (typeof url === "string") {
      if (url.includes("/requirements/tree")) {
        return (treeFetch as any)(url, init);
      }
      const descendantCount = url.match(
        /\/requirements\/(\d+)\/descendant-count$/
      );
      if (descendantCount) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            count: countDescendantsOf(Number(descendantCount[1])),
          }),
        });
      }
    }
    if (!nonTreeResponse) return Promise.resolve({ ok: true });
    return Promise.resolve(nonTreeResponse()).then((value) =>
      value instanceof Error ? Promise.reject(value) : value
    );
  }) as any;
}

/**
 * Waits for the list to reach a terminal state. Rows arrive from the server
 * at every project size now, so nothing is on screen synchronously after a
 * render -- a test that queries immediately reads the loading frame.
 */
async function waitForTree() {
  await waitFor(() => {
    expect(
      screen.queryByTestId("requirements-list") ??
        screen.queryByTestId("requirements-tree-empty") ??
        screen.queryByTestId("requirements-list-error")
    ).not.toBeNull();
  });
}

function renderView(
  overrides: {
    selectedRequirementId?: number | null;
    onSelectRequirement?: (id: number | null) => void;
    ref?: React.Ref<RequirementsListViewHandle>;
  } = {}
) {
  const onSelectRequirement = overrides.onSelectRequirement ?? vi.fn();
  if (
    (global.fetch as unknown as { __isDefaultFetch?: boolean })
      ?.__isDefaultFetch
  ) {
    seedTreeFromIssueMock();
  }
  // 28-15: the delete dialog's lazy-mode descendant count now runs through
  // the REAL `useRequirementSubtreeCount` (a real `useQuery`, per this
  // file's own "mock fetch, not the hook" convention), which needs a real
  // `QueryClient` in context -- a fresh one per render so no test's cached
  // count leaks into the next.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RequirementsListView
        ref={overrides.ref}
        projectId="42"
        selectedRequirementId={overrides.selectedRequirementId ?? null}
        onSelectRequirement={onSelectRequirement}
      />
    </QueryClientProvider>
  );
  return { onSelectRequirement, ...utils };
}

/** Opens a Radix DropdownMenu trigger -- fireEvent.click alone doesn't
 *  dispatch the pointerdown/pointerup sequence Radix listens for in jsdom. */
function openMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
  fireEvent.pointerUp(trigger, { button: 0, pointerId: 1 });
}

/** The `MultiAsyncCombobox` trigger inside one of the three filter
 *  wrappers. The testid now sits on the wrapper (a disabled button fires no
 *  pointer events, so the coverage tooltip has to live outside it), and the
 *  trigger itself is the `role="combobox"` button within. */
function filterTrigger(triggerTestId: string): HTMLElement {
  return within(screen.getByTestId(triggerTestId)).getByRole("combobox");
}

/** Collapses one filter's option list if it is open. A multi-select stays
 *  open across a selection (so several values can be picked in one visit),
 *  so a test that reads a SECOND axis's option list has to close the first
 *  -- otherwise both axes' `role="option"` rows are in the document at once
 *  and a name query can match either. */
async function closeFilterOptions(triggerTestId: string) {
  const trigger = filterTrigger(triggerTestId);
  if (trigger.getAttribute("aria-expanded") !== "true") return;
  await act(async () => {
    fireEvent.click(trigger);
  });
}

/** Opens one of the three multi-select filter comboboxes and toggles the
 *  named option. Every axis is a `MultiAsyncCombobox` now, so this both
 *  SELECTS and DESELECTS -- calling it twice with the same option clears
 *  it, which is how "clear this filter" is expressed without an "All X"
 *  sentinel row.
 *
 *  Matched by accessible name/role, so a same-text badge elsewhere in the
 *  row -- e.g. a provenance badge -- can never collide: only cmdk's own
 *  `role="option"` items are candidates. The name is matched as a substring
 *  because the coverage rows append a count to their label. */
async function selectFilterOption(triggerTestId: string, optionName: string) {
  const trigger = filterTrigger(triggerTestId);
  await act(async () => {
    fireEvent.click(trigger);
  });
  const option = await screen.findByRole("option", {
    name: new RegExp(optionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  });
  await act(async () => {
    fireEvent.click(option);
  });
  await closeFilterOptions(triggerTestId);
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
  virtualizedHookMock.lastOnLoadMore = null;
  virtualizedHookMock.lastOpts = null;
  const defaultFetch = vi.fn().mockResolvedValue({ ok: true });
  (defaultFetch as unknown as { __isDefaultFetch?: boolean }).__isDefaultFetch =
    true;
  global.fetch = defaultFetch as any;
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

    it("renders only the parent row while collapsed, then reveals both children on chevron click", async () => {
      renderView();
      await waitForTree();

      expect(
        await screen.findByTestId("requirement-row-1")
      ).toBeInTheDocument();
      expect(screen.queryByTestId("requirement-row-2")).not.toBeInTheDocument();
      expect(screen.queryByTestId("requirement-row-3")).not.toBeInTheDocument();

      const collapsedContent = screen.getByTestId(
        "requirement-coverage-cell-1"
      ).textContent;
      expect(screen.getByLabelText("Passed: 3")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("requirement-chevron-1"));

      expect(
        await screen.findByTestId("requirement-row-2")
      ).toBeInTheDocument();
      expect(
        await screen.findByTestId("requirement-row-3")
      ).toBeInTheDocument();

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

    it("renders the eight column ids, in order, at the pane's default width", async () => {
      renderView();
      await waitForTree();

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
    it("does not render the hidden-by-default createdAt column as a header at the pane's default width", async () => {
      renderView();
      await waitForTree();

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
    it("keeps createdAt hidden when the actions column is absent (viewer / permissions still resolving)", async () => {
      mockIsProjectAdmin = false;
      renderView();
      await waitForTree();

      const table = screen.getByTestId("requirements-list");
      const labels = Array.from(
        table.querySelectorAll('[role="columnheader"]')
      ).map((cell) => cell.textContent);
      // D-17 adds Priority to the base (actions-absent) set: name/status/
      // coverage/coveringCases/linkedCases/source/priority = 7.
      expect(labels).toHaveLength(7);
      expect(labels).not.toContain("common.fields.createdAt");
    });

    it("keeps createdAt hidden across the permissions flip that appends the actions column after mount", async () => {
      mockIsProjectAdmin = false;
      seedTreeFromIssueMock();
      const onSelectRequirement = vi.fn();
      // 28-15: real useQuery (useRequirementSubtreeCount) now runs
      // unconditionally, needing a real QueryClient in context -- see
      // renderView()'s own comment for why.
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <RequirementsListView
            projectId="42"
            selectedRequirementId={null}
            onSelectRequirement={onSelectRequirement}
          />
        </QueryClientProvider>
      );

      mockIsProjectAdmin = true;
      rerender(
        <QueryClientProvider client={queryClient}>
          <RequirementsListView
            projectId="42"
            selectedRequirementId={null}
            onSelectRequirement={onSelectRequirement}
          />
        </QueryClientProvider>
      );

      const table = await screen.findByTestId("requirements-list");
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
    it("renders the Columns control in the toolbar", async () => {
      renderView();
      await waitForTree();

      expect(
        screen.getByTestId("column-selection-trigger")
      ).toBeInTheDocument();
    });

    it("moves horizontal scroll onto the table body (enableColumnPinning), never overflow-x-hidden", async () => {
      renderView();
      await waitForTree();

      const scrollBody = screen.getByTestId("requirements-list-scroll");
      expect(scrollBody.className).toContain("overflow-auto");
      expect(scrollBody.className).not.toContain("overflow-x-hidden");

      const tableContainer = screen.getByTestId("requirements-list");
      expect(tableContainer.className).toContain("overflow-hidden");
      expect(tableContainer.className).not.toContain("overflow-x-auto");
    });

    it("does not stretch to 100% width (flexColumnId removed) -- the header row sits at its natural summed column width", async () => {
      renderView();
      await waitForTree();

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
    it("the covering cell's other-project expansion renders a case reached only through a non-requirement descendant (ABT-47193 shape)", async () => {
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
      await waitForTree();

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
      seedTreeFromIssueMock();

      renderView();
      await waitForTree();

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
      // The refresh goes to the tree route, which is the only row source.
      await waitFor(() => {
        expect(
          (global.fetch as any).mock.calls.filter(
            ([url]: [string]) =>
              typeof url === "string" && url.includes("countOnly=1")
          ).length
        ).toBeGreaterThan(1);
      });

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
      seedTreeFromIssueMock(() => ({
        ok: false,
        json: async () => ({ error: "cycle" }),
      }));

      renderView();
      await waitForTree();

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
      // The refresh goes to the tree route, which is the only row source.
      await waitFor(() => {
        expect(
          (global.fetch as any).mock.calls.filter(
            ([url]: [string]) =>
              typeof url === "string" && url.includes("countOnly=1")
          ).length
        ).toBeGreaterThan(1);
      });
      expect(mockInvalidateQueries).not.toHaveBeenCalled();
    });

    it("network failure: a rejecting fetch produces moveFailed and no invalidation", async () => {
      seedTreeFromIssueMock(() => new Error("offline"));

      renderView();
      await waitForTree();

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
      await waitForTree();

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
      await waitForTree();

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
      await waitForTree();

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

    it("drop gate: canDrop() is false while a filter query is active", async () => {
      renderView();
      await waitForTree();
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

    it("item() marks the container and the source row; end() clears both; a second end() is idempotent", async () => {
      renderView();
      await waitForTree();

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
    it("rows carry the static candidate-ring classes unconditionally on the ring overlay (never toggled by JS)", async () => {
      renderView();
      await waitForTree();
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
    it("the drag-over hover ring renders on the row's ring overlay, not the row's own box", async () => {
      renderView();
      await waitForTree();
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

    it("the bottom root strip carries the static drag classes and an always-mounted (CSS-hidden) hint", async () => {
      renderView();
      await waitForTree();
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
      await waitForTree();

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
      seedTreeFromIssueMock(() => ({
        ok: true,
        json: async () => ({ deletedIds: [1] }),
      }));

      renderView();
      await waitForTree();

      openMenu(await screen.findByTestId("requirement-actions-trigger-1"));
      fireEvent.click(screen.getByTestId("requirement-action-delete-1"));
      await waitFor(() =>
        expect(screen.getByTestId("delete-requirement-confirm")).toBeEnabled()
      );
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

    it("exposes openCreateRoot on its ref for the workspace's action bar button", async () => {
      useFindManyIssueMock.mockReturnValue({
        data: [makeRequirement({ id: 1, name: "Root A" })],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      const listRef = React.createRef<RequirementsListViewHandle>();
      renderView({ ref: listRef });
      await waitForTree();

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

    it("resolves the same descendant count as the row action, for the same id", async () => {
      // Row-action path: open through the row's own actions menu.
      const { unmount } = renderView();
      await waitForTree();
      openMenu(await screen.findByTestId("requirement-actions-trigger-1"));
      fireEvent.click(screen.getByTestId("requirement-action-delete-1"));
      const rowActionText = screen.getByTestId(
        "delete-requirement-dialog"
      ).textContent;
      unmount();

      // Panel path: open through the imperative handle, for the same id.
      const listRef = React.createRef<RequirementsListViewHandle>();
      renderView({ ref: listRef });
      await waitForTree();
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
      seedTreeFromIssueMock(() => ({
        ok: true,
        json: async () => ({ deletedIds: [1, 2] }),
      }));

      const onSelectRequirement = vi.fn();
      const listRef = React.createRef<RequirementsListViewHandle>();
      renderView({
        ref: listRef,
        selectedRequirementId: 1,
        onSelectRequirement,
      });
      await waitForTree();

      act(() => {
        listRef.current?.openDeleteDialog(1);
      });
      // The dialog's count is a server round trip; Confirm stays disabled
      // until it lands.
      await waitFor(() =>
        expect(screen.getByTestId("delete-requirement-confirm")).toBeEnabled()
      );
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

    it("opens the dialog in LAZY mode, where the row lives in the loaded partial forest rather than the all-mode map", async () => {
      // Above the threshold `requirements` stays `[]` by design, so the map
      // built from it is permanently empty. A lookup that only consults that
      // map therefore fails for EVERY id -- the no-op above stops being the
      // "unknown id" guard it was written as and becomes the behaviour of
      // the panel's Delete button on every project large enough to be lazy.
      global.fetch = makeTreeFetchMock({
        mode: "lazy",
        total: 600,
        rootsRows: [makeLazyRow({ id: 501, name: "Lazy Root" })],
      }) as any;

      const listRef = React.createRef<RequirementsListViewHandle>();
      renderView({ ref: listRef });

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
      });

      act(() => {
        listRef.current?.openDeleteDialog(501);
      });

      expect(
        await screen.findByTestId("delete-requirement-dialog")
      ).toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("a failed count round trip renders the error state with a retry, never an endless spinner", async () => {
      // When the count fails, `mode` never resolves: `isLazy` stays false and
      // the load-all query, gated on `mode === "all"`, never fires either.
      // Neither row source can report anything, so without a count-error
      // signal the page shows its "no data yet" spinner for the rest of the
      // session and offers nothing to retry.
      global.fetch = makeTreeFetchMock({
        mode: "lazy",
        total: 600,
        countOk: false,
      }) as any;
      useFindManyIssueMock.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      renderView();

      expect(
        await screen.findByTestId("requirements-list-error")
      ).toBeInTheDocument();
    });

    it("renders requirements-list-error (not a spinner) and retry refetches the tree", async () => {
      // The list's rows come from the server, so its failure state does too:
      // a failed count round trip is what leaves it with nothing to render.
      global.fetch = makeTreeFetchMock({
        mode: "lazy",
        total: 600,
        countOk: false,
      }) as any;

      renderView();
      await waitForTree();

      expect(
        await screen.findByTestId("requirements-list-error")
      ).toBeInTheDocument();
      expect(document.querySelector(".animate-spin")).not.toBeInTheDocument();

      const countCallsBefore = (global.fetch as any).mock.calls.filter(
        ([url]: [string]) =>
          typeof url === "string" && url.includes("countOnly=1")
      ).length;

      fireEvent.click(
        screen.getByRole("button", { name: "search.errors.tryAgain" })
      );

      await waitFor(() => {
        const after = (global.fetch as any).mock.calls.filter(
          ([url]: [string]) =>
            typeof url === "string" && url.includes("countOnly=1")
        ).length;
        expect(after).toBeGreaterThan(countCallsBefore);
      });
    });
  });

  describe("empty states", () => {
    it("renders requirements-tree-empty when there are zero requirements", async () => {
      useFindManyIssueMock.mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      renderView();
      await waitForTree();

      expect(
        await screen.findByTestId("requirements-tree-empty")
      ).toBeInTheDocument();
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
      await waitForTree();

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
      await waitForTree();

      await selectFilterOption(
        "requirements-coverage-filter",
        "requirements.coverage.uncovered"
      );

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-2")).toBeInTheDocument();
      });
      // The covered Root is retained ONLY because it's id 2's ancestor.
      expect(
        await screen.findByTestId("requirement-row-1")
      ).toBeInTheDocument();
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
      await waitForTree();

      await selectFilterOption("requirements-coverage-filter", "Failed");

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-2")).toBeInTheDocument();
      });
      expect(
        await screen.findByTestId("requirement-row-1")
      ).toBeInTheDocument();
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
      await waitForTree();

      await selectFilterOption(
        "requirements-source-filter",
        "requirements.provenance.detachedLabel"
      );

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-2")).toBeInTheDocument();
      });
      expect(
        await screen.findByTestId("requirement-row-1")
      ).toBeInTheDocument();
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
      await waitForTree();

      await selectFilterOption(
        "requirements-coverage-filter",
        "requirements.coverage.uncovered"
      );
      await selectFilterOption("requirements-status-filter", "Open");

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-2")).toBeInTheDocument();
      });
      expect(
        await screen.findByTestId("requirement-row-1")
      ).toBeInTheDocument();
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
      await waitForTree();

      expect(filterTrigger("requirements-coverage-filter")).toBeDisabled();

      await selectFilterOption("requirements-status-filter", "Open");

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-2")).toBeInTheDocument();
      });
      expect(
        await screen.findByTestId("requirement-row-1")
      ).toBeInTheDocument();
      expect(screen.queryByTestId("requirement-row-3")).not.toBeInTheDocument();
    });

    it("clearing every filter restores the unfiltered roots list, not a stale match set", async () => {
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
      await waitForTree();

      await selectFilterOption(
        "requirements-coverage-filter",
        "requirements.coverage.uncovered"
      );
      await waitFor(() => {
        // Anchor on the toolbar. An absence-only assertion is ALSO satisfied
        // by the whole view being absent, and a lazy filter change
        // briefly renders nothing while it refetches -- so without this the
        // wait can succeed on the empty intermediate render and the next
        // synchronous query then finds no DOM at all.
        expect(
          screen.getByTestId("requirements-filter-input")
        ).toBeInTheDocument();
        expect(
          screen.queryByTestId("requirement-row-3")
        ).not.toBeInTheDocument();
      });

      // Multi-select: clearing the axis is DESELECTING the value that was
      // chosen, not picking an "All coverage" sentinel row -- there is no
      // such row any more, because an empty selection already means "all".
      await selectFilterOption(
        "requirements-coverage-filter",
        "requirements.coverage.uncovered"
      );

      // Unfiltered, the list shows the project's ROOTS; children come back
      // on expansion. (The stale match set would have shown only the leaf and
      // its retained ancestor, and no chevron.)
      expect(
        await screen.findByTestId("requirement-row-1")
      ).toBeInTheDocument();
      await waitFor(() => {
        expect(
          screen.queryByTestId("requirement-row-2")
        ).not.toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("requirement-chevron-1"));

      expect(
        await screen.findByTestId("requirement-row-2")
      ).toBeInTheDocument();
      expect(
        await screen.findByTestId("requirement-row-3")
      ).toBeInTheDocument();
    });
  });

  // 28-14 Task 1 (D-04): filters and text search submit to the server at
  // EVERY project size now -- `computeVisibleRequirementIds`'s call site is
  // gone from the component (the function and its own tests are untouched,
  // 28-09's oracle). Same convention as the mode-fork/expand-on-demand
  // blocks below: `useRequirementsTree` runs for real against a routed fake
  // `fetch`, never mocked itself.
  describe("server-side filtering (28-14)", () => {
    it("keeps the very same filter input mounted WHILE the filter request is in flight", async () => {
      // The full-view spinner is a FIRST-PAINT state. If a later fetch can
      // still return it, the whole view unmounts while the filter request is
      // open, the input is rebuilt as a new DOM node, and focus and the caret
      // go with it -- the user loses their place mid-word.
      //
      // The filter response is held OPEN deliberately. A mock that resolves
      // immediately never leaves the window in which the unmount happens, so
      // a test written against one passes with or without the fix (learned
      // the hard way -- the first version of this test did exactly that).
      let releaseFilter: (() => void) | null = null;
      const treeFetch = makeTreeFetchMock({
        mode: "lazy",
        total: 600,
        rootsRows: [makeLazyRow({ id: 501, name: "Root A" })],
        matchPages: [
          {
            matchedTotal: 1,
            matchedIds: [501],
            ancestorIds: [],
            rows: [makeLazyRow({ id: 501, name: "Root A" })],
            nextCursor: null,
          },
        ],
      });
      global.fetch = vi.fn((url: string, init?: RequestInit) => {
        const isFilterPost =
          typeof url === "string" &&
          url.includes("/requirements/tree") &&
          (init?.method ?? "GET") === "POST";
        if (!isFilterPost) return (treeFetch as any)(url, init);
        return new Promise((resolve) => {
          releaseFilter = () => resolve((treeFetch as any)(url, init) as never);
        });
      }) as any;

      renderView();
      await waitForTree();

      const before = screen.getByTestId("requirements-filter-input");
      fireEvent.change(before, { target: { value: "root" } });

      // Wait until the request is actually open, then look at the DOM while
      // it still is -- that is the whole window under test.
      await waitFor(() => expect(releaseFilter).not.toBeNull());
      expect(screen.queryByTestId("requirements-filter-input")).toBe(before);

      await act(async () => {
        releaseFilter!();
      });

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
      });
      // Still the SAME node afterwards: a remount is what steals focus.
      expect(screen.getByTestId("requirements-filter-input")).toBe(before);
    });

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

    it("a second selection on the same axis ADDS to it rather than replacing it", async () => {
      const requirements = [
        makeRequirement({ id: 1, name: "Root", externalStatus: "Open" }),
        makeRequirement({
          id: 2,
          name: "Child",
          parentId: 1,
          externalStatus: "Blocked",
        }),
      ];
      useFindManyIssueMock.mockReturnValue({
        data: requirements,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      useRequirementCoverageMock.mockReturnValue({
        data: makeCoverageResponse({}),
        isError: false,
      });
      global.fetch = makeLegacyFilterFetchMock(
        requirements,
        makeCoverageResponse({})
      ) as any;

      renderView();
      await waitForTree();

      await selectFilterOption("requirements-status-filter", "Open");
      await waitFor(() => {
        expect(lastFilterRequestBody()?.status).toEqual(["Open"]);
      });

      await selectFilterOption("requirements-status-filter", "Blocked");
      await waitFor(() => {
        expect(lastFilterRequestBody()?.status).toEqual(["Open", "Blocked"]);
      });

      // ...and picking the same value again removes it -- the only way to
      // clear an axis now that there is no "All statuses" sentinel row.
      await selectFilterOption("requirements-status-filter", "Open");
      await waitFor(() => {
        expect(lastFilterRequestBody()?.status).toEqual(["Blocked"]);
      });
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
      await waitForTree();

      await selectFilterOption(
        "requirements-coverage-filter",
        "requirements.coverage.uncovered"
      );
      await waitFor(() => {
        expect(lastFilterRequestBody()?.coverage).toEqual(["UNCOVERED"]);
      });

      await selectFilterOption("requirements-status-filter", "Open");
      await waitFor(() => {
        expect(lastFilterRequestBody()?.status).toEqual(["Open"]);
      });

      await selectFilterOption(
        "requirements-source-filter",
        "requirements.provenance.nativeLabel"
      );
      await waitFor(() => {
        expect(lastFilterRequestBody()?.source).toEqual(["MANUAL"]);
      });
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

    it("above the threshold, a filter change collapses expanded rows -- an expanded row must never survive the reset with its children silently dropped", async () => {
      global.fetch = makeTreeFetchMock({
        mode: "lazy",
        total: 600,
        rootsRows: [
          makeLazyRow({ id: 501, name: "Root A", hasChildren: true }),
        ],
        matchPages: [
          {
            matchedTotal: 1,
            matchedIds: [501],
            ancestorIds: [],
            expandMatchedSubtrees: true,
            rows: [makeLazyRow({ id: 501, name: "Root A", hasChildren: true })],
          },
        ],
        childrenByParentId: {
          501: [makeLazyRow({ id: 502, name: "Child of A", parentId: 501 })],
        },
      }) as any;

      renderView();
      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("requirement-chevron-501"));
      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-502")).toBeInTheDocument();
      });

      // The hook drops every loaded row (children included) on a filter
      // change, and nothing refetches them -- so the row must come back
      // COLLAPSED, not open-and-empty.
      fireEvent.change(screen.getByTestId("requirements-filter-input"), {
        target: { value: "root a" },
      });

      await waitFor(() => {
        // Anchor on the toolbar. An absence-only assertion is ALSO satisfied
        // by the whole view being absent, and a lazy filter change
        // briefly renders nothing while it refetches -- so without this the
        // wait can succeed on the empty intermediate render and the next
        // synchronous query then finds no DOM at all.
        expect(
          screen.getByTestId("requirements-filter-input")
        ).toBeInTheDocument();
        expect(
          screen.queryByTestId("requirement-row-502")
        ).not.toBeInTheDocument();
      });
      expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
      // The chevron names the action it OFFERS, so "expandRow" is the
      // collapsed state -- the row is genuinely closed, not open-and-empty.
      expect(
        screen.getByTestId("requirement-chevron-501").getAttribute("aria-label")
      ).toContain("requirements.list.expandRow");
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
        // Anchor on the toolbar. An absence-only assertion is ALSO satisfied
        // by the whole view being absent, and a lazy filter change
        // briefly renders nothing while it refetches -- so without this the
        // wait can succeed on the empty intermediate render and the next
        // synchronous query then finds no DOM at all.
        expect(
          screen.getByTestId("requirements-filter-input")
        ).toBeInTheDocument();
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
      expect(filterTrigger("requirements-coverage-filter")).toBeDisabled();

      await selectFilterOption(
        "requirements-source-filter",
        "requirements.provenance.detachedLabel"
      );

      await waitFor(() => {
        expect(lastFilterRequestBody()?.source).toEqual(["DETACHED"]);
      });
      expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
    });

    it("every filter control keeps its existing test id and disabled rule", async () => {
      useFindManyIssueMock.mockReturnValue({
        data: [makeRequirement({ id: 1, name: "Root A" })],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      renderView();
      await waitForTree();

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
      expect(filterTrigger("requirements-coverage-filter")).toBeDisabled();
    });
  });

  // 28-14 Task 2 (SCALE-02/SCALE-03): the hardcoded `hasMore={false}`
  // literal is gone -- the roots pager's real `hasMore`/`onLoadMore`/
  // `loadedCount`/`loadMoreError`/`onRetryLoadMore` are wired at the
  // `<DataTable virtualized>` call site, and the toolbar renders "Showing x
  // of y" from the hook's own matched-aware counts. `virtualizedHookMock`
  // captures the REAL `onLoadMore` the engine passes to
  // `useVirtualizedInfiniteList` so a test can simulate the sentinel firing
  // directly (DataTable.virtualized.test.tsx's own convention), since jsdom
  // has no IntersectionObserver.
  describe("infinite scroll + showing x of y (28-14)", () => {
    it("hasMore is true while the roots cursor has more, and false once exhausted", async () => {
      global.fetch = makeTreeFetchMock({
        mode: "lazy",
        total: 600,
        rootsPages: [
          {
            rows: [makeLazyRow({ id: 501, name: "Root A" })],
            nextCursor: { name: "Root B", id: 502 },
          },
          {
            rows: [makeLazyRow({ id: 502, name: "Root B" })],
            nextCursor: null,
          },
        ],
      }) as any;

      renderView();
      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
      });
      expect(virtualizedHookMock.lastOpts?.hasMore).toBe(true);

      await act(async () => {
        virtualizedHookMock.lastOnLoadMore?.();
      });

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-502")).toBeInTheDocument();
      });
      expect(virtualizedHookMock.lastOpts?.hasMore).toBe(false);
    });

    it("the sentinel firing loads the next window and appends it, without duplicating a row", async () => {
      global.fetch = makeTreeFetchMock({
        mode: "lazy",
        total: 600,
        rootsPages: [
          {
            rows: [makeLazyRow({ id: 501, name: "Root A" })],
            nextCursor: { name: "Root B", id: 502 },
          },
          {
            rows: [makeLazyRow({ id: 502, name: "Root B" })],
            nextCursor: null,
          },
        ],
      }) as any;

      renderView();
      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
      });

      await act(async () => {
        virtualizedHookMock.lastOnLoadMore?.();
      });

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-502")).toBeInTheDocument();
      });
      expect(screen.getAllByTestId("requirement-row-501")).toHaveLength(1);
      expect(screen.getAllByTestId("requirement-row-502")).toHaveLength(1);
    });

    it("a failed page sets the retry affordance and keeps the already-loaded rows; retrying recovers", async () => {
      let rootsCallCount = 0;
      global.fetch = vi.fn((url: string) => {
        if (typeof url === "string" && url.includes("countOnly=1")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ total: 600, threshold: 500, mode: "lazy" }),
          });
        }
        // 28-19's own facets GET must NOT consume one of the numbered
        // rootsCallCount slots below -- it shares the same
        // `/requirements/tree` path prefix as the roots-page GET this
        // test's own call-count sequencing depends on.
        if (typeof url === "string" && url.includes("facetsOnly=1")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ statuses: [], coverageStatuses: [] }),
          });
        }
        if (typeof url === "string" && url.includes("/requirements/tree")) {
          rootsCallCount += 1;
          if (rootsCallCount === 1) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                total: 600,
                rows: [makeLazyRow({ id: 501, name: "Root A" })],
                nextCursor: { name: "Root B", id: 502 },
              }),
            });
          }
          if (rootsCallCount === 2) {
            return Promise.resolve({ ok: false, status: 500 });
          }
          return Promise.resolve({
            ok: true,
            json: async () => ({
              total: 600,
              rows: [makeLazyRow({ id: 502, name: "Root B" })],
              nextCursor: null,
            }),
          });
        }
        return Promise.resolve({ ok: true });
      }) as any;

      renderView();
      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
      });

      await act(async () => {
        virtualizedHookMock.lastOnLoadMore?.();
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("requirements-list-load-more-retry")
        ).toBeInTheDocument();
      });
      expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("requirements-list-load-more-retry"));

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-502")).toBeInTheDocument();
      });
      expect(
        screen.queryByTestId("requirements-list-load-more-retry")
      ).not.toBeInTheDocument();
    });

    it("unfiltered, the toolbar reads Showing {loaded} of {total} with the project's classified total", async () => {
      global.fetch = makeTreeFetchMock({
        mode: "lazy",
        total: 600,
        rootsRows: [
          makeLazyRow({ id: 501, name: "Root A" }),
          makeLazyRow({ id: 502, name: "Root B" }),
        ],
      }) as any;

      renderView();

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
      });

      expect(screen.getByTestId("requirements-list-showing").textContent).toBe(
        "common.pagination.showing common.pagination.loadedOfTotal:2·600"
      );
    });

    it("filtered, the toolbar reads the loaded match count and the server's match total -- never larger than the total", async () => {
      global.fetch = makeTreeFetchMock({
        mode: "lazy",
        total: 600,
        matchPages: [
          {
            matchedTotal: 25,
            matchedIds: [501, 502, 503],
            ancestorIds: [],
            expandMatchedSubtrees: true,
            rows: [
              makeLazyRow({ id: 501, name: "Findme A" }),
              makeLazyRow({ id: 502, name: "Findme B" }),
              makeLazyRow({ id: 503, name: "Findme C" }),
            ],
          },
        ],
      }) as any;

      renderView();

      fireEvent.change(await screen.findByTestId("requirements-filter-input"), {
        target: { value: "findme" },
      });

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
      });

      expect(screen.getByTestId("requirements-list-showing").textContent).toBe(
        "common.pagination.showing common.pagination.loadedOfTotal:3·25"
      );
    });

    it("the showing text shares its own row with the column picker, below the filters", async () => {
      useFindManyIssueMock.mockReturnValue({
        data: [makeRequirement({ id: 1, name: "Root A" })],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      renderView();
      await waitForTree();

      const showing = screen.getByTestId("requirements-list-showing");
      // Operator UAT: the count moved out of the filter row onto a row of
      // its own, sharing it with the column picker -- picker left, count
      // right. Verified structurally; jsdom has no layout engine, so the
      // visual justification itself is a UAT check.
      const ownRow = showing.parentElement;
      expect(ownRow).not.toBeNull();
      expect(ownRow?.className).toContain("justify-between");
      // The filter Selects are NOT in this row any more.
      expect(ownRow).not.toContainElement(
        screen.getByTestId("requirements-coverage-filter")
      );
    });
  });

  // 28-13: the server-decided mode fork. Per this file's own established
  // convention (25-15's UAT ruling), `useRequirementsTree` itself is never
  // mocked -- only `global.fetch`, so the hook's real fetch/merge/state
  // logic runs against a routed fake transport.
  describe("mode fork (28-13)", () => {
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

  // 28-19 (gap closure, defect A): the Status/Coverage Selects' option
  // source forks by mode -- `collectRequirementStatusOptions`/
  // `collectCoverageStatusOptions` both read the all-mode-only in-memory
  // `requirements` array, which stays `[]` above the threshold, so both
  // Selects rendered EMPTY above the threshold before this gap-closure
  // plan. Above it, the two lists now come from the hook's own
  // server-computed facets instead.
  describe("filter options by mode (28-19)", () => {
    it("offers the project's statuses above the threshold", async () => {
      // The Coverage Select's OWN disabled gate reads the always-on
      // rollup hook (`useRequirementCoverage`), independent of mode -- a
      // truthy rollup here is what makes the Select interactive at all, so
      // this test can prove its DYNAMIC entries come from the facets
      // fetch rather than the rollup's own content.
      useRequirementCoverageMock.mockReturnValue({
        data: makeCoverageResponse({}),
        isError: false,
      });
      global.fetch = makeTreeFetchMock({
        mode: "lazy",
        total: 600,
        rootsRows: [makeLazyRow({ id: 501, name: "Lazy Root" })],
        facets: {
          statuses: ["Blocked", "Open"],
          coverageStatuses: [
            { statusId: 10, name: "Passed", color: "#0f0", count: 3 },
          ],
        },
      }) as any;

      renderView();

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
      });

      await act(async () => {
        fireEvent.click(filterTrigger("requirements-status-filter"));
      });
      expect(
        await screen.findByRole("option", { name: "Open" })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: "Blocked" })
      ).toBeInTheDocument();
      await closeFilterOptions("requirements-status-filter");

      await act(async () => {
        fireEvent.click(filterTrigger("requirements-coverage-filter"));
      });
      expect(
        await screen.findByRole("option", { name: /Passed/ })
      ).toBeInTheDocument();
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
        // Anchor on the toolbar. An absence-only assertion is ALSO satisfied
        // by the whole view being absent, and a lazy filter change
        // briefly renders nothing while it refetches -- so without this the
        // wait can succeed on the empty intermediate render and the next
        // synchronous query then finds no DOM at all.
        expect(
          screen.getByTestId("requirements-filter-input")
        ).toBeInTheDocument();
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
      // 28-15: real useQuery (useRequirementSubtreeCount) now runs
      // unconditionally, needing a real QueryClient in context -- see
      // renderView()'s own comment for why.
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <RequirementsListView
            projectId="42"
            selectedRequirementId={null}
            onSelectRequirement={onSelectRequirement}
          />
        </QueryClientProvider>
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
        // Anchor on the toolbar. An absence-only assertion is ALSO satisfied
        // by the whole view being absent, and a lazy filter change
        // briefly renders nothing while it refetches -- so without this the
        // wait can succeed on the empty intermediate render and the next
        // synchronous query then finds no DOM at all.
        expect(
          screen.getByTestId("requirements-filter-input")
        ).toBeInTheDocument();
        expect(
          screen.queryByTestId("requirement-row-502")
        ).not.toBeInTheDocument();
      });

      rerender(
        <QueryClientProvider client={queryClient}>
          <RequirementsListView
            projectId="42"
            selectedRequirementId={502}
            onSelectRequirement={onSelectRequirement}
          />
        </QueryClientProvider>
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
      // 28-15: see the previous test's own comment for why this needs a
      // real QueryClient in context now.
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <RequirementsListView
            projectId="42"
            selectedRequirementId={null}
            onSelectRequirement={onSelectRequirement}
          />
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(
          screen.getByTestId("requirement-chevron-501")
        ).toBeInTheDocument();
      });

      // 999 was never loaded -- its ancestor chain is unknown to this list.
      expect(() =>
        rerender(
          <QueryClientProvider client={queryClient}>
            <RequirementsListView
              projectId="42"
              selectedRequirementId={999}
              onSelectRequirement={onSelectRequirement}
            />
          </QueryClientProvider>
        )
      ).not.toThrow();

      expect(screen.getByTestId("requirement-chevron-501")).toHaveAttribute(
        "aria-label",
        "requirements.list.expandRow:Lazy Root"
      );
    });
  });

  // 28-15: the delete confirmation's descendant count under lazy mode.
  // `useRequirementSubtreeCount` runs for real here (never mocked itself,
  // per this file's own "mock fetch, not the hook" convention) -- only
  // `global.fetch` is routed, via `makeTreeFetchMockWithDescendantCount`.
  describe("delete confirmation descendant count (28-15)", () => {
    it("lazy mode: a FAILED descendant-count request leaves the count unknown and Confirm disabled -- never 'no children' over a subtree that has them", async () => {
      // The destructive case. React Query settles a failed query into
      // `status: "error"` with `data` undefined, at which point `isLoading`
      // is false -- so a consumer that only checks `isLoading` sees "not
      // loading, no data" and, if it defaults that to 0, renders the
      // no-children copy over a subtree that may hold hundreds of rows.
      // Confirming there cascades the delete across every one of them.
      global.fetch = makeTreeFetchMockWithDescendantCount({
        mode: "lazy",
        total: 600,
        rootsRows: [
          makeLazyRow({ id: 501, name: "Lazy Root", hasChildren: true }),
        ],
        descendantCountOk: false,
      }) as any;

      renderView();

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
      });

      openMenu(screen.getByTestId("requirement-actions-trigger-501"));
      fireEvent.click(screen.getByTestId("requirement-action-delete-501"));

      const dialog = await screen.findByTestId("delete-requirement-dialog");

      await waitFor(() => {
        expect(screen.getByTestId("delete-requirement-confirm")).toBeDisabled();
      });
      // The specific wrong outcome: the reassuring copy. `hasChildren` is
      // true on this row, so "no children" is not merely unknown-but-
      // harmless, it is a statement the server never made.
      expect(dialog).not.toHaveTextContent(
        "requirements.delete.confirmNoChildren"
      );
    });

    it("lazy mode: opening the delete dialog for a root whose subtree hasn't loaded states the server's real descendant count, not zero", async () => {
      global.fetch = makeTreeFetchMockWithDescendantCount({
        mode: "lazy",
        total: 600,
        rootsRows: [
          makeLazyRow({ id: 501, name: "Lazy Root", hasChildren: true }),
        ],
        descendantCounts: { 501: 42 },
      }) as any;

      renderView();

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
      });

      openMenu(screen.getByTestId("requirement-actions-trigger-501"));
      fireEvent.click(screen.getByTestId("requirement-action-delete-501"));

      // Today (pre-28-15), this reads `countDescendants(childrenMap, 501)`
      // against an empty lazy-mode `childrenMap` -- 0, always, regardless of
      // what the server actually holds. This assertion is the one that
      // matters: the server's real count (42), not that undercount.
      await waitFor(() => {
        expect(
          screen.getByTestId("delete-requirement-dialog")
        ).toHaveTextContent("requirements.delete.confirmWithChildren:42");
      });

      const descendantCountCalls = (global.fetch as any).mock.calls.filter(
        ([url]: [string]) =>
          typeof url === "string" && url.includes("/descendant-count")
      );
      expect(descendantCountCalls).toHaveLength(1);
      expect(descendantCountCalls[0][0]).toBe(
        "/api/projects/42/requirements/501/descendant-count"
      );
    });

    it("the dialog does not refetch its count while it stays open, even as unrelated state changes", async () => {
      global.fetch = makeTreeFetchMockWithDescendantCount({
        mode: "lazy",
        total: 600,
        rootsRows: [makeLazyRow({ id: 501, name: "Lazy Root" })],
        descendantCounts: { 501: 42 },
      }) as any;

      renderView();

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
      });

      openMenu(screen.getByTestId("requirement-actions-trigger-501"));
      fireEvent.click(screen.getByTestId("requirement-action-delete-501"));

      await waitFor(() => {
        expect(
          screen.getByTestId("delete-requirement-dialog")
        ).toHaveTextContent("requirements.delete.confirmWithChildren:42");
      });

      const countCallsAfterOpen = (global.fetch as any).mock.calls.filter(
        ([url]: [string]) =>
          typeof url === "string" && url.includes("/descendant-count")
      ).length;
      expect(countCallsAfterOpen).toBe(1);

      // Unrelated activity while the dialog stays open (a filter keystroke,
      // reaching the server for the TREE route only) -- proves the count
      // isn't tied to every render, only to the dialog's own open lifetime.
      const input = screen.getByTestId("requirements-filter-input");
      fireEvent.change(input, { target: { value: "unrelated" } });

      await waitFor(() => {
        expect(filterRequestCalls().length).toBeGreaterThan(0);
      });

      const countCallsAfterTyping = (global.fetch as any).mock.calls.filter(
        ([url]: [string]) =>
          typeof url === "string" && url.includes("/descendant-count")
      ).length;
      expect(countCallsAfterTyping).toBe(1);
    });

    it("closing the dialog and reopening it for a different requirement fetches that requirement's own count", async () => {
      global.fetch = makeTreeFetchMockWithDescendantCount({
        mode: "lazy",
        total: 600,
        rootsRows: [
          makeLazyRow({ id: 501, name: "Lazy Root A" }),
          makeLazyRow({ id: 502, name: "Lazy Root B" }),
        ],
        descendantCounts: { 501: 5, 502: 9 },
      }) as any;

      renderView();

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
        expect(screen.getByTestId("requirement-row-502")).toBeInTheDocument();
      });

      openMenu(screen.getByTestId("requirement-actions-trigger-501"));
      fireEvent.click(screen.getByTestId("requirement-action-delete-501"));
      await waitFor(() => {
        expect(
          screen.getByTestId("delete-requirement-dialog")
        ).toHaveTextContent("requirements.delete.confirmWithChildren:5");
      });

      fireEvent.click(screen.getByText("common.cancel"));
      await waitFor(() => {
        // Anchor on the toolbar. An absence-only assertion is ALSO satisfied
        // by the whole view being absent, and a lazy filter change
        // briefly renders nothing while it refetches -- so without this the
        // wait can succeed on the empty intermediate render and the next
        // synchronous query then finds no DOM at all.
        expect(
          screen.getByTestId("requirements-filter-input")
        ).toBeInTheDocument();
        expect(
          screen.queryByTestId("delete-requirement-dialog")
        ).not.toBeInTheDocument();
      });

      openMenu(screen.getByTestId("requirement-actions-trigger-502"));
      fireEvent.click(screen.getByTestId("requirement-action-delete-502"));
      await waitFor(() => {
        expect(
          screen.getByTestId("delete-requirement-dialog")
        ).toHaveTextContent("requirements.delete.confirmWithChildren:9");
      });

      const descendantCountUrls = (global.fetch as any).mock.calls
        .filter(
          ([url]: [string]) =>
            typeof url === "string" && url.includes("/descendant-count")
        )
        .map(([url]: [string]) => url);
      expect(descendantCountUrls).toEqual([
        "/api/projects/42/requirements/501/descendant-count",
        "/api/projects/42/requirements/502/descendant-count",
      ]);
    });

    it("the delete itself still POSTs the guarded delete-subtree route and consumes the server's deletedIds, in lazy mode too", async () => {
      global.fetch = vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (typeof url === "string" && url.includes("/requirements/tree")) {
          if (url.includes("countOnly=1")) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                total: 600,
                threshold: 500,
                mode: "lazy",
              }),
            });
          }
          if (url.includes("facetsOnly=1")) {
            return Promise.resolve({
              ok: true,
              json: async () => ({ statuses: [], coverageStatuses: [] }),
            });
          }
          if (method === "GET") {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                total: 600,
                rows: [makeLazyRow({ id: 501, name: "Lazy Root" })],
                nextCursor: null,
              }),
            });
          }
        }
        if (typeof url === "string" && url.includes("/descendant-count")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ count: 3 }),
          });
        }
        if (typeof url === "string" && url.includes("/delete-subtree")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ deletedIds: [501] }),
          });
        }
        return Promise.resolve({ ok: true });
      }) as any;

      renderView();

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
      });

      openMenu(screen.getByTestId("requirement-actions-trigger-501"));
      fireEvent.click(screen.getByTestId("requirement-action-delete-501"));
      await waitFor(() => {
        expect(
          screen.getByTestId("delete-requirement-dialog")
        ).toHaveTextContent("requirements.delete.confirmWithChildren:3");
      });

      fireEvent.click(screen.getByTestId("delete-requirement-confirm"));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/projects/42/requirements/501/delete-subtree",
          { method: "POST" }
        );
      });
      await waitFor(() => expect(mockInvalidateQueries).toHaveBeenCalled());
    });
  });

  // 28-15 Task 2: pinning the two 28-CONTEXT discretion decisions (drag
  // targets, coverage) under lazy loading with tests instead of an
  // assumption. `useRequirementsTree` runs for real here, never mocked
  // itself, mirroring every other lazy-mode describe block in this file.
  describe("drag targets under lazy loading (28-15)", () => {
    it("the set of rows exposing a drop target equals the set of loaded rows -- an unloaded row has no DOM node at all", async () => {
      global.fetch = makeTreeFetchMock({
        mode: "lazy",
        total: 600,
        rootsRows: [
          makeLazyRow({ id: 501, name: "Lazy Root A" }),
          makeLazyRow({ id: 502, name: "Lazy Root B" }),
        ],
      }) as any;

      renderView();

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
        expect(screen.getByTestId("requirement-row-502")).toBeInTheDocument();
      });

      // Only the two loaded roots exist as rows at all -- there is no
      // separate "present but not a target" state to assert against: an id
      // the pager hasn't paged in yet (e.g. 999) simply has no row, and a
      // drop can only ever target a rendered one (getRowProps/dragOverRow
      // both key off a row that exists in the DOM).
      const renderedRowIds = screen
        .getAllByTestId(/^requirement-row-\d+$/)
        .map((el) => el.getAttribute("data-testid"));
      expect(renderedRowIds.sort()).toEqual(
        ["requirement-row-501", "requirement-row-502"].sort()
      );
      expect(
        screen.queryByTestId("requirement-row-999")
      ).not.toBeInTheDocument();
    });

    // 28-19 (gap closure, defect B): the FINDING 28-15 recorded (and
    // deliberately did not fix, per its own test-only scope) is fixed here.
    // `handleMove`'s guard now derives readiness from the rows the list
    // actually has (`hasLoadedRequirements`, keyed off `lazyRowsById` above
    // the threshold) rather than the permanently-disabled load-all query's
    // own `data`, which stayed `undefined` forever once `mode` resolved to
    // `"lazy"` -- the exact defect this test used to characterize as
    // "unreachable" is now proven fixed, using the SAME faithful mock
    // (`data: undefined`, not this file's usual convenience default of
    // `data: []`) that made the original defect visible in the first place.
    it("reparents a requirement above the threshold", async () => {
      useFindManyIssueMock.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      global.fetch = makeTreeFetchMock({
        mode: "lazy",
        total: 600,
        rootsRows: [
          makeLazyRow({ id: 501, name: "Lazy Root A" }),
          makeLazyRow({ id: 502, name: "Lazy Root B" }),
        ],
      }) as any;

      renderView();

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
        expect(screen.getByTestId("requirement-row-502")).toBeInTheDocument();
      });

      fireEvent.dragEnter(screen.getByTestId("requirement-row-502"));
      await act(async () => {
        await dropSpecs.list.drop(
          { requirementId: 501, name: "Lazy Root A" },
          { didDrop: () => false }
        );
      });

      await waitFor(() =>
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/projects/42/requirements/501/reparent",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ parentId: 502 }),
          })
        )
      );

      const { toast } = await import("sonner");
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith(
          "requirements.tree.moveSuccess"
        )
      );
    });

    it("a server rejection surfaces the same actionable toast above the threshold as it does below it", async () => {
      useFindManyIssueMock.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      global.fetch = vi.fn((url: string, init?: RequestInit) => {
        if (typeof url === "string" && url.includes("/reparent")) {
          return Promise.resolve({
            ok: false,
            json: async () => ({ error: "cycle" }),
          });
        }
        if (typeof url === "string" && url.includes("countOnly=1")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ total: 600, threshold: 500, mode: "lazy" }),
          });
        }
        if (typeof url === "string" && url.includes("facetsOnly=1")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ statuses: [], coverageStatuses: [] }),
          });
        }
        if (
          typeof url === "string" &&
          url.includes("/requirements/tree") &&
          (init?.method ?? "GET") === "GET"
        ) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              total: 600,
              rows: [
                makeLazyRow({ id: 501, name: "Lazy Root A" }),
                makeLazyRow({ id: 502, name: "Lazy Root B" }),
              ],
              nextCursor: null,
            }),
          });
        }
        return Promise.resolve({ ok: true });
      }) as any;

      renderView();

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
        expect(screen.getByTestId("requirement-row-502")).toBeInTheDocument();
      });

      fireEvent.dragEnter(screen.getByTestId("requirement-row-502"));
      await act(async () => {
        await dropSpecs.list.drop(
          { requirementId: 501, name: "Lazy Root A" },
          { didDrop: () => false }
        );
      });

      const { toast } = await import("sonner");
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          "requirements.tree.moveRejected cycle"
        )
      );
    });

    it("drag stays unavailable while filtering, above the threshold too -- no reparent request fires", async () => {
      useFindManyIssueMock.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      global.fetch = makeTreeFetchMock({
        mode: "lazy",
        total: 600,
        rootsRows: [
          makeLazyRow({ id: 501, name: "Lazy Root A" }),
          makeLazyRow({ id: 502, name: "Lazy Root B" }),
        ],
        // Both rows match "Lazy Root" -- unlike the reparent tests above,
        // this test needs a SECOND rendered row to drop onto, so the
        // filter term stays broad enough to keep both matched.
        matchPages: [
          {
            matchedTotal: 2,
            matchedIds: [501, 502],
            ancestorIds: [],
            rows: [
              makeLazyRow({ id: 501, name: "Lazy Root A" }),
              makeLazyRow({ id: 502, name: "Lazy Root B" }),
            ],
            nextCursor: null,
          },
        ],
      }) as any;

      renderView();

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
        expect(screen.getByTestId("requirement-row-502")).toBeInTheDocument();
      });

      fireEvent.change(screen.getByTestId("requirements-filter-input"), {
        target: { value: "Lazy Root" },
      });

      await waitFor(() => {
        const filterCalls = (global.fetch as any).mock.calls.filter(
          ([url, init]: [string, RequestInit | undefined]) =>
            typeof url === "string" &&
            url.includes("/requirements/tree") &&
            (init?.method ?? "GET") === "POST"
        );
        expect(filterCalls.length).toBeGreaterThan(0);
      });

      // `findBy`, not `getBy`: the wait above proves only that the filter
      // REQUEST was issued. A filter change in lazy mode collapses the tree
      // and refetches, so the rows are briefly absent between that request
      // and its response, and a synchronous query reads the empty
      // intermediate render whenever the response has not landed yet. The
      // three sibling drag tests above wait on the ROW rather than on a
      // fetch call, which is why only this one was load-sensitive.
      fireEvent.dragEnter(await screen.findByTestId("requirement-row-502"));
      await act(async () => {
        await dropSpecs.list.drop(
          { requirementId: 501, name: "Lazy Root A" },
          { didDrop: () => false }
        );
      });

      const reparentCalls = (global.fetch as any).mock.calls.filter(
        ([url]: [string]) =>
          typeof url === "string" && url.includes("/reparent")
      );
      expect(reparentCalls).toHaveLength(0);
    });

    it("a viewer without edit rights cannot reparent above the threshold either -- no reparent request fires", async () => {
      mockIsProjectAdmin = false;
      useFindManyIssueMock.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      global.fetch = makeTreeFetchMock({
        mode: "lazy",
        total: 600,
        rootsRows: [
          makeLazyRow({ id: 501, name: "Lazy Root A" }),
          makeLazyRow({ id: 502, name: "Lazy Root B" }),
        ],
      }) as any;

      renderView();

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
        expect(screen.getByTestId("requirement-row-502")).toBeInTheDocument();
      });

      fireEvent.dragEnter(screen.getByTestId("requirement-row-502"));
      await act(async () => {
        await dropSpecs.list.drop(
          { requirementId: 501, name: "Lazy Root A" },
          { didDrop: () => false }
        );
      });

      const reparentCalls = (global.fetch as any).mock.calls.filter(
        ([url]: [string]) =>
          typeof url === "string" && url.includes("/reparent")
      );
      expect(reparentCalls).toHaveLength(0);
    });
  });

  describe("coverage on lazily loaded rows (28-15)", () => {
    it("a row that arrived through the lazy path renders its coverage cell from the whole-project rollup, keyed by id like any other row", async () => {
      global.fetch = makeTreeFetchMock({
        mode: "lazy",
        total: 600,
        rootsRows: [makeLazyRow({ id: 501, name: "Lazy Root" })],
      }) as any;
      useRequirementCoverageMock.mockReturnValue({
        data: makeCoverageResponse({
          501: makeBreakdown({ linkedCaseCount: 3, status: "PASSED" }),
        }),
        isError: false,
      });

      renderView();

      await waitFor(() => {
        expect(screen.getByTestId("requirement-row-501")).toBeInTheDocument();
      });

      expect(
        screen.getByTestId("requirement-coverage-cell-501")
      ).toBeInTheDocument();
    });
  });
});
