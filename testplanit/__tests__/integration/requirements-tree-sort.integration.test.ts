// Live-DB integration proof for requirementTree's SERVER-SIDE SORTING.
//
// The unit lane (requirementTree.test.ts) proves the built statement's SHAPE
// against a mocked client. It cannot prove any of what this file proves,
// because every one of these properties is a property of real Postgres:
// whether a keyset walk over a generalized `(sortValue, id)` tuple visits
// each row exactly once for EVERY sortable column, whether the cursor value
// survives its round trip through the driver's own type mapping, and whether
// Postgres' collation orders text the same way the browser's `localeCompare`
// does for the same rows.
//
// The two lanes are deliberately separated:
//
//   walk parity     -- paging with a small limit must reproduce, exactly, what
//                      a single unpaged page returns. This isolates the KEYSET
//                      (cursor + tuple predicate) from the ORDER BY.
//   comparator parity -- that single unpaged page must agree with the client
//                      comparator the list uses below the lazy threshold. This
//                      isolates the ORDER BY EXPRESSION's semantics.
//
// Splitting them matters: a bug in the tuple predicate and a bug in a CASE
// expression produce the same end-to-end symptom ("the list is out of order")
// but have nothing to do with each other, and a single combined assertion
// would not say which one fired.
//
// Run via (never against the default .env DATABASE_URL -- that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/requirements-tree-sort.integration.test.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";
import {
  DEFAULT_REQUIREMENT_SORT,
  REQUIREMENT_SORT_COLUMNS,
  getRequirementRootsPage,
  resolveRequirementMatches,
  type RequirementRootsCursor,
  type RequirementSortColumn,
  type RequirementTreeFilterAxes,
  type RequirementTreeSort,
} from "~/lib/services/requirementTree";
import type { Issue } from "~/zenstack/models";

import {
  buildRequirementMaps,
  flattenRequirementRows,
  requirementSourceSortValue,
} from "~/app/[locale]/projects/requirements/[projectId]/requirementsListRows";
import {
  formatIssueDisplayText,
  resolveRequirementDisplayStatus,
} from "~/utils/issueDisplayText";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `rts-${Date.now()}`;

/** Small enough that every column x direction combination can be walked to
 *  exhaustion in one suite, large enough that a page boundary lands inside a
 *  run of tied sort values rather than always between two distinct ones --
 *  which is the only place a keyset tuple can actually go wrong. */
const ROOT_COUNT = 120;
const PAGE_LIMIT = 7;

const DIRECTIONS = ["asc", "desc"] as const;

interface SortForest {
  projectId: number;
  adminId: string;
  integrationId: number;
  rootIds: number[];
  namePrefix: string;
}

/**
 * Seeds roots through RAW SQL rather than the ORM, because two of the
 * properties under test are only reachable that way: `createdAt` needs
 * MICROSECOND components (the ORM would stamp a millisecond-precision JS
 * Date), and the attribute cycles below have to produce deliberate ties and
 * deliberate collation hazards at known positions.
 *
 * The vocabularies are intentionally nasty. `priority` mixes case and a
 * leading-punctuation value; `status` mixes case and an accent. Postgres'
 * collation and the browser's `localeCompare` are two different orderings and
 * this fixture is built to make them disagree if they are going to -- that
 * disagreement is a real user-visible defect (a project would sort one way
 * above the lazy threshold and another way below it), so the fixture must not
 * hide it behind lowercase ASCII.
 */
async function seedSortForest(namePrefix: string): Promise<SortForest> {
  const role = await db.roles.findFirst({
    where: { isDefault: true, isDeleted: false },
    select: { id: true },
  });
  if (!role) {
    throw new Error(
      "seedSortForest: test prerequisite missing -- no default Roles row"
    );
  }

  const admin = await db.user.create({
    data: {
      email: `${namePrefix}-admin@example.com`,
      name: `${namePrefix} Sort Fixture Admin`,
      authMethod: "INTERNAL",
      access: "ADMIN",
      accessSource: "MANUAL",
      roleId: role.id,
      password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
    },
    select: { id: true },
  });

  const project = await db.projects.create({
    data: { name: `${namePrefix}-project`, createdBy: admin.id },
    select: { id: true },
  });

  const integration = await db.integration.create({
    data: {
      name: `${namePrefix}-integration`,
      provider: "JIRA",
      authType: "PERSONAL_ACCESS_TOKEN",
      credentials: {},
    },
    select: { id: true },
  });

  // Deliberately not sorted, not uniform in length, and mixed in case.
  const PRIORITIES = [null, "High", "low", "MEDIUM", "critical", "!urgent"];
  const STATUSES = [null, "Open", "closed", "In Progress", "Ätest", "open"];

  const width = String(ROOT_COUNT).length;
  const rootIds: number[] = [];

  for (let i = 1; i <= ROOT_COUNT; i++) {
    const name = `${namePrefix}-${String(i).padStart(width, "0")}`;
    const priority = PRIORITIES[i % PRIORITIES.length];
    const status = STATUSES[i % STATUSES.length];

    // Three-way source cycle: native (no integration), synced (integration,
    // not detached), detached (integration + requirementDetachedAt).
    const sourceKind = i % 3;
    const integrationId = sourceKind === 0 ? null : integration.id;
    const detachedAt = sourceKind === 2 ? "2026-02-02 02:02:02+00" : null;

    // Every 5th row gets a distinct title + externalUrl, which is what makes
    // the DISPLAYED name differ from `Issue.name` -- the name column sorts on
    // the displayed string, so a fixture where the two always coincide would
    // never exercise that CASE at all.
    const hasDistinctTitle = i % 5 === 0;
    const title = hasDistinctTitle ? `${name} distinct title` : name;
    const externalUrl = hasDistinctTitle
      ? `https://tracker.example.com/${name}`
      : null;

    const externalStatus = integrationId !== null ? `ext-${i % 4}` : null;

    // MICROSECONDS. Rows are spaced 1ms apart, but each carries a distinct
    // sub-millisecond component, so a cursor that truncates to milliseconds
    // (which `Date.prototype.toISOString()` does) cannot round-trip this
    // column faithfully. Several rows deliberately share a millisecond.
    const micro = String((i * 137) % 1000).padStart(3, "0");
    const createdAt = `2026-03-03 03:03:${String(Math.floor(i / 1000)).padStart(
      2,
      "0"
    )}.${String(i % 1000).padStart(3, "0")}${micro}+00`;

    const rows = await db.$queryRaw<Array<{ id: number }>>`
      INSERT INTO "Issue"
        ("name", "title", "createdById", "projectId", "isRequirement",
         "isDeleted", "parentId", "priority", "status", "externalStatus",
         "externalUrl", "integrationId", "requirementDetachedAt", "createdAt")
      VALUES
        (${name}, ${title}, ${admin.id}, ${project.id}, true,
         false, NULL, ${priority}, ${status}, ${externalStatus},
         ${externalUrl}, ${integrationId},
         ${detachedAt}::timestamptz, ${createdAt}::timestamptz)
      RETURNING id
    `;
    rootIds.push(rows[0].id);
  }

  return {
    projectId: project.id,
    adminId: admin.id,
    integrationId: integration.id,
    rootIds,
    namePrefix,
  };
}

async function tearDownSortForest(forest: SortForest): Promise<void> {
  await db.issue.deleteMany({
    where: { name: { startsWith: forest.namePrefix } },
  });
  await db.projects.deleteMany({
    where: { name: { startsWith: forest.namePrefix } },
  });
  await db.integration.deleteMany({
    where: { name: { startsWith: forest.namePrefix } },
  });
  await db.user.deleteMany({
    where: { email: { startsWith: forest.namePrefix } },
  });
}

/** Walks the roots window to exhaustion under `sort`, returning the id
 *  sequence in the order the pager produced it. */
async function walkPaged(
  projectId: number,
  sort: RequirementTreeSort,
  limit = PAGE_LIMIT
): Promise<number[]> {
  const ids: number[] = [];
  let cursor: RequirementRootsCursor | null = null;
  // A generous but finite cap: a keyset that fails to advance would otherwise
  // spin forever instead of failing the test.
  const maxPages = Math.ceil(ROOT_COUNT / limit) * 4 + 10;
  let pages = 0;

  do {
    if (++pages > maxPages) {
      throw new Error(
        `walkPaged: exceeded ${maxPages} pages for ${sort.column}/${sort.direction} -- the cursor is not advancing`
      );
    }
    const page = await getRequirementRootsPage(
      { projectId, limit, cursor, sort },
      db
    );
    ids.push(...page.rows.map((row) => row.id));
    cursor = page.nextCursor;
  } while (cursor);

  return ids;
}

/** The same window as ONE page, which is the oracle `walkPaged` is compared
 *  against: same statement, same ORDER BY, no cursor involved. */
async function singlePage(
  projectId: number,
  sort: RequirementTreeSort
): Promise<number[]> {
  const page = await getRequirementRootsPage(
    { projectId, limit: ROOT_COUNT + 50, cursor: null, sort },
    db
  );
  expect(page.nextCursor).toBeNull();
  return page.rows.map((row) => row.id);
}

function duplicatesOf(ids: number[]): number[] {
  const seen = new Set<number>();
  const dupes = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}

describeIntegration("requirements tree server-side sorting (live DB)", () => {
  let forest: SortForest;

  beforeAll(async () => {
    // Refuse to run against anything but a scratch database, on this file's
    // OWN connection -- the same guard every other suite in this directory
    // holds, and for the same reason: a callee's guard is never this file's
    // only line of defense.
    const [{ current_database: dbName }] = await db.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (dbName !== "tpi_req20" && dbName !== "tpi_test") {
      throw new Error(
        `refusing to run against database "${dbName}" -- this suite only runs against the tpi_req20 scratch DB (or tpi_test in CI)`
      );
    }
    forest = await seedSortForest(`${STAMP}-forest`);
  }, 120_000);

  afterAll(async () => {
    if (forest) await tearDownSortForest(forest);
    await db.$disconnect();
  }, 120_000);

  describe("keyset walk parity -- paging reproduces the unpaged page exactly", () => {
    for (const column of REQUIREMENT_SORT_COLUMNS) {
      // The three coverage-derived columns need a caller-supplied value list;
      // they get their own dedicated block below rather than a degenerate
      // all-sentinel run here.
      if (
        column === "coverage" ||
        column === "linkedCases" ||
        column === "coveringCases"
      ) {
        continue;
      }

      for (const direction of DIRECTIONS) {
        it(`${column} ${direction}: every root exactly once, in the unpaged order`, async () => {
          const sort: RequirementTreeSort = { column, direction };
          const expected = await singlePage(forest.projectId, sort);
          const actual = await walkPaged(forest.projectId, sort);

          expect(duplicatesOf(actual)).toEqual([]);
          expect(actual).toHaveLength(ROOT_COUNT);
          expect(new Set(actual)).toEqual(new Set(forest.rootIds));
          // The strongest form: not merely the same set, the same ORDER.
          expect(actual).toEqual(expected);
        });
      }
    }

    it("a page limit of 1 -- the boundary lands between every adjacent pair -- still visits each root once", async () => {
      const sort: RequirementTreeSort = { column: "status", direction: "asc" };
      const expected = await singlePage(forest.projectId, sort);
      const actual = await walkPaged(forest.projectId, sort, 1);

      expect(duplicatesOf(actual)).toEqual([]);
      expect(actual).toEqual(expected);
    });
  });

  describe("comparator parity -- the server ORDER BY agrees with the client comparator", () => {
    /**
     * Server and client break TIES differently, on purpose and by design:
     * the server's keyset tie-break is `id` in the SAME direction as the sort
     * (a tuple comparison is only a valid page boundary when the ordering
     * matches it exactly), while the client comparator ties on name-then-id
     * always ascending. `requirementSortOrderFragment`'s own comment states
     * this divergence outright.
     *
     * Parity therefore means the two agree on the SEQUENCE OF SORT-VALUE
     * GROUPS and on each group's MEMBERSHIP -- not on the arrangement inside
     * a group, which the two are entitled to disagree about. Asserting raw
     * index-by-index equality would fail on that intended difference and say
     * nothing about the property actually at stake, which is whether the SQL
     * expression and the JS comparator rank values the same way.
     */
    /** The value the CLIENT comparator ranks on for a column -- the grouping
     *  key both sides are bucketed by. Deliberately the client's own notion:
     *  the question this block asks is whether the server reproduces it. */
    function clientSortValue(
      row: Issue,
      column: RequirementSortColumn
    ): string | number {
      switch (column) {
        case "status":
          return resolveRequirementDisplayStatus(row) ?? "";
        case "priority":
          return row.priority ?? "";
        case "source":
          return requirementSourceSortValue(row);
        case "createdAt":
          return row.createdAt
            ? new Date(row.createdAt).getTime()
            : Number.POSITIVE_INFINITY;
        default:
          return formatIssueDisplayText(row);
      }
    }

    function groupByRuns(
      ids: number[],
      valueOf: (id: number) => string | number
    ): Array<{ value: string | number; members: Set<number> }> {
      const groups: Array<{ value: string | number; members: Set<number> }> =
        [];
      for (const id of ids) {
        const value = valueOf(id);
        const last = groups[groups.length - 1];
        if (last && last.value === value) last.members.add(id);
        else groups.push({ value, members: new Set([id]) });
      }
      return groups;
    }

    for (const column of REQUIREMENT_SORT_COLUMNS) {
      if (
        column === "coverage" ||
        column === "linkedCases" ||
        column === "coveringCases"
      ) {
        continue;
      }

      for (const direction of DIRECTIONS) {
        it(`${column} ${direction}: same sort-value groups as flattenRequirementRows`, async () => {
          const serverIds = await singlePage(forest.projectId, {
            column,
            direction,
          });

          const requirements = (await db.issue.findMany({
            where: {
              projectId: forest.projectId,
              isRequirement: true,
              isDeleted: false,
              parentId: null,
            },
          })) as Issue[];

          const { childrenMap } = buildRequirementMaps(requirements);
          const clientIds = flattenRequirementRows({
            childrenMap,
            visibleRequirementIds: null,
            expandedByIssueId: {},
            sortConfig: { column, direction },
            coverage: undefined,
          }).map((row) => row.id);

          expect(clientIds).toHaveLength(ROOT_COUNT);

          const byId = new Map(requirements.map((row) => [row.id, row]));
          const valueOf = (id: number) =>
            clientSortValue(byId.get(id)!, column);

          expect(groupByRuns(serverIds, valueOf)).toEqual(
            groupByRuns(clientIds, valueOf)
          );
        });
      }
    }
  });

  describe("coverage-derived columns (the unnest join)", () => {
    /** Values for only PART of the forest, so the LEFT JOIN's sentinel path
     *  is exercised rather than assumed. */
    function partialCoverageValues(rootIds: number[]) {
      const covered = rootIds.filter((_, index) => index % 3 !== 0);
      return {
        ids: covered,
        values: covered.map((_, index) => (index % 7) + 1),
      };
    }

    for (const column of [
      "coverage",
      "linkedCases",
      "coveringCases",
    ] as const) {
      for (const direction of DIRECTIONS) {
        it(`${column} ${direction}: pages to exhaustion, keeping rows with no rollup entry`, async () => {
          const sort: RequirementTreeSort = {
            column: column as RequirementSortColumn,
            direction,
            coverageValues: partialCoverageValues(forest.rootIds),
          };
          const expected = await singlePage(forest.projectId, sort);
          const actual = await walkPaged(forest.projectId, sort);

          expect(duplicatesOf(actual)).toEqual([]);
          // LEFT JOIN, never INNER: a requirement absent from the rollup must
          // still appear, at the -1 sentinel.
          expect(actual).toHaveLength(ROOT_COUNT);
          expect(new Set(actual)).toEqual(new Set(forest.rootIds));
          expect(actual).toEqual(expected);
        });
      }
    }

    it("an empty rollup sorts every row at the sentinel and still returns all of them", async () => {
      const sort: RequirementTreeSort = {
        column: "coverage",
        direction: "desc",
        coverageValues: { ids: [], values: [] },
      };
      const actual = await walkPaged(forest.projectId, sort);

      expect(duplicatesOf(actual)).toEqual([]);
      expect(actual).toHaveLength(ROOT_COUNT);
    });

    it("ranks a supplied value above the sentinel, in the direction asked for", async () => {
      const [first, second] = forest.rootIds;
      const sort: RequirementTreeSort = {
        column: "coverage",
        direction: "desc",
        coverageValues: { ids: [second], values: [99] },
      };
      const ids = await singlePage(forest.projectId, sort);

      // The only row with a rollup value sorts first descending; everything
      // else is tied at the sentinel behind it.
      expect(ids[0]).toBe(second);
      expect(ids).toContain(first);
    });
  });

  describe("cursor value round trip", () => {
    it("createdAt: the cursor survives a column whose values carry microseconds", async () => {
      // Isolated from the walk-parity block above because this is a property
      // of the CURSOR VALUE's type mapping, not of the ordering: `createdAt`
      // is declared `@db.Timestamptz(6)`, so a value can carry microseconds,
      // while the cursor round-trips through a JS `Date`.
      const sort: RequirementTreeSort = {
        column: "createdAt",
        direction: "asc",
      };
      const expected = await singlePage(forest.projectId, sort);
      const actual = await walkPaged(forest.projectId, sort, 1);

      expect(duplicatesOf(actual)).toEqual([]);
      expect(actual).toEqual(expected);
    });

    it("createdAt descending: no row is skipped across a page boundary", async () => {
      const sort: RequirementTreeSort = {
        column: "createdAt",
        direction: "desc",
      };
      const expected = await singlePage(forest.projectId, sort);
      const actual = await walkPaged(forest.projectId, sort, 1);

      expect(actual).toHaveLength(ROOT_COUNT);
      expect(actual).toEqual(expected);
    });

    it("the default sort is name ascending, and pages identically to an explicit one", async () => {
      const explicit = await walkPaged(forest.projectId, {
        column: "name",
        direction: "asc",
      });
      const defaulted = await walkPaged(
        forest.projectId,
        DEFAULT_REQUIREMENT_SORT
      );
      expect(defaulted).toEqual(explicit);
    });
  });

  /**
   * The FILTERED page is a second, separate implementation of the same idea.
   * `getRequirementRootsPage` orders by the sort expression directly and
   * cursor-compares it directly; `resolveRequirementMatches` computes the
   * axis intersection in a `matches` CTE, windows a count over it, and then
   * orders and cursor-compares the ALIAS (`"requirementSortKey"`) from
   * outside that CTE. The two share their descriptor and their cursor
   * rendering but not their statement, so proving one proves nothing about
   * the other -- and the paging that exists for this path today was only
   * ever walked under the default name sort.
   */
  describe("filtered match paging under a non-default sort", () => {
    /** Matches the whole fixture: every row's name starts with the prefix.
     *  A full-set walk is the strongest version of this assertion, since a
     *  narrow filter could hide a boundary bug behind a single page. */
    const allRowsAxes = (namePrefix: string): RequirementTreeFilterAxes => ({
      search: namePrefix,
      status: [],
      source: [],
    });

    async function walkMatches(
      sort: RequirementTreeSort,
      limit: number
    ): Promise<{ ids: number[]; totals: number[] }> {
      const ids: number[] = [];
      const totals: number[] = [];
      let cursor: RequirementRootsCursor | null = null;
      const maxPages = Math.ceil(ROOT_COUNT / limit) * 4 + 10;
      let pages = 0;

      do {
        if (++pages > maxPages) {
          throw new Error(
            `walkMatches: exceeded ${maxPages} pages for ${sort.column}/${sort.direction} -- the cursor is not advancing`
          );
        }
        const page = await resolveRequirementMatches(
          {
            projectId: forest.projectId,
            axes: allRowsAxes(forest.namePrefix),
            coverageMatchIds: null,
            limit,
            cursor,
            include: "ids",
            sort,
          },
          db
        );
        ids.push(...page.matchedIds);
        totals.push(page.matchedTotal);
        cursor = page.nextCursor;
      } while (cursor);

      return { ids, totals };
    }

    for (const column of REQUIREMENT_SORT_COLUMNS) {
      const coverageDerived =
        column === "coverage" ||
        column === "linkedCases" ||
        column === "coveringCases";

      for (const direction of DIRECTIONS) {
        it(`${column} ${direction}: pages the match set to exhaustion, matching the unpaged set`, async () => {
          const sort: RequirementTreeSort = {
            column,
            direction,
            ...(coverageDerived
              ? {
                  coverageValues: {
                    ids: forest.rootIds.filter((_, index) => index % 3 !== 0),
                    values: forest.rootIds
                      .filter((_, index) => index % 3 !== 0)
                      .map((_, index) => (index % 7) + 1),
                  },
                }
              : {}),
          };

          const unpaged = await resolveRequirementMatches(
            {
              projectId: forest.projectId,
              axes: allRowsAxes(forest.namePrefix),
              coverageMatchIds: null,
              limit: ROOT_COUNT + 50,
              cursor: null,
              include: "ids",
              sort,
            },
            db
          );
          expect(unpaged.nextCursor).toBeNull();
          expect(unpaged.matchedIds).toHaveLength(ROOT_COUNT);

          const { ids, totals } = await walkMatches(sort, PAGE_LIMIT);

          expect(duplicatesOf(ids)).toEqual([]);
          expect(ids).toEqual(unpaged.matchedIds);
          // `matchedTotal` is windowed over the whole match set BEFORE the
          // cursor trims it, so every page must report the same total --
          // a total that shrank page by page would mean the count had moved
          // inside the cursor's own filter.
          expect(new Set(totals)).toEqual(new Set([ROOT_COUNT]));
        });
      }
    }

    it("createdAt ascending at a page limit of 1 -- the microsecond cursor path, through the CTE this time", async () => {
      const sort: RequirementTreeSort = {
        column: "createdAt",
        direction: "asc",
      };
      const unpaged = await resolveRequirementMatches(
        {
          projectId: forest.projectId,
          axes: allRowsAxes(forest.namePrefix),
          coverageMatchIds: null,
          limit: ROOT_COUNT + 50,
          cursor: null,
          include: "ids",
          sort,
        },
        db
      );
      const { ids } = await walkMatches(sort, 1);

      expect(duplicatesOf(ids)).toEqual([]);
      expect(ids).toEqual(unpaged.matchedIds);
    });

    it("a narrower axis still pages cleanly under a sort whose values are almost all tied", async () => {
      // `source` collapses 120 rows into 3 distinct values, so nearly every
      // page boundary falls INSIDE a tie -- the case where a keyset tuple
      // that disagreed with its own ORDER BY would lose or repeat rows.
      const sort: RequirementTreeSort = {
        column: "source",
        direction: "desc",
      };
      const axes: RequirementTreeFilterAxes = {
        search: forest.namePrefix,
        status: [],
        source: ["MANUAL", "SYNCED"],
      };

      const unpaged = await resolveRequirementMatches(
        {
          projectId: forest.projectId,
          axes,
          coverageMatchIds: null,
          limit: ROOT_COUNT + 50,
          cursor: null,
          include: "ids",
          sort,
        },
        db
      );

      const ids: number[] = [];
      let cursor: RequirementRootsCursor | null = null;
      let pages = 0;
      do {
        if (++pages > ROOT_COUNT + 10) {
          throw new Error(
            "source/desc narrow walk: the cursor is not advancing"
          );
        }
        const page = await resolveRequirementMatches(
          {
            projectId: forest.projectId,
            axes,
            coverageMatchIds: null,
            limit: 3,
            cursor,
            include: "ids",
            sort,
          },
          db
        );
        ids.push(...page.matchedIds);
        cursor = page.nextCursor;
      } while (cursor);

      expect(duplicatesOf(ids)).toEqual([]);
      expect(ids).toEqual(unpaged.matchedIds);
      // The axis really did narrow the set -- otherwise this test would be
      // the full-set walk above wearing a different name.
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.length).toBeLessThan(ROOT_COUNT);
    });
  });
});
