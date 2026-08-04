import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildFilterDimensions } from "~/lib/repository/filterDimensions";
import { parseFilterParams } from "~/lib/repository/filterUrlCodec";
import type { FilterPredicate } from "~/lib/schemas/repositoryFilterPredicates";
import { useRepositoryFilters } from "./useRepositoryFilters";

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

      expect(mockRouterReplace).toHaveBeenCalledTimes(1);
      expect(mockRouterReplace).toHaveBeenCalledWith(
        "/projects/repository/1?node=42&view=templates&status=1&status=2&f=templates:in:1,2&f=tags:any",
        { scroll: false }
      );
    });

    it("component-encodes values so commas in free text round-trip", () => {
      const { result } = renderFilters();
      act(() => {
        result.current.setPredicates([
          { dimension: "field_12", operator: "contains", values: ["foo,bar"] },
        ]);
      });

      const url = mockRouterReplace.mock.calls[0][0] as string;
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

      expect(mockRouterReplace).toHaveBeenCalledWith(
        "/projects/repository/1?node=1",
        { scroll: false }
      );
    });

    it("drops the query string entirely when nothing remains", () => {
      setLocation("?f=templates:in:5");

      const { result } = renderFilters();
      act(() => {
        result.current.setPredicates([]);
      });

      expect(mockRouterReplace).toHaveBeenCalledWith("/projects/repository/1", {
        scroll: false,
      });
    });
  });

  describe("echo guard", () => {
    it("skips the write when the serialized f set matches the URL", () => {
      setLocation("?f=templates:in:1,2&f=tags:any");

      const { result } = renderFilters();
      act(() => {
        result.current.setPredicates([templatesIn12, tagsAny]);
      });

      expect(mockRouterReplace).not.toHaveBeenCalled();
    });

    it("skips even when the URL carries the form-encoded variant", () => {
      setLocation("?f=templates%3Ain%3A1%2C2&f=tags%3Aany");

      const { result } = renderFilters();
      act(() => {
        result.current.setPredicates([templatesIn12, tagsAny]);
      });

      expect(mockRouterReplace).not.toHaveBeenCalled();
    });

    it("skips when both the URL and the next set are empty", () => {
      setLocation("?node=1");

      const { result } = renderFilters();
      act(() => {
        result.current.setPredicates([]);
      });

      expect(mockRouterReplace).not.toHaveBeenCalled();
    });

    it("writes when the f set actually differs", () => {
      setLocation("?f=templates:in:1");

      const { result } = renderFilters();
      act(() => {
        result.current.setPredicates([templatesIn12]);
      });

      expect(mockRouterReplace).toHaveBeenCalledTimes(1);
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
      expect(mockRouterReplace).not.toHaveBeenCalled();
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
      expect(mockRouterReplace).toHaveBeenCalledWith(
        "/projects/repository/1?node=9&f=templates:in:1&f=tags:any",
        { scroll: false }
      );
    });

    it("URL-mode removePredicate rewrites the remaining set", () => {
      setLocation("?f=templates:in:1&f=tags:any");

      const { result } = renderFilters();
      act(() => {
        result.current.removePredicate("tags", "any");
      });

      expect(mockRouterReplace).toHaveBeenCalledWith(
        "/projects/repository/1?f=templates:in:1",
        { scroll: false }
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
