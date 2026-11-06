import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
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

describe("TestRunCasesSummary never-executed cases", () => {
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
});
