import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MilestoneSummary } from "./MilestoneSummary";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function renderWithQueryClient(ui: React.ReactElement) {
  const testQueryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={testQueryClient}>{ui}</QueryClientProvider>
  );
}

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mockFetch);

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  useLocale: () => "en-US",
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null }),
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    status: {
      useFindFirst: () => ({ data: null }),
    },
  }),
}));

vi.mock("~/zenstack/schema", () => ({ schema: {} }));

vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function baseSummary(overrides: Partial<any> = {}) {
  return {
    milestoneId: 42,
    totalItems: 1,
    completionRate: 50,
    totalElapsed: 0,
    totalEstimate: 0,
    commentsCount: 0,
    segments: [
      {
        id: "test-run-1-1-0",
        type: "test-run",
        sourceId: 1,
        sourceName: "Run 1",
        statusId: 1,
        statusName: "Passed",
        colorValue: "#0f0",
        elapsed: 0,
        estimate: 0,
        isPending: false,
        itemCount: 1,
        statusOrder: 1,
      },
    ],
    issues: [],
    scopeCount: 0,
    ...overrides,
  };
}

function mockSummaryFetch(payload: any) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => payload,
  });
}

describe("MilestoneSummary — paired issue count chips", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("renders both chips with their respective counts when scope and found-in-testing issues exist", async () => {
    mockSummaryFetch(
      baseSummary({
        scopeCount: 12,
        issues: [{ id: 1, name: "PROJ-1", title: "t", projectIds: [7] }],
      })
    );

    renderWithQueryClient(<MilestoneSummary milestoneId={42} projectId={7} />);

    await waitFor(() => {
      expect(
        screen.getByTestId("milestone-summary-scope-chip")
      ).toHaveTextContent("12");
    });
    expect(
      screen.getByTestId("milestone-summary-found-chip")
    ).toHaveTextContent("1");
  });

  it("renders chips as plain non-interactive text when no click handlers are passed (milestones LIST page)", async () => {
    mockSummaryFetch(
      baseSummary({
        scopeCount: 3,
        issues: [{ id: 1, name: "PROJ-1", title: "t", projectIds: [7] }],
      })
    );

    renderWithQueryClient(<MilestoneSummary milestoneId={42} projectId={7} />);

    await waitFor(() => {
      expect(
        screen.getByTestId("milestone-summary-scope-chip")
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId("milestone-summary-scope-chip").tagName).not.toBe(
      "BUTTON"
    );
    expect(screen.getByTestId("milestone-summary-found-chip").tagName).not.toBe(
      "BUTTON"
    );
  });

  it("renders clickable chips that invoke the detail-page callbacks without bubbling", async () => {
    mockSummaryFetch(
      baseSummary({
        scopeCount: 3,
        issues: [{ id: 1, name: "PROJ-1", title: "t", projectIds: [7] }],
      })
    );
    const onScopeChipClick = vi.fn();
    const onFoundInTestingChipClick = vi.fn();
    const onOuterClick = vi.fn();

    renderWithQueryClient(
      <div onClick={onOuterClick}>
        <MilestoneSummary
          milestoneId={42}
          projectId={7}
          onScopeChipClick={onScopeChipClick}
          onFoundInTestingChipClick={onFoundInTestingChipClick}
        />
      </div>
    );

    const scopeChip = await screen.findByTestId("milestone-summary-scope-chip");
    expect(scopeChip.tagName).toBe("BUTTON");
    fireEvent.click(scopeChip);
    expect(onScopeChipClick).toHaveBeenCalledTimes(1);
    expect(onOuterClick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("milestone-summary-found-chip"));
    expect(onFoundInTestingChipClick).toHaveBeenCalledTimes(1);
    expect(onOuterClick).not.toHaveBeenCalled();
  });

  it("omits the scope chip when scopeCount is 0, and omits the found chip when there are no summary issues", async () => {
    mockSummaryFetch(baseSummary({ scopeCount: 0, issues: [] }));

    renderWithQueryClient(<MilestoneSummary milestoneId={42} projectId={7} />);

    // Wait for load to settle via the elapsed/summary bar test id.
    await waitFor(() => {
      expect(screen.getByTestId("milestone-summary-bar")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("milestone-summary-scope-chip")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("milestone-summary-found-chip")
    ).not.toBeInTheDocument();
  });
});
