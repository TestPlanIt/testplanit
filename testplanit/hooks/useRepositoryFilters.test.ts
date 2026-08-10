import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildFilterDimensions } from "~/lib/repository/filterDimensions";
import {
  encodeCompressedFilterParam,
  FILTER_URL_PARAM_BUDGET,
  measureFilterParams,
  parseFilterParams,
} from "~/lib/repository/filterUrlCodec";
import {
  MAX_FILTER_PREDICATES,
  MAX_VALUES_PER_PREDICATE,
  type FilterPredicate,
} from "~/lib/schemas/repositoryFilterPredicates";
import {
  assertsAbsence,
  assertsValueExists,
  dropConflictingPredicates,
  predicatesConflict,
  useRepositoryFilters,
} from "./useRepositoryFilters";

// --- Mocks ---

const { mockRouterReplace, mockRouterPush, mockPathname } = vi.hoisted(() => ({
  mockRouterReplace: vi.fn(),
  mockRouterPush: vi.fn(),
  mockPathname: vi.fn(() => "/projects/repository/1"),
}));

vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({
    push: mockRouterPush,
    replace: mockRouterReplace,
    back: vi.fn(),
  }),
  usePathname: () => mockPathname(),
  Link: ({ children }: { children?: unknown }) => children,
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  // Mirrors the real subscription: reflects the current URL each render.
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const { mockCommitUrlSearch } = vi.hoisted(() => ({
  mockCommitUrlSearch: vi.fn(),
}));

vi.mock("~/lib/urlState", () => ({
  // Record writes as "pathname?search" so expectations read like URLs; the
  // read hook mirrors the real subscription by reflecting the current
  // (stubbed) location each render.
  commitUrlSearch: (url: string | URL) => {
    const u = new URL(url.toString(), "http://localhost");
    mockCommitUrlSearch(`${u.pathname}${u.search}`);
  },
  pushUrlSearch: vi.fn(),
  useLocationSearch: () => window.location.search,
}));

// --- Fixtures ---

const repoRegistry = buildFilterDimensions({
  dynamicFields: [{ fieldId: 12, type: "Text Long" }],
});
const runRegistry = buildFilterDimensions({ includeRunDimensions: true });

const templatesIn12: FilterPredicate = {
  dimension: "templates",
  operator: "in",
  values: [1, 2],
};
const tagsAny: FilterPredicate = {
  dimension: "tags",
  operator: "any",
  values: [],
};

function setLocation(search: string) {
  Object.defineProperty(window, "location", {
    value: {
      search,
      href: `http://localhost/projects/repository/1${search}`,
    },
    writable: true,
  });
}

function renderFilters({
  registry = repoRegistry,
  persistToUrl = true,
}: {
  registry?: typeof repoRegistry;
  persistToUrl?: boolean;
} = {}) {
  return renderHook(() => useRepositoryFilters({ registry, persistToUrl }));
}

describe("useRepositoryFilters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLocation("");
    mockPathname.mockReturnValue("/projects/repository/1");
  });

  describe("URL -> predicates parse (persistToUrl: true)", () => {
    it("parses predicates from repeated f params, ignoring other params", () => {
      setLocation("?node=5&f=templates:in:1,2&f=tags:any");

      const { result } = renderFilters();

      expect(result.current.predicates).toEqual([templatesIn12, tagsAny]);
    });

    it("drops unknown dimensions and run dims outside run mode", () => {
      setLocation("?f=bogus:in:1&f=status:in:3&f=templates:in:1");

      const { result } = renderFilters();

      expect(result.current.predicates).toEqual([
        { dimension: "templates", operator: "in", values: [1] },
      ]);
    });

    it("keeps run dims (with sentinels) when the registry includes them", () => {
      setLocation("?f=status:in:3,untested&f=assignedTo:in:cku1,unassigned");

      const { result } = renderFilters({ registry: runRegistry });

      expect(result.current.predicates).toEqual([
        { dimension: "status", operator: "in", values: [3, "untested"] },
        {
          dimension: "assignedTo",
          operator: "in",
          values: ["cku1", "unassigned"],
        },
      ]);
    });

    it("drops malformed params (no operator, bad values, over-long text)", () => {
      setLocation(
        `?f=templates&f=templates:in:nope&f=field_12:contains:${"x".repeat(300)}`
      );

      const { result } = renderFilters();

      expect(result.current.predicates).toEqual([]);
    });

    it("returns an empty array when no f params are present", () => {
      setLocation("?node=5&view=templates");

      const { result } = renderFilters();

      expect(result.current.predicates).toEqual([]);
    });
  });

  describe("setPredicates URL write", () => {
    it("writes f params via router.replace, preserving unrelated params", () => {
      // `status` here is the run-page MATRIX param — same name as the run
      // filter dimension, and it must survive untouched.
      setLocation("?node=42&view=templates&status=1&status=2");

      const { result } = renderFilters();
      act(() => {
        result.current.setPredicates([templatesIn12, tagsAny]);
      });

      expect(mockCommitUrlSearch).toHaveBeenCalledTimes(1);
      expect(mockCommitUrlSearch).toHaveBeenCalledWith(
        "/projects/repository/1?node=42&view=templates&status=1&status=2&f=templates:in:1,2&f=tags:any"
      );
    });

    it("component-encodes values so commas in free text round-trip", () => {
      const { result } = renderFilters();
      act(() => {
        result.current.setPredicates([
          { dimension: "field_12", operator: "contains", values: ["foo,bar"] },
        ]);
      });

      const url = mockCommitUrlSearch.mock.calls[0][0] as string;
      expect(url).toBe(
        "/projects/repository/1?f=field_12:contains:foo%252Cbar"
      );
      // Full wire round-trip: what was written parses back to the original.
      const written = new URLSearchParams(url.split("?")[1]);
      expect(parseFilterParams(written.getAll("f"), repoRegistry)).toEqual([
        { dimension: "field_12", operator: "contains", values: ["foo,bar"] },
      ]);
    });

    it("removes f params (only) when set to empty", () => {
      setLocation("?f=templates:in:5&node=1");

      const { result } = renderFilters();
      act(() => {
        result.current.setPredicates([]);
      });

      expect(mockCommitUrlSearch).toHaveBeenCalledWith(
        "/projects/repository/1?node=1"
      );
    });

    it("drops the query string entirely when nothing remains", () => {
      setLocation("?f=templates:in:5");

      const { result } = renderFilters();
      act(() => {
        result.current.setPredicates([]);
      });

      expect(mockCommitUrlSearch).toHaveBeenCalledWith(
        "/projects/repository/1"
      );
    });
  });

  describe("echo guard", () => {
    it("skips the write when the serialized f set matches the URL", () => {
      setLocation("?f=templates:in:1,2&f=tags:any");

      const { result } = renderFilters();
      act(() => {
        result.current.setPredicates([templatesIn12, tagsAny]);
      });

      expect(mockCommitUrlSearch).not.toHaveBeenCalled();
    });

    it("skips even when the URL carries the form-encoded variant", () => {
      setLocation("?f=templates%3Ain%3A1%2C2&f=tags%3Aany");

      const { result } = renderFilters();
      act(() => {
        result.current.setPredicates([templatesIn12, tagsAny]);
      });

      expect(mockCommitUrlSearch).not.toHaveBeenCalled();
    });

    it("skips when both the URL and the next set are empty", () => {
      setLocation("?node=1");

      const { result } = renderFilters();
      act(() => {
        result.current.setPredicates([]);
      });

      expect(mockCommitUrlSearch).not.toHaveBeenCalled();
    });

    it("writes when the f set actually differs", () => {
      setLocation("?f=templates:in:1");

      const { result } = renderFilters();
      act(() => {
        result.current.setPredicates([templatesIn12]);
      });

      expect(mockCommitUrlSearch).toHaveBeenCalledTimes(1);
    });
  });

  describe("persistToUrl: false (selection mode)", () => {
    it("never reads f params from the URL", () => {
      setLocation("?f=templates:in:1");

      const { result } = renderFilters({ persistToUrl: false });

      expect(result.current.predicates).toEqual([]);
    });

    it("keeps state in memory without touching the router", () => {
      setLocation("?f=templates:in:1");

      const { result } = renderFilters({ persistToUrl: false });
      act(() => {
        result.current.setPredicates([tagsAny]);
      });

      expect(result.current.predicates).toEqual([tagsAny]);
      expect(mockCommitUrlSearch).not.toHaveBeenCalled();
      expect(mockRouterPush).not.toHaveBeenCalled();
      expect(window.location.search).toBe("?f=templates:in:1");
    });
  });

  describe("mutators (keyed by dimension+operator)", () => {
    it("addPredicate appends a new predicate", () => {
      const { result } = renderFilters({ persistToUrl: false });

      act(() => {
        result.current.addPredicate(templatesIn12);
      });
      act(() => {
        result.current.addPredicate(tagsAny);
      });

      expect(result.current.predicates).toEqual([templatesIn12, tagsAny]);
    });

    it("addPredicate replaces an existing dimension+operator in place", () => {
      const { result } = renderFilters({ persistToUrl: false });

      act(() => {
        result.current.setPredicates([templatesIn12, tagsAny]);
      });
      act(() => {
        result.current.addPredicate({
          dimension: "templates",
          operator: "in",
          values: [3],
        });
      });

      expect(result.current.predicates).toEqual([
        { dimension: "templates", operator: "in", values: [3] },
        tagsAny,
      ]);
    });

    it("updatePredicate replaces the addressed chip's values", () => {
      const { result } = renderFilters({ persistToUrl: false });

      act(() => {
        result.current.setPredicates([templatesIn12]);
      });
      act(() => {
        result.current.updatePredicate("templates", "in", {
          dimension: "templates",
          operator: "in",
          values: [7],
        });
      });

      expect(result.current.predicates).toEqual([
        { dimension: "templates", operator: "in", values: [7] },
      ]);
    });

    it("updatePredicate re-keys the operator atomically", () => {
      const { result } = renderFilters({ persistToUrl: false });

      act(() => {
        result.current.setPredicates([
          { dimension: "tags", operator: "any", values: [1] },
        ]);
      });
      act(() => {
        result.current.updatePredicate("tags", "any", {
          dimension: "tags",
          operator: "none",
          values: [1],
        });
      });

      expect(result.current.predicates).toEqual([
        { dimension: "tags", operator: "none", values: [1] },
      ]);
    });

    it("updatePredicate drops another chip the re-key would collide with", () => {
      const { result } = renderFilters({ persistToUrl: false });

      act(() => {
        result.current.setPredicates([
          { dimension: "tags", operator: "any", values: [1] },
          { dimension: "tags", operator: "all", values: [2] },
        ]);
      });
      act(() => {
        result.current.updatePredicate("tags", "all", {
          dimension: "tags",
          operator: "any",
          values: [2],
        });
      });

      expect(result.current.predicates).toEqual([
        { dimension: "tags", operator: "any", values: [2] },
      ]);
    });

    it("updatePredicate removes the predicate when the last value goes", () => {
      const { result } = renderFilters({ persistToUrl: false });

      act(() => {
        result.current.setPredicates([templatesIn12, tagsAny]);
      });
      act(() => {
        result.current.updatePredicate("templates", "in", {
          dimension: "templates",
          operator: "in",
          values: [],
        });
      });

      expect(result.current.predicates).toEqual([tagsAny]);
    });

    it("updatePredicate keeps the bare form for zero-arity operators", () => {
      const { result } = renderFilters({ persistToUrl: false });

      act(() => {
        result.current.setPredicates([
          { dimension: "tags", operator: "any", values: [1] },
        ]);
      });
      act(() => {
        result.current.updatePredicate("tags", "any", {
          dimension: "tags",
          operator: "any",
          values: [],
        });
      });

      // Bare `tags:any` = "has a value" — a legitimate predicate, not empty.
      expect(result.current.predicates).toEqual([tagsAny]);
    });

    it("updatePredicate no-ops when the addressed chip is absent", () => {
      const { result } = renderFilters({ persistToUrl: false });

      act(() => {
        result.current.setPredicates([templatesIn12]);
      });
      act(() => {
        result.current.updatePredicate("states", "in", {
          dimension: "states",
          operator: "in",
          values: [1],
        });
      });

      expect(result.current.predicates).toEqual([templatesIn12]);
    });

    it("removePredicate removes only the addressed dimension+operator", () => {
      const { result } = renderFilters({ persistToUrl: false });

      act(() => {
        result.current.setPredicates([
          { dimension: "tags", operator: "any", values: [1] },
          { dimension: "tags", operator: "none", values: [5] },
        ]);
      });
      act(() => {
        result.current.removePredicate("tags", "none");
      });

      expect(result.current.predicates).toEqual([
        { dimension: "tags", operator: "any", values: [1] },
      ]);
    });

    it("clearPredicates removes everything", () => {
      const { result } = renderFilters({ persistToUrl: false });

      act(() => {
        result.current.setPredicates([templatesIn12, tagsAny]);
      });
      act(() => {
        result.current.clearPredicates();
      });

      expect(result.current.predicates).toEqual([]);
    });

    it("URL-mode addPredicate composes with the existing f params", () => {
      setLocation("?f=templates:in:1&node=9");

      const { result } = renderFilters();
      act(() => {
        result.current.addPredicate(tagsAny);
      });

      // delete-all-then-append: the f set re-serializes after the other params.
      expect(mockCommitUrlSearch).toHaveBeenCalledWith(
        "/projects/repository/1?node=9&f=templates:in:1&f=tags:any"
      );
    });

    it("URL-mode removePredicate rewrites the remaining set", () => {
      setLocation("?f=templates:in:1&f=tags:any");

      const { result } = renderFilters();
      act(() => {
        result.current.removePredicate("tags", "any");
      });

      expect(mockCommitUrlSearch).toHaveBeenCalledWith(
        "/projects/repository/1?f=templates:in:1"
      );
    });
  });

  describe("canonicalKey", () => {
    it("is stable under predicate reordering", () => {
      const { result } = renderFilters({ persistToUrl: false });

      act(() => {
        result.current.setPredicates([tagsAny, templatesIn12]);
      });
      const first = result.current.canonicalKey;

      act(() => {
        result.current.setPredicates([templatesIn12, tagsAny]);
      });

      expect(result.current.canonicalKey).toBe(first);
      expect(first).toBe("tags:any&templates:in:1,2");
    });
  });
});

describe("URL-length mitigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLocation("");
    mockPathname.mockReturnValue("/projects/repository/1");
  });

  /** Text-heavy predicates — the shape that actually blows the budget. */
  const bulky = (count: number): FilterPredicate[] =>
    Array.from({ length: count }, (_, index) => ({
      dimension: "field_12",
      operator: "contains",
      values: [`the quick brown fox jumps over the lazy dog ${index}`],
    }));

  function overBudgetPredicates(): FilterPredicate[] {
    let count = 1;
    while (
      measureFilterParams(bulky(count)) <= FILTER_URL_PARAM_BUDGET &&
      count < MAX_FILTER_PREDICATES
    ) {
      count += 1;
    }
    return bulky(count);
  }

  it("writes readable f params while under the budget", () => {
    const { result } = renderFilters();

    act(() => {
      result.current.setPredicates([templatesIn12]);
    });

    const [url] = mockCommitUrlSearch.mock.calls[0];
    expect(url).toContain("f=templates:in:1,2");
    expect(url).not.toContain("fz=");
  });

  it("switches to a single fz param over the budget and round-trips it", () => {
    const predicates = overBudgetPredicates();
    const { result } = renderFilters();

    act(() => {
      result.current.setPredicates(predicates);
    });

    const [url] = mockCommitUrlSearch.mock.calls[0] as [string];
    const search = url.slice(url.indexOf("?"));
    expect(search).toMatch(/[?&]fz=/);
    expect(search).not.toContain("f=");
    expect(search.length).toBeLessThan(measureFilterParams(predicates));

    setLocation(search);
    const reloaded = renderFilters();
    expect(reloaded.result.current.predicates).toEqual(predicates);
  });

  it("clears a stale fz when the filters shrink back under budget", () => {
    const fz = encodeCompressedFilterParam(overBudgetPredicates())!;
    setLocation(`?node=5&fz=${fz}`);
    const { result } = renderFilters();

    act(() => {
      result.current.setPredicates([templatesIn12]);
    });

    const [url] = mockCommitUrlSearch.mock.calls[0] as [string];
    expect(url).toContain("node=5");
    expect(url).toContain("f=templates:in:1,2");
    expect(url).not.toContain("fz=");
  });

  it("reads fz and ignores f params sitting next to it", () => {
    const fz = encodeCompressedFilterParam([tagsAny])!;
    setLocation(`?f=templates:in:1,2&fz=${fz}`);
    const { result } = renderFilters();

    expect(result.current.predicates).toEqual([tagsAny]);
  });

  it("drops everything when fz is corrupt, without throwing", () => {
    setLocation("?f=templates:in:1,2&fz=u!!!!");
    const { result } = renderFilters();

    expect(result.current.predicates).toEqual([]);
    expect(result.current.canonicalKey).toBe("");
  });

  it("caps predicates on read and reports the truncation", () => {
    const search = Array.from(
      { length: MAX_FILTER_PREDICATES + 3 },
      (_, i) => `f=field_12:contains:value${i}`
    ).join("&");
    setLocation(`?${search}`);
    const { result } = renderFilters();

    expect(result.current.predicates).toHaveLength(MAX_FILTER_PREDICATES);
    expect(result.current.truncation.predicatesDropped).toBe(3);
    expect(result.current.limitReached).toBe(true);
  });

  it("caps predicates on write too, and says so", () => {
    const { result } = renderFilters({ persistToUrl: false });

    act(() => {
      result.current.setPredicates(bulky(MAX_FILTER_PREDICATES + 5));
    });

    expect(result.current.predicates).toHaveLength(MAX_FILTER_PREDICATES);
    expect(result.current.limitReached).toBe(true);
    // The write-path clamp is reported, not silent — the FilterBar renders it.
    expect(result.current.truncation).toEqual({
      predicatesDropped: 5,
      valuesTruncated: [],
    });
  });

  it("caps values per predicate on write, so the url survives a re-read", () => {
    const values = Array.from(
      { length: MAX_VALUES_PER_PREDICATE + 6 },
      (_, i) => i + 1
    );
    const { result } = renderFilters();

    act(() => {
      result.current.setPredicates([
        { dimension: "templates", operator: "in", values },
      ]);
    });

    const [url] = mockCommitUrlSearch.mock.calls[0] as [string];
    setLocation(url.slice(url.indexOf("?")));
    const { result: reread } = renderFilters();

    expect(reread.current.predicates[0]!.values).toHaveLength(
      MAX_VALUES_PER_PREDICATE
    );
    expect(reread.current.truncation).toEqual({
      predicatesDropped: 0,
      valuesTruncated: [],
    });
    expect(result.current.truncation).toEqual({
      predicatesDropped: 0,
      valuesTruncated: ["templates"],
    });
  });

  it("skips the write when the compressed param already matches", () => {
    const predicates = overBudgetPredicates();
    const fz = encodeCompressedFilterParam(predicates)!;
    setLocation(`?fz=${fz}`);
    const { result } = renderFilters();

    act(() => {
      result.current.setPredicates(predicates);
    });

    expect(mockCommitUrlSearch).not.toHaveBeenCalled();
  });
});

describe("contradictory predicate resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLocation("");
    mockPathname.mockReturnValue("/projects/repository/1");
  });

  const bareNone = (dimension: string): FilterPredicate => ({
    dimension,
    operator: "none",
    values: [],
  });

  describe("predicate helpers", () => {
    it.each([
      "in",
      "all",
      "is",
      "eq",
      "ne",
      "lt",
      "lte",
      "gt",
      "gte",
      "between",
      "on",
      "before",
      "after",
      "last7",
      "last30",
      "last90",
      "thisYear",
      "contains",
      "notContains",
      "startsWith",
      "endsWith",
      "domain",
    ])("treats %s as asserting a value exists", (operator) => {
      const predicate = { dimension: "field_2", operator, values: [1] };
      expect(assertsValueExists(predicate)).toBe(true);
      expect(assertsAbsence(predicate)).toBe(false);
    });

    it("treats both faces of `any` as asserting a value exists", () => {
      expect(
        assertsValueExists({ dimension: "tags", operator: "any", values: [] })
      ).toBe(true);
      expect(
        assertsValueExists({ dimension: "tags", operator: "any", values: [1] })
      ).toBe(true);
    });

    it("treats only the BARE none as asserting absence", () => {
      expect(assertsAbsence(bareNone("tags"))).toBe(true);
      expect(
        assertsAbsence({ dimension: "tags", operator: "none", values: [5] })
      ).toBe(false);
      expect(
        assertsValueExists({ dimension: "tags", operator: "none", values: [5] })
      ).toBe(false);
    });

    it("conflicts only within one dimension", () => {
      expect(predicatesConflict(bareNone("tags"), tagsAny)).toBe(true);
      expect(predicatesConflict(tagsAny, bareNone("tags"))).toBe(true);
      expect(predicatesConflict(bareNone("tags"), templatesIn12)).toBe(false);
    });

    it("never conflicts with a valued none (has A but not B stays legal)", () => {
      const valuedNone: FilterPredicate = {
        dimension: "tags",
        operator: "none",
        values: [5],
      };
      expect(predicatesConflict(valuedNone, tagsAny)).toBe(false);
      expect(predicatesConflict(valuedNone, bareNone("tags"))).toBe(false);
    });

    it("dropConflictingPredicates keeps the added predicate itself", () => {
      const added = bareNone("tags");
      expect(dropConflictingPredicates([tagsAny, added], added)).toEqual([
        added,
      ]);
    });
  });

  it("adding bare none drops the dimension's value-asserting predicates", () => {
    const { result } = renderFilters({ persistToUrl: false });

    act(() => {
      result.current.setPredicates([
        templatesIn12,
        { dimension: "tags", operator: "any", values: [1, 2] },
        { dimension: "tags", operator: "all", values: [3] },
      ]);
    });
    act(() => {
      result.current.addPredicate(bareNone("tags"));
    });

    expect(result.current.predicates).toEqual([
      templatesIn12,
      bareNone("tags"),
    ]);
  });

  it("adding a value-asserting predicate drops the dimension's bare none", () => {
    const { result } = renderFilters({ persistToUrl: false });

    act(() => {
      result.current.setPredicates([bareNone("field_2"), templatesIn12]);
    });
    act(() => {
      result.current.addPredicate({
        dimension: "field_2",
        operator: "in",
        values: [147],
      });
    });

    // The live repro: "None" + one dropdown option no longer AND to nothing.
    expect(result.current.predicates).toEqual([
      templatesIn12,
      { dimension: "field_2", operator: "in", values: [147] },
    ]);
  });

  it("bare none and bare any on one dimension are mutually exclusive", () => {
    const { result } = renderFilters({ persistToUrl: false });

    act(() => {
      result.current.setPredicates([tagsAny]);
    });
    act(() => {
      result.current.addPredicate(bareNone("tags"));
    });
    expect(result.current.predicates).toEqual([bareNone("tags")]);

    act(() => {
      result.current.addPredicate(tagsAny);
    });
    expect(result.current.predicates).toEqual([tagsAny]);
  });

  it("text-operator predicates conflict with the same field's bare none", () => {
    const { result } = renderFilters({ persistToUrl: false });

    act(() => {
      result.current.setPredicates([
        { dimension: "field_12", operator: "contains", values: ["foo"] },
      ]);
    });
    act(() => {
      result.current.addPredicate(bareNone("field_12"));
    });

    expect(result.current.predicates).toEqual([bareNone("field_12")]);
  });

  it("keeps a valued none next to a value-asserting predicate", () => {
    const { result } = renderFilters({ persistToUrl: false });
    const valuedNone: FilterPredicate = {
      dimension: "tags",
      operator: "none",
      values: [5],
    };

    act(() => {
      result.current.setPredicates([
        {
          dimension: "tags",
          operator: "any",
          values: [1],
        },
      ]);
    });
    act(() => {
      result.current.addPredicate(valuedNone);
    });

    // "has tag 1 but not tag 5" is legitimate and must keep working.
    expect(result.current.predicates).toEqual([
      { dimension: "tags", operator: "any", values: [1] },
      valuedNone,
    ]);
  });

  it("leaves other dimensions' predicates alone", () => {
    const { result } = renderFilters({ persistToUrl: false });

    act(() => {
      result.current.setPredicates([templatesIn12, tagsAny]);
    });
    act(() => {
      result.current.addPredicate(bareNone("states"));
    });

    expect(result.current.predicates).toEqual([
      templatesIn12,
      tagsAny,
      bareNone("states"),
    ]);
  });

  it("updatePredicate re-keying to bare none drops the conflicting chip", () => {
    const { result } = renderFilters({ persistToUrl: false });

    act(() => {
      result.current.setPredicates([
        { dimension: "tags", operator: "any", values: [1] },
        { dimension: "tags", operator: "all", values: [2] },
      ]);
    });
    act(() => {
      result.current.updatePredicate("tags", "all", bareNone("tags"));
    });

    expect(result.current.predicates).toEqual([bareNone("tags")]);
  });

  it("updatePredicate emptying a valued none turns it into a conflicting bare none", () => {
    const { result } = renderFilters({ persistToUrl: false });

    act(() => {
      result.current.setPredicates([
        { dimension: "tags", operator: "any", values: [1] },
        { dimension: "tags", operator: "none", values: [5] },
      ]);
    });
    act(() => {
      result.current.updatePredicate("tags", "none", bareNone("tags"));
    });

    expect(result.current.predicates).toEqual([bareNone("tags")]);
  });

  it("updatePredicate re-keying away from bare none keeps unrelated chips", () => {
    const { result } = renderFilters({ persistToUrl: false });

    act(() => {
      result.current.setPredicates([templatesIn12, bareNone("tags")]);
    });
    act(() => {
      result.current.updatePredicate("tags", "none", {
        dimension: "tags",
        operator: "any",
        values: [7],
      });
    });

    expect(result.current.predicates).toEqual([
      templatesIn12,
      { dimension: "tags", operator: "any", values: [7] },
    ]);
  });

  it("setPredicates stays permissive — it never rewrites a contradiction", () => {
    const { result } = renderFilters({ persistToUrl: false });

    act(() => {
      result.current.setPredicates([bareNone("tags"), tagsAny]);
    });

    expect(result.current.predicates).toEqual([bareNone("tags"), tagsAny]);
  });

  it("the URL parse path stays permissive — a shared contradictory link renders both chips", () => {
    setLocation("?f=tags:none&f=tags:any:1");

    const { result } = renderFilters();

    expect(result.current.predicates).toEqual([
      bareNone("tags"),
      { dimension: "tags", operator: "any", values: [1] },
    ]);
    expect(mockCommitUrlSearch).not.toHaveBeenCalled();
  });
});
