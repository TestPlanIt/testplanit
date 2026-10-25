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

vi.mock("./RiskScoreCell", () => ({
  RiskScoreCell: ({ score }: { score: number | null }) => <span>{score}</span>,
}));

import { RiskDialog } from "./RiskDialog";

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
function lastQueryArgs() {
  const calls = mockInfiniteFindMany.mock.calls;
  return calls[calls.length - 1][0];
}

function lastQueryWhere() {
  return lastQueryArgs().where;
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

describe("RiskDialog manual/automated", () => {
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

  const box = (kind: string) =>
    document.querySelector(`[data-testid="risk-kind-${kind}"]`) as HTMLElement;

  it("sorts by risk in the query, so lowest-first reaches the server", () => {
    // Some runs want the low-risk cases; the list pages in as it scrolls, so
    // sorting in place would only order what happens to be loaded.
    renderDialog();
    const table = () => mockDataTable.mock.calls.at(-1)![0];

    expect(table().sortConfig).toEqual({
      column: "riskScore",
      direction: "desc",
    });
    expect(lastQueryArgs().orderBy[0].riskScore).toBe("desc");

    act(() => table().onSortChange("riskScore"));

    expect(table().sortConfig.direction).toBe("asc");
    expect(lastQueryArgs().orderBy[0].riskScore).toBe("asc");
  });

  it("keeps the selection when only the order changes", () => {
    renderDialog();
    const table = () => mockDataTable.mock.calls.at(-1)![0];

    act(() => table().onRowSelectionChange({ "1": true }));
    act(() => table().onSortChange("riskScore"));

    expect(table().rowSelection).toEqual({ "1": true });
  });

  it("says how much of the match set is loaded", () => {
    // Lost when the dialog's change filter was removed (398e112c4) and the
    // string sat unused until this test pinned it.
    mockCount.mockReturnValue({ data: 1407 });
    const { getByTestId } = renderDialog();

    expect(getByTestId("risk-showing").textContent).toBe(
      'showing:{"shown":2,"total":1407}'
    );
  });

  it("asks for both kinds to start, which is no filter at all", () => {
    renderDialog();

    expect(box("manual").getAttribute("data-state")).toBe("checked");
    expect(box("automated").getAttribute("data-state")).toBe("checked");
    expect(lastQueryWhere()).not.toHaveProperty("automated");
  });

  it("asks for manual cases alone when automated is unchecked", () => {
    renderDialog();

    act(() => box("automated").click());

    expect(lastQueryWhere().automated).toBe(false);
  });

  it("asks for automated cases alone when manual is unchecked", () => {
    renderDialog();

    act(() => box("manual").click());

    expect(lastQueryWhere().automated).toBe(true);
  });

  it("holds the last kind checked, so the list can never be impossible", () => {
    renderDialog();

    act(() => box("automated").click());
    expect(box("manual")).toBeDisabled();
    act(() => box("manual").click());
    expect(lastQueryWhere().automated).toBe(false);
  });

  it("starts the choice over when the kinds change the candidate set", () => {
    renderDialog();
    const table = () => mockDataTable.mock.calls.at(-1)![0];

    act(() => table().onRowSelectionChange({ "1": true }));
    expect(table().rowSelection).toEqual({ "1": true });

    act(() => box("automated").click());
    expect(table().rowSelection).toEqual({});
  });
});
