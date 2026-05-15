import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { getEnhancedDb } from "~/lib/auth/utils";
import {
  MatrixCellCapExceededError,
  runMatrixAggregation,
} from "~/lib/matrix/matrixAggregation";
import { prisma } from "~/lib/prisma";
import { matrixFiltersBodySchema } from "~/lib/schemas/matrixFiltersSchema";
import { authOptions } from "~/server/auth";

/**
 * POST /api/projects/[projectId]/matrix/aggregate
 *
 * Returns the full aggregated grid (`AxesShape` from `lib/matrix/types.ts`)
 * — `caseAxis`, `configAxis`, `cells`, `cellCount`, `statusMap`. The
 * `cells` Map is serialized as an array of `[key, CellSummary]` pairs
 * because `JSON.stringify(new Map())` returns `{}`. Clients reconstruct
 * the Map with `new Map(response.cells)`.
 *
 * Cell-cap refusal returns 422 with body
 * `{ error: "cell_cap_exceeded", cellCount, threshold, axisCounts }`
 * so React Query does NOT cache the refusal — the cap notice clears as
 * soon as the user changes filters and re-queries.
 *
 * Security:
 *   - 401 when there is no session.
 *   - 403 when the caller cannot read the requested project. The read-gate
 *     uses `getEnhancedDb(session).projects.findFirst` BEFORE invoking
 *     `runMatrixAggregation`, because the aggregator runs raw SQL which
 *     bypasses ZenStack policies.
 *   - Sensitive parameter values are redacted inside `runMatrixAggregation`
 *     based on `viewerCanReadSensitive` resolved from the session's role
 *     permissions.
 */

/**
 * Resolves whether the authenticated user holds the `canReadSensitive`
 * permission on ANY of their role rows. Mirrors the inline helper in
 * `app/api/repository/cases/[caseId]/dataset/route.ts` (and its three
 * sibling routes) — the rule has not yet been extracted into a shared
 * `lib/auth/sensitiveValues.ts` helper, so this route uses the same local
 * pattern. System admins always have access.
 */
async function resolveCanReadSensitive(
  db: any,
  userId: string
): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { role: { include: { rolePermissions: true } } },
  });
  if (!user) return false;
  if (user.access === "ADMIN") return true;
  const perms = user.role?.rolePermissions ?? [];
  return Array.isArray(perms)
    ? perms.some(
        (p: { canReadSensitive?: boolean }) => p?.canReadSensitive === true
      )
    : false;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { projectId: projectIdParam } = await params;
    const projectId = parseInt(projectIdParam, 10);
    if (Number.isNaN(projectId) || projectId <= 0) {
      return NextResponse.json(
        { error: "Invalid project id" },
        { status: 400 }
      );
    }

    const db = await getEnhancedDb(session);
    const project = await db.projects.findFirst({
      where: { id: projectId, isDeleted: false },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      rawBody = {};
    }
    const parsed = matrixFiltersBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid filters", details: parsed.error.flatten() },
        { status: 422 }
      );
    }

    const viewerCanReadSensitive = await resolveCanReadSensitive(
      db,
      session.user.id
    );

    try {
      const axes = await runMatrixAggregation(
        prisma,
        projectId,
        parsed.data.filters,
        viewerCanReadSensitive
      );
      return NextResponse.json({
        caseAxis: axes.caseAxis,
        configAxis: axes.configAxis,
        cells: Array.from(axes.cells.entries()),
        cellCount: axes.cellCount,
        statusMap: axes.statusMap,
      });
    } catch (err) {
      if (err instanceof MatrixCellCapExceededError) {
        return NextResponse.json(
          {
            error: "cell_cap_exceeded",
            cellCount: err.result.cellCount,
            threshold: err.result.threshold,
            axisCounts: err.result.axisCounts,
          },
          { status: 422 }
        );
      }
      throw err;
    }
  } catch (err) {
    console.error("[matrix aggregate POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
