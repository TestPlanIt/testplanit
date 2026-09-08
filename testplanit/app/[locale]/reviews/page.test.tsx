import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

// router.push/replace write the URL's query back into the search-params
// store (below) so the page re-renders with the new params, mirroring the
// real App Router — the tab state lives in the `tab` param and would never
// flip under an inert mock.
const applyMockNavigation = (url: string) => {
  setCurrentSearchParams(
    url.includes("?") ? url.slice(url.indexOf("?") + 1) : ""
  );
};
const mockRouterPush = vi.fn(applyMockNavigation);
const mockRouterReplace = vi.fn(applyMockNavigation);
vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush, replace: mockRouterReplace }),
  usePathname: () => "/reviews",
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} data-mock-link="true" {...rest}>
      {children}
    </a>
  ),
}));

// The docked details panel is driven by `case` + `caseProject` search
// params and the tab strip by `tab`. Backed by a subscribable store so
// mock navigation triggers a re-render (tests may still assign
// `currentSearchParams` directly before render to deep-link).
let currentSearchParams = "";
const searchParamsListeners = new Set<() => void>();
function setCurrentSearchParams(next: string) {
  currentSearchParams = next;
  act(() => {
    searchParamsListeners.forEach((notify) => notify());
  });
}
vi.mock("next/navigation", async (importOriginal) => {
  const original = await importOriginal<typeof import("next/navigation")>();
  const { useSyncExternalStore } = await import("react");
  return {
    ...original,
    useSearchParams: () => {
      const query = useSyncExternalStore(
        (onStoreChange) => {
          searchParamsListeners.add(onStoreChange);
          return () => searchParamsListeners.delete(onStoreChange);
        },
        () => currentSearchParams
      );
      return new URLSearchParams(query);
    },
  };
});

// Stub the panel — it pulls the whole TestCaseDetailsView tree, which is far
// heavier than anything these page-level tests assert on. The stub records the
// props the page hands it and exposes its callbacks as buttons.
vi.mock("@/components/repositories/CaseDetailsPanel", () => ({
  CaseDetailsPanel: ({
    caseId,
    projectId,
    position,
    total,
    hasPrev,
    hasNext,
    onPrev,
    onNext,
    onClose,
  }: {
    caseId: string;
    projectId: string;
    position: number | null;
    total: number;
    hasPrev: boolean;
    hasNext: boolean;
    onPrev: () => void;
    onNext: () => void;
    onClose: () => void;
  }) => (
    <div
      data-testid="case-details-panel-stub"
      data-case-id={caseId}
      data-project-id={projectId}
      data-position={String(position)}
      data-total={String(total)}
      data-has-prev={String(hasPrev)}
      data-has-next={String(hasNext)}
    >
      <button data-testid="stub-prev" onClick={onPrev} />
      <button data-testid="stub-next" onClick={onNext} />
      <button data-testid="stub-close" onClick={onClose} />
    </div>
  ),
}));

// Stub the filter comboboxes as native selects — the real MultiAsyncCombobox
// is a Popover + cmdk tree that's exercised by its own tests; page tests only
// care that a selection lands in the query's where-clause. The stub loads the
// option list through the page's fetchOptions so option values stay real
// (page tests pick single values; multi-select behavior belongs to the
// shared component's own suite).
vi.mock("@/components/ui/multi-async-combobox", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    MultiAsyncCombobox: ({
      value,
      onValueChange,
      fetchOptions,
      getOptionValue,
      ariaLabel,
    }: {
      value: unknown[];
      onValueChange: (v: unknown[]) => void;
      fetchOptions: (
        q: string,
        page: number,
        pageSize: number
      ) => Promise<unknown>;
      getOptionValue: (o: unknown) => string | number;
      ariaLabel?: string;
    }) => {
      const [options, setOptions] = React.useState<unknown[]>([]);
      // Load on focus, not on mount — a mount-time fetch would fire an
      // outside-act state update in every test that renders the page but
      // never touches a filter. getFilterSelect() focuses, then waits.
      const load = () => {
        void Promise.resolve(fetchOptions("", 0, 100)).then((r: any) => {
          setOptions(Array.isArray(r) ? r : (r?.results ?? []));
        });
      };
      return (
        <select
          aria-label={ariaLabel}
          onFocus={load}
          value={value.length ? String(getOptionValue(value[0])) : "all"}
          onChange={(e) => {
            const v = e.target.value;
            onValueChange(
              v === "all"
                ? []
                : options.filter((o) => String(getOptionValue(o)) === v)
            );
          }}
        >
          <option value="all">all</option>
          {options.map((o) => (
            <option
              key={String(getOptionValue(o))}
              value={String(getOptionValue(o))}
            >
              {String(getOptionValue(o))}
            </option>
          ))}
        </select>
      );
    },
  };
});

// Grab a filter's stubbed select (scoped by the wrapper testid) once its
// option list has loaded — the stub populates options via an async effect.
async function getFilterSelect(testId: string): Promise<HTMLSelectElement> {
  const select = within(screen.getByTestId(testId)).getByRole(
    "combobox"
  ) as HTMLSelectElement;
  fireEvent.focus(select);
  await waitFor(() => expect(select.options.length).toBeGreaterThan(1));
  return select;
}

type SessionLike = { user: { id: string; access: string } } | null;
let currentSession: SessionLike = {
  user: { id: "user-1", access: "USER" },
};
let currentSessionStatus: "loading" | "authenticated" | "unauthenticated" =
  "authenticated";

vi.mock("next-auth/react", async (importOriginal) => {
  const original = await importOriginal<typeof import("next-auth/react")>();
  return {
    ...original,
    useSession: () => ({
      data: currentSession,
      status: currentSessionStatus,
      update: vi.fn(),
    }),
  };
});

const mockUseReviewFeatureEnabled = vi.fn();
vi.mock("~/hooks/useReviewFeatureEnabled", () => ({
  useReviewFeatureEnabled: (...args: unknown[]) =>
    mockUseReviewFeatureEnabled(...args),
}));

interface MockReviewRow {
  id: string;
  entityType: "CASE" | "RUN" | "SESSION";
  entityId: number;
  projectId: number;
  createdAt: Date;
  status: string;
  fromStateId: number;
  toStateId: number;
  assigneeUserId: string | null;
  assigneeRoleId: number | null;
  requestedByUserId: string;
  project: { id: number; name: string };
  requestedBy: { id: string; name: string | null; image: string | null };
  fromState: { id: number; name: string };
  toState: { id: number; name: string };
  assigneeUser: { id: string; name: string | null } | null;
  assigneeRole: { id: number; name: string } | null;
  decidedByUserId?: string | null;
  decidedBy?: { id: string; name: string | null } | null;
  decidedAt?: Date | null;
}

const allRows: MockReviewRow[] = [
  {
    id: "r1",
    entityType: "CASE",
    entityId: 101,
    projectId: 7,
    createdAt: new Date("2026-05-15T10:00:00Z"),
    status: "PENDING",
    fromStateId: 1,
    toStateId: 2,
    assigneeUserId: "user-1",
    assigneeRoleId: null,
    requestedByUserId: "user-2",
    project: { id: 7, name: "Alpha" },
    requestedBy: { id: "user-2", name: "Alice", image: null },
    fromState: { id: 1, name: "In Progress" },
    toState: { id: 2, name: "Ready For Review" },
    assigneeUser: { id: "user-1", name: "Reviewer One" },
    assigneeRole: null,
  },
  {
    id: "r2",
    entityType: "RUN",
    entityId: 202,
    projectId: 8,
    createdAt: new Date("2026-05-14T10:00:00Z"),
    status: "PENDING",
    fromStateId: 3,
    toStateId: 4,
    assigneeUserId: null,
    assigneeRoleId: 12,
    requestedByUserId: "user-3",
    project: { id: 8, name: "Beta" },
    requestedBy: { id: "user-3", name: "Bob", image: null },
    fromState: { id: 3, name: "Active" },
    toState: { id: 4, name: "Completed" },
    assigneeUser: null,
    assigneeRole: { id: 12, name: "QA Lead" },
  },
  {
    id: "r3",
    entityType: "SESSION",
    entityId: 303,
    projectId: 7,
    createdAt: new Date("2026-05-13T10:00:00Z"),
    status: "PENDING",
    fromStateId: 5,
    toStateId: 6,
    assigneeUserId: "user-1",
    assigneeRoleId: null,
    requestedByUserId: "user-4",
    project: { id: 7, name: "Alpha" },
    requestedBy: { id: "user-4", name: "Carol", image: null },
    fromState: { id: 5, name: "Started" },
    toState: { id: 6, name: "Finished" },
    assigneeUser: { id: "user-1", name: "Reviewer One" },
    assigneeRole: null,
  },
  // Decided rows — feed the Decided tab's scope-derived filter options
  // (statuses and deciders present in the data).
  {
    id: "r4",
    entityType: "CASE",
    entityId: 404,
    projectId: 8,
    createdAt: new Date("2026-05-10T10:00:00Z"),
    status: "APPROVED",
    fromStateId: 1,
    toStateId: 2,
    assigneeUserId: "user-3",
    assigneeRoleId: null,
    requestedByUserId: "user-1",
    project: { id: 8, name: "Beta" },
    requestedBy: { id: "user-1", name: "Reviewer One", image: null },
    fromState: { id: 1, name: "In Progress" },
    toState: { id: 2, name: "Ready For Review" },
    assigneeUser: { id: "user-3", name: "Bob" },
    assigneeRole: null,
    decidedByUserId: "user-3",
    decidedBy: { id: "user-3", name: "Bob" },
    decidedAt: new Date("2026-05-11T10:00:00Z"),
  },
  {
    id: "r5",
    entityType: "RUN",
    entityId: 505,
    projectId: 7,
    createdAt: new Date("2026-05-09T10:00:00Z"),
    status: "REJECTED",
    fromStateId: 3,
    toStateId: 4,
    assigneeUserId: "user-1",
    assigneeRoleId: null,
    requestedByUserId: "user-2",
    project: { id: 7, name: "Alpha" },
    requestedBy: { id: "user-2", name: "Alice", image: null },
    fromState: { id: 3, name: "Active" },
    toState: { id: 4, name: "Completed" },
    assigneeUser: { id: "user-1", name: "Reviewer One" },
    assigneeRole: null,
    decidedByUserId: "user-1",
    decidedBy: { id: "user-1", name: "Reviewer One" },
    decidedAt: new Date("2026-05-12T10:00:00Z"),
  },
];

const mockUseFindManyReviewRequest = vi.fn();
const mockUseCountReviewRequest = vi.fn();
const mockUseFindUniqueUser = vi.fn();
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    reviewRequest: {
      useFindMany: (...args: unknown[]) =>
        mockUseFindManyReviewRequest(...args),
      useCount: (...args: unknown[]) => mockUseCountReviewRequest(...args),
    },
    user: {
      useFindUnique: (...args: unknown[]) => mockUseFindUniqueUser(...args),
    },
    // Side-fetches for entity name lookups — page calls these per visible row
    // set; tests don't assert on entity names so empty data is fine.
    repositoryCases: {
      useFindMany: (...args: unknown[]) =>
        mockUseFindManyRepositoryCases(...args),
    },
    testRuns: {
      useFindMany: (...args: unknown[]) => mockUseFindManyTestRuns(...args),
    },
    sessions: {
      useFindMany: (...args: unknown[]) => mockUseFindManySessions(...args),
    },
  }),
}));

// The inbox mounts `@/components/tables/DataTable` directly with a
// Pending | Decided Tabs strip. Stub the DataTable to render one
// `<div data-testid="reviews-inbox-row">` per row — that's the surface
// the page-level row-count assertions key off, and it keeps the test
// hermetic against DataTable's own internal chrome.
vi.mock("@/components/tables/DataTable", () => ({
  DataTable: ({ data }: { data: Array<Record<string, unknown>> }) => (
    <div data-testid="reviews-inbox-data-table-stub">
      {data.map((row) => (
        <div
          key={String(row.id)}
          data-testid="reviews-inbox-row"
          data-row-id={String(row.id)}
          data-entity-type={String(row.entityType)}
          data-entity-id={String(row.entityId)}
          data-project-id={String(row.projectId)}
        />
      ))}
    </div>
  ),
}));

// `./columns` indirectly pulls the i18n nav router (via UserMention /
// WorkflowStateDisplay / entity display cells) which is fragile in the
// jsdom test env. Tests assert on page-level concerns (query args, tab
// switching, filters) rather than column internals, so a noop columns
// factory keeps the surface minimal.
vi.mock("./columns", () => ({
  useColumns: (args: unknown) => {
    mockUseColumns(args);
    return [];
  },
}));

// Captures the `useColumns` args so tests can drive `onOpenCase` — the hook the
// entity cell calls when a reviewer clicks a case name.
const mockUseColumns = vi.fn((_args: unknown) => {});

// Same reason — entity-row side-fetches.
vi.mock("~/components/reviews/ReviewDecisionDialogs", () => ({
  ApproveDialog: () => null,
  RejectDialog: () => null,
  RequestChangesDialog: () => null,
}));

// Page calls useQueryClient for cache invalidation on tab switch / sort.
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

const mockUseFindManyRepositoryCases = vi.fn((..._args: unknown[]) => ({
  data: [] as unknown[],
}));
const mockUseFindManyTestRuns = vi.fn((..._args: unknown[]) => ({
  data: [] as unknown[],
}));
const mockUseFindManySessions = vi.fn((..._args: unknown[]) => ({
  data: [] as unknown[],
}));

function applyHookFilter(args: any): MockReviewRow[] {
  const where = args?.where ?? {};
  const conditions = where.AND ?? [];
  let rows = allRows.slice();
  // Handles both the scalar shape ({ status: "PENDING" }) and the
  // multi-select `in` shape ({ entityType: { in: [...] } }).
  const matches = (cond: unknown, actual: unknown) =>
    typeof cond === "object" && cond !== null && "in" in cond
      ? ((cond as { in: unknown[] }).in ?? []).includes(actual)
      : cond === actual;
  for (const cond of conditions) {
    if (cond.entityType) {
      rows = rows.filter((r) => matches(cond.entityType, r.entityType));
    }
    if (cond.projectId) {
      rows = rows.filter((r) => matches(cond.projectId, r.projectId));
    }
    if (cond.status) {
      rows = rows.filter((r) => matches(cond.status, r.status));
    }
  }
  return rows;
}

import ReviewsInboxPage from "./page";

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("ReviewsInboxPage (/reviews)", () => {
  beforeEach(() => {
    mockRouterPush.mockReset();
    mockRouterReplace.mockReset();
    // mockReset clears implementations — restore the URL write-back.
    mockRouterPush.mockImplementation(applyMockNavigation);
    mockRouterReplace.mockImplementation(applyMockNavigation);
    mockUseColumns.mockClear();
    currentSearchParams = "";
    mockUseReviewFeatureEnabled.mockReset();
    mockUseFindManyReviewRequest.mockReset();
    mockUseCountReviewRequest.mockReset();
    mockUseFindUniqueUser.mockReset();

    currentSession = { user: { id: "user-1", access: "USER" } };
    currentSessionStatus = "authenticated";

    mockUseReviewFeatureEnabled.mockReturnValue({
      enabled: true,
      isLoading: false,
    });

    mockUseFindUniqueUser.mockReturnValue({
      data: {
        roleId: 7,
        projectPermissions: [{ roleId: 12, accessType: "SPECIFIC_ROLE" }],
      },
    });

    mockUseFindManyReviewRequest.mockImplementation((args: any) => ({
      data: applyHookFilter(args),
      isLoading: false,
    }));

    mockUseCountReviewRequest.mockImplementation((args: any) => ({
      data: applyHookFilter(args).length,
    }));
  });

  it("(a) renders the page chrome — title, Pending/Decided tabs, both filter dropdowns", () => {
    render(<ReviewsInboxPage />);
    expect(screen.getByTestId("reviews-inbox-page")).toBeInTheDocument();
    expect(screen.getByTestId("reviews-inbox-page-title")).toBeInTheDocument();
    expect(screen.getByTestId("reviews-inbox-tab-pending")).toBeInTheDocument();
    expect(screen.getByTestId("reviews-inbox-tab-decided")).toBeInTheDocument();
    expect(
      screen.getByTestId("reviews-inbox-entity-type-filter")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("reviews-inbox-project-filter")
    ).toBeInTheDocument();
  });

  it("(b) renders one row per ReviewRequest returned by the hook (default Pending tab)", () => {
    render(<ReviewsInboxPage />);
    const rows = screen.getAllByTestId("reviews-inbox-row");
    expect(rows).toHaveLength(3);
  });

  it("(c) Pending tab where-clause carries status=PENDING, isDeleted=false, and the assignee OR clause", () => {
    render(<ReviewsInboxPage />);
    expect(mockUseFindManyReviewRequest).toHaveBeenCalled();
    const args = mockUseFindManyReviewRequest.mock.calls[0]![0] as {
      where?: { AND?: Array<Record<string, unknown>> };
    };
    const conditions = args.where?.AND ?? [];
    expect(conditions.some((c: any) => c.status === "PENDING")).toBe(true);
    expect(conditions.some((c: any) => c.isDeleted === false)).toBe(true);
    expect(
      conditions.some(
        (c: any) =>
          Array.isArray(c.OR) &&
          c.OR.some((sub: any) => sub.assigneeUserId === "user-1")
      )
    ).toBe(true);
  });

  it("(c1) Pending tab also scopes in reviews the viewer requested — the queue is everything still awaiting a decision, not just what's parked with the viewer", () => {
    render(<ReviewsInboxPage />);
    const args = mockUseFindManyReviewRequest.mock.calls[0]![0] as {
      where?: { AND?: Array<Record<string, unknown>> };
    };
    const conditions = args.where?.AND ?? [];
    const orClause = conditions.find((c: any) => Array.isArray(c.OR)) as
      { OR: Array<Record<string, unknown>> } | undefined;
    expect(orClause).toBeDefined();
    expect(
      orClause!.OR.some((sub: any) => sub.requestedByUserId === "user-1")
    ).toBe(true);
    // Still one OR — the requester branch widens the existing scope rather
    // than stacking a second, contradictory condition.
    expect(conditions.filter((c: any) => Array.isArray(c.OR))).toHaveLength(1);
  });

  it("(c1b) the viewer's identity and role memberships reach the columns so each row can pick its own action set", () => {
    render(<ReviewsInboxPage />);
    const args = mockUseColumns.mock.calls[
      mockUseColumns.mock.calls.length - 1
    ]![0] as {
      viewerUserId?: string;
      viewerRoleIds?: number[];
      actions?: Record<string, unknown>;
    };
    expect(args.viewerUserId).toBe("user-1");
    expect(Array.isArray(args.viewerRoleIds)).toBe(true);
    // Requester-side handlers ride alongside the reviewer's three.
    expect(typeof args.actions?.onCancel).toBe("function");
    expect(typeof args.actions?.onNudged).toBe("function");
  });

  it("(c2) Decided tab where-clause swaps to (decidedByUserId OR requestedByUserId) + status IN [APPROVED, CHANGES_REQUESTED, REJECTED]", async () => {
    const user = userEvent.setup();
    render(<ReviewsInboxPage />);
    // Switch to the Decided tab — Radix Tabs needs userEvent-style
    // pointer events to register the value change in jsdom.
    await user.click(screen.getByTestId("reviews-inbox-tab-decided"));

    // Re-read the most recent hook call after the state update propagates.
    const lastCall =
      mockUseFindManyReviewRequest.mock.calls[
        mockUseFindManyReviewRequest.mock.calls.length - 1
      ]!;
    const args = lastCall[0] as {
      where?: { AND?: Array<Record<string, unknown>> };
    };
    const conditions = args.where?.AND ?? [];
    // Decisions I made OR decisions on reviews I requested.
    expect(
      conditions.some(
        (c: any) =>
          Array.isArray(c.OR) &&
          c.OR.some((sub: any) => sub.decidedByUserId === "user-1") &&
          c.OR.some((sub: any) => sub.requestedByUserId === "user-1")
      )
    ).toBe(true);
    expect(
      conditions.some(
        (c: any) =>
          c.status &&
          typeof c.status === "object" &&
          Array.isArray(c.status.in) &&
          c.status.in.includes("APPROVED") &&
          c.status.in.includes("CHANGES_REQUESTED") &&
          c.status.in.includes("REJECTED")
      )
    ).toBe(true);
    // The Pending-only `OR: [assigneeUserId, assigneeRoleId in ...]` clause
    // must NOT appear on the Decided tab — that would double-count rows.
    expect(
      conditions.some(
        (c: any) =>
          Array.isArray(c.OR) &&
          c.OR.some((sub: any) => sub.assigneeUserId !== undefined)
      )
    ).toBe(false);
  });

  it("(c3) status filter renders only on the Decided tab", async () => {
    const user = userEvent.setup();
    render(<ReviewsInboxPage />);
    // Pending tab (default) — every row is PENDING, so no status filter.
    expect(
      screen.queryByTestId("reviews-inbox-status-filter")
    ).not.toBeInTheDocument();

    await user.click(screen.getByTestId("reviews-inbox-tab-decided"));
    expect(
      screen.getByTestId("reviews-inbox-status-filter")
    ).toBeInTheDocument();
  });

  it("(c4) status filter narrows the Decided where-clause to the chosen outcome", async () => {
    const user = userEvent.setup();
    render(<ReviewsInboxPage />);
    await user.click(screen.getByTestId("reviews-inbox-tab-decided"));

    const filter = await getFilterSelect("reviews-inbox-status-filter");
    fireEvent.change(filter, { target: { value: "REJECTED" } });

    const lastCall =
      mockUseFindManyReviewRequest.mock.calls[
        mockUseFindManyReviewRequest.mock.calls.length - 1
      ]!;
    const args = lastCall[0] as {
      where?: { AND?: Array<Record<string, unknown>> };
    };
    const conditions = args.where?.AND ?? [];
    // The broad three-status IN clause is replaced (not stacked) by the
    // selection.
    const statusConditions = conditions.filter((c: any) => c.status);
    expect(statusConditions).toHaveLength(1);
    expect((statusConditions[0] as any).status).toEqual({
      in: ["REJECTED"],
    });

    // Back to "all" restores the three-status IN clause.
    fireEvent.change(filter, { target: { value: "all" } });
    const resetCall =
      mockUseFindManyReviewRequest.mock.calls[
        mockUseFindManyReviewRequest.mock.calls.length - 1
      ]!;
    const resetConditions =
      (resetCall[0] as { where?: { AND?: Array<Record<string, unknown>> } })
        .where?.AND ?? [];
    expect(
      resetConditions.some(
        (c: any) =>
          c.status &&
          typeof c.status === "object" &&
          Array.isArray(c.status.in) &&
          c.status.in.length === 3
      )
    ).toBe(true);
  });

  it("(c5) requester filter renders on both tabs and narrows the where-clause", async () => {
    const user = userEvent.setup();
    render(<ReviewsInboxPage />);

    // Pending tab — filter present, selection lands in the where clause.
    const pendingFilter = await getFilterSelect(
      "reviews-inbox-requester-filter"
    );
    fireEvent.change(pendingFilter, { target: { value: "user-2" } });
    let lastCall =
      mockUseFindManyReviewRequest.mock.calls[
        mockUseFindManyReviewRequest.mock.calls.length - 1
      ]!;
    let conditions =
      (lastCall[0] as { where?: { AND?: Array<Record<string, unknown>> } })
        .where?.AND ?? [];
    expect(
      conditions.some((c: any) => c.requestedByUserId?.in?.includes("user-2"))
    ).toBe(true);

    // Still present — and still applied — on the Decided tab.
    await user.click(screen.getByTestId("reviews-inbox-tab-decided"));
    expect(
      screen.getByTestId("reviews-inbox-requester-filter")
    ).toBeInTheDocument();
    lastCall =
      mockUseFindManyReviewRequest.mock.calls[
        mockUseFindManyReviewRequest.mock.calls.length - 1
      ]!;
    conditions =
      (lastCall[0] as { where?: { AND?: Array<Record<string, unknown>> } })
        .where?.AND ?? [];
    expect(
      conditions.some((c: any) => c.requestedByUserId?.in?.includes("user-2"))
    ).toBe(true);
  });

  it("(c6) decided-by filter renders only on the Decided tab and narrows the where-clause", async () => {
    const user = userEvent.setup();
    render(<ReviewsInboxPage />);
    expect(
      screen.queryByTestId("reviews-inbox-decided-by-filter")
    ).not.toBeInTheDocument();

    await user.click(screen.getByTestId("reviews-inbox-tab-decided"));
    const filter = await getFilterSelect("reviews-inbox-decided-by-filter");
    fireEvent.change(filter, { target: { value: "user-3" } });

    const lastCall =
      mockUseFindManyReviewRequest.mock.calls[
        mockUseFindManyReviewRequest.mock.calls.length - 1
      ]!;
    const conditions =
      (lastCall[0] as { where?: { AND?: Array<Record<string, unknown>> } })
        .where?.AND ?? [];
    expect(
      conditions.some((c: any) => c.decidedByUserId?.in?.includes("user-3"))
    ).toBe(true);
  });

  it("(d) entity-type filter narrows results to CASE only", async () => {
    render(<ReviewsInboxPage />);
    const filter = await getFilterSelect("reviews-inbox-entity-type-filter");

    fireEvent.change(filter, { target: { value: "CASE" } });

    const rows = screen.getAllByTestId("reviews-inbox-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute("data-entity-type")).toBe("CASE");
  });

  it("(e) project filter narrows results to one project", async () => {
    render(<ReviewsInboxPage />);
    const filter = await getFilterSelect("reviews-inbox-project-filter");

    fireEvent.change(filter, { target: { value: "7" } });

    const rows = screen.getAllByTestId("reviews-inbox-row");
    // Only Alpha (projectId=7) rows: r1 (CASE) + r3 (SESSION)
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.getAttribute("data-project-id")).toBe("7");
    }
  });

  it("(g) when the feature flag is disabled, the page renders the disabled empty state and no rows", () => {
    mockUseReviewFeatureEnabled.mockReturnValue({
      enabled: false,
      isLoading: false,
    });
    render(<ReviewsInboxPage />);
    expect(screen.getByTestId("reviews-inbox-page")).toBeInTheDocument();
    expect(screen.queryAllByTestId("reviews-inbox-row")).toHaveLength(0);
    expect(
      screen.getByTestId("reviews-inbox-feature-disabled")
    ).toBeInTheDocument();
  });

  it("(h) unauthenticated user is redirected to /", () => {
    currentSession = null;
    currentSessionStatus = "unauthenticated";
    render(<ReviewsInboxPage />);
    expect(mockRouterPush).toHaveBeenCalledWith("/");
  });

  // Note: per render the page issues TWO reviewRequest.useFindMany calls —
  // the filter-options scope query first, then the rows query (the one
  // carrying orderBy + refetchOnWindowFocus). The last call is the rows
  // query.
  it("(i) rows query is called with refetchOnWindowFocus: true (RESEARCH Pitfall 4)", () => {
    render(<ReviewsInboxPage />);
    expect(mockUseFindManyReviewRequest).toHaveBeenCalled();
    const options = mockUseFindManyReviewRequest.mock.calls[
      mockUseFindManyReviewRequest.mock.calls.length - 1
    ]![1] as { refetchOnWindowFocus?: boolean } | undefined;
    expect(options?.refetchOnWindowFocus).toBe(true);
  });

  it("(j) Pending tab default orderBy is { createdAt: 'asc' } — oldest-first so the most-overdue floats up", () => {
    render(<ReviewsInboxPage />);
    const args = mockUseFindManyReviewRequest.mock.calls[
      mockUseFindManyReviewRequest.mock.calls.length - 1
    ]![0] as {
      orderBy?: { createdAt?: string };
    };
    expect(args.orderBy?.createdAt).toBe("asc");
  });

  it("(j2) Decided tab default orderBy flips to { decidedAt: 'desc' } — most-recent decision first", async () => {
    const user = userEvent.setup();
    render(<ReviewsInboxPage />);
    await user.click(screen.getByTestId("reviews-inbox-tab-decided"));

    const lastCall =
      mockUseFindManyReviewRequest.mock.calls[
        mockUseFindManyReviewRequest.mock.calls.length - 1
      ]!;
    const args = lastCall[0] as { orderBy?: { decidedAt?: string } };
    expect(args.orderBy?.decidedAt).toBe("desc");
  });

  // ───────────────────────────────────────────────────────────────────────
  // Docked case-details panel
  // ───────────────────────────────────────────────────────────────────────

  /** Two CASE rows in the same project so prev/next has somewhere to step. */
  const twoCaseRows = () =>
    mockUseFindManyReviewRequest.mockImplementation(() => ({
      data: [
        { ...allRows[0]!, id: "r1", entityId: 101 },
        { ...allRows[0]!, id: "r1b", entityId: 102 },
      ],
      isLoading: false,
    }));

  it("(k) no panel until a case is selected", () => {
    render(<ReviewsInboxPage />);
    expect(
      screen.queryByTestId("case-details-panel-stub")
    ).not.toBeInTheDocument();
  });

  it("(k2) clicking a case name pushes the case + project params instead of navigating to the case page", () => {
    render(<ReviewsInboxPage />);
    const args = mockUseColumns.mock.calls[0]![0] as {
      onOpenCase: (caseId: number, projectId: number) => void;
    };
    args.onOpenCase(101, 7);
    expect(mockRouterPush).toHaveBeenCalledWith(
      "/reviews?case=101&caseProject=7",
      { scroll: false }
    );
  });

  it("(k3) the `case` + `caseProject` params render the panel for that case", () => {
    currentSearchParams = "case=101&caseProject=7";
    render(<ReviewsInboxPage />);
    const panel = screen.getByTestId("case-details-panel-stub");
    expect(panel).toHaveAttribute("data-case-id", "101");
    expect(panel).toHaveAttribute("data-project-id", "7");
  });

  it("(k4) the case id alone doesn't open the panel — the inbox spans projects, so both params are required", () => {
    currentSearchParams = "case=101";
    render(<ReviewsInboxPage />);
    expect(
      screen.queryByTestId("case-details-panel-stub")
    ).not.toBeInTheDocument();
  });

  it("(k5) prev/next step through the CASE rows only, skipping RUN and SESSION rows", async () => {
    const user = userEvent.setup();
    twoCaseRows();
    currentSearchParams = "case=101&caseProject=7";
    render(<ReviewsInboxPage />);

    const panel = screen.getByTestId("case-details-panel-stub");
    expect(panel).toHaveAttribute("data-position", "1");
    expect(panel).toHaveAttribute("data-total", "2");
    expect(panel).toHaveAttribute("data-has-prev", "false");
    expect(panel).toHaveAttribute("data-has-next", "true");

    // replace, not push, so stepping doesn't stack history entries.
    await user.click(screen.getByTestId("stub-next"));
    expect(mockRouterReplace).toHaveBeenCalledWith(
      "/reviews?case=102&caseProject=7",
      { scroll: false }
    );
  });

  it("(k6) a case that isn't in the current list still opens, but without a position", () => {
    currentSearchParams = "case=999&caseProject=7";
    render(<ReviewsInboxPage />);
    const panel = screen.getByTestId("case-details-panel-stub");
    expect(panel).toHaveAttribute("data-position", "null");
    expect(panel).toHaveAttribute("data-has-prev", "false");
    expect(panel).toHaveAttribute("data-has-next", "false");
  });

  it("(k7) closing clears both params", async () => {
    const user = userEvent.setup();
    currentSearchParams = "case=101&caseProject=7";
    render(<ReviewsInboxPage />);
    await user.click(screen.getByTestId("stub-close"));
    expect(mockRouterReplace).toHaveBeenCalledWith("/reviews", {
      scroll: false,
    });
  });
});
