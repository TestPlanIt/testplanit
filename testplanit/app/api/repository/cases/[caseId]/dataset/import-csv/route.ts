import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod/v4";

import { getEnhancedDb } from "~/lib/auth/utils";
import { auditedEnhancedTransaction } from "~/lib/audit/auditedTransaction";
import {
  buildRowSchemaFromParameters,
  type ParameterShape,
} from "~/lib/schemas/datasetRowSchema";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { updateHasParameters } from "~/lib/services/parameterMaintenance";
import { authOptions } from "~/server/auth";

/**
 * Phase 2 Plan 02-02 — CSV import wizard final commit.
 *
 * Atomicity contract (locked by RESEARCH.md HOW Q10):
 *   1. Build a per-row Zod schema from the case's parameter set (resolving
 *      SELECT lookup datasets cross-project-filtered).
 *   2. Apply the user's mapping (csvHeader -> paramName) to every CSV row.
 *   3. Validate every mapped row against the row schema BEFORE any DB write.
 *      If ANY row fails, return 400 with per-row error list — no commit.
 *   4. Open a single $transaction:
 *      - Resolve / create the dataset (via case.projectId scope).
 *      - Replace mode: soft-delete existing non-deleted rows.
 *      - Append mode: discover max(rowIndex) + 1 as the start.
 *      - Insert each validated row.
 *      - Invoke updateHasParameters(caseId, tx) to keep the helper-invocation
 *        invariant uniform across all dataset/parameter mutation paths
 *        (no-op for hasParameters since rows don't change parameter count,
 *        but enforces the call-site discipline going forward).
 */

const importCsvBodySchema = z.object({
  mode: z.enum(["replace", "append"]),
  mapping: z.record(z.string(), z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
});

const MAX_BODY_BYTES = 5 * 1024 * 1024;

export async function POST(
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

    const body = await request.json();

    // Defensive 5 MB cap on serialized body. Next.js's default body limit
    // is enforced by the runtime; this is the application-layer guard.
    const serialized = JSON.stringify(body);
    if (serialized.length > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "Payload too large (5 MB cap)" },
        { status: 413 }
      );
    }

    const data = importCsvBodySchema.parse(body);

    const db = await getEnhancedDb(session);

    const testCase = await db.repositoryCases.findFirst({
      where: { id: caseId, isDeleted: false },
      select: { id: true, projectId: true, name: true },
    });
    if (!testCase) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const parameters = await db.testCaseParameter.findMany({
      where: { testCaseId: caseId, isDeleted: false },
      select: {
        name: true,
        type: true,
        required: true,
        allowedValuesJson: true,
        lookupDataSetId: true,
      },
    });

    // Reject up front if any required parameter is missing from the mapping.
    const mappedTargets = new Set(
      Object.values(data.mapping).filter((v) => v !== "__skip__")
    );
    const missingRequired = parameters
      .filter((p: { name: string; required: boolean }) => p.required)
      .map((p: { name: string }) => p.name)
      .filter((n: string) => !mappedTargets.has(n));
    if (missingRequired.length > 0) {
      return NextResponse.json(
        {
          error: "Required parameters missing from mapping",
          missing: missingRequired,
        },
        { status: 400 }
      );
    }

    // Resolve lookup-dataset SELECT options (cross-project filter applies).
    const enrichedParams: ParameterShape[] = await Promise.all(
      parameters.map(
        async (p: {
          name: string;
          type: "STRING" | "INTEGER" | "BOOLEAN" | "SELECT";
          required: boolean;
          allowedValuesJson: unknown;
          lookupDataSetId: number | null;
        }) => {
          if (p.type === "SELECT" && p.lookupDataSetId) {
            const lookup = await db.dataSet.findFirst({
              where: {
                id: p.lookupDataSetId,
                projectId: testCase.projectId,
                isDeleted: false,
              },
              include: {
                rows: {
                  where: { isDeleted: false },
                  select: { valuesJson: true },
                },
              },
            });
            const lookupAllowedValues = lookup
              ? (lookup.rows ?? [])
                  .map((r: { valuesJson: unknown }) => {
                    const v = (r.valuesJson ?? {}) as Record<string, unknown>;
                    return v[p.name] !== undefined ? String(v[p.name]) : "";
                  })
                  .filter((s: string) => s.length > 0)
              : [];
            return {
              name: p.name,
              type: p.type,
              required: p.required,
              lookupAllowedValues,
            };
          }
          return {
            name: p.name,
            type: p.type,
            required: p.required,
            allowedValuesJson: p.allowedValuesJson,
          };
        }
      )
    );

    const rowSchema = buildRowSchemaFromParameters(enrichedParams);

    // Validate every row BEFORE the transaction.
    const errors: { rowIndex: number; issues: unknown[] }[] = [];
    const validatedRows: Record<string, unknown>[] = [];

    data.rows.forEach((csvRow, idx) => {
      const mapped: Record<string, unknown> = {};
      for (const [csvHeader, target] of Object.entries(data.mapping)) {
        if (target === "__skip__") continue;
        mapped[target] = csvRow[csvHeader];
      }
      const result = rowSchema.safeParse(mapped);
      if (!result.success) {
        errors.push({ rowIndex: idx, issues: result.error.issues });
      } else {
        validatedRows.push(result.data as Record<string, unknown>);
      }
    });

    if (errors.length > 0) {
      return NextResponse.json(
        { error: "Validation failed", errors },
        { status: 400 }
      );
    }

    // Atomic commit.
    const result = await auditedEnhancedTransaction(
      session,
      async (tx: any) => {
        let dataset = await tx.dataSet.findFirst({
          where: {
            ownerCaseId: caseId,
            projectId: testCase.projectId,
            isDeleted: false,
          },
        });
        if (!dataset) {
          dataset = await tx.dataSet.create({
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
            entityId: String(dataset.id),
            entityName: dataset.name,
            projectId: testCase.projectId,
            userId: session.user.id,
            metadata: {
              isShared: false,
              ownerCaseId: caseId,
              source: "csv-import",
            },
          }).catch(() => {
            // Audit is best-effort.
          });
        }

        let startIndex = 0;
        if (data.mode === "replace") {
          await tx.dataSetRow.updateMany({
            where: { dataSetId: dataset.id, isDeleted: false },
            data: { isDeleted: true },
          });
        } else {
          const max = await tx.dataSetRow.aggregate({
            where: { dataSetId: dataset.id, isDeleted: false },
            _max: { rowIndex: true },
          });
          startIndex = (max._max.rowIndex ?? -1) + 1;
        }

        let createdCount = 0;
        for (let i = 0; i < validatedRows.length; i++) {
          await tx.dataSetRow.create({
            data: {
              dataSetId: dataset.id,
              label: null,
              rowIndex: startIndex + i,
              valuesJson: validatedRows[i] as never,
            },
          });
          createdCount += 1;
        }

        // Helper-invocation invariant: even though dataset row writes do not
        // change `hasParameters`, calling the helper here keeps the discipline
        // uniform across every parameter/dataset mutation path.
        await updateHasParameters(caseId, tx);

        return { datasetId: dataset.id, created: createdCount };
      }
    );

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: err.issues },
        { status: 400 }
      );
    }
    console.error("[dataset import-csv POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
