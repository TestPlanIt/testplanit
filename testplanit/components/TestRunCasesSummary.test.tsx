import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestRunCasesSummary } from "./TestRunCasesSummary";
import type { TestRunSummaryData } from "~/lib/services/testRunSummary-shared";

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));
vi.mock("~/lib/basePath", () => ({ apiFetch: mockApiFetch }));

// The global test stub renders no tooltip content at all. Render it inline
// here so a segment's tooltip text can be asserted without hovering.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div role="tooltip">{children}</div>
  ),
}));

function tooltipFor(caseName: string) {
  const tooltip = screen
    .getAllByRole("tooltip")
    .find((el) => el.textContent?.includes(caseName));
  expect(tooltip).toBeDefined();
  return tooltip!;
}

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  useLocale: () => "en-US",
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null }),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "10" }),
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    status: {
      useFindFirst: () => ({
        data: { id: 1, name: "Untested", order: 0, color: { value: "#ccc" } },
      }),
    },
  }),
}));

vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/tables/IssuesListDisplay", () => ({
  IssuesListDisplay: () => null,
}));

// A manual run with two cases nobody has executed. Their status is null, so
// the server has no status name to show; the component picks the label from
// the run's completion state.
function unexecutedSummary(isCompleted: boolean): TestRunSummaryData {
  return {
    testRunType: "REGULAR",
    isCompleted,
    totalCases: 2,
    statusCounts: [
      {
        statusId: null,
        statusName: isCompleted ? "Untested" : "Pending",
        colorValue: "#9ca3af",
        count: 2,
      },
    ],
    completionRate: 0,
    totalElapsed: 0,
    totalEstimate: 0,
    commentsCount: 0,
    issues: [],
    caseDetails: [1, 2].map((id) => ({
      id,
      repositoryCaseId: id,
      testRunId: 5,
      configurationName: null,
      caseName: `Case ${id}`,
      statusId: null,
      statusName: isCompleted ? "Untested" : "Pending",
      colorValue: "#9ca3af",
      estimate: null,
      isPending: true,
    })),
  };
}

// A pure automated run: its counts come from JUnit results, each tagged with
// a result type, so the unexecuted label never applies there.
function automatedSummary(): TestRunSummaryData {
  return {
    testRunType: "JUNIT",
    isCompleted: true,
    totalCases: 3,
    statusCounts: [
      {
        statusId: 1,
        statusName: "Passed",
        colorValue: "#0f0",
        count: 2,
        resultType: "PASSED",
      },
      {
        statusId: 2,
        statusName: "Failed",
        colorValue: "#f00",
        count: 1,
        resultType: "FAILURE",
      },
    ],
    completionRate: 100,
    totalElapsed: 12,
    totalEstimate: 0,
    commentsCount: 0,
    issues: [],
    junitSummary: {
      totalTests: 3,
      totalFailures: 1,
      totalErrors: 0,
      totalSkipped: 0,
      totalQuarantined: 0,
      totalTime: 12,
      resultSegments: [
        {
          id: "passed",
          statusName: "Passed",
          statusColor: "#0f0",
          resultType: "PASSED",
          count: 2,
          isAggregate: true,
        },
        {
          id: "failed",
          statusName: "Failed",
          statusColor: "#f00",
          resultType: "FAILURE",
          count: 1,
          isAggregate: true,
        },
      ],
    },
  };
}

describe("TestRunCasesSummary never-executed cases", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it("counts them as Pending while the run is open", () => {
    renderWithQueryClient(
      <TestRunCasesSummary
        testRunId={5}
        projectId={10}
        summaryData={unexecutedSummary(false)}
      />
    );

    expect(screen.getByText(/2 status\.pending/)).toBeInTheDocument();
    expect(screen.queryByText(/labels\.untested/)).not.toBeInTheDocument();
  });

  it("counts them as Untested once the run is completed", () => {
    renderWithQueryClient(
      <TestRunCasesSummary
        testRunId={5}
        projectId={10}
        summaryData={unexecutedSummary(true)}
      />
    );

    expect(screen.getByText(/2 labels\.untested/)).toBeInTheDocument();
    expect(screen.queryByText(/status\.pending/)).not.toBeInTheDocument();
  });

  it("labels an unexecuted segment's tooltip Untested on a completed run", () => {
    renderWithQueryClient(
      <TestRunCasesSummary
        testRunId={5}
        projectId={10}
        summaryData={unexecutedSummary(true)}
      />
    );

    const tooltip = tooltipFor("Case 1");
    // Header and the clock line under it both carry the label.
    expect(tooltip.textContent?.match(/labels\.untested/g)).toHaveLength(2);
    expect(tooltip.textContent).not.toContain("status.pending");
  });

  it("labels an unexecuted segment's tooltip Pending on an open run", () => {
    renderWithQueryClient(
      <TestRunCasesSummary
        testRunId={5}
        projectId={10}
        summaryData={unexecutedSummary(false)}
      />
    );

    const tooltip = tooltipFor("Case 2");
    expect(tooltip.textContent?.match(/status\.pending/g)).toHaveLength(2);
    expect(tooltip.textContent).not.toContain("labels.untested");
  });

  it("keeps real status names on an automated run", () => {
    renderWithQueryClient(
      <TestRunCasesSummary
        testRunId={5}
        projectId={10}
        summaryData={automatedSummary()}
      />
    );

    expect(screen.getByText(/2 Passed, 1 Failed/)).toBeInTheDocument();
    expect(screen.queryByText(/labels\.untested/)).not.toBeInTheDocument();
    expect(screen.queryByText(/status\.pending/)).not.toBeInTheDocument();
  });
});

// A multi-configuration run fetches one summary per configuration and merges
// them. Unexecuted cases of every configuration share one bucket, and the
// merged run only counts as completed when every configuration is.
describe("TestRunCasesSummary multi-configuration aggregation", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  function mockSummariesById(byId: Record<number, TestRunSummaryData>) {
    mockApiFetch.mockImplementation(async (url: string) => {
      const id = Number(url.match(/test-runs\/(\d+)\/summary/)?.[1]);
      return { ok: true, json: async () => byId[id] };
    });
  }

  it("merges the unexecuted buckets and reads Untested when every configuration is completed", async () => {
    mockSummariesById({
      5: unexecutedSummary(true),
      6: unexecutedSummary(true),
    });

    renderWithQueryClient(
      <TestRunCasesSummary testRunId={5} testRunIds={[5, 6]} projectId={10} />
    );

    expect(
      await screen.findByText(/labels\.total: 4 .*\(4 labels\.untested\)/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/status\.pending/)).not.toBeInTheDocument();
  });

  it("reads Pending while any configuration is still open", async () => {
    mockSummariesById({
      5: unexecutedSummary(true),
      6: unexecutedSummary(false),
    });

    renderWithQueryClient(
      <TestRunCasesSummary testRunId={5} testRunIds={[5, 6]} projectId={10} />
    );

    expect(
      await screen.findByText(/labels\.total: 4 .*\(4 status\.pending\)/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/labels\.untested/)).not.toBeInTheDocument();
  });
});
