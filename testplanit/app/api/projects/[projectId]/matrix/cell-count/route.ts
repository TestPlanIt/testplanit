import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { getEnhancedDb } from "~/lib/auth/utils";
import { runCellCountPreflight } from "~/lib/matrix/matrixCellCount";
import { baseDb } from "~/lib/db";
import { matrixFiltersBodySchema } from "~/lib/schemas/matrixFiltersSchema";
import { authOptions } from "~/server/auth";

/**
 * POST /api/projects/[projectId]/matrix/cell-count
 *
 * Returns the matrix cell-count preflight (`MatrixCellCountResult` from
 * `lib/matrix/types.ts`): `{ cellCount, willRefuse, threshold, axisCounts }`.
 *
 * Always returns 200 — `willRefuse: true` is informational, NOT an error.
 * The aggregate route is where 422 happens. This split lets the UI call
 * cell-count first (preflight UX) so the user sees the cap notice without
 * triggering an aggregate failure.
 *
 * Security:
 *   - 401 when there is no session.
 *   - 403 when the caller cannot read the requested project. The read-gate
 *     uses `getEnhancedDb(session).projects.findFirst` BEFORE invoking
 *     `runCellCountPreflight`, because the preflight runs raw SQL which
 *     bypasses ZenStack policies.
 *   - The preflight itself uses the raw `baseDb` client by design — running
 *     it through the enhanced wrapper would add latency for no security
 *     benefit (raw SQL bypasses policies regardless).
 */
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

    const result = await runCellCountPreflight(
      baseDb,
      projectId,
      parsed.data.filters
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error("[matrix cell-count POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
