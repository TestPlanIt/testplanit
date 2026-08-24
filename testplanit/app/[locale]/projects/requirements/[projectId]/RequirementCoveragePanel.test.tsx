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

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${Object.values(params).join("·")}` : key,
  // DateFormatter's own dependency -- this panel renders it for the
  // executed-at cell, so its seam needs a value here too.
  useLocale: () => "en-US",
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null }),
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
  direct: true,
};

describe("RequirementCoveragePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("renders the empty state for a requirement with no covering cases", async () => {
    stubFetch({ cases: [] });

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("panelEmpty")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("loading-spinner")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("surfaces the cross-project case count when the rollup reports one", async () => {
    stubFetch({
      cases: [baseCase],
      coverage: { "42": { crossProjectCaseCount: 2 } },
    });

    const { unmount } = renderPanel();

    await waitFor(() => {
      expect(
        screen.getByTestId("requirement-coverage-cross-project-count")
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("requirement-coverage-cross-project-count")
    ).toHaveTextContent("+2");
    unmount();

    stubFetch({
      cases: [baseCase],
      coverage: { "42": { crossProjectCaseCount: 0 } },
    });

    renderPanel();

    await waitFor(() => {
      expect(
        screen.getByTestId("requirement-covering-case-1")
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("requirement-coverage-cross-project-count")
    ).not.toBeInTheDocument();
  });
});
