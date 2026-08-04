import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { FilterValueList } from "./FilterValueList";
import type { FilterValueOption } from "./valueOptions";

beforeAll(() => {
  // cmdk scrolls the selected item into view; jsdom has no implementation.
  Element.prototype.scrollIntoView = vi.fn();
});

const shortOptions: FilterValueOption[] = [
  { id: 1, name: "smoke", count: 4 },
  { id: 2, name: "regression", count: 9 },
];

const manyOptions: FilterValueOption[] = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  name: `Tag ${i + 1}`,
  count: i,
}));

describe("FilterValueList", () => {
  it("renders option rows with counts and no search input under the threshold", () => {
    render(
      <FilterValueList
        options={shortOptions}
        selectedValues={[]}
        onToggle={() => {}}
      />
    );
    expect(screen.getByTestId("filter-value-option-1")).toHaveTextContent(
      "smoke"
    );
    expect(screen.getByTestId("filter-value-option-1")).toHaveTextContent("4");
    expect(screen.queryByTestId("filter-value-search")).not.toBeInTheDocument();
  });

  it("shows the search input above the threshold and filters rows", () => {
    render(
      <FilterValueList
        options={manyOptions}
        selectedValues={[]}
        onToggle={() => {}}
      />
    );
    const search = screen.getByTestId("filter-value-search");
    fireEvent.change(search, { target: { value: "Tag 12" } });
    expect(screen.getByTestId("filter-value-option-12")).toBeInTheDocument();
    expect(
      screen.queryByTestId("filter-value-option-1")
    ).not.toBeInTheDocument();
  });

  it("shows the no-matches empty state for a search with no hits", () => {
    render(
      <FilterValueList
        options={manyOptions}
        selectedValues={[]}
        onToggle={() => {}}
      />
    );
    fireEvent.change(screen.getByTestId("filter-value-search"), {
      target: { value: "zzz" },
    });
    expect(
      screen.getByText("repository.filterBar.noMatches")
    ).toBeInTheDocument();
  });

  it("reports clicks through onToggle with the option id", () => {
    const onToggle = vi.fn();
    render(
      <FilterValueList
        options={shortOptions}
        selectedValues={[]}
        onToggle={onToggle}
      />
    );
    fireEvent.click(screen.getByTestId("filter-value-option-2"));
    expect(onToggle).toHaveBeenCalledWith(2);
  });

  it("marks selected options", () => {
    render(
      <FilterValueList
        options={shortOptions}
        selectedValues={[2]}
        onToggle={() => {}}
      />
    );
    expect(screen.getByTestId("filter-value-option-2")).toHaveAttribute(
      "data-checked",
      "true"
    );
    expect(screen.getByTestId("filter-value-option-1")).not.toHaveAttribute(
      "data-checked"
    );
  });

  it("supports a custom option label renderer", () => {
    render(
      <FilterValueList
        options={shortOptions}
        selectedValues={[]}
        onToggle={() => {}}
        renderOptionLabel={(option) => <em>custom-{option.name}</em>}
      />
    );
    expect(screen.getByText("custom-smoke")).toBeInTheDocument();
  });
});
