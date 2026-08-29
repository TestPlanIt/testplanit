// Unit-lane proof for requirementTree's roots-window primitives (SCALE-02).
// Two techniques, mirroring this file family's own established split
// (requirementCoverage.test.ts): behavioral tests against a mocked Kysely
// executor (the same $qb.getExecutor() shape matrixCellCount.test.ts and
// requirementCoverage.test.ts already use) prove the pagination LOGIC --
// dropping the extra row, deriving nextCursor from the last KEPT row, and
// coercing a count to a JS number -- while source-text assertions prove the
// SQL SHAPE: the project/role/soft-delete predicates repeated in both the
// outer query and the EXISTS child-presence subquery, no OFFSET, and the
// limit+1 fetch. The live-DB half (real recursive/keyset correctness under
// concurrent inserts) can only be proven against real Postgres -- see
// requirements-tree-lazy.integration.test.ts and
// requirements-tree-threshold.integration.test.ts for that half.
//
// Run via:
//   cd testplanit && pnpm exec vitest run lib/services/requirementTree.test.ts

import { readFileSync } from "node:fs";

import { PostgresQueryCompiler } from "kysely";
import { describe, expect, it, vi } from "vitest";

// 28-19: `getRequirementFilterFacets`'s coverage axis calls
// `getRequirementCoverage` (requirementCoverage.ts) rather than recomputing
// coverage in SQL -- mocked here so this file's facet tests stay a true
// unit lane (no live rollup query), the same isolation
// `tree/route.test.ts` already applies to the identical import for its own
// coverage-axis tests.
vi.mock("~/lib/services/requirementCoverage", () => ({
  getRequirementCoverage: vi.fn(),
}));

import {
  countProjectRequirements,
  getRequirementChildren,
  getRequirementFilterFacets,
  getRequirementRootsPage,
  REQUIREMENT_LAZY_THRESHOLD,
  resolveRequirementMatches,
  type RequirementMatchPage,
  type RequirementTreeFilterAxes,
  type RequirementTreeRow,
} from "./requirementTree";
import { getRequirementCoverage } from "~/lib/services/requirementCoverage";
import type { RequirementCoverageBreakdown } from "~/lib/services/requirementCoverage";

const mockedGetRequirementCoverage =
  getRequirementCoverage as unknown as ReturnType<typeof vi.fn>;

const FILE_PATH = "lib/services/requirementTree.ts";

function makeMockDb(rows: unknown[]) {
  return {
    $qb: {
      getExecutor: () => ({
        transformQuery: (n: unknown) => n,
        compileQuery: (n: unknown) => n,
        executeQuery: async () => ({ rows }),
      }),
    },
  };
}

/**
 * A richer mock than `makeMockDb` above: it runs every compiled query
 * through a REAL `PostgresQueryCompiler`, so `captured` ends up holding the
 * actual `{ sql, parameters }` Postgres would receive -- not the stub
 * pass-through `compileQuery: (n) => n` uses, which never turns the
 * `RawNode` into real SQL text at all. This is what lets a test assert on
 * the ACTUAL BOUND PARAMETER VALUE (T-28-09-01/02: the escaped search term,
 * the coverage id array, ...) rather than merely on the row data a canned
 * response returns, which would prove nothing about how the term reached
 * the query. `resolveRequirementMatches` issues at most one query per call
 * in this file's Task 1 scope (the ancestor-closure and row-hydration
 * queries are still stubbed off -- see Task 2), so one queued response is
 * enough for every test below; `getCallCount` still guards against a
 * regression that silently starts issuing more.
 */
function makeCapturingMockDb(rowsSequence: unknown[][]) {
  const compiler = new PostgresQueryCompiler();
  const captured: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  let call = 0;
  const db = {
    $qb: {
      getExecutor: () => ({
        transformQuery: (n: unknown) => n,
        compileQuery: (node: unknown) =>
          compiler.compileQuery(
            node as never,
            { queryId: `q${call}` } as never
          ),
        executeQuery: async (compiled: {
          sql: string;
          parameters: readonly unknown[];
        }) => {
          captured.push({ sql: compiled.sql, parameters: compiled.parameters });
          if (call >= rowsSequence.length) {
            throw new Error(
              `makeCapturingMockDb: unexpected query call #${call + 1} -- only ${rowsSequence.length} response(s) were configured`
            );
          }
          const rows = rowsSequence[call];
          call += 1;
          return { rows };
        },
      }),
    },
  };
  return { db, captured, getCallCount: () => call };
}

function makeMatchRow(
  overrides: Partial<RequirementTreeRow> & {
    matchedTotal?: number | bigint;
    requirementSortKey?: unknown;
  } = {}
) {
  return {
    requirementSortKey: overrides.name ?? "a",
    id: 1,
    name: "a",
    title: "a",
    status: null,
    externalStatus: null,
    priority: null,
    externalId: null,
    externalKey: null,
    externalUrl: null,
    issueTypeId: null,
    issueTypeName: null,
    issueTypeIconUrl: null,
    contentUpdatedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    projectId: 1,
    integrationId: null,
    parentId: null,
    isRequirement: true,
    requirementDetachedAt: null,
    isDeleted: false,
    hasChildren: false,
    matchedTotal: 1,
    ...overrides,
  };
}

const NO_AXES: RequirementTreeFilterAxes = {
  search: "",
  status: [],
  source: [],
};

// The page queries also SELECT the sort key (`requirementSortKey`), which is
// what the next cursor is derived from -- a mock row without one would make
// every cursor assertion below prove nothing. Defaulted to the row's own
// `name`, which is exactly what the default name sort's expression produces
// for a row whose title is not distinct.
function makeRow(
  overrides: Partial<RequirementTreeRow> & { requirementSortKey?: unknown }
): RequirementTreeRow {
  return {
    requirementSortKey: overrides.name ?? "a",
    id: 1,
    name: "a",
    title: "a",
    status: null,
    externalStatus: null,
    priority: null,
    externalId: null,
    externalKey: null,
    externalUrl: null,
    issueTypeId: null,
    issueTypeName: null,
    issueTypeIconUrl: null,
    contentUpdatedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    projectId: 1,
    integrationId: null,
    parentId: null,
    isRequirement: true,
    requirementDetachedAt: null,
    isDeleted: false,
    hasChildren: false,
    ...overrides,
  };
}

describe("REQUIREMENT_LAZY_THRESHOLD", () => {
  it("is fixed at 500 with no configuration knob (28-CONTEXT D-01)", () => {
    expect(REQUIREMENT_LAZY_THRESHOLD).toBe(500);
  });
});

describe("countProjectRequirements (unit, mocked $qb)", () => {
  it("returns a JS number even when the driver hands back a BigInt", async () => {
    const db = makeMockDb([{ count: 500n }]);
    const result = await countProjectRequirements(1, db as never);
    expect(result).toBe(500);
    expect(typeof result).toBe("number");
  });

  it("returns 0 when the project has no rows at all", async () => {
    const db = makeMockDb([]);
    const result = await countProjectRequirements(1, db as never);
    expect(result).toBe(0);
  });
});

describe("getRequirementRootsPage (unit, mocked $qb)", () => {
  it("returns nextCursor: null when exactly `limit` rows come back (no extra row)", async () => {
    const rows = [makeRow({ id: 1, name: "a" }), makeRow({ id: 2, name: "b" })];
    const db = makeMockDb(rows);
    const page = await getRequirementRootsPage(
      { projectId: 1, limit: 2 },
      db as never
    );
    expect(page.rows).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it("drops the limit+1th row and derives nextCursor from the LAST KEPT row, not the dropped one", async () => {
    // limit=2, three rows returned (the limit+1 fetch) -- the third exists
    // ONLY to signal "is there more". Using ITS (name, id) as the cursor
    // would make the next page's strict `>` comparison skip it entirely,
    // since it was never returned on THIS page either -- a lost row.
    const rows = [
      makeRow({ id: 1, name: "a" }),
      makeRow({ id: 2, name: "b" }),
      makeRow({ id: 3, name: "c" }),
    ];
    const db = makeMockDb(rows);
    const page = await getRequirementRootsPage(
      { projectId: 1, limit: 2 },
      db as never
    );
    expect(page.rows).toHaveLength(2);
    expect(page.rows.map((r) => r.id)).toEqual([1, 2]);
    expect(page.nextCursor).toEqual({ value: "b", id: 2 });
  });

  it("accepts a hostile cursor value without throwing (T-28-08-03) -- real injection immunity comes from parameterization, proven structurally below", async () => {
    const rows = [makeRow({ id: 5, name: "z" })];
    const db = makeMockDb(rows);
    await expect(
      getRequirementRootsPage(
        {
          projectId: 1,
          limit: 10,
          cursor: { value: '\'); DROP TABLE "Issue"; --', id: 999 },
        },
        db as never
      )
    ).resolves.toEqual({
      // The sort key is stripped from the rows a caller sees -- it is a
      // paging mechanism, not part of `RequirementTreeRow`.
      rows: rows.map((row) => {
        const { requirementSortKey: _key, ...rest } =
          row as RequirementTreeRow & Record<string, unknown>;
        return rest;
      }),
      nextCursor: null,
    });
  });
});

describe("getRequirementChildren (unit, mocked $qb)", () => {
  it("returns the mocked rows unmodified, each carrying its own hasChildren", async () => {
    const rows = [
      makeRow({ id: 10, name: "child-a", parentId: 1, hasChildren: false }),
      makeRow({ id: 11, name: "child-b", parentId: 1, hasChildren: true }),
    ];
    const db = makeMockDb(rows);
    const children = await getRequirementChildren(
      { projectId: 1, parentId: 1 },
      db as never
    );
    expect(children).toEqual(rows);
  });

  it("returns an empty array when the mocked executor reports no rows", async () => {
    const db = makeMockDb([]);
    const children = await getRequirementChildren(
      { projectId: 1, parentId: 999 },
      db as never
    );
    expect(children).toEqual([]);
  });
});

describe("resolveRequirementMatches -- caller-error guard (unit, mocked $qb)", () => {
  it("rejects a call with no active axis at all -- an unfiltered read is getRequirementRootsPage's job", async () => {
    const { db } = makeCapturingMockDb([[]]);
    await expect(
      resolveRequirementMatches(
        {
          projectId: 1,
          axes: NO_AXES,
          coverageMatchIds: null,
          limit: 50,
          include: "ids",
        },
        db as never
      )
    ).rejects.toThrow(/at least one filter axis must be active/);
  });

  it("does NOT reject coverageMatchIds: [] as 'no active axis' -- a non-null empty array is still an ACTIVE axis that matches nothing", async () => {
    const { db } = makeCapturingMockDb([[]]);
    const result = await resolveRequirementMatches(
      {
        projectId: 1,
        axes: NO_AXES,
        coverageMatchIds: [],
        limit: 50,
        include: "ids",
      },
      db as never
    );
    expect(result.matchedIds).toEqual([]);
    expect(result.matchedTotal).toBe(0);
  });
});

describe("resolveRequirementMatches -- the three SQL axes (unit, mocked $qb + real compiler)", () => {
  it("builds an ILIKE predicate for the search axis, binding the term as a parameter (never interpolated)", async () => {
    const { db, captured } = makeCapturingMockDb([[]]);
    await resolveRequirementMatches(
      {
        projectId: 1,
        axes: { search: "widget", status: [], source: [] },
        coverageMatchIds: null,
        limit: 50,
        include: "ids",
      },
      db as never
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].sql).toMatch(/ILIKE \$\d+/i);
    expect(captured[0].parameters).toContain("%widget%");
  });

  it("escapes %, _, and a literal backslash in the search term before wrapping it, and binds the ESCAPED value", async () => {
    const { db, captured } = makeCapturingMockDb([[]]);
    await resolveRequirementMatches(
      {
        projectId: 1,
        axes: { search: "100% off_sale", status: [], source: [] },
        coverageMatchIds: null,
        limit: 50,
        include: "ids",
      },
      db as never
    );
    expect(captured[0].parameters).toContain("%100\\% off\\_sale%");
  });

  it("escapes a literal backslash FIRST, so it cannot re-escape the %/_ substitutions that follow it", async () => {
    const { db, captured } = makeCapturingMockDb([[]]);
    await resolveRequirementMatches(
      {
        projectId: 1,
        axes: { search: "a\\b", status: [], source: [] },
        coverageMatchIds: null,
        limit: 50,
        include: "ids",
      },
      db as never
    );
    expect(captured[0].parameters).toContain("%a\\\\b%");
  });

  it("a search term containing NO wildcard metacharacters round-trips unescaped except for the wrapping %", async () => {
    const { db, captured } = makeCapturingMockDb([[]]);
    await resolveRequirementMatches(
      {
        projectId: 1,
        axes: { search: "plainterm", status: [], source: [] },
        coverageMatchIds: null,
        limit: 50,
        include: "ids",
      },
      db as never
    );
    expect(captured[0].parameters).toContain("%plainterm%");
  });

  // Server-side sorting. The defect these guard against is specific: a sort
  // applied only in the browser orders the loaded WINDOW, so on a project
  // larger than one page the top of a "coverage descending" list is not the
  // project's most-covered requirement, it is the most-covered of the first
  // hundred rows sorted by name.
  it("orders by the requested column and direction, with id carrying the SAME direction so the keyset tuple stays valid", async () => {
    const { db, captured } = makeCapturingMockDb([[]]);
    await resolveRequirementMatches(
      {
        projectId: 1,
        axes: { search: "widget", status: [], source: [] },
        coverageMatchIds: null,
        limit: 50,
        include: "ids",
        sort: { column: "priority", direction: "desc" },
      },
      db as never
    );
    expect(captured[0].sql).toContain(
      'ORDER BY "requirementSortKey" DESC, id DESC'
    );
  });

  it("sorts a coverage-derived column through the caller's precomputed values, LEFT joined so a requirement missing from the rollup still appears", async () => {
    const { db, captured } = makeCapturingMockDb([[]]);
    await resolveRequirementMatches(
      {
        projectId: 1,
        axes: { search: "widget", status: [], source: [] },
        coverageMatchIds: null,
        limit: 50,
        include: "ids",
        sort: {
          column: "coverage",
          direction: "desc",
          coverageValues: { ids: [7, 8], values: [30_001, 2] },
        },
      },
      db as never
    );
    expect(captured[0].sql).toContain("LEFT JOIN unnest(");
    expect(captured[0].sql).toContain("COALESCE(req_sort.value, -1)");
    expect(captured[0].parameters).toContainEqual([7, 8]);
    expect(captured[0].parameters).toContainEqual([30_001, 2]);
  });

  it("never joins the coverage value relation for a plain Issue column -- an ordinary sort must not pay for the rollup", async () => {
    const { db, captured } = makeCapturingMockDb([[]]);
    await resolveRequirementMatches(
      {
        projectId: 1,
        axes: { search: "widget", status: [], source: [] },
        coverageMatchIds: null,
        limit: 50,
        include: "ids",
        sort: { column: "status", direction: "asc" },
      },
      db as never
    );
    expect(captured[0].sql).not.toContain("LEFT JOIN unnest(");
  });

  it("binds a descending cursor with `<`, not `>` -- the page walks the direction it is ordered in", async () => {
    const { db, captured } = makeCapturingMockDb([[]]);
    await resolveRequirementMatches(
      {
        projectId: 1,
        axes: { search: "widget", status: [], source: [] },
        coverageMatchIds: null,
        limit: 50,
        include: "ids",
        sort: { column: "createdAt", direction: "desc" },
        cursor: { value: "2026-01-01T00:00:00.000Z", id: 9 },
      },
      db as never
    );
    expect(captured[0].sql).toContain('("requirementSortKey", id) <');
    expect(captured[0].parameters).toContain("2026-01-01T00:00:00.000Z");
  });

  it("builds the lock-aware status CASE predicate for the status axis, binding the selected values as one array parameter", async () => {
    const { db, captured } = makeCapturingMockDb([[]]);
    await resolveRequirementMatches(
      {
        projectId: 1,
        axes: { search: "", status: ["Open"], source: [] },
        coverageMatchIds: null,
        limit: 50,
        include: "ids",
      },
      db as never
    );
    expect(captured[0].sql).toMatch(/CASE/i);
    expect(captured[0].sql).toContain('"externalStatus"');
    expect(captured[0].sql).toMatch(/= ANY\(\$\d+::text\[\]\)/);
    expect(captured[0].parameters).toContainEqual(["Open"]);
  });

  it("unions WITHIN the status axis -- several selected statuses become ONE `= ANY(...)`, never several ANDed equalities that could match nothing", async () => {
    const { db, captured } = makeCapturingMockDb([[]]);
    await resolveRequirementMatches(
      {
        projectId: 1,
        axes: { search: "", status: ["Open", "Closed"], source: [] },
        coverageMatchIds: null,
        limit: 50,
        include: "ids",
      },
      db as never
    );
    expect(captured[0].sql.match(/= ANY\(\$\d+::text\[\]\)/g)).toHaveLength(1);
    expect(captured[0].parameters).toContainEqual(["Open", "Closed"]);
  });

  it("builds the source CASE predicate for the source axis, binding the selected values as one array parameter", async () => {
    const { db, captured } = makeCapturingMockDb([[]]);
    await resolveRequirementMatches(
      {
        projectId: 1,
        axes: { search: "", status: [], source: ["DETACHED"] },
        coverageMatchIds: null,
        limit: 50,
        include: "ids",
      },
      db as never
    );
    expect(captured[0].sql).toMatch(/CASE/i);
    expect(captured[0].sql).toContain("'MANUAL'");
    expect(captured[0].sql).toMatch(/= ANY\(\$\d+::text\[\]\)/);
    expect(captured[0].parameters).toContainEqual(["DETACHED"]);
  });

  it("still ANDs ACROSS axes when both are multi-valued -- two `= ANY(...)` predicates joined by AND, never one flattened list", async () => {
    const { db, captured } = makeCapturingMockDb([[]]);
    await resolveRequirementMatches(
      {
        projectId: 1,
        axes: {
          search: "",
          status: ["Open", "Closed"],
          source: ["MANUAL", "SYNCED"],
        },
        coverageMatchIds: null,
        limit: 50,
        include: "ids",
      },
      db as never
    );
    expect(captured[0].sql.match(/= ANY\(\$\d+::text\[\]\)/g)).toHaveLength(2);
    expect(captured[0].sql).toContain(" AND ");
    expect(captured[0].parameters).toContainEqual(["Open", "Closed"]);
    expect(captured[0].parameters).toContainEqual(["MANUAL", "SYNCED"]);
  });

  it("builds an `= ANY(...)` predicate for the coverage axis, binding the id array as a parameter", async () => {
    const { db, captured } = makeCapturingMockDb([[]]);
    await resolveRequirementMatches(
      {
        projectId: 1,
        axes: NO_AXES,
        coverageMatchIds: [7, 8, 9],
        limit: 50,
        include: "ids",
      },
      db as never
    );
    expect(captured[0].sql).toMatch(/= ANY\(\$\d+::int\[\]\)/);
    expect(captured[0].parameters).toContainEqual(
      expect.arrayContaining([7, 8, 9])
    );
  });

  it("an empty (non-null) coverageMatchIds array still emits the ANY() predicate, bound to an empty array -- never silently dropped", async () => {
    const { db, captured } = makeCapturingMockDb([[]]);
    await resolveRequirementMatches(
      {
        projectId: 1,
        axes: NO_AXES,
        coverageMatchIds: [],
        limit: 50,
        include: "ids",
      },
      db as never
    );
    expect(captured[0].sql).toMatch(/= ANY\(\$\d+::int\[\]\)/);
    expect(captured[0].parameters).toContainEqual([]);
  });
});

describe("resolveRequirementMatches -- intersection, never union (unit, mocked $qb + real compiler)", () => {
  it("ANDs two active axes together in the compiled SQL, never ORs them", async () => {
    const { db, captured } = makeCapturingMockDb([[]]);
    await resolveRequirementMatches(
      {
        projectId: 1,
        axes: { search: "widget", status: ["Open"], source: [] },
        coverageMatchIds: null,
        limit: 50,
        include: "ids",
      },
      db as never
    );
    expect(captured[0].sql).toMatch(/ILIKE \$\d+\)?\s+AND\s+/i);
    expect(captured[0].sql.toUpperCase()).not.toContain(" OR ");
  });

  it("ANDs all four axes together when every axis is active simultaneously", async () => {
    const { db, captured } = makeCapturingMockDb([[]]);
    await resolveRequirementMatches(
      {
        projectId: 1,
        axes: { search: "widget", status: ["Open"], source: ["MANUAL"] },
        coverageMatchIds: [1, 2],
        limit: 50,
        include: "ids",
      },
      db as never
    );
    const andCount = (captured[0].sql.match(/\sAND\s/gi) ?? []).length;
    // 3 base predicates (projectId/isRequirement/isDeleted) + 3 joins between
    // the 4 axis fragments = well over the single join an OR-mutated build
    // would still contain -- the precise count is asserted by the
    // structural "andAll" test below; this behavioral test only pins that
    // the word "OR" never appears when every axis is active at once.
    expect(andCount).toBeGreaterThanOrEqual(3);
    expect(captured[0].sql.toUpperCase()).not.toContain(" OR ");
  });
});

describe("resolveRequirementMatches -- matchedTotal and paging (unit, mocked $qb)", () => {
  it("computes matchedTotal from the SAME statement's COUNT(*) OVER () window, coercing a BigInt to a JS number", async () => {
    const rows = [makeMatchRow({ id: 1, name: "a", matchedTotal: 250n })];
    const db = makeMockDb(rows);
    const result = await resolveRequirementMatches(
      {
        projectId: 1,
        axes: { search: "widget", status: [], source: [] },
        coverageMatchIds: null,
        limit: 50,
        include: "ids",
      },
      db as never
    );
    expect(result.matchedTotal).toBe(250);
    expect(typeof result.matchedTotal).toBe("number");
  });

  it("drops the limit+1th row and derives nextCursor from the LAST KEPT row, not the dropped one", async () => {
    const rows = [
      makeMatchRow({ id: 1, name: "a", matchedTotal: 3 }),
      makeMatchRow({ id: 2, name: "b", matchedTotal: 3 }),
      makeMatchRow({ id: 3, name: "c", matchedTotal: 3 }),
    ];
    const db = makeMockDb(rows);
    const result = await resolveRequirementMatches(
      {
        projectId: 1,
        axes: { search: "widget", status: [], source: [] },
        coverageMatchIds: null,
        limit: 2,
        include: "ids",
      },
      db as never
    );
    expect(result.matchedIds).toEqual([1, 2]);
    expect(result.nextCursor).toEqual({ value: "b", id: 2 });
  });

  it("returns nextCursor: null and matchedTotal: 0 when the match set is empty", async () => {
    const db = makeMockDb([]);
    const result = await resolveRequirementMatches(
      {
        projectId: 1,
        axes: { search: "nomatch", status: [], source: [] },
        coverageMatchIds: null,
        limit: 50,
        include: "ids",
      },
      db as never
    );
    expect(result.matchedIds).toEqual([]);
    expect(result.matchedTotal).toBe(0);
    expect(result.nextCursor).toBeNull();
  });
});

describe("resolveRequirementMatches -- expandMatchedSubtrees (unit, mocked $qb)", () => {
  const cases: Array<{
    name: string;
    axes: RequirementTreeFilterAxes;
    coverageMatchIds: number[] | null;
    expected: boolean;
  }> = [
    {
      name: "text-only",
      axes: { search: "widget", status: [], source: [] },
      coverageMatchIds: null,
      expected: true,
    },
    {
      name: "text + status",
      axes: { search: "widget", status: ["Open"], source: [] },
      coverageMatchIds: null,
      expected: false,
    },
    {
      name: "text + source",
      axes: { search: "widget", status: [], source: ["MANUAL"] },
      coverageMatchIds: null,
      expected: false,
    },
    {
      name: "text + coverage",
      axes: { search: "widget", status: [], source: [] },
      coverageMatchIds: [1],
      expected: false,
    },
    {
      name: "status-only",
      axes: { search: "", status: ["Open"], source: [] },
      coverageMatchIds: null,
      expected: false,
    },
    {
      name: "coverage-only (empty array)",
      axes: NO_AXES,
      coverageMatchIds: [],
      expected: false,
    },
  ];

  for (const { name, axes, coverageMatchIds, expected } of cases) {
    it(`is ${expected} for ${name}`, async () => {
      const db = makeMockDb([]);
      const result: RequirementMatchPage = await resolveRequirementMatches(
        { projectId: 1, axes, coverageMatchIds, limit: 50, include: "ids" },
        db as never
      );
      expect(result.expandMatchedSubtrees).toBe(expected);
    });
  }
});

describe("resolveRequirementMatches -- the ancestor closure (unit, mocked $qb, sequenced)", () => {
  it("never queries for ancestors when the match set is empty", async () => {
    const { db, getCallCount } = makeCapturingMockDb([[]]);
    const result = await resolveRequirementMatches(
      {
        projectId: 1,
        axes: { search: "nomatch", status: [], source: [] },
        coverageMatchIds: null,
        limit: 50,
        include: "rows",
      },
      db as never
    );
    expect(getCallCount()).toBe(1);
    expect(result.ancestorIds).toEqual([]);
    expect(result.rows).toEqual([]);
  });

  it("relays the ancestor query's returned ids into ancestorIds -- a match at depth 5 (5 rows) yields all 5", async () => {
    const { db } = makeCapturingMockDb([
      [makeMatchRow({ id: 100, name: "leaf" })],
      [{ id: 5 }, { id: 4 }, { id: 3 }, { id: 2 }, { id: 1 }],
    ]);
    const result = await resolveRequirementMatches(
      {
        projectId: 1,
        axes: { search: "leaf", status: [], source: [] },
        coverageMatchIds: null,
        limit: 50,
        include: "ids",
      },
      db as never
    );
    expect(result.matchedIds).toEqual([100]);
    expect(new Set(result.ancestorIds)).toEqual(new Set([1, 2, 3, 4, 5]));
    // Disjoint by construction here (SQL enforces it in production -- see
    // this file's own structural test for the WHERE NOT (id = ANY(...))
    // clause; a live-DB proof of the recursion's real depth/disjointness
    // is 28-09 Task 3's own scope).
    for (const id of result.ancestorIds) {
      expect(result.matchedIds).not.toContain(id);
    }
  });
});

describe("resolveRequirementMatches -- include mode (unit, mocked $qb, sequenced)", () => {
  it("include: 'ids' issues exactly two queries (match page + ancestor closure) and NEVER a third row-hydration query -- proven on the mock's call count, not merely that rows came back empty", async () => {
    const { db, getCallCount } = makeCapturingMockDb([
      [makeMatchRow({ id: 1, name: "a" })],
      [{ id: 5 }],
    ]);
    const result = await resolveRequirementMatches(
      {
        projectId: 1,
        axes: { search: "widget", status: [], source: [] },
        coverageMatchIds: null,
        limit: 50,
        include: "ids",
      },
      db as never
    );
    expect(getCallCount()).toBe(2);
    expect(result.ancestorIds).toEqual([5]);
    expect(result.rows).toEqual([]);
  });

  it("include: 'rows' issues a third query to hydrate matched UNION ancestor rows", async () => {
    const hydrated = [
      makeMatchRow({ id: 1, name: "a" }),
      makeMatchRow({ id: 5, name: "z" }),
    ];
    const { db, getCallCount } = makeCapturingMockDb([
      [makeMatchRow({ id: 1, name: "a" })],
      [{ id: 5 }],
      hydrated,
    ]);
    const result = await resolveRequirementMatches(
      {
        projectId: 1,
        axes: { search: "widget", status: [], source: [] },
        coverageMatchIds: null,
        limit: 50,
        include: "rows",
      },
      db as never
    );
    expect(getCallCount()).toBe(3);
    expect(result.rows).toEqual(hydrated);
  });
});

function makeBreakdown(
  overrides: Partial<RequirementCoverageBreakdown> = {}
): RequirementCoverageBreakdown {
  return {
    linkedCaseCount: 0,
    crossProjectCaseCount: 0,
    directCaseCount: 0,
    directCrossProjectCaseCount: 0,
    passed: 0,
    failed: 0,
    inProgress: 0,
    notRun: 0,
    statuses: [],
    untested: 0,
    uncovered: true,
    status: "UNCOVERED",
    ...overrides,
  };
}

// 28-19 (gap closure): the requirements list's Status/Coverage Selects are
// empty above the lazy threshold today (defect A) because
// `collectRequirementStatusOptions`/`collectCoverageStatusOptions`
// (requirementsListRows.ts) both read the all-mode-only in-memory
// `requirements` array, which lazy mode never populates.
// `getRequirementFilterFacets` is the server-side source those Selects fall
// back to above the threshold.
describe("getRequirementFilterFacets -- status axis (unit, mocked $qb + real compiler)", () => {
  it("returns the project's distinct requirement statuses under the display-status precedence, de-duplicated case-insensitively (first-seen casing kept) and sorted case-insensitively", async () => {
    mockedGetRequirementCoverage.mockResolvedValue(new Map());
    const { db } = makeCapturingMockDb([
      [
        { status: "Open" },
        { status: "open" },
        { status: "Blocked" },
        { status: null },
      ],
    ]);
    const result = await getRequirementFilterFacets(
      { projectId: 1, coverageScope: { accessibleProjectIds: null } },
      db as never
    );
    // "open" (lowercase) never becomes a SECOND entry alongside "Open" --
    // first-seen casing wins, exactly as collectRequirementStatusOptions's
    // own Map-keyed-by-lowercase reducer behaves.
    expect(result.statuses).toEqual(["Blocked", "Open"]);
  });

  it("the query is scoped by project, the shared role predicate, and isDeleted -- never a bare, unscoped read", async () => {
    mockedGetRequirementCoverage.mockResolvedValue(new Map());
    const { db, captured } = makeCapturingMockDb([[]]);
    await getRequirementFilterFacets(
      { projectId: 42, coverageScope: { accessibleProjectIds: null } },
      db as never
    );
    expect(captured[0].sql).toContain('i."projectId" = $1');
    expect(captured[0].parameters).toContain(42);
    expect(captured[0].sql).toContain('i."isRequirement" = true');
    expect(captured[0].sql).toContain('i."isDeleted" = false');
  });
});

describe("getRequirementFilterFacets -- coverage axis (unit, mocked getRequirementCoverage)", () => {
  it("aggregates a per-requirement statuses[] breakdown across every classified requirement, summed by statusId, sorted by count descending -- matching collectCoverageStatusOptions's own output type", async () => {
    mockedGetRequirementCoverage.mockResolvedValue(
      new Map([
        [
          1,
          makeBreakdown({
            statuses: [
              { statusId: 10, name: "Passed", color: "#0f0", count: 3 },
            ],
          }),
        ],
        [
          2,
          makeBreakdown({
            statuses: [
              { statusId: 10, name: "Passed", color: "#0f0", count: 2 },
              { statusId: 11, name: "Failed", color: "#f00", count: 9 },
            ],
          }),
        ],
      ])
    );
    const { db } = makeCapturingMockDb([[]]);
    const result = await getRequirementFilterFacets(
      { projectId: 1, coverageScope: { accessibleProjectIds: null } },
      db as never
    );
    expect(result.coverageStatuses).toEqual([
      { statusId: 11, name: "Failed", color: "#f00", count: 9 },
      { statusId: 10, name: "Passed", color: "#0f0", count: 5 },
    ]);
  });

  it("drops a non-positive count entry defensively, mirroring collectCoverageStatusOptions's own guard", async () => {
    mockedGetRequirementCoverage.mockResolvedValue(
      new Map([
        [
          1,
          makeBreakdown({
            statuses: [{ statusId: 10, name: "Passed", color: null, count: 0 }],
          }),
        ],
      ])
    );
    const { db } = makeCapturingMockDb([[]]);
    const result = await getRequirementFilterFacets(
      { projectId: 1, coverageScope: { accessibleProjectIds: null } },
      db as never
    );
    expect(result.coverageStatuses).toEqual([]);
  });

  it("degrades to an empty coverage facet when the rollup throws -- the status facet must never go dark because coverage did", async () => {
    mockedGetRequirementCoverage.mockRejectedValue(new Error("rollup down"));
    const { db } = makeCapturingMockDb([[{ status: "Open" }]]);
    const result = await getRequirementFilterFacets(
      { projectId: 1, coverageScope: { accessibleProjectIds: null } },
      db as never
    );
    expect(result.statuses).toEqual(["Open"]);
    expect(result.coverageStatuses).toEqual([]);
  });

  it("passes the caller-supplied coverageScope straight through to getRequirementCoverage, unmodified", async () => {
    mockedGetRequirementCoverage.mockResolvedValue(new Map());
    const { db } = makeCapturingMockDb([[]]);
    await getRequirementFilterFacets(
      { projectId: 7, coverageScope: { accessibleProjectIds: [7, 8] } },
      db as never
    );
    expect(mockedGetRequirementCoverage).toHaveBeenCalledWith(
      7,
      { accessibleProjectIds: [7, 8] },
      undefined,
      expect.anything()
    );
  });
});

// Strips comment-prefixed lines before the OFFSET/SELECT-star checks below --
// this file's own prose (this doc comment included) legitimately explains
// why OFFSET is avoided and why no column list uses `SELECT *`, which would
// otherwise trip the very regex meant to catch the CODE doing either. Same
// technique the plan's own inline verification script uses, and the same
// comment-text trap issueRoleScope.containment.test.ts documents for itself.
function stripComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return (
        !trimmed.startsWith("//") &&
        !trimmed.startsWith("*") &&
        !trimmed.startsWith("/*")
      );
    })
    .join("\n");
}

// Anchored slice of a named function's own body, from its `export async
// function <name>` declaration up to the NEXT such declaration (or end of
// file) -- scoped this way so a predicate that exists ELSEWHERE in the file
// (e.g. countProjectRequirements's own, unrelated "isDeleted" = false) can
// never stand in for one that was removed from the function actually under
// test. A whole-file substring check cannot tell those apart; this can.
function extractFunctionBody(content: string, functionName: string): string {
  const startMarker = `export async function ${functionName}`;
  const start = content.indexOf(startMarker);
  if (start === -1) {
    throw new Error(`extractFunctionBody: ${startMarker} not found`);
  }
  const nextFunction = content.indexOf(
    "export async function",
    start + startMarker.length
  );
  return nextFunction === -1
    ? content.slice(start)
    : content.slice(start, nextFunction);
}

describe("requirementTree.ts source shape (structural, mutation-provable)", () => {
  const content = readFileSync(FILE_PATH, "utf8");
  const code = stripComments(content);
  const rootsPageBody = extractFunctionBody(content, "getRequirementRootsPage");
  const hasChildrenFragmentBody = (() => {
    const start = content.indexOf("function requirementHasChildrenFragment");
    const end = content.indexOf(
      "export async function countProjectRequirements",
      start
    );
    return content.slice(start, end);
  })();

  it("never uses OFFSET pagination", () => {
    expect(code).not.toMatch(/OFFSET/i);
  });

  it("never selects * directly off the Issue table -- the heavy description/data/externalData/note blobs this phase exists to avoid paging", () => {
    // `SELECT * FROM matches` / `SELECT * FROM counted` in
    // resolveRequirementMatches's own windowed-count CTEs are exempt: both
    // are THIS FILE's own already-narrow projections (REQUIREMENT_TREE_COLUMNS
    // plus hasChildren/matchedTotal), never the raw "Issue" table, so no
    // heavy blob column can reach them regardless of a `SELECT *` there.
    expect(code).not.toMatch(/SELECT\s+\*\s+FROM\s+"Issue"/i);
  });

  it("the only two `SELECT *` occurrences are resolveRequirementMatches' own matches/counted CTEs, never a table read", () => {
    const starCount = (code.match(/SELECT\s+\*/gi) ?? []).length;
    expect(starCount).toBe(2);
    expect(code).toContain(
      'SELECT *, COUNT(*) OVER ()::int AS "matchedTotal" FROM matches'
    );
    expect(code).toContain("SELECT * FROM counted");
  });

  it("requests limit + 1 rows in the roots window, one query instead of a separate count", () => {
    expect(rootsPageBody).toContain("LIMIT ${limit + 1}");
  });

  it("the outer roots query repeats projectId, the role predicate, isDeleted, and parentId IS NULL", () => {
    expect(rootsPageBody).toContain('i."projectId" = ${projectId}');
    expect(rootsPageBody).toContain('i."isRequirement" = true');
    expect(rootsPageBody).toContain('i."isDeleted" = false');
    expect(rootsPageBody).toContain('i."parentId" IS NULL');
  });

  it("the child-presence EXISTS subquery repeats projectId, the role predicate, and isDeleted", () => {
    expect(hasChildrenFragmentBody).toContain('c."projectId" = ${projectId}');
    expect(hasChildrenFragmentBody).toContain('c."isRequirement" = true');
    expect(hasChildrenFragmentBody).toContain('c."isDeleted" = false');
  });

  it("the cursor comparison is a keyset tuple, never OFFSET", () => {
    // Now generalized over the SORT COLUMN rather than hardcoded to name:
    // both the expression form (the roots window, which can evaluate the
    // expression directly) and the projected-key form (the match page,
    // whose `i` alias lives inside a CTE) compare a two-member tuple.
    expect(content).toContain("(${expr}, i.id) > (${value}, ${cursor.id})");
    expect(content).toContain("(${expr}, i.id) < (${value}, ${cursor.id})");
    expect(content).toContain(
      '("requirementSortKey", id) > (${value}, ${cursor.id})'
    );
    expect(content).toContain(
      '("requirementSortKey", id) < (${value}, ${cursor.id})'
    );
    // `code` (comments stripped) rather than `content`: this file's own
    // header explains at length why it uses KEYSET AND NEVER OFFSET, and
    // asserting against the raw text would match that prose.
    expect(code).not.toMatch(/\bOFFSET\b/);
  });

  it("no ORM issue.findMany/findFirst/count/groupBy read appears in this file", () => {
    expect(content).not.toMatch(
      /\.issue\.(findMany|findFirst|count|groupBy)\(/
    );
  });

  it("getRequirementChildren repeats projectId, parentId, the role predicate and isDeleted, with no cursor and no LIMIT", () => {
    const childrenBody = extractFunctionBody(content, "getRequirementChildren");
    expect(childrenBody).toContain('i."projectId" = ${projectId}');
    expect(childrenBody).toContain('i."parentId" = ${parentId}');
    expect(childrenBody).toContain('i."isRequirement" = true');
    expect(childrenBody).toContain('i."isDeleted" = false');
    expect(childrenBody).not.toMatch(/LIMIT/i);
  });

  it("the roots window and the children query share ONE column projection and ONE hasChildren fragment, never two copies", () => {
    // REQUIREMENT_TREE_COLUMNS is declared exactly once (the shared
    // fragment) and referenced by both queries via interpolation --
    // asserting the DECLARATION count stays at 1 is what would catch a
    // future edit that retyped the column list a second time instead of
    // reusing this one.
    const declarationCount = (
      content.match(/const REQUIREMENT_TREE_COLUMNS = sql`/g) ?? []
    ).length;
    expect(declarationCount).toBe(1);
    const usageCount = (content.match(/\$\{REQUIREMENT_TREE_COLUMNS\}/g) ?? [])
      .length;
    // getRequirementRootsPage + getRequirementChildren + the
    // resolveRequirementMatches match-page query (28-09 Task 1) +
    // hydrateMatchAndAncestorRows (28-09 Task 2) -- 4, not 2.
    expect(usageCount).toBe(4);

    const fragmentDeclarationCount = (
      content.match(/function requirementHasChildrenFragment/g) ?? []
    ).length;
    expect(fragmentDeclarationCount).toBe(1);
    const fragmentUsageCount = (
      content.match(/\$\{requirementHasChildrenFragment\(projectId\)\}/g) ?? []
    ).length;
    expect(fragmentUsageCount).toBe(4);
  });
});

/** Slices `content` from `startMarker` up to (but not including) the next
 *  occurrence of `endMarker` -- used below to scope a structural assertion
 *  to ONE private helper's own body, the same anchor-slicing discipline
 *  `extractFunctionBody` applies to exported functions. */
function sliceBetween(
  content: string,
  startMarker: string,
  endMarker: string | null
): string {
  const start = content.indexOf(startMarker);
  if (start === -1) {
    throw new Error(`sliceBetween: ${startMarker} not found`);
  }
  if (!endMarker) return content.slice(start);
  const end = content.indexOf(endMarker, start + startMarker.length);
  return end === -1 ? content.slice(start) : content.slice(start, end);
}

describe("resolveAncestorIds / hydrateMatchAndAncestorRows source shape (structural, mutation-provable)", () => {
  const content = readFileSync(FILE_PATH, "utf8");
  const ancestorBody = sliceBetween(
    content,
    "async function resolveAncestorIds",
    "async function hydrateMatchAndAncestorRows"
  );
  const hydrateBody = sliceBetween(
    content,
    "async function hydrateMatchAndAncestorRows",
    "export async function resolveRequirementMatches"
  );

  it("uses a WITH RECURSIVE ancestor walk", () => {
    expect(ancestorBody).toMatch(/WITH RECURSIVE ancestors/);
  });

  it("caps the recursive arm at depth < 100, mirroring every sibling CTE in this file family", () => {
    expect(ancestorBody).toContain("a.depth < 100");
  });

  it("the anchor arm scopes the immediate parent row by projectId, isRequirement, and isDeleted", () => {
    expect(ancestorBody).toContain('parent."projectId" = ${projectId}');
    expect(ancestorBody).toContain('parent."isRequirement" = true');
    expect(ancestorBody).toContain('parent."isDeleted" = false');
  });

  it("the recursive arm ALSO scopes by projectId, isRequirement, and isDeleted -- a cross-project, non-requirement, or soft-deleted parent can never widen the walk", () => {
    expect(ancestorBody).toContain('next."projectId" = ${projectId}');
    expect(ancestorBody).toContain('next."isRequirement" = true');
    expect(ancestorBody).toContain('next."isDeleted" = false');
  });

  it("excludes any id already in matchedIds from the final ancestor set -- matchedIds and ancestorIds must stay disjoint", () => {
    expect(ancestorBody).toContain(
      "WHERE NOT (id = ANY(${matchedIds}::int[]))"
    );
  });

  it("hydrateMatchAndAncestorRows reuses the shared column projection and hasChildren fragment, never a retyped copy", () => {
    expect(hydrateBody).toContain("${REQUIREMENT_TREE_COLUMNS}");
    expect(hydrateBody).toContain(
      "${requirementHasChildrenFragment(projectId)}"
    );
  });

  it("skips the row query entirely when there are no ids to hydrate", () => {
    expect(hydrateBody).toContain("if (ids.length === 0) return [];");
  });
});

describe("resolveRequirementMatches source shape (structural, mutation-provable)", () => {
  const content = readFileSync(FILE_PATH, "utf8");
  const resolveBody = extractFunctionBody(content, "resolveRequirementMatches");

  it("requests limit + 1 rows, one statement instead of a separate count query", () => {
    expect(resolveBody).toContain("LIMIT ${limit + 1}");
  });

  it("the match query repeats projectId, the role predicate, and isDeleted", () => {
    expect(resolveBody).toContain('i."projectId" = ${projectId}');
    expect(resolveBody).toContain('i."isRequirement" = true');
    expect(resolveBody).toContain('i."isDeleted" = false');
  });

  it("computes matchedTotal via a window function in the SAME statement as the page", () => {
    expect(resolveBody).toMatch(/COUNT\(\*\)\s*OVER\s*\(\)/i);
  });

  it("rejects a call with no active axis via a literal `!== null` check on coverageMatchIds -- never a truthy/`.length` check that would also treat [] as inactive", () => {
    expect(resolveBody).toContain("coverageMatchIds !== null");
    expect(resolveBody).not.toMatch(/if\s*\(\s*coverageMatchIds\s*&&/);
    expect(resolveBody).not.toMatch(/coverageMatchIds\?\.length/);
  });

  it("joins active axis fragments with the shared andAll helper, never inline string concatenation", () => {
    expect(resolveBody).toContain("andAll(axisFragments)");
  });

  it("andAll joins fragments with AND, never OR -- the single intersection point this SQL has", () => {
    const start = content.indexOf("function andAll");
    const end = content.indexOf("async function resolveAncestorIds", start);
    const andAllBody =
      end === -1 ? content.slice(start) : content.slice(start, end);
    expect(andAllBody).toContain("AND ${fragment}");
    expect(andAllBody).not.toMatch(/OR \$\{fragment\}/);
  });
});

describe("getRequirementFilterFacets source shape (structural, mutation-provable)", () => {
  const content = readFileSync(FILE_PATH, "utf8");
  const facetsBody = extractFunctionBody(content, "getRequirementFilterFacets");

  it("reuses REQUIREMENT_DISPLAY_STATUS_CASE verbatim rather than restating the lock-aware precedence a second time", () => {
    expect(facetsBody).toContain("${REQUIREMENT_DISPLAY_STATUS_CASE}");
  });

  it("scopes the status query by project, the shared role-scope raw-SQL mirror, and isDeleted", () => {
    expect(facetsBody).toContain('i."projectId" = ${projectId}');
    expect(facetsBody).toContain("sql.raw(ISSUE_ROLE_SCOPE_SQL_REQUIREMENT)");
    expect(facetsBody).toContain('i."isDeleted" = false');
  });

  it("imports ISSUE_ROLE_SCOPE_SQL_REQUIREMENT from the shared role-scope module, never a locally re-declared copy", () => {
    expect(content).toContain(
      'import { ISSUE_ROLE_SCOPE_SQL_REQUIREMENT } from "~/lib/services/issueRoleScope";'
    );
  });

  it("derives the coverage facet from getRequirementCoverage's own rollup, never a second coverage SQL statement", () => {
    expect(facetsBody).toContain("getRequirementCoverage(");
    expect(facetsBody).not.toMatch(/WITH RECURSIVE/);
  });

  it("degrades the coverage facet to empty on a rollup failure without ever throwing out of the function", () => {
    expect(facetsBody).toContain("} catch (error) {");
    expect(facetsBody).toContain("coverageStatuses = [];");
  });
});
