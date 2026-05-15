import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

import { getEnhancedDb } from "~/lib/auth/utils";
import {
  MatrixCellCapExceededError,
  runMatrixAggregation,
} from "~/lib/matrix/matrixAggregation";
import { prisma } from "~/lib/prisma";
import { matrixFiltersSchema } from "~/lib/schemas/matrixFiltersSchema";
import { authOptions } from "~/server/auth";

/**
 * POST /api/report-builder/iteration-matrix
 *
 * Report-builder preset proxy for the Matrix view. Returns the same
 * `AxesShape`-shaped payload as the dedicated `/api/projects/[projectId]/matrix/aggregate`
 * route — but with `projectId` carried in the body (the report-builder
 * framework calls presets without a projectId in the URL; the projectId is
 * sourced from the saved report configuration).
 *
 * This proxy MUST import `runMatrixAggregation` directly — it does NOT
 * HTTP-fetch the dedicated route. Both surfaces share the same TypeScript
 * helpers; "no HTTP indirection between the surfaces — they share TS code,
 * not API calls."
 *
 * Response shape mirrors the aggregate route 1:1:
 *   { caseAxis, configAxis, cells: [...], cellCount, statusMap }
 *
 * `cells` is serialized as an array of `[key, value]` pairs because
 * `JSON.stringify(new Map())` returns `{}`. The client-side hook
 * reconstructs the Map via `new Map(response.cells)`.
 *
 * Security:
 *   - 401 when there is no session.
 *   - 403 when the caller cannot read the requested project. Even though
 *     the projectId comes from the body (forgeable by any authenticated
 *     caller), the read-gate via `getEnhancedDb(session).projects.findFirst`
 *     is the single thing keeping cross-project reads honest.
 *   - 422 when the body is malformed OR when the cell-count exceeds the
 *     10k cap. Cap behavior is identical to the dedicated route — the
 *     helper enforces it uniformly; this route does not add a separate cap.
 */

/**
 * Resolves whether the authenticated user holds the `canReadSensitive`
 * permission on their role. Mirrors the inline helper used by the matrix
 * export route + `app/api/test-runs/submit-result/route.ts` —  sensitive
 * parameter values are sensitive across all surfaces, so the rule is the
 * same broad role-permission check (no per-ApplicationArea scoping).
 */
async function resolveCanReadSensitive(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: { include: { rolePermissions: true } } },
  });
  if (!u) return false;
  if (u.access === "ADMIN") return true;
  const perms = u.role?.rolePermissions ?? [];
  return Array.isArray(perms)
    ? perms.some(
        (p: { canReadSensitive?: boolean }) => p?.canReadSensitive === true
      )
    : false;
}

const reportBuilderMatrixBodySchema = z.object({
  projectId: z.number().int().positive(),
  filters: matrixFiltersSchema.default({}),
});

/**
 * GET /api/report-builder/iteration-matrix
 *
 * ReportBuilder fetches metadata via GET on every preset's endpoint to populate
 * its dimensions/metrics pickers. The matrix preset has neither — it's a fixed
 * grid keyed on cases × configurations × parameter rows — so we return empty
 * arrays. Mirrors the execution-log preset's GET stub.
 */
export async function GET() {
  return NextResponse.json({ dimensions: [], metrics: [] });
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      rawBody = {};
    }
    const parsed = reportBuilderMatrixBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 422 }
      );
    }

    const { projectId, filters } = parsed.data;

    const db = await getEnhancedDb(session);
    const project = await db.projects.findFirst({
      where: { id: projectId, isDeleted: false },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const viewerCanReadSensitive = await resolveCanReadSensitive(
      session.user.id
    );

    try {
      const axes = await runMatrixAggregation(
        prisma,
        projectId,
        filters,
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
    console.error("[report-builder iteration-matrix POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
