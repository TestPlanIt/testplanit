import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { getEnhancedDb } from "~/lib/auth/utils";
import { updateAuditContext } from "~/lib/auditContext";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { prisma } from "~/lib/prisma";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { authOptions } from "~/server/auth";

/**
 * Project-scoped shared dataset detail + soft-delete endpoint.
 *
 * GET    — returns the dataset row (must be `isShared: true` and live
 *          inside the path project) plus a summary of its latest
 *          `DataSetVersion`. Historical versions are loaded via the
 *          ZenStack-generated `useFindManyDataSetVersion` hook
 *          (schema-policy gated read), so this route returns only the
 *          parent + latest-version summary.
 *
 * DELETE — soft-deletes the dataset (`isDeleted: true`). When active
 *          assignments exist the request must include `?confirm=true`;
 *          otherwise we return 409 with the active assignment count so
 *          the UI (Plan 04-05) can render an AlertDialog confirmation
 *          before re-issuing the request. On confirmed delete the active
 *          assignment rows are hard-deleted (assignments are not
 *          soft-delete-bearing rows; historical fidelity for in-flight
 *          runs is preserved by the snapshot capture).
 */

export async function GET(
  _request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ projectId: string; dataSetId: string }>;
  }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { projectId: projectIdParam, dataSetId: dataSetIdParam } =
      await params;
    const projectId = parseInt(projectIdParam, 10);
    const dataSetId = parseInt(dataSetIdParam, 10);
    if (isNaN(projectId) || isNaN(dataSetId)) {
      return NextResponse.json(
        { error: "Invalid path parameter" },
        { status: 400 }
      );
    }

    const db = await getEnhancedDb(session);

    const dataset = await db.dataSet.findFirst({
      where: {
        id: dataSetId,
        projectId,
        isShared: true,
        isDeleted: false,
      },
      select: {
        id: true,
        projectId: true,
        name: true,
        description: true,
        isShared: true,
        version: true,
        createdAt: true,
        createdById: true,
      },
    });
    if (!dataset) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const latestVersion = await db.dataSetVersion.findFirst({
      where: { dataSetId },
      orderBy: { version: "desc" },
      select: {
        id: true,
        version: true,
        rowCount: true,
        parametersJson: true,
        createdAt: true,
        createdById: true,
      },
    });

    return NextResponse.json({ dataset, latestVersion: latestVersion ?? null });
  } catch (err) {
    console.error("[shared-dataset detail GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export const DELETE = withAuditContext(async (
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ projectId: string; dataSetId: string }>;
  }
) => {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    updateAuditContext({ userId: session.user.id });

    const { projectId: projectIdParam, dataSetId: dataSetIdParam } =
      await params;
    const projectId = parseInt(projectIdParam, 10);
    const dataSetId = parseInt(dataSetIdParam, 10);
    if (isNaN(projectId) || isNaN(dataSetId)) {
      return NextResponse.json(
        { error: "Invalid path parameter" },
        { status: 400 }
      );
    }

    const url = new URL(request.url);
    const confirmed = url.searchParams.get("confirm") === "true";

    const db = await getEnhancedDb(session);

    const dataset = await db.dataSet.findFirst({
      where: {
        id: dataSetId,
        projectId,
        isShared: true,
        isDeleted: false,
      },
      select: { id: true, name: true },
    });
    if (!dataset) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const assignmentCount = await db.caseSharedDataSetAssignment.count({
      where: { sharedDataSetId: dataSetId },
    });

    if (!confirmed && assignmentCount > 0) {
      return NextResponse.json(
        { error: "has_assignments", assignmentCount },
        { status: 409 }
      );
    }

    await prisma.$transaction(async (tx) => {
      // Soft-delete the parent dataset; rows are gated everywhere by the
      // parent's `isDeleted` filter, so flipping the row-level flag is
      // unnecessary. DataSetVersion rows are immutable history and
      // remain intact.
      await tx.dataSet.update({
        where: { id: dataSetId },
        data: { isDeleted: true },
      });

      // Active assignments must be cleared atomically with the
      // soft-delete so consumer cases stop resolving to a tombstoned
      // dataset on the next iteration fan-out. Assignments do not carry
      // an `isDeleted` flag (their lifecycle is bound to the case + the
      // shared dataset), so a hard delete is the correct semantic. The
      // run snapshot already records the resolved version per
      // testRunCase, preserving historical fidelity.
      //
      // Per-row delete (no `deleteMany`) keeps this call site consistent
      // with the rest of the codebase's policy-friendly mutation idioms;
      // assignment counts are bounded by the number of consuming cases,
      // so the loop is O(n) over a small n.
      if (assignmentCount > 0) {
        const targets = await tx.caseSharedDataSetAssignment.findMany({
          where: { sharedDataSetId: dataSetId },
          select: { id: true },
        });
        for (const t of targets) {
          await tx.caseSharedDataSetAssignment.delete({ where: { id: t.id } });
        }
      }
    });

    captureAuditEvent({
      action: "DELETE",
      entityType: "DataSet",
      entityId: String(dataSetId),
      entityName: dataset.name,
      projectId,
      userId: session.user.id,
      metadata: {
        affectedAssignments: assignmentCount,
        confirmed,
      },
    }).catch(() => {
      // Audit is best-effort; never block the response.
    });

    return NextResponse.json({
      ok: true,
      deletedAssignments: assignmentCount,
    });
  } catch (err) {
    console.error("[shared-dataset detail DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
});
