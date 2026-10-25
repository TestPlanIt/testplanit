import { act, render } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInfiniteFindMany, mockFindMany, mockCount, mockDataTable } =
  vi.hoisted(() => ({
    mockInfiniteFindMany: vi.fn(),
    mockFindMany: vi.fn(),
    mockCount: vi.fn(),
    mockDataTable: vi.fn(),
  }));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    repositoryCases: {
      useInfiniteFindMany: mockInfiniteFindMany,
      useFindMany: mockFindMany,
      useCount: mockCount,
    },
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({ data: null })),
}));

vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: ({ date }: { date: unknown }) => <span>{String(date)}</span>,
}));

vi.mock("@/components/tables/DataTable", () => ({
  DataTable: mockDataTable,
}));

vi.mock("@/components/tables/CaseDisplay", () => ({
  CaseDisplay: ({ name }: { name: string }) => <span>{name}</span>,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

vi.mock("./RiskScoreCell", () => ({
  RiskScoreCell: ({ score }: { score: number | null }) => <span>{score}</span>,
}));

import { RERANK_MAX_CANDIDATES } from "~/lib/schemas/riskRerank";
import { applyRanking, RiskDialog } from "./RiskDialog";

const candidate = (id: number) => ({
  id,
  name: `case ${id}`,
  automated: false,
  isDeleted: false,
  riskScore: 50,
  riskReasons: null,
  folder: { name: "folder" },
});

/** The args the candidate query was last called with. */
function lastQueryWhere() {
  const calls = mockInfiniteFindMany.mock.calls;
  return calls[calls.length - 1][0].where;
}

function renderDialog(
  props: Partial<React.ComponentProps<typeof RiskDialog>> = {}
) {
  return render(
    <RiskDialog
      open
      onOpenChange={vi.fn()}
      projectId={1}
      currentSelection={[]}
      onAccept={vi.fn()}
      {...props}
    />
  );
}

describe("RiskDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDataTable.mockImplementation(() => <div data-testid="table" />);
    mockInfiniteFindMany.mockReturnValue({
      data: { pages: [[candidate(1), candidate(2)]] },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
    });
    mockCount.mockReturnValue({ data: 2 });
    mockFindMany.mockReturnValue({ data: [], refetch: vi.fn() });
  });

  it("asks only for scored cases, and leaves out what the run already holds", () => {
    renderDialog({ currentSelection: [7, 8] });
    expect(lastQueryWhere()).toMatchObject({
      projectId: 1,
      isDeleted: false,
      isArchived: false,
      riskScore: { gte: 0 },
      id: { notIn: [7, 8] },
    });
  });

  it("starts the choice over when the candidate set changes", () => {
    renderDialog();
    const table = () => mockDataTable.mock.calls.at(-1)![0];

    act(() => table().onRowSelectionChange({ "1": true, "2": true }));
    expect(table().rowSelection).toEqual({ "1": true, "2": true });

    // Raising the threshold redefines which cases are candidates.
    act(() => table().onSortChange?.("noop"));
    const slider = document.querySelector(
      '[data-testid="risk-min-score"] [role="slider"]'
    ) as HTMLElement;
    act(() => {
      slider.focus();
      slider.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
      );
    });

    expect(table().rowSelection).toEqual({});
  });
});

describe("applyRanking", () => {
  const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];

  it("leaves the rows alone without a ranking", () => {
    expect(applyRanking(rows, null)).toBe(rows);
  });

  it("lifts ranked rows and keeps the rest in score order beneath", () => {
    const ranked = applyRanking(rows, {
      order: new Map([
        [3, 0],
        [1, 1],
      ]),
      rationale: new Map(),
      model: null,
      rankedCount: 2,
    });

    expect(ranked.map((row) => row.id)).toEqual([3, 1, 2]);
  });
});

describe("RiskDialog re-rank", () => {
  const runContext = { name: "Release 4.2", description: "payments" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDataTable.mockImplementation(() => <div data-testid="table" />);
    mockInfiniteFindMany.mockReturnValue({
      data: { pages: [[candidate(1), candidate(2)]] },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
    });
    mockCount.mockReturnValue({ data: 2 });
    mockFindMany.mockReturnValue({ data: [], refetch: vi.fn() });
  });

  it("is offered only when there is a run to rank for", () => {
    const { queryByTestId, rerender } = renderDialog();
    expect(queryByTestId("risk-rerank")).toBeNull();

    rerender(
      <RiskDialog
        open
        onOpenChange={vi.fn()}
        projectId={1}
        currentSelection={[]}
        onAccept={vi.fn()}
        runContext={runContext}
      />
    );
    expect(queryByTestId("risk-rerank")).not.toBeNull();
  });

  it("sends the loaded candidates and re-orders the table with the answer", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ jobId: "job-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          state: "completed",
          result: {
            ranked: [
              { caseId: 2, rationale: "touches payments" },
              { caseId: 1, rationale: "" },
            ],
            candidateCount: 2,
            droppedCount: 0,
            model: "gpt-x",
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { getByTestId, queryByTestId } = renderDialog({ runContext });
    await act(async () => {
      getByTestId("risk-rerank").click();
    });

    const submit = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/projects/1/risk/rerank");
    expect(submit.caseIds).toEqual([1, 2]);
    expect(submit.runContext.name).toBe("Release 4.2");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });

    expect(queryByTestId("risk-rerank-applied")).not.toBeNull();
    const rows = mockDataTable.mock.calls.at(-1)![0].data;
    expect(rows.map((row: { id: number }) => row.id)).toEqual([2, 1]);

    // Restoring puts the score order back without refetching.
    await act(async () => {
      getByTestId("risk-rerank-restore").click();
    });
    expect(queryByTestId("risk-rerank-applied")).toBeNull();
    expect(
      mockDataTable.mock.calls
        .at(-1)![0]
        .data.map((row: { id: number }) => row.id)
    ).toEqual([1, 2]);

    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("never asks for more candidates than the route accepts", async () => {
    vi.useFakeTimers();
    const { toast } = await import("sonner");
    const many = Array.from({ length: 150 }, (_, i) => candidate(i + 1));
    mockInfiniteFindMany.mockReturnValue({
      data: { pages: [many] },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ jobId: "job-2" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          state: "completed",
          result: {
            ranked: [{ caseId: 5, rationale: "first" }],
            candidateCount: 100,
            droppedCount: 0,
            model: null,
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { getByTestId } = renderDialog({ runContext });
    await act(async () => {
      getByTestId("risk-rerank").click();
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).caseIds).toHaveLength(
      RERANK_MAX_CANDIDATES
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(toast.info).toHaveBeenCalledWith(
      `rerank.capped:{"count":${RERANK_MAX_CANDIDATES}}`
    );

    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("discards an answer that lands after the threshold moved", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ jobId: "job-3" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          state: "completed",
          result: {
            ranked: [{ caseId: 2, rationale: "stale" }],
            candidateCount: 2,
            droppedCount: 0,
            model: null,
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { getByTestId, queryByTestId } = renderDialog({ runContext });
    await act(async () => {
      getByTestId("risk-rerank").click();
    });

    // The candidates change while the model is still thinking.
    const slider = document.querySelector(
      '[data-testid="risk-min-score"] [role="slider"]'
    ) as HTMLElement;
    await act(async () => {
      slider.focus();
      slider.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });

    expect(queryByTestId("risk-rerank-applied")).toBeNull();

    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("says so when the project has no model for the feature", async () => {
    const { toast } = await import("sonner");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "No AI model" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getByTestId, queryByTestId } = renderDialog({ runContext });
    await act(async () => {
      getByTestId("risk-rerank").click();
    });

    expect(toast.error).toHaveBeenCalledWith("rerank.noModel");
    expect(queryByTestId("risk-rerank-applied")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });
});
