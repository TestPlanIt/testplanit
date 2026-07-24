import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { PendingReviewsSummary } from "./PendingReviewsSummary";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

// ~/lib/navigation Link — required wrapper, NEVER next/link.
vi.mock("~/lib/navigation", () => ({
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

// Workflow-state pills render their icon through DynamicIcon, which resolves
// the lucide module asynchronously — stub it so state updates don't land
// outside act().
vi.mock("@/components/DynamicIcon", () => ({
  default: () => <span data-testid="dynamic-icon" />,
}));

// Entity side-fetches — the summary resolves polymorphic entity refs into
// names by type.
const mockUseFindManyRepositoryCases = vi.fn((..._args: unknown[]) => ({
  data: [] as unknown[],
}));
const mockUseFindManyTestRuns = vi.fn((..._args: unknown[]) => ({
  data: [] as unknown[],
}));
const mockUseFindManySessions = vi.fn((..._args: unknown[]) => ({
  data: [] as unknown[],
}));
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const state = (id: number, name: string) => ({
  id,
  name,
  icon: { name: "Circle" },
  color: { value: "#888888" },
});

function makeRequest(
  id: string,
  overrides: Partial<Record<string, unknown>> = {}
) {
  return {
    id,
    projectId: 7,
    entityType: "CASE",
    entityId: 101,
    requestedByUserId: "user-2",
    assigneeUserId: "user-1",
    assigneeRoleId: null,
    fromStateId: 1,
    toStateId: 2,
    status: "PENDING",
    isDeleted: false,
    createdAt: new Date("2026-07-20T10:00:00Z"),
    project: { id: 7, name: "Apollo" },
    requestedBy: { id: "user-2", name: "Dana" },
    fromState: state(1, "Draft"),
    toState: state(2, "Approved"),
    ...overrides,
  } as any;
}

function renderSummary(requests: any[]) {
  return render(
    <TooltipProvider>
      <PendingReviewsSummary requests={requests} />
    </TooltipProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("PendingReviewsSummary", () => {
  beforeEach(() => {
    mockUseFindManyRepositoryCases.mockClear();
    mockUseFindManyTestRuns.mockClear();
    mockUseFindManySessions.mockClear();
    mockUseFindManyRepositoryCases.mockReturnValue({ data: [] });
    mockUseFindManyTestRuns.mockReturnValue({ data: [] });
    mockUseFindManySessions.mockReturnValue({ data: [] });
  });

  it("renders nothing when the queue is empty", () => {
    const { container } = renderSummary([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one row per pending request with its project", () => {
    mockUseFindManyRepositoryCases.mockReturnValue({
      data: [{ id: 101, name: "Login smoke test", source: "MANUAL" }],
    });

    renderSummary([makeRequest("r1")]);

    expect(screen.getByTestId("dashboard-pending-reviews")).toBeInTheDocument();
    expect(
      screen.getByTestId("dashboard-pending-review-r1")
    ).toBeInTheDocument();
    expect(screen.getByText("Login smoke test")).toBeInTheDocument();
    expect(screen.getByText("Apollo")).toBeInTheDocument();
  });

  it("links each entity type to its own page", () => {
    mockUseFindManyRepositoryCases.mockReturnValue({
      data: [{ id: 101, name: "Login smoke test", source: "MANUAL" }],
    });
    mockUseFindManyTestRuns.mockReturnValue({
      data: [{ id: 202, name: "Regression run" }],
    });
    mockUseFindManySessions.mockReturnValue({
      data: [{ id: 303, name: "Exploratory sweep" }],
    });

    renderSummary([
      makeRequest("r1"),
      makeRequest("r2", { entityType: "RUN", entityId: 202 }),
      makeRequest("r3", { entityType: "SESSION", entityId: 303 }),
    ]);

    expect(screen.getByText("Login smoke test").closest("a")).toHaveAttribute(
      "href",
      "/projects/repository/7/101"
    );
    expect(screen.getByText("Regression run").closest("a")).toHaveAttribute(
      "href",
      "/projects/runs/7/202"
    );
    expect(screen.getByText("Exploratory sweep").closest("a")).toHaveAttribute(
      "href",
      "/projects/sessions/7/303"
    );
  });

  it("falls back to a TYPE #id label until the entity name lands", () => {
    renderSummary([makeRequest("r1")]);
    expect(screen.getByText("CASE #101")).toBeInTheDocument();
  });

  it("caps the visible rows and links the remainder to the inbox", () => {
    const requests = Array.from({ length: 8 }, (_, i) =>
      makeRequest(`r${i}`, { entityId: 100 + i })
    );

    renderSummary(requests);

    expect(screen.getAllByTestId(/^dashboard-pending-review-r/)).toHaveLength(
      5
    );
    const viewAll = screen.getByTestId("dashboard-pending-reviews-view-all");
    expect(viewAll).toHaveAttribute("href", "/reviews");
  });

  it("skips the entity side-fetches for types not in the visible rows", () => {
    renderSummary([makeRequest("r1")]);

    const runOpts = mockUseFindManyTestRuns.mock.calls[0]?.[1] as
      { enabled?: boolean } | undefined;
    const sessionOpts = mockUseFindManySessions.mock.calls[0]?.[1] as
      { enabled?: boolean } | undefined;
    const caseOpts = mockUseFindManyRepositoryCases.mock.calls[0]?.[1] as
      { enabled?: boolean } | undefined;

    expect(caseOpts?.enabled).toBe(true);
    expect(runOpts?.enabled).toBe(false);
    expect(sessionOpts?.enabled).toBe(false);
  });
});
