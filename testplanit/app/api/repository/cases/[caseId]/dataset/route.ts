import { ApplicationArea } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { getEnhancedDb } from "~/lib/auth/utils";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { redactValues } from "~/lib/services/parameterRedaction";
import { authOptions } from "~/server/auth";

/**
 * Phase 2 Plan 02-02 — Dataset attach + read.
 *
 * GET — fetches the case's attached DataSet (at most one per case, DSET-01)
 * with rows. Applies the Phase 1 carry-forward `WHERE projectId = ...`
 * filter explicitly: the DataSet `@@deny` only blocks cross-project
 * create/update, not read.
 *
 * Sensitive cell values are redacted via `redactValues()` at the data-fetch
 * boundary; viewers without `RolePermission.canReadSensitive` see
 * "[REDACTED]" instead of plaintext.
 *
 * POST — idempotent attach. Returns the existing dataset if one is already
 * attached (DSET-01 invariant). Otherwise creates a new one with the
 * case's name.
 */

/**
 * Resolves whether the viewer can read sensitive parameter values on this
 * case's dataset. Parameters live with test cases, so the gate is the
 * existing `TestCaseRestrictedFields` ApplicationArea's `canReadSensitive`
 * grant — not a new permission. System admins always pass.
 *
 * The earlier implementation matched `canReadSensitive` on ANY area, which
 * unintentionally let a role with the grant on e.g. Sessions also read
 * test-case sensitive values. Filtering by area aligns this with the
 * existing Restricted Fields gates used elsewhere in the app.
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
        (p: { area?: ApplicationArea; canReadSensitive?: boolean }) =>
          p?.area === ApplicationArea.TestCaseRestrictedFields &&
          p?.canReadSensitive === true
      )
    : false;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ caseId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { caseId: caseIdParam } = await params;
    const caseId = parseInt(caseIdParam, 10);
    if (isNaN(caseId)) {
      return NextResponse.json({ error: "Invalid case id" }, { status: 400 });
    }

    // Pagination: opt-in via ?page=. When absent, return the full dataset
    // for back-compat (callers that need every row in one shot).
    const url = new URL(request.url);
    const pageParam = url.searchParams.get("page");
    const pageSizeParam = url.searchParams.get("pageSize");
    const isPaged = pageParam !== null;
    const page = isPaged ? Math.max(1, parseInt(pageParam, 10) || 1) : 1;
    const pageSize = isPaged
      ? Math.min(
          MAX_PAGE_SIZE,
          Math.max(1, parseInt(pageSizeParam ?? "", 10) || DEFAULT_PAGE_SIZE)
        )
      : DEFAULT_PAGE_SIZE;

    const db = await getEnhancedDb(session);

    const testCase = await db.repositoryCases.findFirst({
      where: { id: caseId, isDeleted: false },
      select: { id: true, projectId: true },
    });
    if (!testCase) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Phase 1 carry-forward: explicit projectId filter — DataSet @@deny
    // does not block cross-project READ at the schema layer.
    const dataset = await db.dataSet.findFirst({
      where: {
        ownerCaseId: caseId,
        projectId: testCase.projectId,
        isDeleted: false,
      },
      include: {
        rows: {
          where: { isDeleted: false },
          orderBy: { rowIndex: "asc" },
          ...(isPaged ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
        },
      },
    });
    if (!dataset) {
      return NextResponse.json({
        dataset: null,
        totalRows: 0,
        page,
        pageSize,
      });
    }

    const totalRows = await db.dataSetRow.count({
      where: { dataSetId: dataset.id, isDeleted: false },
    });

    const parameters = await db.testCaseParameter.findMany({
      where: { testCaseId: caseId, isDeleted: false },
      select: { name: true, sensitive: true },
    });

    const viewerCanReadSensitive = await resolveCanReadSensitive(
      db,
      session.user.id
    );

    const safeRows = (dataset.rows ?? []).map(
      (row: {
        id: number;
        valuesJson: unknown;
        rowIndex: number;
        label: string | null;
      }) => ({
        ...row,
        valuesJson: redactValues(
          (row.valuesJson ?? {}) as Record<string, unknown>,
          parameters,
          viewerCanReadSensitive
        ),
      })
    );

    return NextResponse.json({
      dataset: { ...dataset, rows: safeRows },
      totalRows,
      page,
      pageSize,
    });
  } catch (err) {
    console.error("[dataset GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ caseId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { caseId: caseIdParam } = await params;
    const caseId = parseInt(caseIdParam, 10);
    if (isNaN(caseId)) {
      return NextResponse.json({ error: "Invalid case id" }, { status: 400 });
    }

    const db = await getEnhancedDb(session);

    const testCase = await db.repositoryCases.findFirst({
      where: { id: caseId, isDeleted: false },
      select: { id: true, projectId: true, name: true },
    });
    if (!testCase) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // DSET-01: idempotent attach — return existing if any.
    const existing = await db.dataSet.findFirst({
      where: {
        ownerCaseId: caseId,
        projectId: testCase.projectId,
        isDeleted: false,
      },
    });
    if (existing) {
      return NextResponse.json({ dataset: existing });
    }

    const created = await db.dataSet.create({
      data: {
        name: `${testCase.name} dataset`,
        ownerCaseId: caseId,
        projectId: testCase.projectId,
        isShared: false,
        createdById: session.user.id,
      },
    });

    captureAuditEvent({
      action: "CREATE",
      entityType: "DataSet",
      entityId: String(created.id),
      entityName: created.name,
      projectId: testCase.projectId,
      userId: session.user.id,
      metadata: { isShared: false, ownerCaseId: caseId },
    }).catch(() => {
      // Audit is best-effort.
    });

    return NextResponse.json({ dataset: created });
  } catch (err) {
    console.error("[dataset POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
