import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { getRequirementCoverage } from "~/lib/services/requirementCoverage";
import {
  matchesRequirementCoverageFilter,
  type RequirementCoverageFilter,
} from "~/lib/services/requirementCoverageFilter";
import {
  countProjectRequirements,
  getRequirementRootsPage,
  REQUIREMENT_LAZY_THRESHOLD,
  resolveRequirementMatches,
  type RequirementRootsCursor,
  type RequirementTreeFilterAxes,
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
 */
function parseRootsCursor(
  searchParams: URLSearchParams
): { ok: true; cursor: RequirementRootsCursor | null } | { ok: false } {
  const cursorName = searchParams.get("cursorName");
  const cursorId = searchParams.get("cursorId");
  if (cursorName === null && cursorId === null) {
    return { ok: true, cursor: null };
  }
  if (cursorName === null || cursorId === null) {
    return { ok: false };
  }
  if (!/^\d+$/.test(cursorId)) {
    return { ok: false };
  }
  return { ok: true, cursor: { name: cursorName, id: Number(cursorId) } };
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
      const total = await countProjectRequirements(projectId);
      // The ONE place this comparison is written -- callers read `mode`
      // rather than re-deriving it from `total`/`threshold` themselves, so
      // a future change to the boundary's `>`/`<=` semantics cannot drift
      // between this route and a client-side copy of the same check.
      const mode = total > REQUIREMENT_LAZY_THRESHOLD ? "lazy" : "all";
      return NextResponse.json({
        total,
        threshold: REQUIREMENT_LAZY_THRESHOLD,
        mode,
      });
    }

    const limit = parseLimit(searchParams.get("limit"));
    if (limit === null) {
      return NextResponse.json({ error: "Invalid limit" }, { status: 400 });
    }

    const cursorResult = parseRootsCursor(searchParams);
    if (!cursorResult.ok) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }

    const [total, page] = await Promise.all([
      countProjectRequirements(projectId),
      getRequirementRootsPage({
        projectId,
        limit,
        cursor: cursorResult.cursor,
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
  name: z.string(),
  id: z.number().int(),
});

// `coverage`/`search`/`status` are validated as plain strings, not the
// exact `RequirementCoverageFilter`/status-id union -- an unrecognized
// value degrades harmlessly through `matchesRequirementCoverageFilter`'s
// own final `return true` branch (it becomes a no-op, matching
// everything), never a security concern, so a stricter schema here would
// buy nothing but a second place the same union has to be kept in sync.
const requirementTreeFilterBodySchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  source: z.enum(["", "MANUAL", "SYNCED", "DETACHED"]).optional(),
  coverage: z.string().optional(),
  limit: z.number().int().positive(),
  cursor: requirementTreeCursorSchema.optional(),
  include: z.enum(["ids", "rows"]),
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
      status = "",
      source = "",
      coverage = "",
      cursor = null,
      include,
    } = parsedBody.data;
    const limit = Math.min(parsedBody.data.limit, REQUIREMENTS_TREE_MAX_LIMIT);

    const axes: RequirementTreeFilterAxes = { search, status, source };
    const coverageAxisActive = coverage !== "";

    // Non-null even when empty (28-09's own contract: an empty array is
    // "active and matched nothing", `null` is "inactive") -- computed only
    // when the coverage axis is active at all, since the rollup is a
    // whole-project query this route should never pay for on a request
    // that never asked for it.
    let coverageMatchIds: number[] | null = null;
    if (coverageAxisActive) {
      try {
        const rollup = await getRequirementCoverage(projectId, {
          accessibleProjectIds: scope,
        });
        coverageMatchIds = [];
        for (const [requirementId, breakdown] of rollup) {
          if (
            matchesRequirementCoverageFilter(
              coverage as RequirementCoverageFilter,
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
