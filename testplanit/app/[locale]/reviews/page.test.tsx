import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockRouterPush = vi.fn();
vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
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
];

const mockUseFindManyReviewRequest = vi.fn();
const mockUseCountReviewRequest = vi.fn();
const mockUseFindUniqueUser = vi.fn();
const mockUseFindManyProjects = vi.fn();
vi.mock("~/lib/hooks", () => ({
  useFindManyReviewRequest: (...args: unknown[]) =>
    mockUseFindManyReviewRequest(...args),
  useCountReviewRequest: (...args: unknown[]) =>
    mockUseCountReviewRequest(...args),
  useFindUniqueUser: (...args: unknown[]) => mockUseFindUniqueUser(...args),
  useFindManyProjects: (...args: unknown[]) => mockUseFindManyProjects(...args),
}));

function applyHookFilter(args: any): MockReviewRow[] {
  const where = args?.where ?? {};
  const conditions = where.AND ?? [];
  let rows = allRows.slice();
  for (const cond of conditions) {
    if (cond.entityType) {
      rows = rows.filter((r) => r.entityType === cond.entityType);
    }
    if (cond.projectId) {
      rows = rows.filter((r) => r.projectId === cond.projectId);
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
    mockUseReviewFeatureEnabled.mockReset();
    mockUseFindManyReviewRequest.mockReset();
    mockUseCountReviewRequest.mockReset();
    mockUseFindUniqueUser.mockReset();
    mockUseFindManyProjects.mockReset();

    currentSession = { user: { id: "user-1", access: "USER" } };
    currentSessionStatus = "authenticated";

    mockUseReviewFeatureEnabled.mockReturnValue({
      enabled: true,
      isLoading: false,
    });

    mockUseFindUniqueUser.mockReturnValue({
      data: {
        roleId: 7,
        projectPermissions: [
          { roleId: 12, accessType: "SPECIFIC_ROLE" },
        ],
      },
    });

    mockUseFindManyProjects.mockReturnValue({
      data: [
        { id: 7, name: "Alpha" },
        { id: 8, name: "Beta" },
      ],
    });

    mockUseFindManyReviewRequest.mockImplementation((args: any) => ({
      data: applyHookFilter(args),
      isLoading: false,
    }));

    mockUseCountReviewRequest.mockImplementation((args: any) => ({
      data: applyHookFilter(args).length,
    }));
  });

  it("(a) renders the page chrome with title and both filter dropdowns", () => {
    render(<ReviewsInboxPage />);
    expect(screen.getByTestId("reviews-inbox-page")).toBeInTheDocument();
    expect(
      screen.getByTestId("reviews-inbox-entity-type-filter"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("reviews-inbox-project-filter"),
    ).toBeInTheDocument();
  });

  it("(b) renders rows from the mocked data (one row per ReviewRequest)", () => {
    render(<ReviewsInboxPage />);
    const rows = screen.getAllByTestId("reviews-inbox-row");
    expect(rows).toHaveLength(3);
  });

  it("(c) PENDING status filter is shipped to useFindManyReviewRequest (assert call args)", () => {
    render(<ReviewsInboxPage />);
    expect(mockUseFindManyReviewRequest).toHaveBeenCalled();
    const args = mockUseFindManyReviewRequest.mock.calls[0]![0] as {
      where?: { AND?: Array<Record<string, unknown>> };
    };
    const conditions = args.where?.AND ?? [];
    const hasPending = conditions.some(
      (c: any) => c.status === "PENDING",
    );
    expect(hasPending).toBe(true);
    // isDeleted: false also required
    const hasIsDeletedFalse = conditions.some(
      (c: any) => c.isDeleted === false,
    );
    expect(hasIsDeletedFalse).toBe(true);
    // OR clause on assignee / role
    const hasAssigneeOr = conditions.some(
      (c: any) =>
        Array.isArray(c.OR) &&
        c.OR.some((sub: any) => sub.assigneeUserId === "user-1"),
    );
    expect(hasAssigneeOr).toBe(true);
  });

  it("(d) entity-type filter narrows results to CASE only", () => {
    render(<ReviewsInboxPage />);
    const filter = screen.getByTestId(
      "reviews-inbox-entity-type-filter",
    ) as HTMLSelectElement;

    fireEvent.change(filter, { target: { value: "CASE" } });

    const rows = screen.getAllByTestId("reviews-inbox-row");
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByTestId("reviews-inbox-row-entity-type"))
      .toHaveTextContent(/CASE/i);
  });

  it("(e) project filter narrows results to one project", () => {
    render(<ReviewsInboxPage />);
    const filter = screen.getByTestId(
      "reviews-inbox-project-filter",
    ) as HTMLSelectElement;

    fireEvent.change(filter, { target: { value: "7" } });

    const rows = screen.getAllByTestId("reviews-inbox-row");
    // Only Alpha (projectId=7) rows: r1 (CASE) + r3 (SESSION)
    expect(rows).toHaveLength(2);
  });

  it("(f) clicking a CASE row deep-links to /projects/repository/{projectId}/{entityId}", () => {
    render(<ReviewsInboxPage />);
    const rows = screen.getAllByTestId("reviews-inbox-row");
    const caseRow = rows.find((r) =>
      r.getAttribute("data-entity-type") === "CASE",
    );
    expect(caseRow).toBeDefined();
    // Row wraps in a Link (mock anchor) — assert the href
    const anchor =
      caseRow!.tagName === "A"
        ? caseRow!
        : caseRow!.querySelector("a[data-mock-link]");
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute("href")).toBe(
      "/projects/repository/7/101",
    );
  });

  it("(f2) RUN row deep-links to /projects/runs/{projectId}/{entityId}", () => {
    render(<ReviewsInboxPage />);
    const rows = screen.getAllByTestId("reviews-inbox-row");
    const runRow = rows.find(
      (r) => r.getAttribute("data-entity-type") === "RUN",
    );
    expect(runRow).toBeDefined();
    const anchor =
      runRow!.tagName === "A"
        ? runRow!
        : runRow!.querySelector("a[data-mock-link]");
    expect(anchor!.getAttribute("href")).toBe("/projects/runs/8/202");
  });

  it("(f3) SESSION row deep-links to /projects/sessions/{projectId}/{entityId}", () => {
    render(<ReviewsInboxPage />);
    const rows = screen.getAllByTestId("reviews-inbox-row");
    const sessionRow = rows.find(
      (r) => r.getAttribute("data-entity-type") === "SESSION",
    );
    expect(sessionRow).toBeDefined();
    const anchor =
      sessionRow!.tagName === "A"
        ? sessionRow!
        : sessionRow!.querySelector("a[data-mock-link]");
    expect(anchor!.getAttribute("href")).toBe(
      "/projects/sessions/7/303",
    );
  });

  it("(g) when feature flag is disabled at system level, page chrome renders an empty state (no rows)", () => {
    mockUseReviewFeatureEnabled.mockReturnValue({
      enabled: false,
      isLoading: false,
    });
    render(<ReviewsInboxPage />);
    expect(screen.getByTestId("reviews-inbox-page")).toBeInTheDocument();
    expect(
      screen.queryAllByTestId("reviews-inbox-row"),
    ).toHaveLength(0);
    expect(
      screen.getByTestId("reviews-inbox-feature-disabled"),
    ).toBeInTheDocument();
  });

  it("(h) unauthenticated user is redirected to /", () => {
    currentSession = null;
    currentSessionStatus = "unauthenticated";
    render(<ReviewsInboxPage />);
    expect(mockRouterPush).toHaveBeenCalledWith("/");
  });

  it("(i) hook is called with refetchOnWindowFocus: true (RESEARCH Pitfall 4)", () => {
    render(<ReviewsInboxPage />);
    expect(mockUseFindManyReviewRequest).toHaveBeenCalled();
    const options = mockUseFindManyReviewRequest.mock.calls[0]![1] as
      | { refetchOnWindowFocus?: boolean }
      | undefined;
    expect(options?.refetchOnWindowFocus).toBe(true);
  });

  it("(j) orderBy is { createdAt: 'desc' } (REVIEWER-01: newest first)", () => {
    render(<ReviewsInboxPage />);
    const args = mockUseFindManyReviewRequest.mock.calls[0]![0] as {
      orderBy?: { createdAt?: string };
    };
    expect(args.orderBy?.createdAt).toBe("desc");
  });
});
