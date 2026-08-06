import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// TanStack Virtual takes its first measurement from the scroll element's
// offsetHeight, and the shared ResizeObserver mock never fires. Without a
// non-zero height the virtualizer mounts no rows at all in jsdom.
const VIEWPORT_HEIGHT = 400;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    value: VIEWPORT_HEIGHT,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    value: 300,
  });
});

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

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) => {
    const fullKey = namespace ? `${namespace}.${key}` : key;
    const map: Record<string, string> = {
      "common.labels.noResults": "No Results",
      "common.labels.unassigned": "Unassigned",
      "common.actions.previous": "Previous",
      "common.actions.next": "Next",
    };
    return map[fullKey] ?? key.split(".").pop() ?? key;
  },
  useLocale: () => "en-US",
}));

import { AsyncCombobox } from "./async-combobox";

interface Option {
  id: number;
  label: string;
}

const makeOptions = (count: number): Option[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    label: `Item ${i + 1}`,
  }));

const renderCombobox = (options: Option[]) =>
  render(
    <AsyncCombobox<Option>
      value={null}
      onValueChange={vi.fn()}
      fetchOptions={() => Promise.resolve(options)}
      getOptionValue={(option) => option.id}
      renderOption={(option) => <span>{option.label}</span>}
      placeholder="Search"
      showPagination={false}
    />
  );

const openAndWait = async (firstLabel: string) => {
  fireEvent.click(screen.getByRole("combobox"));
  await waitFor(() => {
    expect(screen.getByText(firstLabel)).toBeInTheDocument();
  });
};

describe("AsyncCombobox virtualization", () => {
  it("renders every option in full below the threshold", async () => {
    const options = makeOptions(10);
    renderCombobox(options);

    await openAndWait("Item 1");

    // No virtual container: small lists keep the original DOM, so cmdk retains
    // arrow-key navigation across all rows.
    expect(
      screen.queryByTestId("async-combobox-virtual-list")
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(10);
  });

  it("virtualizes above the threshold instead of mounting every option", async () => {
    const options = makeOptions(500);
    renderCombobox(options);

    await openAndWait("Item 1");

    const virtualList = screen.getByTestId("async-combobox-virtual-list");
    expect(virtualList).toBeInTheDocument();

    // Scroll height covers all 500 rows, not just the mounted ones, so the
    // scrollbar still spans the whole list. Rows measured in jsdom report the
    // stubbed viewport height, so this asserts the floor rather than an exact
    // total: at least the estimated height per row.
    const reservedHeight = parseFloat(virtualList.style.height);
    expect(reservedHeight).toBeGreaterThanOrEqual(500 * 36);

    // Only a window is mounted, which is what makes opening fast.
    expect(screen.getAllByRole("option").length).toBeLessThan(100);
  });

  it("keeps the option count honest right at the boundary", async () => {
    renderCombobox(makeOptions(100));

    await openAndWait("Item 1");

    // 100 is not "more than 100", so this is still the plain path.
    expect(
      screen.queryByTestId("async-combobox-virtual-list")
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(100);
  });

  it("shows a spinner on the trigger while options load, then removes it", async () => {
    let resolveFetch!: (options: Option[]) => void;
    const pending = new Promise<Option[]>((resolve) => {
      resolveFetch = resolve;
    });
    render(
      <AsyncCombobox<Option>
        value={null}
        onValueChange={vi.fn()}
        fetchOptions={() => pending}
        getOptionValue={(option) => option.id}
        renderOption={(option) => <span>{option.label}</span>}
        placeholder="Search"
        showPagination={false}
      />
    );

    fireEvent.click(screen.getByRole("combobox"));

    await waitFor(() => {
      expect(
        screen.getByTestId("async-combobox-trigger-spinner")
      ).toBeInTheDocument();
    });

    resolveFetch(makeOptions(3));

    await waitFor(() => {
      expect(
        screen.queryByTestId("async-combobox-trigger-spinner")
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText("Item 1")).toBeInTheDocument();
  });

  it("caps the dropdown at the room Radix reports it has", async () => {
    renderCombobox(makeOptions(500));

    await openAndWait("Item 1");

    // Without the cap the popover renders at its natural height, and rows past
    // the window edge cannot be scrolled to: the list scrolls, the popover
    // does not move.
    const dropdown = screen.getByRole("dialog");
    expect(dropdown.className).toContain(
      "max-h-[var(--radix-popover-content-available-height)]"
    );
  });

  it("selecting a virtualized option reports that option", async () => {
    const onValueChange = vi.fn();
    render(
      <AsyncCombobox<Option>
        value={null}
        onValueChange={onValueChange}
        fetchOptions={() => Promise.resolve(makeOptions(500))}
        getOptionValue={(option) => option.id}
        renderOption={(option) => <span>{option.label}</span>}
        placeholder="Search"
        showPagination={false}
      />
    );

    await openAndWait("Item 1");
    fireEvent.click(screen.getByText("Item 1"));

    expect(onValueChange).toHaveBeenCalledWith({ id: 1, label: "Item 1" });
  });

  it("hands the active search to the option renderer, never to the trigger", async () => {
    const options = makeOptions(3);
    render(
      <AsyncCombobox<Option>
        value={options[0]}
        onValueChange={vi.fn()}
        fetchOptions={() => Promise.resolve(options)}
        getOptionValue={(option) => option.id}
        renderOption={(option, query) => (
          <span>{query ? `${option.label} [${query}]` : option.label}</span>
        )}
        placeholder="Search"
        showPagination={false}
      />
    );

    // Grabbed before opening: the search box is a combobox too once the
    // dropdown mounts.
    const trigger = screen.getByRole("combobox");
    await openAndWait("Item 2");

    fireEvent.change(screen.getByPlaceholderText("Search"), {
      target: { value: "item" },
    });

    await waitFor(() => {
      expect(screen.getByText("Item 2 [item]")).toBeInTheDocument();
    });
    // The trigger shows the chosen option, not a search result, so it gets no
    // query to mark up.
    expect(trigger).toHaveTextContent("Item 1");
    expect(trigger).not.toHaveTextContent("[item]");
  });

  describe("infinite scroll", () => {
    const renderPaged = (all: Option[], pageSize = 10) =>
      render(
        <AsyncCombobox<Option>
          value={null}
          onValueChange={vi.fn()}
          fetchOptions={(_query, page, size) =>
            Promise.resolve({
              results: all.slice(page * size, (page + 1) * size),
              total: all.length,
            })
          }
          getOptionValue={(option) => option.id}
          renderOption={(option) => <span>{option.label}</span>}
          placeholder="Search"
          pageSize={pageSize}
        />
      );

    it("appends further pages as the sentinel comes into view", async () => {
      renderPaged(makeOptions(25));

      await openAndWait("Item 1");
      expect(screen.queryByText("Item 11")).not.toBeInTheDocument();

      // Scrolled to the bottom: the sentinel intersects and, page by page,
      // the viewport-fill keeps pulling while it stays visible.
      fireSentinel(true);

      await waitFor(() => {
        expect(screen.getByText("Item 25")).toBeInTheDocument();
      });
      // Earlier pages are still mounted — appended, not swapped.
      expect(screen.getByText("Item 1")).toBeInTheDocument();
      expect(screen.getAllByRole("option")).toHaveLength(25);
    });

    it("shows the loaded-of-total footer instead of a pager", async () => {
      renderPaged(makeOptions(25));

      await openAndWait("Item 1");

      expect(
        screen.getByTestId("async-combobox-count-footer")
      ).toBeInTheDocument();
      expect(screen.queryByText("Previous")).not.toBeInTheDocument();
      expect(screen.queryByText("Next")).not.toBeInTheDocument();
    });

    it("offers no footer for local full-list sources", async () => {
      renderCombobox(makeOptions(10));

      await openAndWait("Item 1");

      expect(
        screen.queryByTestId("async-combobox-count-footer")
      ).not.toBeInTheDocument();
    });
  });

  // WCAG 4.1.2. A combobox trigger usually shows only the selected value (or
  // a placeholder), so ariaLabel is the sole thing naming it. The custom
  // trigger path dropped it, shipping unnamed comboboxes into dialogs.
  describe("trigger accessible name", () => {
    it("names the default trigger from ariaLabel", () => {
      render(
        <AsyncCombobox<Option>
          value={null}
          onValueChange={vi.fn()}
          fetchOptions={() => Promise.resolve([])}
          getOptionValue={(option) => option.id}
          renderOption={(option) => <span>{option.label}</span>}
          ariaLabel="Parent folder"
        />
      );

      expect(
        screen.getByRole("combobox", { name: "Parent folder" })
      ).toBeInTheDocument();
    });

    it("names a custom trigger from ariaLabel", () => {
      render(
        <AsyncCombobox<Option>
          value={null}
          onValueChange={vi.fn()}
          fetchOptions={() => Promise.resolve([])}
          getOptionValue={(option) => option.id}
          renderOption={(option) => <span>{option.label}</span>}
          ariaLabel="Configuration"
          renderTrigger={() => <button />}
        />
      );

      expect(
        screen.getByRole("combobox", { name: "Configuration" })
      ).toBeInTheDocument();
    });

    it("lets a custom trigger's own aria-label win", () => {
      render(
        <AsyncCombobox<Option>
          value={null}
          onValueChange={vi.fn()}
          fetchOptions={() => Promise.resolve([])}
          getOptionValue={(option) => option.id}
          renderOption={(option) => <span>{option.label}</span>}
          ariaLabel="Fallback"
          renderTrigger={() => <button aria-label="Explicit" />}
        />
      );

      expect(
        screen.getByRole("combobox", { name: "Explicit" })
      ).toBeInTheDocument();
    });
  });
});
