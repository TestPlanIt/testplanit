import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { buildFilterDimensions } from "~/lib/repository/filterDimensions";
import {
  MAX_FILTER_PREDICATES,
  type FilterPredicate,
} from "~/lib/schemas/repositoryFilterPredicates";

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
  it("does not duplicate the pagination summary's result total", () => {
    render(<RepositoryFilterBar {...makeProps()} />);
    expect(screen.queryByTestId("filter-bar-results")).not.toBeInTheDocument();
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

  it("keeps the chips live during search and reports a truncated search window", () => {
    render(
      <RepositoryFilterBar
        {...makeProps({
          predicates: [templatesIn([1])],
          searchTruncated: true,
          searchWindow: 10000,
        })}
      />
    );
    // Filters now intersect with search instead of being paused by it, so the
    // chips row stays interactive.
    const group = screen.getByRole("group");
    expect(group.className).not.toContain("pointer-events-none");
    expect(screen.getByTestId("filter-bar-search-truncated")).toHaveTextContent(
      "repository.filterBar.searchTruncated"
    );
  });

  it("shows no truncation notice for a search inside the result window", () => {
    render(
      <RepositoryFilterBar {...makeProps({ predicates: [templatesIn([1])] })} />
    );
    expect(screen.queryByTestId("filter-bar-search-truncated")).toBeNull();
  });

  it("mutes chip-editor option counts with a tooltip while countsMuted is set", () => {
    render(
      <TooltipProvider>
        <RepositoryFilterBar
          {...makeProps({
            predicates: [templatesIn([1])],
            viewOptions: {
              templates: [
                { id: 1, name: "Login", count: 3 },
                { id: 2, name: "Checkout", count: 5 },
              ],
            },
            countsMuted: true,
          })}
        />
      </TooltipProvider>
    );
    fireEvent.click(screen.getByLabelText("repository.filterBar.editFilter"));
    expect(screen.getByText("3").className).toContain("opacity-50");
  });

  it("keeps chip-editor counts unmuted when countsMuted is false, even with active predicates", () => {
    render(
      <TooltipProvider>
        <RepositoryFilterBar
          {...makeProps({
            predicates: [templatesIn([1])],
            viewOptions: {
              templates: [
                { id: 1, name: "Login", count: 3 },
                { id: 2, name: "Checkout", count: 5 },
              ],
            },
          })}
        />
      </TooltipProvider>
    );
    fireEvent.click(screen.getByLabelText("repository.filterBar.editFilter"));
    expect(screen.getByText("3").className).not.toContain("opacity-50");
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

describe("RepositoryFilterBar cap feedback", () => {
  // One chip per (dimension, operator) — the bar's keying invariant — so the
  // fixture needs MAX_FILTER_PREDICATES distinct dimensions.
  const atCap: FilterPredicate[] = Array.from(
    { length: MAX_FILTER_PREDICATES },
    (_, i) => ({
      dimension: `field_${i + 1}`,
      operator: "contains",
      values: [`value${i}`],
    })
  );

  const capRegistry = buildFilterDimensions({
    dynamicFields: Array.from({ length: MAX_FILTER_PREDICATES }, (_, i) => ({
      fieldId: i + 1,
      type: "Text Long",
    })),
  });

  it("disables Add-filter at the predicate cap", () => {
    render(
      <TooltipProvider>
        <RepositoryFilterBar
          {...makeProps({ predicates: atCap, registry: capRegistry })}
        />
      </TooltipProvider>
    );
    expect(screen.getByTestId("filter-bar-add")).toBeDisabled();
  });

  it("keeps Add-filter enabled one below the cap", () => {
    render(
      <TooltipProvider>
        <RepositoryFilterBar
          {...makeProps({
            predicates: atCap.slice(1),
            registry: capRegistry,
          })}
        />
      </TooltipProvider>
    );
    expect(screen.getByTestId("filter-bar-add")).toBeEnabled();
  });

  it("says so when an over-cap link was trimmed", () => {
    render(
      <TooltipProvider>
        <RepositoryFilterBar
          {...makeProps({
            predicates: [templatesIn([1])],
            truncation: { predicatesDropped: 6, valuesTruncated: [] },
          })}
        />
      </TooltipProvider>
    );
    expect(screen.getByTestId("filter-bar-truncated")).toHaveTextContent(
      // vitest.setup.tsx carries its own message fixture, so t() echoes the key.
      "repository.filterBar.filtersTruncated"
    );
    // The predicate cap was not the thing that bit, so its notice stays away.
    expect(
      screen.queryByTestId("filter-bar-values-truncated")
    ).not.toBeInTheDocument();
  });

  it("reports a trimmed value list with its own notice, not the predicate cap", () => {
    render(
      <TooltipProvider>
        <RepositoryFilterBar
          {...makeProps({
            predicates: [templatesIn([1])],
            truncation: {
              predicatesDropped: 0,
              valuesTruncated: ["templates"],
            },
          })}
        />
      </TooltipProvider>
    );
    expect(screen.getByTestId("filter-bar-values-truncated")).toHaveTextContent(
      "repository.filterBar.valuesTruncated"
    );
    expect(
      screen.queryByTestId("filter-bar-truncated")
    ).not.toBeInTheDocument();
  });

  it("shows both notices when both caps bit", () => {
    render(
      <TooltipProvider>
        <RepositoryFilterBar
          {...makeProps({
            predicates: [templatesIn([1])],
            truncation: {
              predicatesDropped: 3,
              valuesTruncated: ["templates", "tags"],
            },
          })}
        />
      </TooltipProvider>
    );
    expect(screen.getByTestId("filter-bar-truncated")).toHaveTextContent(
      "repository.filterBar.filtersTruncated"
    );
    expect(screen.getByTestId("filter-bar-values-truncated")).toHaveTextContent(
      "repository.filterBar.valuesTruncated"
    );
  });

  it("stays quiet when nothing was trimmed", () => {
    render(
      <TooltipProvider>
        <RepositoryFilterBar
          {...makeProps({
            predicates: [templatesIn([1])],
            truncation: { predicatesDropped: 0, valuesTruncated: [] },
          })}
        />
      </TooltipProvider>
    );
    expect(
      screen.queryByTestId("filter-bar-truncated")
    ).not.toBeInTheDocument();
  });
});
