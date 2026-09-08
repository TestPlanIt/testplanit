/**
 * GET /api/mcp/milestones-descendants — batched recursive-CTE descendant
 * counts. The MCP server calls this from milestones_list / milestones_get to
 * compute totalDescendants for a page of milestones in a single SQL round
 * trip. ZenStack RPC has no $queryRaw passthrough, hence the dedicated host
 * endpoint.
 *
 * Auth: Bearer API token (same path as /api/auth/whoami). Multi-tenant
 * isolation is enforced inside the handler by filtering input ids through
 * an access-policy-enforced milestones.findMany BEFORE feeding them to the
 * recursive CTE. Ids the caller cannot read are silently mapped to a count
 * of 0 in the response so the endpoint never confirms or denies the
 * existence of an arbitrary milestone id.
 *
 * Response: { data: Record<string, number> } where keys are root milestone
 * IDs (string per JSON) and values are non-soft-deleted descendant counts.
 * Every input id appears with at least 0.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateApiToken } from "~/lib/api-token-auth";
import { getEnhancedDb } from "~/lib/auth/utils";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";

interface QueryShape {
  milestoneIds: number[];
}

// Cap on the number of input ids per request. Both upstream callers
// (milestones_list page=100 + milestones_get children=100) stay well under
// this; the cap exists so an unbounded array cannot drive an expensive
// recursive CTE over arbitrary id counts.
const MAX_BATCHED_IDS = 250;

// Cap on the raw `q` JSON string length (~16KB). 250 ids of ~7 chars each
// plus JSON envelope sit well below this; the cap short-circuits parsing
// of pathologically large inputs before JSON.parse runs.
const MAX_Q_LENGTH = 16_384;

export const GET = withAuditContext(async (request: NextRequest) => {
  try {
    const auth = await authenticateApiToken(request);
    if (!auth.authenticated || !auth.userId) {
      return NextResponse.json(
        { error: auth.error ?? "Unauthorized", code: auth.errorCode },
        { status: 401 }
      );
    }

    const q = request.nextUrl.searchParams.get("q");
    if (!q) return NextResponse.json({ data: {} });
    if (q.length > MAX_Q_LENGTH) {
      return NextResponse.json(
        { error: "q parameter too large" },
        { status: 400 }
      );
    }

    let parsed: QueryShape;
    try {
      parsed = JSON.parse(q) as QueryShape;
    } catch {
      return NextResponse.json(
        { error: "Invalid q parameter" },
        { status: 400 }
      );
    }

    const ids = Array.isArray(parsed?.milestoneIds)
      ? parsed.milestoneIds.filter(
          (n): n is number => Number.isInteger(n) && n > 0
        )
      : [];
    if (ids.length === 0) return NextResponse.json({ data: {} });
    if (ids.length > MAX_BATCHED_IDS) {
      return NextResponse.json(
        { error: `milestoneIds exceeds maximum of ${MAX_BATCHED_IDS}` },
        { status: 400 }
      );
    }

    // Multi-tenant boundary: filter the input ids through an
    // access-policy-enforced read so the CTE never observes ids the caller
    // cannot access. Build a minimal Session shape from the authenticated
    // token; `getEnhancedDb` only requires `session.user.id` to load the
    // user's role + rolePermissions for ZenStack policy evaluation.
    const enhanced = await getEnhancedDb({
      user: { id: auth.userId },
      // expires is required by the next-auth Session type but unused here
      expires: new Date(0).toISOString(),
    } as Parameters<typeof getEnhancedDb>[0]);
    const accessible = (await enhanced.milestones.findMany({
      where: { id: { in: ids }, isDeleted: false },
      select: { id: true },
    })) as Array<{ id: number }>;
    const accessibleIdSet = new Set(accessible.map((m) => m.id));
    const filteredIds = ids.filter((id) => accessibleIdSet.has(id));

    const data: Record<string, number> = {};
    for (const id of ids) data[String(id)] = 0;

    if (filteredIds.length === 0) {
      return NextResponse.json({ data });
    }

    // Recursive CTE: for each accessible input id (a "root"), count all
    // descendants reachable via parentId chains where every node is
    // non-soft-deleted. Parameterized via the Prisma.sql tagged template —
    // `${filteredIds}` is bound as a typed int array, never string-interpolated.
    const rows = await baseDb.$queryRaw<
      Array<{ root_milestone_id: number; descendant_count: number }>
    >`
      WITH RECURSIVE descendants AS (
        SELECT
          "parentId" AS root_milestone_id,
          id         AS descendant_id
        FROM "Milestones"
        WHERE "parentId" = ANY(${filteredIds}::int[])
          AND "isDeleted" = false
        UNION ALL
        SELECT
          d.root_milestone_id,
          m.id AS descendant_id
        FROM "Milestones" m
        INNER JOIN descendants d ON m."parentId" = d.descendant_id
        WHERE m."isDeleted" = false
      )
      SELECT root_milestone_id, COUNT(*)::int AS descendant_count
      FROM descendants
      GROUP BY root_milestone_id
    `;

    for (const r of rows)
      data[String(r.root_milestone_id)] = r.descendant_count;

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Failed to compute milestone descendants:", error);
    return NextResponse.json(
      { error: "Failed to compute milestone descendants" },
      { status: 500 }
    );
  }
});
