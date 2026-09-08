import { fireEvent, render, screen } from "@testing-library/react";
import { LayoutTemplate, Tags } from "lucide-react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildFilterDimensions } from "~/lib/repository/filterDimensions";

vi.mock("@/components/tables/UserNameCell", () => ({
  UserNameCell: ({ userId }: { userId: string }) => <span>{userId}</span>,
}));

import { FilterChip } from "./FilterChip";

beforeAll(() => {
  // cmdk scrolls the selected item into view; jsdom has no implementation.
  Element.prototype.scrollIntoView = vi.fn();
});

const registry = buildFilterDimensions({ includeRunDimensions: true });
const templatesDimension = registry.get("templates")!;
const tagsDimension = registry.get("tags")!;

const noop = () => {};

const baseProps = {
  open: false,
  onOpenChange: noop,
  onChange: noop,
  onRemove: noop,
};

describe("FilterChip", () => {
  it("composes the chip label as 'Label: operator values'", () => {
    render(
      <FilterChip
        {...baseProps}
        dimension={templatesDimension}
        predicate={{ dimension: "templates", operator: "in", values: [1, 2] }}
        label="Template"
        icon={LayoutTemplate}
        options={[
          { id: 1, name: "Login" },
          { id: 2, name: "Checkout" },
        ]}
      />
    );
    expect(screen.getByTestId("filter-chip-templates-in")).toHaveTextContent(
      "Template: common.operators.in Login, Checkout"
    );
  });

  it("labels a bare 'any' predicate as has-value", () => {
    render(
      <FilterChip
        {...baseProps}
        dimension={tagsDimension}
        predicate={{ dimension: "tags", operator: "any", values: [] }}
        label="Tag"
        icon={Tags}
        options={[]}
      />
    );
    const chip = screen.getByTestId("filter-chip-tags-any");
    expect(chip).toHaveTextContent("Tag: common.operators.hasValue");
    expect(chip).not.toHaveTextContent("common.operators.anyOf");
  });

  it("labels 'any' with values as any-of with option names", () => {
    render(
      <FilterChip
        {...baseProps}
        dimension={tagsDimension}
        predicate={{ dimension: "tags", operator: "any", values: [5] }}
        label="Tag"
        icon={Tags}
        options={[{ id: 5, name: "smoke" }]}
      />
    );
    expect(screen.getByTestId("filter-chip-tags-any")).toHaveTextContent(
      "Tag: common.operators.anyOf smoke"
    );
  });

  it("falls back to raw values for ids missing from the options payload", () => {
    render(
      <FilterChip
        {...baseProps}
        dimension={templatesDimension}
        predicate={{ dimension: "templates", operator: "in", values: [7] }}
        label="Template"
        icon={LayoutTemplate}
        options={[]}
      />
    );
    expect(screen.getByTestId("filter-chip-templates-in")).toHaveTextContent(
      "Template: common.operators.in 7"
    );
  });

  it("invokes onRemove from the labeled X button", () => {
    const onRemove = vi.fn();
    render(
      <FilterChip
        {...baseProps}
        onRemove={onRemove}
        dimension={templatesDimension}
        predicate={{ dimension: "templates", operator: "in", values: [1] }}
        label="Template"
        icon={LayoutTemplate}
        options={[{ id: 1, name: "Login" }]}
      />
    );
    const removeButton = screen.getByTestId("filter-chip-templates-in-remove");
    expect(removeButton).toHaveAttribute(
      "aria-label",
      "repository.filterBar.removeFilter"
    );
    fireEvent.click(removeButton);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("opens the editor when open and reports value toggles through onChange", () => {
    const onChange = vi.fn();
    render(
      <FilterChip
        {...baseProps}
        open
        onChange={onChange}
        dimension={tagsDimension}
        predicate={{ dimension: "tags", operator: "any", values: [1] }}
        label="Tag"
        icon={Tags}
        options={[
          { id: 1, name: "smoke" },
          { id: 2, name: "regression" },
        ]}
      />
    );
    expect(screen.getByTestId("filter-chip-editor")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("filter-value-option-2"));
    expect(onChange).toHaveBeenCalledWith({
      dimension: "tags",
      operator: "any",
      values: [1, 2],
    });
  });
});
