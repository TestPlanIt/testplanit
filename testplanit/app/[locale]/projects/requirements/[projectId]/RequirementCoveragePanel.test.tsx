// Converted from the Wave 0 title scaffold (COV-02, ROADMAP criterion 2).
// See RequirementCoveragePanel.tsx's own header comment for why this panel
// stays separate from LinkedRequirementCasesPanel.
//
// Neither `useRequirementCoveringCases` nor `useRequirementCoverage` -- the
// panel's own data seams -- is mocked anywhere in this file. Every test
// renders through a real `QueryClientProvider` against a stubbed
// `global.fetch`, mirroring MemberIssuesOverflowPanel.test.tsx's own
// convention for a hand-written useQuery hook. This is deliberate: mocking
// the hook itself would make the "empty, not loading" distinction (test 5)
// unprovable, since a canned `{ data: [], isLoading: false }` return value
// proves nothing about whether the component actually distinguishes those
// two states once real data resolves.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The panel virtualizes its rows, and jsdom gives every element a zero
// height -- a real `useVirtualizer` against a zero-height scroll container
// mounts nothing, which would make every assertion below fail for a reason
// that has nothing to do with the panel. Stubbed the same way
// components/matrix/MatrixGrid.test.tsx stubs it: a deterministic window of
// the first N rows, so "is this row rendered" stays testable AND the cap is
// itself observable (the last test asserts a long list is windowed rather
// than mounted whole).
const VIRTUALIZER_RENDER_CAP = 20;
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({
    count,
    estimateSize,
  }: {
    count: number;
    estimateSize: () => number;
  }) => {
    const size = estimateSize();
    const visibleCount = Math.min(count, VIRTUALIZER_RENDER_CAP);
    const items = Array.from({ length: visibleCount }, (_, i) => ({
      index: i,
      key: i,
      start: i * size,
      size,
      end: (i + 1) * size,
      lane: 0,
    }));
    return {
      getVirtualItems: () => items,
      getTotalSize: () => count * size,
    };
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${Object.values(params).join("·")}` : key,
  // DateFormatter's own dependency -- this panel renders it for the
  // executed-at cell, so its seam needs a value here too.
  useLocale: () => "en-US",
}));

// Mutable so one test can prove the executed-at cell formats against the
// viewer's own preferences rather than a hardcoded format; every other test
// runs on the no-preference default the reset in `beforeEach` restores.
const mockSession = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: mockSession.current }),
}));

vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/ProjectIcon", () => ({
  ProjectIcon: () => <span data-testid="project-icon" />,
}));

// Same mock ProjectNameDisplay.test.tsx already established for this exact
// primitive -- avoids depending on a `TooltipProvider` ancestor Radix
// requires and this panel's own mount site does not supply in isolation.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <span>{children}</span>,
  TooltipContent: ({ children }: any) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

import { RequirementCoveragePanel } from "./RequirementCoveragePanel";

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

interface CoveringCaseFixture {
  caseId: number;
  caseName: string;
  projectId: number;
  projectName: string;
  lastStatusName: string | null;
  lastStatusColor: string | null;
  lastStatusIsSuccess: boolean | null;
  lastStatusIsFailure: boolean | null;
  lastExecutedAt: string | null;
  lastTestRunId: number | null;
  direct: boolean;
}

function stubFetch(opts: {
  cases?: CoveringCaseFixture[];
  coverage?: Record<string, { crossProjectCaseCount: number }>;
}) {
  const { cases = [], coverage = {} } = opts;
  global.fetch = vi.fn(async (url: string) => {
    if (url.includes("/covering-cases")) {
      return jsonResponse({ requirementId: 42, cases });
    }
    if (url.includes("/requirements/coverage")) {
      return jsonResponse({ coverage });
    }
    return jsonResponse({});
  }) as any;
}

function renderPanel(projectId = "7", requirementId = 42) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RequirementCoveragePanel
        projectId={projectId}
        requirementId={requirementId}
      />
    </QueryClientProvider>
  );
}

const baseCase: CoveringCaseFixture = {
  caseId: 1,
  caseName: "Case A",
  projectId: 7,
  projectName: "Current Project",
  lastStatusName: "Passed",
  lastStatusColor: "#00aa00",
  lastStatusIsSuccess: true,
  lastStatusIsFailure: false,
  lastExecutedAt: "2026-01-01T00:00:00.000Z",
  lastTestRunId: 55,
  direct: true,
};

describe("RequirementCoveragePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.current = null;
  });

  it("lists every covering case with its latest result", async () => {
    stubFetch({
      cases: [
        {
          ...baseCase,
          caseId: 1,
          caseName: "Case A",
          lastStatusName: "Passed",
        },
        {
          ...baseCase,
          caseId: 2,
          caseName: "Case B",
          lastStatusName: "Failed",
          lastStatusColor: "#ff0000",
          lastStatusIsSuccess: false,
          lastStatusIsFailure: true,
        },
        {
          ...baseCase,
          caseId: 3,
          caseName: "Case C",
          lastStatusName: "In Progress",
          lastStatusColor: "#0000ff",
          lastStatusIsSuccess: false,
          lastStatusIsFailure: false,
        },
      ],
    });

    renderPanel();

    await waitFor(() => {
      expect(
        screen.getByTestId("requirement-covering-case-1")
      ).toBeInTheDocument();
    });

    const row1 = screen.getByTestId("requirement-covering-case-1");
    const row2 = screen.getByTestId("requirement-covering-case-2");
    const row3 = screen.getByTestId("requirement-covering-case-3");

    expect(row1).toHaveTextContent("Case A");
    expect(row1).toHaveTextContent("Passed");
    expect(row2).toHaveTextContent("Case B");
    expect(row2).toHaveTextContent("Failed");
    expect(row3).toHaveTextContent("Case C");
    expect(row3).toHaveTextContent("In Progress");
  });

  it("shows a not-run treatment for a covering case that has never executed", async () => {
    stubFetch({
      cases: [
        {
          ...baseCase,
          caseId: 1,
          caseName: "Failing case",
          lastStatusName: "Failed",
          lastStatusColor: "#ff0000",
          lastStatusIsSuccess: false,
          lastStatusIsFailure: true,
        },
        {
          ...baseCase,
          caseId: 2,
          caseName: "Never executed",
          lastStatusName: null,
          lastStatusColor: null,
          lastStatusIsSuccess: null,
          lastStatusIsFailure: null,
          lastExecutedAt: null,
          lastTestRunId: null,
        },
      ],
    });

    renderPanel();

    await waitFor(() => {
      expect(
        screen.getByTestId("requirement-covering-case-2")
      ).toBeInTheDocument();
    });

    const failedRow = screen.getByTestId("requirement-covering-case-1");
    const notRunRow = screen.getByTestId("requirement-covering-case-2");

    expect(notRunRow).toHaveTextContent("notRunCell");
    expect(notRunRow).not.toHaveTextContent("Failed");
    // Executed cell renders an em dash rather than a formatted date for the
    // never-executed row.
    expect(notRunRow).toHaveTextContent("—");

    const failedDot = failedRow.querySelector<HTMLDivElement>(".rounded-full");
    const notRunDot = notRunRow.querySelector<HTMLDivElement>(".rounded-full");
    expect(failedDot).not.toBeNull();
    expect(notRunDot).not.toBeNull();
    // Visually distinct: the failed case's own status color versus the
    // not-run treatment's default gray -- never the same swatch.
    expect(failedDot!.style.backgroundColor).not.toBe(
      notRunDot!.style.backgroundColor
    );
  });

  it("totals every listed case in its title, cross-project rows included", async () => {
    stubFetch({
      cases: [
        { ...baseCase, caseId: 1 },
        { ...baseCase, caseId: 2 },
        // Another project's case is listed like any other, so it counts
        // toward the title exactly like the two above.
        { ...baseCase, caseId: 3, projectId: 9, projectName: "Other Project" },
      ],
    });

    renderPanel();

    await waitFor(() => {
      expect(
        screen.getByTestId("requirement-covering-case-3")
      ).toBeInTheDocument();
    });

    expect(screen.getByTestId("requirement-coverage")).toHaveTextContent(
      "panelTitleWithCount:3"
    );
  });

  it("omits the count from its title while loading and when empty", async () => {
    // Never resolves: the panel is still in flight, so it has no total to
    // report and must not claim zero.
    global.fetch = vi.fn(() => new Promise(() => {})) as any;
    const { unmount } = renderPanel();
    expect(screen.getByTestId("requirement-coverage")).toHaveTextContent(
      "panelTitleWithCount:0"
    );
    unmount();

    // Loaded and genuinely empty routes to the same `=0` branch.
    stubFetch({ cases: [] });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("panelEmpty")).toBeInTheDocument();
    });
    expect(screen.getByTestId("requirement-coverage")).toHaveTextContent(
      "panelTitleWithCount:0"
    );
  });

  it("links a result to the run it was recorded against, and leaves a never-run case unlinked", async () => {
    stubFetch({
      cases: [
        // A cross-project case, so the link is proven to use the CASE's own
        // project rather than the requirement's -- a run lives in the same
        // project as the case that produced the result.
        {
          ...baseCase,
          caseId: 1,
          projectId: 9,
          lastTestRunId: 55,
        },
        {
          ...baseCase,
          caseId: 2,
          lastStatusName: null,
          lastExecutedAt: null,
          lastTestRunId: null,
        },
      ],
    });

    renderPanel();

    await waitFor(() => {
      expect(
        screen.getByTestId("requirement-covering-case-2")
      ).toBeInTheDocument();
    });

    // Same destination shape as the repository list's Latest Results squares,
    // `selectedCase` included, so the run opens focused on this case.
    expect(
      screen.getByTestId("requirement-covering-case-run-link-1")
    ).toHaveAttribute("href", "/projects/runs/9/55?selectedCase=1");

    // A case that has never been executed has no run to open: the status
    // still renders, but never as a link to a nonexistent run.
    expect(
      screen.queryByTestId("requirement-covering-case-run-link-2")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("requirement-covering-case-2")).toHaveTextContent(
      "notRunCell"
    );
  });

  it("renders executed-at in the viewer's preferred date and time format", async () => {
    // Stored exactly as the schema's `DateFormat`/`TimeFormat` enums hold
    // them -- `mapDateTimeFormatString` is what turns the pair into date-fns
    // tokens, so a raw token string here would prove nothing about the real
    // session shape.
    mockSession.current = {
      user: {
        preferences: {
          dateFormat: "DD_MM_YYYY_SLASH",
          timeFormat: "HH_MM",
          timezone: "Etc/UTC",
        },
      },
    };
    stubFetch({
      cases: [
        {
          ...baseCase,
          caseId: 1,
          lastExecutedAt: "2026-01-02T15:04:00.000Z",
        },
      ],
    });

    renderPanel();

    await waitFor(() => {
      expect(
        screen.getByTestId("requirement-covering-case-1")
      ).toBeInTheDocument();
    });

    // Day-first with a 24-hour time, per the preferences above -- never the
    // formatter's own "MM-dd-yyyy" default, which would read "01-02-2026"
    // and drop the time entirely.
    expect(screen.getByTestId("requirement-covering-case-1")).toHaveTextContent(
      "02/01/2026 15:04"
    );
  });

  it("marks an inherited case as inherited and offers no unlink affordance on it", async () => {
    stubFetch({
      cases: [
        { ...baseCase, caseId: 1, caseName: "Direct case", direct: true },
        { ...baseCase, caseId: 2, caseName: "Inherited case", direct: false },
      ],
    });

    renderPanel();

    await waitFor(() => {
      expect(
        screen.getByTestId("requirement-covering-case-2")
      ).toBeInTheDocument();
    });

    const directRow = screen.getByTestId("requirement-covering-case-1");
    const inheritedRow = screen.getByTestId("requirement-covering-case-2");

    expect(
      within(inheritedRow).getByTestId("requirement-covering-case-inherited-2")
    ).toBeInTheDocument();
    expect(
      within(directRow).queryByTestId("requirement-covering-case-inherited-1")
    ).toBeNull();

    // The absence, not just the marker: a read-only row offers no
    // interactive control of any kind, on either row -- there is nothing
    // here that could unlink, silently or otherwise.
    expect(within(inheritedRow).queryAllByRole("button")).toHaveLength(0);
    expect(within(directRow).queryAllByRole("button")).toHaveLength(0);
  });

  it("links a cross-project case into its own project, not the requirement's", async () => {
    stubFetch({
      cases: [
        {
          ...baseCase,
          caseId: 1,
          caseName: "Other project case",
          projectId: 9,
          projectName: "Other Project",
        },
      ],
    });

    // The panel is mounted for project 7's requirement.
    renderPanel("7", 42);

    await waitFor(() => {
      expect(
        screen.getByTestId("requirement-covering-case-1")
      ).toBeInTheDocument();
    });

    const row = screen.getByTestId("requirement-covering-case-1");
    const links = within(row).getAllByRole("link");
    const caseLink = links.find((l) =>
      l.getAttribute("href")?.startsWith("/projects/repository/9/")
    );
    const projectLink = links.find(
      (l) => l.getAttribute("href") === "/projects/overview/9"
    );

    expect(caseLink).toBeDefined();
    expect(projectLink).toBeDefined();
    // Neither href carries the requirement's own project id (7).
    expect(caseLink!.getAttribute("href")).not.toContain(
      "/projects/repository/7/"
    );
    expect(projectLink!.getAttribute("href")).not.toBe("/projects/overview/7");
  });

  // Operator decision 2026-08-25: the Project column is uniform -- a case in
  // the requirement's OWN project shows its project name too, instead of the
  // old cross-project-only badge that left same-project cells empty.
  it("shows the project name on a same-project row", async () => {
    stubFetch({ cases: [baseCase] });

    renderPanel("7", 42);

    await waitFor(() => {
      expect(
        screen.getByTestId("requirement-covering-case-1")
      ).toBeInTheDocument();
    });

    const row = screen.getByTestId("requirement-covering-case-1");
    const projectLink = within(row)
      .getAllByRole("link")
      .find((l) => l.getAttribute("href") === "/projects/overview/7");
    expect(projectLink).toBeDefined();
    expect(projectLink).toHaveTextContent("Current Project");
  });

  it("renders the empty state for a requirement with no covering cases", async () => {
    stubFetch({ cases: [] });

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("panelEmpty")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("loading-spinner")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  // F6: a failed fetch must never be indistinguishable from a genuine
  // zero. Before the fix, `useRequirementCoveringCases`'s errored query
  // still has `data === undefined`, so `rows = data?.cases ?? []` is empty
  // and the panel fell into the exact same branch as the true-empty test
  // above -- rendering "panelEmpty" for a fetch that never returned an
  // answer. This asserts the two states are NOT rendered the same way.
  it("renders a distinct error affordance -- never the empty-state copy -- when the covering-cases fetch fails", async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes("/covering-cases")) {
        return { ok: false, json: async () => ({}) } as Response;
      }
      if (url.includes("/requirements/coverage")) {
        return { ok: true, json: async () => ({ coverage: {} }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as any;

    renderPanel();

    await waitFor(() => {
      expect(
        screen.getByTestId("requirement-coverage-error")
      ).toBeInTheDocument();
    });

    // The failure copy renders...
    expect(screen.getByText("loadFailed")).toBeInTheDocument();
    // ...and the empty-state copy, which would falsely claim zero
    // covering cases, must NOT render alongside or instead of it.
    expect(screen.queryByText("panelEmpty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("loading-spinner")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("summarizes no cases away: a cross-project case is a listed row, never a header count", async () => {
    stubFetch({
      cases: [
        baseCase,
        { ...baseCase, caseId: 2, projectId: 9, projectName: "Other Project" },
      ],
      // The rollup still reports this total for the requirements list's own
      // +N affordance; this panel deliberately ignores it, because every
      // case it would stand for is already a row here.
      coverage: { "42": { crossProjectCaseCount: 1 } },
    });

    renderPanel();

    await waitFor(() => {
      expect(
        screen.getByTestId("requirement-covering-case-2")
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByTestId("requirement-coverage-cross-project-count")
    ).not.toBeInTheDocument();
    // The other project's case is reachable as a row, with its own project
    // named -- which is what makes the removed badge redundant rather than
    // lost information.
    expect(screen.getByTestId("requirement-covering-case-2")).toHaveTextContent(
      "Other Project"
    );
  });
  // The whole point of I8's fix: a root requirement's subtree can gather
  // thousands of covering cases, and the pane used to mount every one of
  // them on selection and again on every re-render.
  it("windows a large covering set instead of mounting every row", async () => {
    const many = Array.from({ length: 400 }, (_, i) => ({
      caseId: 1000 + i,
      caseName: `Case ${i}`,
      projectId: 7,
      projectName: "Project A",
      lastStatusName: "Passed",
      lastStatusColor: "#22c55e",
      lastStatusIsSuccess: true,
      lastStatusIsFailure: false,
      lastExecutedAt: "2026-03-01T10:00:00.000Z",
      lastTestRunId: 5,
      direct: true,
    }));
    stubFetch({ cases: many });
    renderPanel();

    // The first row mounts...
    await waitFor(() => {
      expect(
        screen.getByTestId("requirement-covering-case-1000")
      ).toBeInTheDocument();
    });

    // ...the rest of the set does not, and the count still tells the truth
    // about the whole set rather than about what happens to be mounted.
    const mounted = screen.getAllByTestId(/^requirement-covering-case-\d+$/);
    expect(mounted).toHaveLength(VIRTUALIZER_RENDER_CAP);
    expect(
      screen.queryByTestId("requirement-covering-case-1399")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("requirement-coverage")).toHaveTextContent("400");
  });
});
