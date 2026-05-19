import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

import { getEnhancedDb } from "~/lib/auth/utils";
import { prisma } from "~/lib/prisma";
import {
  SKIP_MAPPING_SENTINEL,
  sharedDatasetAssignmentSchema,
} from "~/lib/schemas/sharedDatasetAssignmentSchema";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { authOptions } from "~/server/auth";

/**
 * Per-case shared-dataset assignment endpoint.
 *
 * GET   — return the current `CaseSharedDataSetAssignment` for the case
 *         (or `{ assignment: null }` if none).
 * PUT   — upsert the assignment. Validates the requested shared dataset
 *         lives in the case's project (cross-project denial; defense in
 *         depth on top of the schema `@@deny`), the pinned version (if
 *         any) belongs to that dataset, and that every REQUIRED parameter
 *         on the case is covered by a non-skip column in `mappingJson`.
 * DELETE — hard-delete the assignment row. The schema does not carry an
 *         `isDeleted` flag on the assignment; historical fidelity is
 *         preserved by the snapshot (which captures the resolved version
 *         at run-create time), so dropping the row is the correct
 *         semantic.
 *
 * A case may carry an owner dataset AND a shared-dataset assignment
 * simultaneously; runtime semantics decide which one drives iteration
 * fan-out. This endpoint does NOT refuse a PUT when an owner dataset
 * exists.
 */

const SKIP = SKIP_MAPPING_SENTINEL;

/**
 * Derive the column name set for a `DataSetVersion` from its
 * `parametersJson`. Falls back to `rowsJson[0]` keys when `parametersJson`
 * is null (defensive — shared-dataset versions always populate
 * `parametersJson` on save, but pre-save backfills could be sparse).
 */
function deriveVersionColumns(version: {
  parametersJson: unknown;
  rowsJson: unknown;
}): string[] {
  const params = version.parametersJson;
  if (Array.isArray(params)) {
    const out: string[] = [];
    for (const entry of params) {
      if (
        entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        typeof (entry as Record<string, unknown>).name === "string"
      ) {
        out.push(String((entry as Record<string, unknown>).name));
      }
    }
    if (out.length > 0) return out;
  }

  const rows = version.rowsJson;
  if (Array.isArray(rows) && rows.length > 0) {
    const first = rows[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const valuesJson = (first as Record<string, unknown>).valuesJson;
      if (
        valuesJson &&
        typeof valuesJson === "object" &&
        !Array.isArray(valuesJson)
      ) {
        return Object.keys(valuesJson as Record<string, unknown>);
      }
      // Some row shapes inline the values directly on the row object
      // (no `valuesJson` wrapper) — accept that too for resilience.
      return Object.keys(first as Record<string, unknown>).filter(
        (k) => k !== "label" && k !== "rowIndex" && k !== "id",
      );
    }
  }

  return [];
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
      select: { id: true },
    });
    if (!testCase) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const assignment = await db.caseSharedDataSetAssignment.findUnique({
      where: { caseId },
      include: {
        sharedDataSet: { select: { id: true, name: true, version: true } },
        pinnedVersion: {
          select: {
            id: true,
            version: true,
            rowCount: true,
            parametersJson: true,
          },
        },
      },
    });

    return NextResponse.json({ assignment: assignment ?? null });
  } catch (err) {
    console.error("[shared-dataset GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
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

    const body = await request.json().catch(() => null);
    const parsed = sharedDatasetAssignmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: z.treeifyError(parsed.error) },
        { status: 422 },
      );
    }
    const { sharedDataSetId, pinnedVersionId, mappingJson } = parsed.data;

    const db = await getEnhancedDb(session);

    // The enhanced client enforces write access on the case via the
    // assignment model's @@allow chain. We still read the case row to
    // discover its projectId for the cross-project comparison and to
    // surface a precise 404.
    const testCase = await db.repositoryCases.findFirst({
      where: { id: caseId, isDeleted: false },
      select: { id: true, projectId: true },
    });
    if (!testCase) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const sharedDataSet = await db.dataSet.findFirst({
      where: { id: sharedDataSetId, isDeleted: false },
      select: { id: true, projectId: true, isShared: true },
    });
    if (!sharedDataSet) {
      return NextResponse.json(
        { error: "Shared dataset not found" },
        { status: 404 },
      );
    }
    if (!sharedDataSet.isShared) {
      return NextResponse.json(
        { error: "not_shared" },
        { status: 422 },
      );
    }
    if (sharedDataSet.projectId !== testCase.projectId) {
      return NextResponse.json(
        { error: "cross_project" },
        { status: 422 },
      );
    }

    let resolvedVersion: {
      id: number;
      parametersJson: unknown;
      rowsJson: unknown;
    } | null = null;
    if (pinnedVersionId !== null) {
      const v = await db.dataSetVersion.findFirst({
        where: { id: pinnedVersionId },
        select: {
          id: true,
          dataSetId: true,
          parametersJson: true,
          rowsJson: true,
        },
      });
      if (!v) {
        return NextResponse.json(
          { error: "pinned_version_not_found" },
          { status: 422 },
        );
      }
      if (v.dataSetId !== sharedDataSetId) {
        return NextResponse.json(
          { error: "pinned_version_dataset_mismatch" },
          { status: 422 },
        );
      }
      resolvedVersion = v;
    } else {
      // "Follow latest": validate against the highest-numbered version of
      // the dataset (or skip column-existence checks if the dataset has
      // never been saved — in which case mapping cannot reference any
      // columns and the required-coverage check below will catch the
      // gap).
      const v = await db.dataSetVersion.findFirst({
        where: { dataSetId: sharedDataSetId },
        orderBy: { version: "desc" },
        select: {
          id: true,
          parametersJson: true,
          rowsJson: true,
        },
      });
      resolvedVersion = v;
    }

    const versionColumns = resolvedVersion
      ? new Set(deriveVersionColumns(resolvedVersion))
      : new Set<string>();

    const caseParameters = await db.testCaseParameter.findMany({
      where: { testCaseId: caseId, isDeleted: false },
      select: { name: true, required: true },
    });
    const liveParameterNames = new Set(caseParameters.map((p) => p.name));
    const requiredParameterNames = caseParameters
      .filter((p) => p.required)
      .map((p) => p.name);

    // Per-entry validation: column must exist on the version (when we
    // know the columns); paramName must either be the skip sentinel or a
    // live parameter name on the case.
    const unknownColumns: string[] = [];
    const unknownParams: string[] = [];
    for (const [columnName, paramName] of Object.entries(mappingJson)) {
      if (versionColumns.size > 0 && !versionColumns.has(columnName)) {
        unknownColumns.push(columnName);
      }
      if (paramName !== SKIP && !liveParameterNames.has(paramName)) {
        unknownParams.push(paramName);
      }
    }
    if (unknownColumns.length > 0) {
      return NextResponse.json(
        { error: "unknown_columns", columns: unknownColumns },
        { status: 422 },
      );
    }
    if (unknownParams.length > 0) {
      return NextResponse.json(
        { error: "unknown_parameters", parameters: unknownParams },
        { status: 422 },
      );
    }

    // Required-coverage: every required parameter must be the target of
    // at least one non-skip column mapping.
    const mappedParamNames = new Set(
      Object.values(mappingJson).filter((v) => v !== SKIP),
    );
    const missing = requiredParameterNames.filter(
      (name) => !mappedParamNames.has(name),
    );
    if (missing.length > 0) {
      return NextResponse.json(
        { error: "required_unmapped", missing },
        { status: 422 },
      );
    }

    const assignment = await prisma.$transaction(async (tx) => {
      return tx.caseSharedDataSetAssignment.upsert({
        where: { caseId },
        create: {
          caseId,
          sharedDataSetId,
          pinnedVersionId,
          mappingJson: mappingJson as unknown as Prisma.InputJsonValue,
          createdById: session.user.id,
        },
        update: {
          sharedDataSetId,
          pinnedVersionId,
          mappingJson: mappingJson as unknown as Prisma.InputJsonValue,
        },
        select: {
          id: true,
          sharedDataSetId: true,
          pinnedVersionId: true,
          mappingJson: true,
        },
      });
    });

    captureAuditEvent({
      action: "UPDATE",
      entityType: "CaseSharedDataSetAssignment",
      entityId: String(assignment.id),
      projectId: testCase.projectId,
      userId: session.user.id,
      metadata: {
        caseId,
        sharedDataSetId,
        pinnedVersionId,
        // Log mapping KEYS only (column names), never values (parameter
        // names may be considered sensitive in some projects).
        mappingColumns: Object.keys(mappingJson),
      },
    }).catch(() => {
      // Audit is best-effort; never block the response.
    });

    return NextResponse.json({ assignment });
  } catch (err) {
    console.error("[shared-dataset PUT]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
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

    // Pre-fetch for the audit payload + a precise 404 when no assignment
    // exists (vs. the policy-deny noise of a blind delete).
    const existing = await db.caseSharedDataSetAssignment.findUnique({
      where: { caseId },
      include: {
        case: { select: { projectId: true } },
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.caseSharedDataSetAssignment.delete({ where: { caseId } });
    });

    captureAuditEvent({
      action: "DELETE",
      entityType: "CaseSharedDataSetAssignment",
      entityId: String(existing.id),
      projectId: existing.case.projectId,
      userId: session.user.id,
      metadata: {
        caseId,
        sharedDataSetId: existing.sharedDataSetId,
        pinnedVersionId: existing.pinnedVersionId,
      },
    }).catch(() => {
      // Audit is best-effort; never block the response.
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[shared-dataset DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
