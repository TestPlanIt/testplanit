import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SummaryCardGrid } from "./SummaryCardGrid";

const columnsOf = (testId: string) =>
  screen.getByTestId(testId).parentElement?.style.gridTemplateColumns;

describe("SummaryCardGrid", () => {
  it("caps the columns at the number of cards rendered", () => {
    render(
      <SummaryCardGrid>
        <div data-testid="card-1" />
        <div data-testid="card-2" />
        <div data-testid="card-3" />
      </SummaryCardGrid>
    );
    expect(columnsOf("card-1")).toBe(
      "repeat(auto-fill, minmax(max(340px, calc((100% - 32px) / 3 - 1px)), 1fr))"
    );
  });

  it("ignores cards whose render condition is false", () => {
    const showFourth = false;
    render(
      <SummaryCardGrid>
        <div data-testid="card-1" />
        <div data-testid="card-2" />
        {showFourth && <div data-testid="card-4" />}
      </SummaryCardGrid>
    );
    expect(columnsOf("card-1")).toBe(
      "repeat(auto-fill, minmax(max(340px, calc((100% - 16px) / 2 - 1px)), 1fr))"
    );
    expect(screen.queryByTestId("card-4")).not.toBeInTheDocument();
  });

  it("keeps a single card at the full width of the grid", () => {
    render(
      <SummaryCardGrid>
        <div data-testid="card-1" />
      </SummaryCardGrid>
    );
    expect(columnsOf("card-1")).toBe(
      "repeat(auto-fill, minmax(max(340px, calc((100% - 0px) / 1 - 1px)), 1fr))"
    );
  });
});
