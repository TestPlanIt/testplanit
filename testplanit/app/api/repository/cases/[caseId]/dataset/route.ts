import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { getEnhancedDb } from "~/lib/auth/utils";
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

async function resolveCanReadSensitive(
  db: any,
  userId: string,
): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { role: { include: { rolePermissions: true } } },
  });
  if (!user) return false;
  // System admins always have access.
  if (user.access === "ADMIN") return true;
  const perms = user.role?.rolePermissions ?? [];
  return Array.isArray(perms)
    ? perms.some((p: { canReadSensitive?: boolean }) => p?.canReadSensitive === true)
    : false;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ caseId: string }> },
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
        },
      },
    });
    if (!dataset) {
      return NextResponse.json({ dataset: null });
    }

    const parameters = await db.testCaseParameter.findMany({
      where: { testCaseId: caseId, isDeleted: false },
      select: { name: true, sensitive: true },
    });

    const viewerCanReadSensitive = await resolveCanReadSensitive(
      db,
      session.user.id,
    );

    const safeRows = (dataset.rows ?? []).map(
      (row: { id: number; valuesJson: unknown; rowIndex: number; label: string | null }) => ({
        ...row,
        valuesJson: redactValues(
          (row.valuesJson ?? {}) as Record<string, unknown>,
          parameters,
          viewerCanReadSensitive,
        ),
      }),
    );

    return NextResponse.json({
      dataset: { ...dataset, rows: safeRows },
    });
  } catch (err) {
    console.error("[dataset GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ caseId: string }> },
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
    return NextResponse.json({ dataset: created });
  } catch (err) {
    console.error("[dataset POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
