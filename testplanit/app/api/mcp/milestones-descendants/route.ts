/**
 * GET /api/mcp/milestones-descendants — batched recursive-CTE descendant
 * counts. The MCP server calls this from milestones_list / milestones_get to
 * compute totalDescendants for a page of milestones in a single SQL round
 * trip. ZenStack RPC has no $queryRaw passthrough, hence the dedicated host
 * endpoint.
 *
 * Auth: Bearer API token (same path as /api/auth/whoami). Multi-tenant
 * isolation via the CTE filtering on isDeleted=false at every level;
 * project-scope is implicitly enforced by the caller having already
 * resolved the milestoneIds via a project-scoped milestones.findMany with
 * access policy enforcement.
 *
 * Response: { data: Record<string, number> } where keys are root milestone
 * IDs (string per JSON) and values are non-soft-deleted descendant counts.
 * Every input id appears with at least 0.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateApiToken } from "~/lib/api-token-auth";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { prisma } from "~/lib/prisma";

interface QueryShape {
  milestoneIds: number[];
}

export const GET = withAuditContext(async (request: NextRequest) => {
  try {
    const auth = await authenticateApiToken(request);
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error ?? "Unauthorized", code: auth.errorCode },
        { status: 401 },
      );
    }

    const q = request.nextUrl.searchParams.get("q");
    if (!q) return NextResponse.json({ data: {} });

    let parsed: QueryShape;
    try {
      parsed = JSON.parse(q) as QueryShape;
    } catch {
      return NextResponse.json(
        { error: "Invalid q parameter" },
        { status: 400 },
      );
    }

    const ids = Array.isArray(parsed?.milestoneIds)
      ? parsed.milestoneIds.filter(
          (n): n is number => Number.isInteger(n) && n > 0,
        )
      : [];
    if (ids.length === 0) return NextResponse.json({ data: {} });

    // Recursive CTE: for each input id (a "root"), count all descendants
    // reachable via parentId chains where every node is non-soft-deleted.
    // Parameterized via the Prisma.sql tagged template — `${ids}` is bound
    // as a typed int array, never string-interpolated.
    const rows = await prisma.$queryRaw<
      Array<{ root_milestone_id: number; descendant_count: number }>
    >`
      WITH RECURSIVE descendants AS (
        SELECT
          "parentId" AS root_milestone_id,
          id         AS descendant_id
        FROM "Milestones"
        WHERE "parentId" = ANY(${ids}::int[])
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

    const data: Record<string, number> = {};
    for (const id of ids) data[String(id)] = 0;
    for (const r of rows) data[String(r.root_milestone_id)] = r.descendant_count;

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Failed to compute milestone descendants:", error);
    return NextResponse.json(
      { error: "Failed to compute milestone descendants" },
      { status: 500 },
    );
  }
});
