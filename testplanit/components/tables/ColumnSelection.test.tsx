import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Control the `?columns=` query param per test.
const mockSearchParams = { current: "" };

// Stable router spies so we can assert URL pushes — e.g. that restoring stored
// columns does NOT write `?columns=` to the URL on mount.
const navMocks = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));

// URL-state write spy (see lib/urlState.ts) — records writes as
// "pathname?search" so assertions read like URLs.
const { mockCommitUrlSearch } = vi.hoisted(() => ({
  mockCommitUrlSearch: vi.fn(),
}));

vi.mock("~/lib/urlState", () => ({
  commitUrlSearch: (url: string | URL) => {
    const u = new URL(url.toString(), "http://localhost");
    mockCommitUrlSearch(`${u.pathname}${u.search}`);
  },
  pushUrlSearch: vi.fn(),
  useLocationSearch: () => window.location.search,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mockSearchParams.current),
}));

vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({ push: navMocks.push, replace: navMocks.replace }),
  usePathname: () => "/test",
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import {
  ColumnSelection,
  CustomColumnDef,
  readStoredColumnOrder,
  readStoredColumnSort,
  readStoredColumnVisibility,
  readStoredColumnWidths,
  writeStoredColumnOrder,
  writeStoredColumnSort,
  writeStoredColumnVisibility,
  writeStoredColumnWidths,
} from "./ColumnSelection";

const STORAGE_PREFIX = "testplanit:columnVisibility:";
const ORDER_PREFIX = "testplanit:columnOrder:";
const WIDTH_PREFIX = "testplanit:columnWidth:";
const SORT_PREFIX = "testplanit:columnSort:";

interface Row {
  id: number;
}

// name (first, cannot hide) | description | customField | actions (last, cannot hide)
const columns: CustomColumnDef<Row>[] = [
  { id: "name", header: "Name", enableHiding: false },
  { id: "description", header: "Description" },
  { id: "customField", header: "Custom Field" },
  { id: "actions", header: "Actions", enableHiding: false },
];

function lastVisibility(spy: ReturnType<typeof vi.fn>) {
  return spy.mock.calls.at(-1)?.[0] as Record<string, boolean>;
}

// Radix popover/checkbox use pointer-capture + scrollIntoView APIs jsdom
// doesn't implement; stub them so the selector can be opened and toggled.
beforeAll(() => {
  const proto = window.HTMLElement.prototype as unknown as Record<
    string,
    unknown
  >;
  proto.hasPointerCapture ||= () => false;
  proto.setPointerCapture ||= () => {};
  proto.releasePointerCapture ||= () => {};
  proto.scrollIntoView ||= () => {};
});

beforeEach(() => {
  window.localStorage.clear();
  mockSearchParams.current = "";
  navMocks.push.mockClear();
  navMocks.replace.mockClear();
  mockCommitUrlSearch.mockClear();
});

describe("column visibility storage helpers", () => {
  it("returns null when nothing is stored", () => {
    expect(readStoredColumnVisibility("view-a")).toBeNull();
  });

  it("returns null when no storage key is provided", () => {
    expect(readStoredColumnVisibility(undefined)).toBeNull();
  });

  it("round-trips a boolean map", () => {
    writeStoredColumnVisibility("view-a", { description: false, tags: true });
    expect(readStoredColumnVisibility("view-a")).toEqual({
      description: false,
      tags: true,
    });
  });

  it("ignores non-boolean and malformed stored values", () => {
    window.localStorage.setItem(
      `${STORAGE_PREFIX}view-a`,
      JSON.stringify({ description: false, bogus: "yes", count: 3 })
    );
    expect(readStoredColumnVisibility("view-a")).toEqual({
      description: false,
    });

    window.localStorage.setItem(`${STORAGE_PREFIX}view-b`, "not json");
    expect(readStoredColumnVisibility("view-b")).toBeNull();

    window.localStorage.setItem(
      `${STORAGE_PREFIX}view-c`,
      JSON.stringify([1, 2])
    );
    expect(readStoredColumnVisibility("view-c")).toBeNull();
  });

  it("merges on write so choices for columns from other views are preserved", () => {
    // e.g. columns from template A
    writeStoredColumnVisibility("repository-cases:1", { fieldA: false });
    // later, columns from template B under the same view key
    writeStoredColumnVisibility("repository-cases:1", { fieldB: true });

    expect(readStoredColumnVisibility("repository-cases:1")).toEqual({
      fieldA: false,
      fieldB: true,
    });
  });
});

describe("column order storage helpers", () => {
  it("returns null when nothing is stored / no key", () => {
    expect(readStoredColumnOrder("view-a")).toBeNull();
    expect(readStoredColumnOrder(undefined)).toBeNull();
  });

  it("round-trips a stored order", () => {
    writeStoredColumnOrder("view-a", ["name", "tags", "actions"]);
    expect(readStoredColumnOrder("view-a")).toEqual([
      "name",
      "tags",
      "actions",
    ]);
  });

  it("replaces (does not merge) on write", () => {
    writeStoredColumnOrder("view-a", ["a", "b", "c"]);
    writeStoredColumnOrder("view-a", ["c", "a"]);
    expect(readStoredColumnOrder("view-a")).toEqual(["c", "a"]);
  });

  it("returns null for a non-array or malformed value", () => {
    window.localStorage.setItem(
      `${ORDER_PREFIX}view-b`,
      JSON.stringify({ a: 1 })
    );
    expect(readStoredColumnOrder("view-b")).toBeNull();
    window.localStorage.setItem(`${ORDER_PREFIX}view-c`, "not json");
    expect(readStoredColumnOrder("view-c")).toBeNull();
  });

  it("drops non-string entries", () => {
    window.localStorage.setItem(
      `${ORDER_PREFIX}view-d`,
      JSON.stringify(["a", 2, "b"])
    );
    expect(readStoredColumnOrder("view-d")).toEqual(["a", "b"]);
  });
});

describe("column width storage helpers", () => {
  it("returns null when nothing is stored", () => {
    expect(readStoredColumnWidths("view-a")).toBeNull();
  });

  it("round-trips numeric widths and ignores non-numbers", () => {
    window.localStorage.setItem(
      `${WIDTH_PREFIX}view-a`,
      JSON.stringify({ name: 200, tags: "wide", ok: 120 })
    );
    expect(readStoredColumnWidths("view-a")).toEqual({ name: 200, ok: 120 });
  });

  it("returns null for malformed JSON", () => {
    window.localStorage.setItem(`${WIDTH_PREFIX}view-b`, "not json");
    expect(readStoredColumnWidths("view-b")).toBeNull();
  });

  it("merges on write so widths from other views survive", () => {
    writeStoredColumnWidths("view-a", { fieldA: 100 });
    writeStoredColumnWidths("view-a", { fieldB: 200 });
    expect(readStoredColumnWidths("view-a")).toEqual({
      fieldA: 100,
      fieldB: 200,
    });
  });

  it("clears a reset width for a present column while keeping other-view widths", () => {
    // fieldA (present, resized) + fieldOther (from another template, absent now)
    writeStoredColumnWidths("view-a", { fieldA: 100, fieldOther: 300 });
    // fieldA reset -> absent from the new sizing; present columns = [fieldA]
    writeStoredColumnWidths("view-a", {}, ["fieldA"]);
    expect(readStoredColumnWidths("view-a")).toEqual({ fieldOther: 300 });
  });
});

describe("column sort storage helpers", () => {
  it("returns null when nothing is stored / no key", () => {
    expect(readStoredColumnSort("view-a")).toBeNull();
    expect(readStoredColumnSort(undefined)).toBeNull();
  });

  it("round-trips a stored sort", () => {
    writeStoredColumnSort("view-a", {
      column: "latestResults",
      direction: "desc",
    });
    expect(readStoredColumnSort("view-a")).toEqual({
      column: "latestResults",
      direction: "desc",
    });
  });

  it("clears the stored sort when passed null", () => {
    writeStoredColumnSort("view-a", { column: "name", direction: "asc" });
    writeStoredColumnSort("view-a", null);
    expect(readStoredColumnSort("view-a")).toBeNull();
    expect(window.localStorage.getItem(`${SORT_PREFIX}view-a`)).toBeNull();
  });

  it("returns null for a malformed or invalid stored value", () => {
    window.localStorage.setItem(`${SORT_PREFIX}view-a`, "not json");
    expect(readStoredColumnSort("view-a")).toBeNull();

    window.localStorage.setItem(
      `${SORT_PREFIX}view-b`,
      JSON.stringify({ column: "name", direction: "sideways" })
    );
    expect(readStoredColumnSort("view-b")).toBeNull();

    window.localStorage.setItem(
      `${SORT_PREFIX}view-c`,
      JSON.stringify({ column: "", direction: "asc" })
    );
    expect(readStoredColumnSort("view-c")).toBeNull();
  });
});

describe("ColumnSelection restore", () => {
  it("restores a remembered hidden column on mount", () => {
    writeStoredColumnVisibility("view-a", { description: false });
    const onVisibilityChange = vi.fn();

    render(
      <ColumnSelection
        storageKey="view-a"
        columns={columns}
        onVisibilityChange={onVisibilityChange}
      />
    );

    expect(lastVisibility(onVisibilityChange)).toEqual({
      name: true,
      description: false,
      customField: true,
      actions: true,
    });
  });

  it("ignores stored columns that do not exist in the current view", () => {
    // `ghost` is not one of this view's columns; `customField` is.
    writeStoredColumnVisibility("view-a", {
      ghost: false,
      customField: false,
    });
    const onVisibilityChange = vi.fn();

    render(
      <ColumnSelection
        storageKey="view-a"
        columns={columns}
        onVisibilityChange={onVisibilityChange}
      />
    );

    const result = lastVisibility(onVisibilityChange);
    expect(result).not.toHaveProperty("ghost");
    expect(result.customField).toBe(false);
    expect(result.description).toBe(true);
  });

  it("never lets storage hide always-visible (first/last/non-hideable) columns", () => {
    writeStoredColumnVisibility("view-a", {
      name: false,
      actions: false,
    });
    const onVisibilityChange = vi.fn();

    render(
      <ColumnSelection
        storageKey="view-a"
        columns={columns}
        onVisibilityChange={onVisibilityChange}
      />
    );

    const result = lastVisibility(onVisibilityChange);
    expect(result.name).toBe(true);
    expect(result.actions).toBe(true);
  });

  it("lets an explicit ?columns= link override the remembered preference", () => {
    writeStoredColumnVisibility("view-a", { description: false });
    mockSearchParams.current = "columns=description"; // URL says: show description, hide the rest
    const onVisibilityChange = vi.fn();

    render(
      <ColumnSelection
        storageKey="view-a"
        columns={columns}
        onVisibilityChange={onVisibilityChange}
      />
    );

    const result = lastVisibility(onVisibilityChange);
    expect(result.description).toBe(true); // URL wins over stored `false`
    expect(result.customField).toBe(false); // not in URL list
  });

  it("does not persist the computed defaults on mount", () => {
    const onVisibilityChange = vi.fn();

    render(
      <ColumnSelection
        storageKey="fresh-view"
        columns={columns}
        onVisibilityChange={onVisibilityChange}
      />
    );

    // Nothing should be written until the user actually changes a column.
    expect(readStoredColumnVisibility("fresh-view")).toBeNull();
  });

  it("does not touch storage when no storageKey is provided", () => {
    const onVisibilityChange = vi.fn();

    render(
      <ColumnSelection
        columns={columns}
        onVisibilityChange={onVisibilityChange}
      />
    );

    // Defaults still propagate, storage stays empty.
    expect(lastVisibility(onVisibilityChange)).toEqual({
      name: true,
      description: true,
      customField: true,
      actions: true,
    });
    expect(window.localStorage.length).toBe(0);
  });
});

// Three hideable columns (colB can be hidden while colA stays visible, so the
// "always keep one visible" guard doesn't fight a single deliberate toggle).
const wideColumns: CustomColumnDef<Row>[] = [
  { id: "name", header: "Name", enableHiding: false },
  { id: "colA", header: "Col A" },
  { id: "colB", header: "Col B" },
  { id: "colC", header: "Col C" },
  { id: "actions", header: "Actions", enableHiding: false },
];

// (1) SSR / hydration safety.
describe("SSR / hydration safety", () => {
  it("read + write are safe no-ops with no window, and don't mutate client storage", () => {
    const stored = { description: false };
    writeStoredColumnVisibility("view-a", stored);
    expect(readStoredColumnVisibility("view-a")).toEqual(stored);

    // Simulate the server render: `window` is undefined.
    vi.stubGlobal("window", undefined);
    try {
      expect(readStoredColumnVisibility("view-a")).toBeNull();
      expect(() =>
        writeStoredColumnVisibility("view-a", { description: true })
      ).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }

    // The server-side no-op must not have touched what the client stored.
    expect(readStoredColumnVisibility("view-a")).toEqual(stored);
  });

  it("emits the stored visibility on the very first render (no defaults-then-correction flash)", () => {
    writeStoredColumnVisibility("view-a", { description: false });
    const onVisibilityChange = vi.fn();

    render(
      <ColumnSelection
        storageKey="view-a"
        columns={columns}
        onVisibilityChange={onVisibilityChange}
      />
    );

    // First emitted value already reflects storage, so there is no visible
    // flip from computed defaults to stored state after mount.
    expect(onVisibilityChange.mock.calls[0]?.[0]).toEqual({
      name: true,
      description: false,
      customField: true,
      actions: true,
    });
  });
});

// (2) A shared ?columns= link updates the remembered view once the user changes
// a column. Confirmed-intended behavior.
describe("URL columns persist to storage on change", () => {
  it("persists URL-derived visibility (incl. URL-hidden columns) after a user toggle", async () => {
    const user = userEvent.setup();
    mockSearchParams.current = "columns=colA,colB"; // colC hidden purely by the URL
    const onVisibilityChange = vi.fn();

    render(
      <ColumnSelection
        storageKey="url-view"
        columns={wideColumns}
        onVisibilityChange={onVisibilityChange}
      />
    );

    // Loading the URL alone does not write storage (first render is skipped).
    expect(readStoredColumnVisibility("url-view")).toBeNull();

    // User opens the selector and hides Col B.
    await user.click(screen.getByTestId("column-selection-trigger"));
    await user.click(await screen.findByRole("checkbox", { name: /Col B/ }));

    const stored = readStoredColumnVisibility("url-view");
    expect(stored).not.toBeNull();
    expect(stored?.colB).toBe(false); // the explicit change
    expect(stored?.colA).toBe(true);
    // colC was hidden only because of the URL, yet it is now persisted —
    // i.e. opening a shared ?columns= link rewrote the remembered view.
    expect(stored?.colC).toBe(false);
  });
});

// (3) Restoring stored prefs must not leak into the shareable URL on load; only
// an explicit change should update it.
describe("restore vs. URL", () => {
  it("does not push a ?columns= URL when restoring stored columns on mount", () => {
    writeStoredColumnVisibility("view-a", { description: false });
    const onVisibilityChange = vi.fn();

    render(
      <ColumnSelection
        storageKey="view-a"
        columns={columns}
        onVisibilityChange={onVisibilityChange}
      />
    );

    expect(onVisibilityChange).toHaveBeenCalled(); // mounted + computed state
    expect(navMocks.push).not.toHaveBeenCalled(); // but no URL written
    expect(mockCommitUrlSearch).not.toHaveBeenCalled();
  });

  it("updates the ?columns= URL on an explicit change when column memory is OFF", async () => {
    const user = userEvent.setup();
    const onVisibilityChange = vi.fn();

    render(
      <ColumnSelection
        columns={wideColumns}
        onVisibilityChange={onVisibilityChange}
      />
    ); // no storageKey
    expect(navMocks.push).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("column-selection-trigger"));
    await user.click(await screen.findByRole("checkbox", { name: /Col B/ }));

    await waitFor(() => expect(mockCommitUrlSearch).toHaveBeenCalled());
    const url = mockCommitUrlSearch.mock.calls.at(-1)?.[0] as string;
    expect(url).toContain("columns=");
  });

  it("with column memory ON, a change updates both storage and the ?columns= URL", async () => {
    // The persist effect writes the change to storage; change-detection in the
    // URL effect compares against a stable mount-time snapshot (not re-read
    // storage), so the shareable ?columns= URL stays in sync with the change.
    const user = userEvent.setup();
    const onVisibilityChange = vi.fn();

    render(
      <ColumnSelection
        storageKey="mem-view"
        columns={wideColumns}
        onVisibilityChange={onVisibilityChange}
      />
    );

    await user.click(screen.getByTestId("column-selection-trigger"));
    await user.click(await screen.findByRole("checkbox", { name: /Col B/ }));

    // The change is remembered in storage...
    await waitFor(() =>
      expect(readStoredColumnVisibility("mem-view")?.colB).toBe(false)
    );
    // ...and the shareable URL is kept in sync.
    await waitFor(() => expect(mockCommitUrlSearch).toHaveBeenCalled());
    expect(mockCommitUrlSearch.mock.calls.at(-1)?.[0] as string).toContain(
      "columns="
    );
  });
});

// (4) Columns that load after mount (e.g. repository custom fields fetched
// async) — the initial state is computed once.
describe("columns that load after mount", () => {
  it("restores stored prefs for columns present at first render", () => {
    writeStoredColumnVisibility("late-view", { customField: false });
    const onVisibilityChange = vi.fn();

    render(
      <ColumnSelection
        storageKey="late-view"
        columns={columns}
        onVisibilityChange={onVisibilityChange}
      />
    );

    expect(lastVisibility(onVisibilityChange).customField).toBe(false);
  });

  it("applies stored prefs to columns that appear only after mount (async custom fields)", () => {
    // The user showed customField ("select all") and reloaded; the custom-field
    // column loads after the initial render.
    writeStoredColumnVisibility("late-view", { customField: true });
    const onVisibilityChange = vi.fn();
    const initialColumns = columns.filter((c) => c.id !== "customField");

    const { rerender } = render(
      <ColumnSelection
        storageKey="late-view"
        columns={initialColumns}
        onVisibilityChange={onVisibilityChange}
      />
    );
    expect(lastVisibility(onVisibilityChange)).not.toHaveProperty(
      "customField"
    );

    // customField arrives later (async custom-field columns).
    rerender(
      <ColumnSelection
        storageKey="late-view"
        columns={columns}
        onVisibilityChange={onVisibilityChange}
      />
    );

    // The late-arriving column is folded into the visibility map with its
    // remembered choice, so a "select all" made before the reload still applies
    // instead of the column falling back to its hidden default.
    expect(lastVisibility(onVisibilityChange).customField).toBe(true);
  });
});

// (5) Hiding a column through the ref out-param (used by the header "Hide
// column" menu) drives this control's own state — the same path as the
// checkbox — so it emits, persists, and keeps the checkbox in sync.
describe("hideColumnRef", () => {
  it("hides a column when the exposed function is called (emits + persists)", async () => {
    const onVisibilityChange = vi.fn();
    const hideColumnRef: { current: ((columnId: string) => void) | null } = {
      current: null,
    };

    render(
      <ColumnSelection
        storageKey="hide-view"
        columns={columns}
        hideColumnRef={hideColumnRef}
        onVisibilityChange={onVisibilityChange}
      />
    );

    // The control exposes its hide function and nothing is persisted yet.
    expect(hideColumnRef.current).toBeInstanceOf(Function);
    expect(lastVisibility(onVisibilityChange).description).toBe(true);
    expect(readStoredColumnVisibility("hide-view")).toBeNull();

    // The header menu hides `description` through the ref.
    act(() => hideColumnRef.current?.("description"));

    // It is emitted (so the table hides it and the checkbox unchecks)...
    expect(lastVisibility(onVisibilityChange).description).toBe(false);
    // ...and persisted so it survives a reload.
    await waitFor(() =>
      expect(readStoredColumnVisibility("hide-view")?.description).toBe(false)
    );
  });
});
