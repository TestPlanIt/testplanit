import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { buildFilterDimensions } from "~/lib/repository/filterDimensions";
import type { FilterPredicate } from "~/lib/schemas/repositoryFilterPredicates";

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

/**
 * The chip is stubbed down to the two signals a typed editor sends the bar —
 * a pending value and a request to close — because the operator Select is a
 * Radix popover that jsdom cannot open. The editor's own side of that
 * contract (typing reports, Enter/apply confirms) is covered against the real
 * inputs in RepositoryFilterBar.test.tsx; what is proven here is the bar's
 * write behavior: one editing session is one URL write.
 */
vi.mock("./FilterChip", () => ({
  FilterChip: ({
    predicate,
    onPendingChange,
    onOpenChange,
  }: {
    predicate: FilterPredicate;
    onPendingChange?: (next: FilterPredicate | null) => void;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div data-testid={`chip-${predicate.dimension}-${predicate.operator}`}>
      <span>{`${predicate.dimension}:${predicate.operator}:${predicate.values.join(",")}`}</span>
      <button
        data-testid="type-eq-12"
        onClick={() =>
          onPendingChange?.({
            dimension: "riskScore",
            operator: "eq",
            values: [12],
          })
        }
      />
      <button
        data-testid="switch-to-gt-12"
        onClick={() =>
          onPendingChange?.({
            dimension: "riskScore",
            operator: "gt",
            values: [12],
          })
        }
      />
      <button
        data-testid="pick-any"
        onClick={() =>
          onPendingChange?.({
            dimension: "riskScore",
            operator: "any",
            values: [],
          })
        }
      />
      <button data-testid="close-editor" onClick={() => onOpenChange(false)} />
    </div>
  ),
}));

import { RepositoryFilterBar } from "./RepositoryFilterBar";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const registry = buildFilterDimensions({ includeRiskScore: true });

let writes: FilterPredicate[][] = [];

/**
 * Mirrors useRepositoryFilters: every mutator is closed over the `predicates`
 * it was built with, computes the full next set from that snapshot, and writes
 * it to the URL absolutely — landing a round-trip later. updatePredicate
 * no-ops outright when its target is not in that snapshot, which is what
 * turned a mid-flight re-key into two chips.
 */
function AsyncUrlHarness({ initial = [] }: { initial?: FilterPredicate[] }) {
  const [predicates, setPredicates] = useState<FilterPredicate[]>(initial);
  const write = (next: FilterPredicate[]) => {
    writes.push(next);
    setTimeout(() => act(() => setPredicates(next)), 120);
  };
  return (
    <RepositoryFilterBar
      predicates={predicates}
      onAdd={(next) => {
        const i = predicates.findIndex(
          (p) => p.dimension === next.dimension && p.operator === next.operator
        );
        write(
          i === -1
            ? [...predicates, next]
            : predicates.map((p, j) => (j === i ? next : p))
        );
      }}
      onUpdate={(dimension, operator, next) => {
        const i = predicates.findIndex(
          (p) => p.dimension === dimension && p.operator === operator
        );
        if (i === -1) return;
        write(predicates.map((p, j) => (j === i ? next : p)));
      }}
      onRemove={(dimension, operator) =>
        write(
          predicates.filter(
            (p) => !(p.dimension === dimension && p.operator === operator)
          )
        )
      }
      onClearAll={() => write([])}
      registry={registry}
      isRunMode={false}
    />
  );
}

const settle = async () => {
  await act(async () => {
    vi.advanceTimersByTime(600);
  });
};

const chipTexts = () =>
  screen.queryAllByText(/^riskScore:/).map((node) => node.textContent);

describe("RepositoryFilterBar typed-value writes", () => {
  beforeEach(() => {
    writes = [];
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes once for a new filter, after the editor closes", async () => {
    render(<AsyncUrlHarness />);
    fireEvent.click(screen.getByTestId("filter-bar-add"));
    fireEvent.click(screen.getByTestId("filter-dimension-option-riskScore"));

    fireEvent.click(screen.getByTestId("type-eq-12"));
    await settle();
    expect(writes).toEqual([]);

    fireEvent.click(screen.getByTestId("close-editor"));
    await settle();

    expect(writes).toEqual([
      [{ dimension: "riskScore", operator: "eq", values: [12] }],
    ]);
    expect(chipTexts()).toEqual(["riskScore:eq:12"]);
  });

  it("leaves one filter, not two, when the operator is switched after typing", async () => {
    render(<AsyncUrlHarness />);
    fireEvent.click(screen.getByTestId("filter-bar-add"));
    fireEvent.click(screen.getByTestId("filter-dimension-option-riskScore"));

    // Type a value, then switch equals -> greater than before closing.
    fireEvent.click(screen.getByTestId("type-eq-12"));
    await settle();
    fireEvent.click(screen.getByTestId("switch-to-gt-12"));
    await settle();
    fireEvent.click(screen.getByTestId("close-editor"));
    await settle();

    expect(writes).toEqual([
      [{ dimension: "riskScore", operator: "gt", values: [12] }],
    ]);
    expect(chipTexts()).toEqual(["riskScore:gt:12"]);
  });

  it("re-keys an existing chip's operator in a single update", async () => {
    render(
      <AsyncUrlHarness
        initial={[{ dimension: "riskScore", operator: "eq", values: [5] }]}
      />
    );

    fireEvent.click(screen.getByTestId("switch-to-gt-12"));
    await settle();
    expect(writes).toEqual([]);

    fireEvent.click(screen.getByTestId("close-editor"));
    await settle();

    expect(writes).toEqual([
      [{ dimension: "riskScore", operator: "gt", values: [12] }],
    ]);
    expect(chipTexts()).toEqual(["riskScore:gt:12"]);
  });

  it("applies a valueless operator on close, having no entry to confirm", async () => {
    render(<AsyncUrlHarness />);
    fireEvent.click(screen.getByTestId("filter-bar-add"));
    fireEvent.click(screen.getByTestId("filter-dimension-option-riskScore"));

    // `any` renders neither a value input nor an apply button, so closing the
    // editor is its only commit path.
    fireEvent.click(screen.getByTestId("pick-any"));
    await settle();
    expect(writes).toEqual([]);

    fireEvent.click(screen.getByTestId("close-editor"));
    await settle();

    expect(writes).toEqual([
      [{ dimension: "riskScore", operator: "any", values: [] }],
    ]);
    expect(chipTexts()).toEqual(["riskScore:any:"]);
  });

  it("leaves an abandoned draft out of the URL entirely", async () => {
    render(<AsyncUrlHarness />);
    fireEvent.click(screen.getByTestId("filter-bar-add"));
    fireEvent.click(screen.getByTestId("filter-dimension-option-riskScore"));

    fireEvent.click(screen.getByTestId("close-editor"));
    await settle();

    expect(writes).toEqual([]);
    expect(chipTexts()).toEqual([]);
  });
});
