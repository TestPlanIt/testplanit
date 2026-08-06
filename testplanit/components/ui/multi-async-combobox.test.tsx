import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) => {
    const fullKey = namespace ? `${namespace}.${key}` : key;
    const map: Record<string, string> = {
      "common.labels.noResults": "No Results",
      "common.actions.previous": "Previous",
      "common.actions.next": "Next",
      "common.actions.selectAll": "Select All",
      "common.actions.clearAll": "Clear All",
      "common.search": "Search",
      "common.placeholders.selectConfigurations": "Select",
    };
    return map[fullKey] ?? key.split(".").pop() ?? key;
  },
  useLocale: () => "en-US",
}));

import { MultiAsyncCombobox } from "./multi-async-combobox";

interface Option {
  id: number;
  label: string;
}

const makeOptions = (count: number): Option[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    label: `Item ${i + 1}`,
  }));

// jsdom has no IntersectionObserver, and without one the load-more sentinel
// never wires. Controllable stand-in so tests drive intersection by hand.
let observers: MockIntersectionObserver[] = [];

class MockIntersectionObserver {
  callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    observers.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    observers = observers.filter((o) => o !== this);
  }
  takeRecords() {
    return [];
  }
  fire(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
}

const fireSentinel = (isIntersecting: boolean) => {
  act(() => {
    observers.forEach((o) => o.fire(isIntersecting));
  });
};

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

afterEach(() => {
  observers = [];
  vi.unstubAllGlobals();
});

describe("MultiAsyncCombobox trigger loading state", () => {
  it("swaps the chevron for a spinner while options load, then restores it", async () => {
    let resolveFetch!: (options: Option[]) => void;
    const pending = new Promise<Option[]>((resolve) => {
      resolveFetch = resolve;
    });
    render(
      <MultiAsyncCombobox<Option>
        value={[]}
        onValueChange={vi.fn()}
        fetchOptions={() => pending}
        renderOption={(option) => <span>{option.label}</span>}
        getOptionValue={(option) => option.id}
        getOptionLabel={(option) => option.label}
        placeholder="Search"
      />
    );

    // Closed and idle: no spinner on the trigger.
    expect(
      screen.queryByTestId("multi-async-combobox-trigger-spinner")
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox"));

    await waitFor(() => {
      expect(
        screen.getByTestId("multi-async-combobox-trigger-spinner")
      ).toBeInTheDocument();
    });

    resolveFetch(makeOptions(3));

    await waitFor(() => {
      expect(
        screen.queryByTestId("multi-async-combobox-trigger-spinner")
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText("Item 1")).toBeInTheDocument();
  });
});

describe("MultiAsyncCombobox selection toolbar", () => {
  const renderCombobox = (
    props: Partial<React.ComponentProps<typeof MultiAsyncCombobox<Option>>> = {}
  ) =>
    render(
      <MultiAsyncCombobox<Option>
        value={[]}
        onValueChange={vi.fn()}
        fetchOptions={async () => makeOptions(3)}
        renderOption={(option) => <span>{option.label}</span>}
        getOptionValue={(option) => option.id}
        getOptionLabel={(option) => option.label}
        placeholder="Search"
        {...props}
      />
    );

  it("clears every selection when Clear All is clicked", async () => {
    const onValueChange = vi.fn();
    renderCombobox({ value: makeOptions(2), onValueChange });

    fireEvent.click(screen.getByRole("combobox"));

    fireEvent.click(
      await screen.findByTestId("multi-async-combobox-clear-all")
    );

    expect(onValueChange).toHaveBeenCalledWith([]);
  });

  it("offers no Clear All while nothing is selected", async () => {
    renderCombobox();

    fireEvent.click(screen.getByRole("combobox"));

    expect(await screen.findByText("Item 1")).toBeInTheDocument();
    expect(
      screen.queryByTestId("multi-async-combobox-clear-all")
    ).not.toBeInTheDocument();
  });

  it("appends further pages as the sentinel comes into view", async () => {
    const all = makeOptions(25);
    renderCombobox({
      pageSize: 10,
      fetchOptions: async (_query, page, pageSize) => ({
        results: all.slice(page * pageSize, (page + 1) * pageSize),
        total: all.length,
      }),
    });

    fireEvent.click(screen.getByRole("combobox"));
    expect(await screen.findByText("Item 1")).toBeInTheDocument();
    expect(screen.queryByText("Item 11")).not.toBeInTheDocument();
    expect(screen.queryByText("Previous")).not.toBeInTheDocument();
    expect(screen.queryByText("Next")).not.toBeInTheDocument();

    // Scrolled to the bottom: the sentinel intersects and, page by page, the
    // viewport-fill keeps pulling while it stays visible.
    fireSentinel(true);

    await waitFor(() => {
      expect(screen.getByText("Item 25")).toBeInTheDocument();
    });
    // Earlier pages are still mounted — appended, not swapped.
    expect(screen.getByText("Item 1")).toBeInTheDocument();
    expect(
      screen.getByTestId("multi-async-combobox-count-footer")
    ).toBeInTheDocument();
  });

  it("selects every match — not just the page on screen — from Select All", async () => {
    const onValueChange = vi.fn();
    const all = makeOptions(25);
    renderCombobox({
      onValueChange,
      pageSize: 10,
      fetchOptions: async (_query, page, pageSize) => ({
        results: all.slice(page * pageSize, (page + 1) * pageSize),
        total: all.length,
      }),
    });

    fireEvent.click(screen.getByRole("combobox"));

    fireEvent.click(await screen.findByText(/Select All/));

    await waitFor(() => {
      expect(onValueChange).toHaveBeenCalledWith(all);
    });
  });
});
