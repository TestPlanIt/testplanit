import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod/v4";

import { getEnhancedDb } from "~/lib/auth/utils";
import {
  sharedDatasetSaveSchema,
  type SharedDatasetParameter,
} from "~/lib/schemas/sharedDatasetSaveSchema";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { authOptions } from "~/server/auth";

/**
 * Shared-dataset Save endpoint — the explicit commit boundary that
 * inserts a new immutable `DataSetVersion` row, bumps the parent
 * `DataSet.version` pointer, and replaces the live `DataSetRow[]`
 * (soft-delete-then-create) so existing UI surfaces continue to render
 * the latest version.
 *
 * Lazy v1 backfill: on the very first save of a previously-unversioned
 * shared dataset (zero `DataSetVersion` rows), the same transaction
 * inserts a v1 baseline row capturing the *pre-edit* `DataSetRow[]` and
 * a v2 row capturing the post-edit payload. The v1 `parametersJson` is
 * derived from the column names of the first live row (or `[]` when the
 * dataset is empty) — never `null` — so downstream mapping validation
 * always has a parameter list to validate against.
 *
 * Owner datasets (`isShared === false`) are NOT versioned through this
 * endpoint; they keep the inline-edit `DataSetRow.update` path.
 */

export async function POST(
  request: NextRequest,
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
        { error: "Invalid project or dataset id" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const payload = sharedDatasetSaveSchema.parse(body);

    const db = await getEnhancedDb(session);

    // Verify the dataset exists, belongs to the project, and is shared.
    // The enhanced client enforces SharedSteps canAddEdit / canDelete
    // for the write inside the transaction; this read happens through
    // the same enhanced client so cross-project reads are denied first.
    const dataset = await db.dataSet.findFirst({
      where: { id: dataSetId, projectId, isDeleted: false },
      select: { id: true, isShared: true },
    });
    if (!dataset) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!dataset.isShared) {
      return NextResponse.json(
        {
          error:
            "Owner datasets are not versioned through this endpoint; use the inline-edit path.",
        },
        { status: 422 }
      );
    }

    const result = await db.$transaction(async (tx: any) => {
      // Determine the current max version.
      const cur = await tx.dataSetVersion.aggregate({
        where: { dataSetId },
        _max: { version: true },
      });

      let nextVersion: number;
      let backfilledV1 = false;

      if (cur._max.version === null || cur._max.version === undefined) {
        // Lazy v1 backfill: capture the pre-edit baseline.
        const liveRows = await tx.dataSetRow.findMany({
          where: { dataSetId, isDeleted: false },
          orderBy: { rowIndex: "asc" },
          select: { label: true, valuesJson: true },
        });

        // W5 lock: derive parametersJson from the column names of the
        // first live row. Empty dataset -> empty parameter list. Each
        // derived parameter is { name, type: "STRING", order, required: false }.
        const firstRowValues =
          liveRows.length > 0
            ? ((liveRows[0].valuesJson ?? {}) as Record<string, unknown>)
            : {};
        const derivedParameters: SharedDatasetParameter[] = Object.keys(
          firstRowValues
        ).map((columnName, idx) => ({
          name: columnName,
          type: "STRING" as const,
          order: idx,
          required: false,
        }));

        const baselineRowsJson = liveRows.map(
          (r: { label: string | null; valuesJson: unknown }) => ({
            label: r.label,
            valuesJson: r.valuesJson ?? {},
          })
        );

        await tx.dataSetVersion.create({
          data: {
            dataSetId,
            version: 1,
            parametersJson: derivedParameters as never,
            rowsJson: baselineRowsJson as never,
            rowCount: liveRows.length,
            createdById: session.user.id,
          },
        });

        nextVersion = 2;
        backfilledV1 = true;
      } else {
        nextVersion = cur._max.version + 1;
      }

      // Insert the new version row capturing the post-edit payload.
      const newVersion = await tx.dataSetVersion.create({
        data: {
          dataSetId,
          version: nextVersion,
          parametersJson:
            payload.parametersJson === undefined
              ? null
              : (payload.parametersJson as never),
          rowsJson: payload.rowsJson as never,
          rowCount: payload.rowsJson.length,
          createdById: session.user.id,
        },
        select: { id: true, version: true, rowCount: true },
      });

      // Bump the parent DataSet pointer.
      await tx.dataSet.update({
        where: { id: dataSetId },
        data: { version: nextVersion },
      });

      // Replace live DataSetRow[] (soft-delete-then-create) so existing
      // UI surfaces continue to render the latest version. NEVER use
      // deleteMany — soft-delete preserves audit history.
      //
      // The @@unique([dataSetId, rowIndex]) constraint covers ALL rows,
      // soft-deleted or not, so we cannot reuse rowIndex 0..N for the
      // new rows. Insert past the existing max instead. The mirror is
      // ordered by rowIndex asc downstream so any monotonically growing
      // sequence works; the absolute values don't carry meaning.
      await tx.dataSetRow.updateMany({
        where: { dataSetId, isDeleted: false },
        data: { isDeleted: true },
      });

      const maxRow = await tx.dataSetRow.findFirst({
        where: { dataSetId },
        orderBy: { rowIndex: "desc" },
        select: { rowIndex: true },
      });
      const startIndex = (maxRow?.rowIndex ?? -1) + 1;

      for (let i = 0; i < payload.rowsJson.length; i++) {
        const row = payload.rowsJson[i];
        await tx.dataSetRow.create({
          data: {
            dataSetId,
            rowIndex: startIndex + i,
            label: row.label ?? null,
            valuesJson: row.valuesJson as never,
          },
        });
      }

      return {
        dataSetVersionId: newVersion.id,
        version: newVersion.version,
        rowCount: newVersion.rowCount,
        backfilledV1,
      };
    });

    captureAuditEvent({
      action: "UPDATE",
      entityType: "DataSet",
      entityId: String(dataSetId),
      projectId,
      userId: session.user.id,
      metadata: {
        newVersion: result.version,
        rowCount: result.rowCount,
        branchedFromVersionId: payload.branchedFromVersionId ?? null,
        backfilledV1: result.backfilledV1,
      },
    }).catch(() => {
      // Audit is best-effort.
    });

    return NextResponse.json({
      ok: true,
      version: result.version,
      dataSetVersionId: result.dataSetVersionId,
      rowCount: result.rowCount,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: err.issues },
        { status: 422 }
      );
    }
    console.error("[shared-dataset save POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
