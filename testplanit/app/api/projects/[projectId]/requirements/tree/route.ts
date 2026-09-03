import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { resolveViewerProjectScope } from "~/lib/authContext";
import {
  executionScopeBodyShape,
  parseExecutionScopeQuery,
  toExecutionScope,
} from "~/lib/services/executionScopeParam";
import type { LatestResultExecutionScope } from "~/lib/services/latestCaseResults";
import { getRequirementCoverage } from "~/lib/services/requirementCoverage";
import {
  matchesRequirementCoverageFilters,
  type RequirementCoverageFilter,
} from "~/lib/services/requirementCoverageFilter";
import { requirementCoverageSortValue } from "~/lib/services/requirementCoverageSort";
import {
  countProjectRequirements,
  countProjectRequirementRoots,
  COVERAGE_DERIVED_SORT_COLUMNS,
  DEFAULT_REQUIREMENT_SORT,
  getRequirementFilterFacets,
  getRequirementRootsPage,
  REQUIREMENT_LAZY_THRESHOLD,
  REQUIREMENT_SORT_COLUMNS,
  resolveRequirementMatches,
  type RequirementCoverageSortValues,
  type RequirementRootsCursor,
  type RequirementTreeFilterAxes,
  type RequirementTreeSort,
} from "~/lib/services/requirementTree";
import { authOptions } from "~/server/auth";

/**
 * GET/POST /api/projects/[projectId]/requirements/tree
 *
 * The route layer for 28-08/28-09's authorization-free tree/filter
 * primitives -- this file is the ONLY project-scope boundary either of
 * those modules has. Modelled directly on
 * `coverage/route.ts`'s own gate (read this file's imports of the same
 * `resolveViewerProjectScope`/`authOptions` pair as the literal same
 * pattern, not a coincidence): 401 (no session) -> 400 (non-numeric
 * project id) -> 403 (viewer's project scope excludes the requested
 * project) -> 200/500. Any project member may read this route; there is
 * no admin-only surface here (that is `descendant-count/route.ts`,
 * sibling to `delete-subtree/route.ts`).
 *
 * `projectId` is taken from the path ONLY and re-derived server-side on
 * every request -- a POST body never carries its own project id, so a
 * caller cannot point this route at a project other than the one named in
 * the URL it was authorized against.
 */

// Page-size ceiling for both the roots window and the filtered-match page:
// `RequirementsListView.tsx`'s virtualized DataTable already uses a 48px
// `estimateSize` per row, and 100 rows is roughly two screens' worth of
// scroll-ahead at a typical viewport height -- large enough that the
// infinite-scroll sentinel rarely fires mid-scroll, small enough that one
// page never dominates a request's payload the way an unbounded roots read
// would for a multi-thousand-row typed import.
const REQUIREMENTS_TREE_MAX_LIMIT = 100;
const REQUIREMENTS_TREE_DEFAULT_LIMIT = 100;

function parseLimit(raw: string | null): number | null {
  if (raw === null) return REQUIREMENTS_TREE_DEFAULT_LIMIT;
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  // Clamped, never honoured past the ceiling above (T-28-10-04) -- a
  // caller-supplied 100000 silently becomes the max page, not a 400,
  // matching the plan's own "clamped, not honoured" instruction.
  return Math.min(parsed, REQUIREMENTS_TREE_MAX_LIMIT);
}

/**
 * A cursor is only valid with BOTH halves present. `{ ok: false }` covers
 * exactly one half supplied (a client bug or a truncated query string) --
 * silently treating that as "no cursor" would restart the walk from page
 * one instead of failing loudly.
 *
 * `cursorValue` carries whatever the SORT COLUMN produced for the last row
 * of the previous page, always as a string on the wire; the service casts
 * it back to that column's own type. It is deliberately opaque here -- this
 * route never interprets it, only relays it, so adding a sortable column
 * cannot require a change in this function.
 */
function parseRootsCursor(
  searchParams: URLSearchParams
): { ok: true; cursor: RequirementRootsCursor | null } | { ok: false } {
  const cursorValue = searchParams.get("cursorValue");
  const cursorId = searchParams.get("cursorId");
  if (cursorValue === null && cursorId === null) {
    return { ok: true, cursor: null };
  }
  if (cursorValue === null || cursorId === null) {
    return { ok: false };
  }
  if (!/^\d+$/.test(cursorId)) {
    return { ok: false };
  }
  return { ok: true, cursor: { value: cursorValue, id: Number(cursorId) } };
}

/**
 * The requested sort, or the list's default. An unrecognized column or
 * direction is a 400 rather than a silent fallback: it reaches an `ORDER
 * BY` fragment, and quietly sorting by something else would look like the
 * sort simply not working -- the exact failure this whole change exists to
 * remove.
 */
function parseSort(
  searchParams: URLSearchParams
): { ok: true; sort: RequirementTreeSort } | { ok: false } {
  const column = searchParams.get("sortColumn");
  const direction = searchParams.get("sortDirection");
  if (column === null && direction === null) {
    return { ok: true, sort: DEFAULT_REQUIREMENT_SORT };
  }
  const parsed = requirementSortSchema.safeParse({ column, direction });
  if (!parsed.success) return { ok: false };
  return { ok: true, sort: parsed.data };
}

const requirementSortSchema = z.object({
  column: z.enum(REQUIREMENT_SORT_COLUMNS),
  direction: z.enum(["asc", "desc"]),
});

/**
 * The per-requirement sort values a COVERAGE-DERIVED sort column needs,
 * read out of the same whole-project rollup the coverage FILTER already
 * uses. Returns `null` for every other column, so an ordinary sort never
 * pays for the rollup.
 *
 * The three value expressions mirror `compareRequirements`'s own coverage
 * cases (requirementsListRows.ts) exactly:
 *   coverage      -> requirementCoverageSortValue (STATUS_RANK ladder)
 *   linkedCases   -> breakdown.directCaseCount
 *   coveringCases -> breakdown.linkedCaseCount
 * A rollup failure degrades to `null` (an unsorted-by-coverage page) rather
 * than failing the request, matching the coverage axis's own
 * outage-degrades-to-inactive rule below.
 */
async function resolveCoverageSortValues(
  sort: RequirementTreeSort,
  projectId: number,
  scope: number[] | null,
  executionScope: LatestResultExecutionScope | undefined
): Promise<RequirementCoverageSortValues | null> {
  if (!COVERAGE_DERIVED_SORT_COLUMNS.includes(sort.column)) return null;
  try {
    const rollup = await getRequirementCoverage(
      projectId,
      { accessibleProjectIds: scope },
      { executionScope }
    );
    const ids: number[] = [];
    const values: number[] = [];
    for (const [requirementId, breakdown] of rollup) {
      ids.push(requirementId);
      values.push(
        sort.column === "coverage"
          ? requirementCoverageSortValue(breakdown)
          : sort.column === "linkedCases"
            ? (breakdown.directCaseCount ?? 0)
            : (breakdown.linkedCaseCount ?? 0)
      );
    }
    return { ids, values };
  } catch (coverageError) {
    console.error("Requirement coverage sort rollup error:", coverageError);
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { projectId: projectIdParam } = await params;
    const projectId = Number(projectIdParam);
    if (!Number.isInteger(projectId)) {
      return NextResponse.json(
        { error: "Invalid project ID" },
        { status: 400 }
      );
    }

    const scope = await resolveViewerProjectScope(session.user.id);
    if (scope !== null && !scope.includes(projectId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = request.nextUrl;

    if (searchParams.get("countOnly") === "1") {
      const [total, rootTotal] = await Promise.all([
        countProjectRequirements(projectId),
        countProjectRequirementRoots(projectId),
      ]);
      // The ONE place this comparison is written -- callers read `mode`
      // rather than re-deriving it from `total`/`threshold` themselves, so
      // a future change to the boundary's `>`/`<=` semantics cannot drift
      // between this route and a client-side copy of the same check.
      const mode = total > REQUIREMENT_LAZY_THRESHOLD ? "lazy" : "all";
      return NextResponse.json({
        total,
        // The roots-only denominator the list's unfiltered "x of y" uses --
        // a nested child is never a row the roots window can load.
        rootTotal,
        threshold: REQUIREMENT_LAZY_THRESHOLD,
        mode,
      });
    }

    // 28-19 (gap closure): the requirements list's Status/Coverage Selects
    // above the lazy threshold, since `collectRequirementStatusOptions`/
    // `collectCoverageStatusOptions` (requirementsListRows.ts) both read the
    // all-mode-only in-memory `requirements` array lazy mode never
    // populates. `scope` is the SAME resolved value the 403 gate above
    // already checked -- reused here as `getRequirementCoverage`'s own
    // visibility-scope argument, never re-resolved.
    if (searchParams.get("facetsOnly") === "1") {
      const facets = await getRequirementFilterFacets({
        projectId,
        coverageScope: { accessibleProjectIds: scope },
      });
      return NextResponse.json(facets);
    }

    const limit = parseLimit(searchParams.get("limit"));
    if (limit === null) {
      return NextResponse.json({ error: "Invalid limit" }, { status: 400 });
    }

    const cursorResult = parseRootsCursor(searchParams);
    if (!cursorResult.ok) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }

    const sortResult = parseSort(searchParams);
    if (!sortResult.ok) {
      return NextResponse.json({ error: "Invalid sort" }, { status: 400 });
    }
    // The page-level execution scope (milestone/configuration) — only the
    // coverage-derived pieces of this route read it; the tree structure,
    // counts and facets are execution-independent by construction.
    const executionScopeResult = parseExecutionScopeQuery(searchParams);
    if (!executionScopeResult.ok) {
      return NextResponse.json(
        { error: "Invalid milestoneIds/configIds" },
        { status: 400 }
      );
    }
    const sort: RequirementTreeSort = {
      ...sortResult.sort,
      coverageValues: await resolveCoverageSortValues(
        sortResult.sort,
        projectId,
        scope,
        executionScopeResult.scope
      ),
    };

    const [total, page] = await Promise.all([
      countProjectRequirements(projectId),
      getRequirementRootsPage({
        projectId,
        limit,
        cursor: cursorResult.cursor,
        sort,
      }),
    ]);

    return NextResponse.json({
      total,
      rows: page.rows,
      nextCursor: page.nextCursor,
    });
  } catch (error) {
    console.error("Requirements tree error:", error);
    return NextResponse.json(
      { error: "Failed to fetch requirements tree" },
      { status: 500 }
    );
  }
}

const requirementTreeCursorSchema = z.object({
  // Opaque to this route: whatever the sort column produced for the last
  // row of the previous page. A number arrives for a numeric sort column
  // and a string for a text/timestamp one; the service casts it back.
  value: z.union([z.string(), z.number()]),
  id: z.number().int(),
});

// `coverage`/`status` entries are validated as plain strings, not the
// exact `RequirementCoverageFilter`/status-id union -- an unrecognized
// value degrades harmlessly through `matchesRequirementCoverageFilter`'s
// own final `return true` branch (it becomes a no-op, matching
// everything), never a security concern, so a stricter schema here would
// buy nothing but a second place the same union has to be kept in sync.
//
// Status/source/coverage are ARRAYS: all three filters are multi-select
// (`RequirementsListView.tsx`'s three `MultiAsyncCombobox`es). An empty
// array is the inactive axis. `""` is deliberately not a member of the
// source enum any more -- the sentinel it used to carry is now the empty
// array itself, so a client that still sends `source: [""]` fails the
// schema loudly instead of silently filtering on a provenance no row has.
const requirementTreeFilterBodySchema = z.object({
  search: z.string().optional(),
  status: z.array(z.string()).optional(),
  source: z.array(z.enum(["MANUAL", "SYNCED", "DETACHED"])).optional(),
  coverage: z.array(z.string()).optional(),
  limit: z.number().int().positive(),
  // `.nullish()`, not `.optional()`: the client sends an explicit
  // `cursor: null` for page one of every filtered request, and zod's
  // `.optional()` is `T | undefined` — it rejects null, which 400'd every
  // search and filter in the browser.
  cursor: requirementTreeCursorSchema.nullish(),
  include: z.enum(["ids", "rows"]),
  // Same closed union and same default as the GET path's query params --
  // the filtered page is paged by the same keyset and must be ordered the
  // same way, or scrolling a filtered list would walk a different order
  // than the one on screen.
  sort: requirementSortSchema.nullish(),
  // Execution scope: the coverage axis and coverage-derived sorts count
  // under it; the search/status/source axes are execution-independent.
  ...executionScopeBodyShape,
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { projectId: projectIdParam } = await params;
    const projectId = Number(projectIdParam);
    if (!Number.isInteger(projectId)) {
      return NextResponse.json(
        { error: "Invalid project ID" },
        { status: 400 }
      );
    }

    const scope = await resolveViewerProjectScope(session.user.id);
    if (scope !== null && !scope.includes(projectId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    const parsedBody = requirementTreeFilterBodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    const {
      search = "",
      status = [],
      source = [],
      coverage = [],
      cursor = null,
      include,
      sort: requestedSort,
    } = parsedBody.data;
    const limit = Math.min(parsedBody.data.limit, REQUIREMENTS_TREE_MAX_LIMIT);

    const executionScope = toExecutionScope(parsedBody.data);
    const baseSort = requestedSort ?? DEFAULT_REQUIREMENT_SORT;
    const sort: RequirementTreeSort = {
      ...baseSort,
      coverageValues: await resolveCoverageSortValues(
        baseSort,
        projectId,
        scope,
        executionScope
      ),
    };

    const axes: RequirementTreeFilterAxes = { search, status, source };
    const coverageAxisActive = coverage.length > 0;

    // Non-null even when empty (28-09's own contract: an empty array is
    // "active and matched nothing", `null` is "inactive") -- computed only
    // when the coverage axis is active at all, since the rollup is a
    // whole-project query this route should never pay for on a request
    // that never asked for it.
    let coverageMatchIds: number[] | null = null;
    if (coverageAxisActive) {
      try {
        const rollup = await getRequirementCoverage(
          projectId,
          { accessibleProjectIds: scope },
          { executionScope }
        );
        coverageMatchIds = [];
        for (const [requirementId, breakdown] of rollup) {
          if (
            matchesRequirementCoverageFilters(
              coverage as RequirementCoverageFilter[],
              breakdown
            )
          ) {
            coverageMatchIds.push(requirementId);
          }
        }
      } catch (coverageError) {
        // The outage-degrades-to-inactive rule the client function has
        // today (T-28-10 threat model), preserved server-side: a rollup
        // failure must never blank the other three axes' results. This
        // catch is deliberately narrow -- only the coverage call sits
        // inside it, so a real failure in `resolveRequirementMatches`
        // below is never mistaken for this one.
        console.error("Requirement coverage rollup error:", coverageError);
        coverageMatchIds = null;
      }
    }

    const total = await countProjectRequirements(projectId);

    let matchPage;
    try {
      matchPage = await resolveRequirementMatches({
        projectId,
        axes,
        coverageMatchIds,
        limit,
        cursor,
        include,
        sort,
      });
    } catch (matchError) {
      // The ONE expected, documented failure mode this service throws for
      // (every axis inactive, including a coverage axis that degraded to
      // inactive above) -- mapped to 400, never swallowed generically.
      // Anything else propagates to the outer catch as a real 500, so a
      // genuine query failure can never present as an empty filter result.
      if (
        matchError instanceof Error &&
        matchError.message.includes("at least one filter axis must be active")
      ) {
        return NextResponse.json(
          { error: "At least one filter axis must be active" },
          { status: 400 }
        );
      }
      throw matchError;
    }

    return NextResponse.json({ total, ...matchPage });
  } catch (error) {
    console.error("Requirements tree filter error:", error);
    return NextResponse.json(
      { error: "Failed to filter requirements tree" },
      { status: 500 }
    );
  }
}
