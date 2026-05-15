import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";

// Local next-intl mock: the global vitest setup mock only knows a tiny set
// of `common.*` keys; we need the matrix-specific keys (with ICU param
// substitution) here so assertions can match on rendered numbers.
vi.mock("next-intl", () => ({
  useTranslations:
    (_namespace?: string) =>
    (key: string, params?: Record<string, unknown>) => {
      const dict: Record<string, string> = {
        cellCapTitle:
          "Matrix would render {cellCount} cells (limit {threshold})",
        cellCapSuggestionFilterCases:
          "Try filtering to fewer test cases — that axis is the largest contributor.",
        cellCapSuggestionFilterConfigs:
          "Try filtering to fewer configurations — that axis is the largest contributor.",
        cellCapSuggestionFilterDates:
          "Try narrowing the date range — parameter iterations dominate the cell count.",
        cellCapAxisCases: "Test cases: {count}",
        cellCapAxisConfigs: "Configurations: {count}",
        cellCapAxisMaxIters:
          "Largest parameter row count for any case: {count}",
        cellCapResetFilters: "Reset filters and try again",
      };
      let v = dict[key] ?? key;
      if (params) {
        Object.entries(params).forEach(([k, val]) => {
          v = v.replace(`{${k}}`, String(val));
        });
      }
      return v;
    },
}));

import { MatrixCellCapNotice } from "./MatrixCellCapNotice";

function makeError(
  over?: Partial<{
    cellCount: number;
    threshold: number;
    caseCount: number;
    configCount: number;
    perCaseMaxIterations: Array<{ caseId: number; maxIterations: number }>;
  }>
) {
  return {
    type: "cell_cap_exceeded" as const,
    cellCount: over?.cellCount ?? 12345,
    threshold: over?.threshold ?? 10000,
    axisCounts: {
      caseCount: over?.caseCount ?? 100,
      configCount: over?.configCount ?? 100,
      perCaseMaxIterations: over?.perCaseMaxIterations ?? [
        { caseId: 1, maxIterations: 5 },
      ],
    },
  };
}

describe("<MatrixCellCapNotice />", () => {
  it("renders the cell count + threshold from props", () => {
    render(
      <MatrixCellCapNotice
        error={makeError({ cellCount: 12345, threshold: 10000 })}
        filters={{}}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByTestId("matrix-cell-cap-notice")).toBeInTheDocument();
    // Both numbers must show up somewhere in the title (raw or formatted).
    const text = screen.getByTestId("matrix-cell-cap-notice").textContent ?? "";
    expect(text).toMatch(/12[,.]?345/);
    expect(text).toMatch(/10[,.]?000/);
  });

  it("suggests filtering cases when caseCount dominates", () => {
    render(
      <MatrixCellCapNotice
        error={makeError({
          caseCount: 200,
          configCount: 5,
          perCaseMaxIterations: [{ caseId: 1, maxIterations: 1 }],
        })}
        filters={{}}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByTestId("matrix-cell-cap-notice").textContent).toMatch(
      /test cases|fewer test cases/i
    );
  });

  it("suggests filtering configurations when configCount dominates", () => {
    render(
      <MatrixCellCapNotice
        error={makeError({
          caseCount: 5,
          configCount: 200,
          perCaseMaxIterations: [{ caseId: 1, maxIterations: 1 }],
        })}
        filters={{}}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByTestId("matrix-cell-cap-notice").textContent).toMatch(
      /configurations|fewer configurations/i
    );
  });

  it("suggests narrowing date range when paramRows axis dominates", () => {
    render(
      <MatrixCellCapNotice
        error={makeError({
          caseCount: 5,
          configCount: 5,
          perCaseMaxIterations: [{ caseId: 1, maxIterations: 999 }],
        })}
        filters={{}}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByTestId("matrix-cell-cap-notice").textContent).toMatch(
      /date range|narrowing/i
    );
  });

  it("does NOT show the Reset Filters button when no filters are active", () => {
    render(
      <MatrixCellCapNotice
        error={makeError()}
        filters={{}}
        onChange={vi.fn()}
      />
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the Reset Filters button when filters are active", () => {
    render(
      <MatrixCellCapNotice
        error={makeError()}
        filters={{ statusIds: [1] }}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("clicking Reset Filters calls onChange with empty arrays + undefined dates", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MatrixCellCapNotice
        error={makeError()}
        filters={{
          statusIds: [1],
          configIds: [2],
          datasetIds: [3],
          dateFrom: "2026-04-01T00:00:00.000Z",
          dateTo: "2026-05-01T00:00:00.000Z",
        }}
        onChange={onChange}
      />
    );
    await user.click(screen.getByRole("button"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      statusIds: [],
      configIds: [],
      datasetIds: [],
      dateFrom: undefined,
      dateTo: undefined,
    });
  });

  it("renders the axis-count breakdown (cases / configs / max iters)", () => {
    render(
      <MatrixCellCapNotice
        error={makeError({
          caseCount: 50,
          configCount: 60,
          perCaseMaxIterations: [{ caseId: 1, maxIterations: 7 }],
        })}
        filters={{}}
        onChange={vi.fn()}
      />
    );
    const text = screen.getByTestId("matrix-cell-cap-notice").textContent ?? "";
    expect(text).toMatch(/50/);
    expect(text).toMatch(/60/);
    expect(text).toMatch(/7/);
  });

  it("treats the Reset button as active when only dateFrom is set", () => {
    render(
      <MatrixCellCapNotice
        error={makeError()}
        filters={{ dateFrom: "2026-04-01T00:00:00.000Z" }}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});
