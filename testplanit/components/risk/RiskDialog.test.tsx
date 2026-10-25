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
