import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { buildFilterDimensions } from "~/lib/repository/filterDimensions";
import {
  MAX_FILTER_PREDICATES,
  type FilterPredicate,
} from "~/lib/schemas/repositoryFilterPredicates";

vi.mock("@/components/tables/UserNameCell", () => ({
  UserNameCell: ({ userId }: { userId: string }) => <span>{userId}</span>,
}));

// The saved-views menu's persistence is covered by SavedViewsMenu.test.tsx;
// here only its presence on the bar matters.
vi.mock("~/hooks/useSavedRepositoryViews", () => ({
  useSavedRepositoryViews: () => ({
    views: [],
    unreadableCount: 0,
    isLoading: false,
    refetch: vi.fn(),
    saveView: vi.fn(),
    renameView: vi.fn(),
    deleteView: vi.fn(),
    isSaving: false,
    isMutating: false,
  }),
}));

import { useState } from "react";

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

  describe("saved views", () => {
    const savedViews = {
      projectId: 42,
      axis: "folders",
      onApply: vi.fn(),
    };

    it("renders the saved-views control on the bar, outside any kebab", () => {
      render(
        <TooltipProvider>
          <RepositoryFilterBar {...makeProps({ savedViews })} />
        </TooltipProvider>
      );
      const trigger = screen.getByTestId("saved-views-trigger");
      expect(trigger).toBeInTheDocument();
      expect(screen.getByTestId("filter-bar")).toContainElement(trigger);
    });

    it("omits the control on surfaces that do not bind it", () => {
      render(
        <TooltipProvider>
          <RepositoryFilterBar {...makeProps()} />
        </TooltipProvider>
      );
      expect(
        screen.queryByTestId("saved-views-trigger")
      ).not.toBeInTheDocument();
    });
  });

  describe("typed-value filters", () => {
    const riskRegistry = buildFilterDimensions({ includeRiskScore: true });

    afterEach(() => {
      vi.useRealTimers();
    });

    /**
     * The repository bar reads `predicates` back from the URL, so a commit
     * lands a render later than any local state the bar sets alongside it,
     * and each mutator is closed over the snapshot it was built with. A
     * synchronous parent hides both effects.
     */
    function AsyncUrlHarness({
      registry = riskRegistry,
    }: {
      registry?: ReturnType<typeof buildFilterDimensions>;
    } = {}) {
      const [predicates, setPredicates] = useState<FilterPredicate[]>([]);
      const write = (next: FilterPredicate[]) => {
        writes.push(next);
        setTimeout(() => act(() => setPredicates(next)), 120);
      };
      return (
        <RepositoryFilterBar
          {...makeProps({
            registry,
            predicates,
            onAdd: (next: FilterPredicate) => {
              const i = predicates.findIndex(
                (p) =>
                  p.dimension === next.dimension && p.operator === next.operator
              );
              write(
                i === -1
                  ? [...predicates, next]
                  : predicates.map((p, j) => (j === i ? next : p))
              );
            },
            onUpdate: (
              dimension: string,
              operator: string,
              next: FilterPredicate
            ) => {
              const i = predicates.findIndex(
                (p) => p.dimension === dimension && p.operator === operator
              );
              if (i === -1) return; // the hook no-ops when the target is absent
              write(predicates.map((p, j) => (j === i ? next : p)));
            },
            onRemove: (dimension: string, operator: string) =>
              write(
                predicates.filter(
                  (p) => !(p.dimension === dimension && p.operator === operator)
                )
              ),
          })}
        />
      );
    }

    let writes: FilterPredicate[][] = [];

    const settle = async () => {
      await act(async () => {
        vi.advanceTimersByTime(600);
      });
    };

    const openDraft = (optionTestId: string) => {
      fireEvent.click(screen.getByTestId("filter-bar-add"));
      fireEvent.click(screen.getByTestId(optionTestId));
    };

    const valueInput = (selector = 'input[type="number"]') =>
      screen
        .getByTestId("filter-chip-editor")
        .querySelector(selector) as HTMLInputElement;

    beforeEach(() => {
      writes = [];
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    it("does not apply a typed value while it is being entered", async () => {
      render(<AsyncUrlHarness />);
      openDraft("filter-dimension-option-riskScore");

      const input = valueInput();
      fireEvent.change(input, { target: { value: "1" } });
      await settle();

      expect(writes).toEqual([]);
    });

    it("keeps the same input focused across multi-digit entry", async () => {
      render(<AsyncUrlHarness />);
      openDraft("filter-dimension-option-riskScore");

      const input = valueInput();
      input.focus();
      fireEvent.change(input, { target: { value: "1" } });
      await settle();
      fireEvent.change(input, { target: { value: "12" } });
      await settle();

      expect(valueInput()).toBe(input);
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe("12");
    });

    it("applies the whole value as one write when confirmed", async () => {
      render(<AsyncUrlHarness />);
      openDraft("filter-dimension-option-riskScore");

      const input = valueInput();
      fireEvent.change(input, { target: { value: "1" } });
      await settle();
      fireEvent.change(input, { target: { value: "12" } });
      await settle();
      fireEvent.click(screen.getByTestId("filter-input-apply"));
      await settle();

      expect(writes).toEqual([
        [{ dimension: "riskScore", operator: "eq", values: [12] }],
      ]);
      expect(
        screen.getByTestId("filter-chip-riskScore-eq").textContent
      ).toContain("12");
    });

    it("drops a half-typed entry that is abandoned", async () => {
      render(<AsyncUrlHarness />);
      openDraft("filter-dimension-option-riskScore");

      const input = valueInput();
      fireEvent.change(input, { target: { value: "12" } });
      fireEvent.change(input, { target: { value: "" } });
      await settle();
      fireEvent.keyDown(document.body, { key: "Escape" });
      await settle();

      expect(writes).toEqual([]);
    });

    it("applies a confirmed text value in one write too", async () => {
      const textRegistry = buildFilterDimensions({
        dynamicFields: [{ fieldId: 9, type: "Text String" }],
      });
      render(<AsyncUrlHarness registry={textRegistry} />);
      openDraft("filter-dimension-option-field_9");

      const input = valueInput("input");
      input.focus();
      fireEvent.change(input, { target: { value: "l" } });
      await settle();
      expect(document.activeElement).toBe(input);
      expect(writes).toEqual([]);

      fireEvent.change(input, { target: { value: "login" } });
      await settle();
      fireEvent.click(screen.getByTestId("filter-input-apply"));
      await settle();

      expect(writes).toEqual([
        [{ dimension: "field_9", operator: "contains", values: ["login"] }],
      ]);
    });
  });
});
