import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildFilterDimensions } from "~/lib/repository/filterDimensions";
import type { FilterPredicate } from "~/lib/schemas/repositoryFilterPredicates";

vi.mock("@/components/tables/UserNameCell", () => ({
  UserNameCell: ({ userId }: { userId: string }) => <span>{userId}</span>,
}));

import { RepositoryFilterBar } from "./RepositoryFilterBar";

beforeAll(() => {
  // cmdk scrolls the selected item into view; jsdom has no implementation.
  Element.prototype.scrollIntoView = vi.fn();
});

const repoRegistry = buildFilterDimensions();
const runRegistry = buildFilterDimensions({ includeRunDimensions: true });

// The global next-auth mock authenticates as this user id.
const ME = "test-user-id";

const templatesIn = (values: Array<string | number>): FilterPredicate => ({
  dimension: "templates",
  operator: "in",
  values,
});

const tagsAny = (values: Array<string | number>): FilterPredicate => ({
  dimension: "tags",
  operator: "any",
  values,
});

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    predicates: [] as FilterPredicate[],
    onAdd: vi.fn(),
    onUpdate: vi.fn(),
    onRemove: vi.fn(),
    onClearAll: vi.fn(),
    registry: repoRegistry,
    viewOptions: {
      templates: [
        { id: 1, name: "Login" },
        { id: 2, name: "Checkout" },
      ],
      tags: [
        { id: 5, name: "smoke" },
        { id: 6, name: "regression" },
      ],
    },
    totalCount: 42,
    isRunMode: false,
    ...overrides,
  };
}

describe("RepositoryFilterBar", () => {
  it("renders a polite live results count", () => {
    render(<RepositoryFilterBar {...makeProps()} />);
    const results = screen.getByTestId("filter-bar-results");
    expect(results).toHaveAttribute("aria-live", "polite");
    expect(results).toHaveTextContent("repository.filterBar.resultsCount");
  });

  it("renders one chip per predicate", () => {
    render(
      <RepositoryFilterBar
        {...makeProps({ predicates: [templatesIn([1]), tagsAny([])] })}
      />
    );
    expect(screen.getByTestId("filter-chip-templates-in")).toBeInTheDocument();
    expect(screen.getByTestId("filter-chip-tags-any")).toBeInTheDocument();
  });

  it("shows Clear-all only at two or more predicates", () => {
    const { rerender } = render(
      <RepositoryFilterBar {...makeProps({ predicates: [templatesIn([1])] })} />
    );
    expect(screen.queryByTestId("filter-bar-clear")).not.toBeInTheDocument();

    const props = makeProps({ predicates: [templatesIn([1]), tagsAny([])] });
    rerender(<RepositoryFilterBar {...props} />);
    fireEvent.click(screen.getByTestId("filter-bar-clear"));
    expect(props.onClearAll).toHaveBeenCalledTimes(1);
  });

  it("routes chip removal through onRemove with (dimension, operator)", () => {
    const props = makeProps({ predicates: [templatesIn([1])] });
    render(<RepositoryFilterBar {...props} />);
    fireEvent.click(screen.getByTestId("filter-chip-templates-in-remove"));
    expect(props.onRemove).toHaveBeenCalledWith("templates", "in");
  });

  it("routes chip edits through onUpdate keyed by the original chip", () => {
    const props = makeProps({ predicates: [tagsAny([5])] });
    render(<RepositoryFilterBar {...props} />);
    // Open the chip editor, then toggle a value.
    fireEvent.click(screen.getByLabelText("repository.filterBar.editFilter"));
    fireEvent.click(screen.getByTestId("filter-value-option-6"));
    expect(props.onUpdate).toHaveBeenCalledWith("tags", "any", {
      dimension: "tags",
      operator: "any",
      values: [5, 6],
    });
  });

  it("mutes the chips row and shows the notice while search pauses filters", () => {
    render(
      <RepositoryFilterBar
        {...makeProps({ predicates: [templatesIn([1])], searchPaused: true })}
      />
    );
    expect(screen.getByTestId("filter-bar-paused")).toHaveTextContent(
      "repository.filterBar.pausedDuringSearch"
    );
    const group = screen.getByRole("group");
    expect(group.className).toContain("pointer-events-none");
    expect(group.className).toContain("opacity-50");
  });

  it("adds an immediately-valid seed chip when a zero-arity dimension is picked", () => {
    const props = makeProps();
    render(<RepositoryFilterBar {...props} />);
    fireEvent.click(screen.getByTestId("filter-bar-add"));
    fireEvent.click(screen.getByTestId("filter-dimension-option-tags"));
    expect(props.onAdd).toHaveBeenCalledWith({
      dimension: "tags",
      operator: "any",
      values: [],
    });
  });

  it("holds a draft chip for min-1 dimensions until a value is picked", () => {
    const props = makeProps();
    render(<RepositoryFilterBar {...props} />);
    fireEvent.click(screen.getByTestId("filter-bar-add"));
    fireEvent.click(screen.getByTestId("filter-dimension-option-templates"));
    // Draft chip exists with an open editor, but nothing was committed yet.
    expect(props.onAdd).not.toHaveBeenCalled();
    expect(screen.getByTestId("filter-chip-templates-in")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("filter-value-option-1"));
    expect(props.onAdd).toHaveBeenCalledWith({
      dimension: "templates",
      operator: "in",
      values: [1],
    });
  });

  it("omits the assigned-to-me quick chip outside run mode", () => {
    render(<RepositoryFilterBar {...makeProps()} />);
    expect(
      screen.queryByTestId("filter-quick-assigned-me")
    ).not.toBeInTheDocument();
  });

  it("seeds the assigned-to-me predicate from the quick chip in run mode", () => {
    const props = makeProps({ registry: runRegistry, isRunMode: true });
    render(<RepositoryFilterBar {...props} />);
    const quick = screen.getByTestId("filter-quick-assigned-me");
    expect(quick).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(quick);
    expect(props.onAdd).toHaveBeenCalledWith({
      dimension: "assignedTo",
      operator: "in",
      values: [ME],
    });
  });

  it("toggles me out of an existing assignedTo predicate from the quick chip", () => {
    const predicate: FilterPredicate = {
      dimension: "assignedTo",
      operator: "in",
      values: [ME, "other-user"],
    };
    const props = makeProps({
      registry: runRegistry,
      isRunMode: true,
      predicates: [predicate],
    });
    render(<RepositoryFilterBar {...props} />);
    const quick = screen.getByTestId("filter-quick-assigned-me");
    expect(quick).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(quick);
    expect(props.onUpdate).toHaveBeenCalledWith("assignedTo", "in", {
      dimension: "assignedTo",
      operator: "in",
      values: ["other-user"],
    });
  });
});
