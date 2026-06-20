import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod/v4";

import { getEnhancedDb } from "~/lib/auth/utils";
import { updateAuditContext } from "~/lib/auditContext";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { prisma } from "~/lib/prisma";
import { sharedDatasetCreateSchema } from "~/lib/schemas/sharedDatasetCreateSchema";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { authOptions } from "~/server/auth";

/**
 * Project-scoped shared-dataset list + create endpoint.
 *
 * GET — paginated list of shared datasets for the project. Includes the
 * latest `DataSetVersion` (rowCount + parametersJson + createdBy) for
 * version-label rendering, and `_count` for sharedAssignments / versions
 * so the soft-delete confirmation flow can show "N cases reference this
 * dataset" without a follow-up query.
 *
 * POST — creates a new shared dataset (no `ownerCaseId`, `isShared: true`).
 * Starts at `version: 1` with zero `DataSetVersion` rows; the lazy v1
 * backfill in the save endpoint inserts the v1 baseline + the v2
 * post-save row on first explicit Save.
 *
 * Cross-project access is blocked by the inherited `DataSet` read policy
 * via `getEnhancedDb(session)`; no route-level cross-project filter is
 * needed.
 */

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export async function GET(
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
    if (isNaN(projectId)) {
      return NextResponse.json(
        { error: "Invalid project id" },
        { status: 400 }
      );
    }

    const url = new URL(request.url);
    const page = Math.max(
      1,
      parseInt(url.searchParams.get("page") ?? "1", 10) || 1
    );
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(
        1,
        parseInt(url.searchParams.get("pageSize") ?? "", 10) ||
          DEFAULT_PAGE_SIZE
      )
    );

    const db = await getEnhancedDb(session);

    const where = {
      projectId,
      isShared: true,
      isDeleted: false,
    };

    const [items, total] = await Promise.all([
      db.dataSet.findMany({
        where,
        orderBy: { name: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          description: true,
          version: true,
          createdAt: true,
          createdBy: { select: { id: true, name: true, email: true } },
          _count: {
            select: { sharedAssignments: true, versions: true },
          },
          versions: {
            take: 1,
            orderBy: { version: "desc" },
            select: {
              rowCount: true,
              parametersJson: true,
              createdAt: true,
              createdBy: { select: { id: true, name: true, email: true } },
            },
          },
        },
      }),
      db.dataSet.count({ where }),
    ]);

    return NextResponse.json({ items, total, page, pageSize });
  } catch (err) {
    console.error("[projects datasets GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export const POST = withAuditContext(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ projectId: string }> }
  ) => {
    try {
      const session = await getServerSession(authOptions);
      if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      updateAuditContext({ userId: session.user.id });

      const { projectId: projectIdParam } = await params;
      const projectId = parseInt(projectIdParam, 10);
      if (isNaN(projectId)) {
        return NextResponse.json(
          { error: "Invalid project id" },
          { status: 400 }
        );
      }

      const body = await request.json();
      const data = sharedDatasetCreateSchema.parse(body);

      // First verify the user can READ this project via the enhanced client.
      // The DataSet @@deny chain inherits read access from the project, so
      // findFirst returning null means the caller has no business creating a
      // shared dataset here. This replaces the @@deny('create') validation
      // which can't run in ZenStack v2 against a null `ownerCase` relation —
      // the policy expression `ownerCaseId != null && ownerCase.projectId !=
      // projectId` is logically null-safe via &&, but the runtime Zod
      // validator dereferences `ownerCase` regardless and rejects the null.
      // We use the raw `prisma` client only for the create itself; the read
      // gate above is the access check.
      const db = await getEnhancedDb(session);
      const project = await db.projects.findFirst({
        where: { id: projectId, isDeleted: false },
        select: { id: true },
      });
      if (!project) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const created = await prisma.$transaction(async (tx) => {
        const dataSet = await tx.dataSet.create({
          data: {
            projectId,
            name: data.name,
            description: data.description ?? null,
            isShared: true,
            ownerCaseId: null,
            version: 1,
            createdById: session.user.id,
          },
          select: {
            id: true,
            name: true,
            description: true,
            version: true,
            isShared: true,
          },
        });

        captureAuditEvent({
          action: "CREATE",
          entityType: "DataSet",
          entityId: String(dataSet.id),
          entityName: dataSet.name,
          projectId,
          userId: session.user.id,
          metadata: { isShared: true },
        }).catch(() => {
          // Audit is best-effort.
        });

        return dataSet;
      });

      return NextResponse.json({ dataSet: created });
    } catch (err) {
      if (err instanceof ZodError) {
        return NextResponse.json(
          { error: "Validation failed", details: err.issues },
          { status: 400 }
        );
      }
      console.error("[projects datasets POST]", err);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  }
);
