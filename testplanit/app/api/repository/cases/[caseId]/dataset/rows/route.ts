import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod/v4";

import { getEnhancedDb } from "~/lib/auth/utils";
import { isUniqueConstraintError } from "~/lib/utils/errors";
import { authOptions } from "~/server/auth";

/**
 * Phase 2 Plan 02-02 — Dataset row mutations (auto-save model).
 *
 * Each method scopes by the case's `projectId` (Phase 1 carry-forward
 * gap closure). Soft-delete only — never `dataSetRow.delete()`.
 *
 * Row mutations do NOT bump the test-case version (CONTEXT.md Decision 4:
 * dataset rows are not part of the schema invariant; only parameter
 * schema changes bump the version).
 */

const rowCreateBodySchema = z.object({
  label: z.string().nullable().optional(),
  rowIndex: z.number().int().optional(),
  valuesJson: z.record(z.string(), z.unknown()),
});

const rowPatchBodySchema = z.object({
  rowId: z.number().int(),
  label: z.string().nullable().optional(),
  rowIndex: z.number().int().optional(),
  valuesJson: z.record(z.string(), z.unknown()).optional(),
});

const rowDeleteBodySchema = z.object({
  rowIds: z.array(z.number().int()).min(1),
});

async function resolveCaseAndDataset(
  db: any,
  caseId: number
): Promise<{
  testCase: { id: number; projectId: number } | null;
  dataset: { id: number; projectId: number } | null;
}> {
  const testCase = await db.repositoryCases.findFirst({
    where: { id: caseId, isDeleted: false },
    select: { id: true, projectId: true },
  });
  if (!testCase) return { testCase: null, dataset: null };

  const dataset = await db.dataSet.findFirst({
    where: {
      ownerCaseId: caseId,
      projectId: testCase.projectId,
      isDeleted: false,
    },
    select: { id: true, projectId: true },
  });
  return { testCase, dataset };
}

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
    const data = rowCreateBodySchema.parse(body);

    const db = await getEnhancedDb(session);
    const { testCase, dataset } = await resolveCaseAndDataset(db, caseId);
    if (!testCase) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }
    if (!dataset) {
      return NextResponse.json(
        { error: "Dataset not attached to case" },
        { status: 404 }
      );
    }

    // Compute-then-insert with retry. Aggregate + create is not atomic,
    // so two concurrent POSTs (e.g. a rapid double-click on "Add row")
    // both observe the same `max.rowIndex` and race the unique
    // constraint `@@unique([dataSetId, rowIndex])`. When the constraint
    // fires (P2002), re-read max and try again with a fresh rowIndex.
    // A small bounded retry is enough — by the time we retry, the other
    // insert has committed and the new max reflects it. The caller can
    // still pass an explicit `rowIndex` to opt out of auto-assignment.
    let created: any = null;
    let lastErr: any = null;
    const RETRY_BUDGET = 5;
    for (let attempt = 0; attempt < RETRY_BUDGET; attempt++) {
      let rowIndex = data.rowIndex;
      if (rowIndex === undefined) {
        // findFirst sorted desc, not aggregate({_max}), so we include
        // soft-deleted rows — the unique constraint covers ALL rows
        // regardless of `isDeleted`, so reusing a soft-deleted index
        // would also race the constraint.
        const max = await db.dataSetRow.findFirst({
          where: { dataSetId: dataset.id },
          orderBy: { rowIndex: "desc" },
          select: { rowIndex: true },
        });
        rowIndex = (max?.rowIndex ?? -1) + 1 + attempt;
      }

      try {
        created = await db.dataSetRow.create({
          data: {
            dataSetId: dataset.id,
            label: data.label ?? null,
            rowIndex,
            valuesJson: data.valuesJson as never,
          },
        });
        lastErr = null;
        break;
      } catch (e: any) {
        // Caller-supplied rowIndex collisions are programmer errors —
        // surface them rather than silently retrying with a different
        // index than the caller asked for.
        if (data.rowIndex !== undefined) throw e;
        if (!isUniqueConstraintError(e)) throw e;
        lastErr = e;
        // fall through to retry with next attempt
      }
    }
    if (!created) {
      throw lastErr ?? new Error("Failed to insert dataset row");
    }
    return NextResponse.json({ row: created });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: err.issues },
        { status: 400 }
      );
    }
    console.error("[dataset rows POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
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
    const data = rowPatchBodySchema.parse(body);

    const db = await getEnhancedDb(session);
    const { testCase, dataset } = await resolveCaseAndDataset(db, caseId);
    if (!testCase || !dataset) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Confirm row belongs to this dataset (cross-project leak prevention).
    const existing = await db.dataSetRow.findFirst({
      where: {
        id: data.rowId,
        dataSetId: dataset.id,
        isDeleted: false,
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Row not found" }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (data.label !== undefined) updateData.label = data.label;
    if (data.rowIndex !== undefined) updateData.rowIndex = data.rowIndex;
    if (data.valuesJson !== undefined) {
      // Partial-merge so editing one cell does not erase the others.
      const current = (existing.valuesJson ?? {}) as Record<string, unknown>;
      updateData.valuesJson = { ...current, ...data.valuesJson };
    }

    const updated = await db.dataSetRow.update({
      where: { id: data.rowId },
      data: updateData,
    });
    return NextResponse.json({ row: updated });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: err.issues },
        { status: 400 }
      );
    }
    console.error("[dataset rows PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
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
    const data = rowDeleteBodySchema.parse(body);

    const db = await getEnhancedDb(session);
    const { testCase, dataset } = await resolveCaseAndDataset(db, caseId);
    if (!testCase || !dataset) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db.$transaction(async (tx: any) => {
      // Soft-delete only — feedback_soft_delete invariant.
      await tx.dataSetRow.updateMany({
        where: {
          id: { in: data.rowIds },
          dataSetId: dataset.id,
          isDeleted: false,
        },
        data: { isDeleted: true },
      });
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: err.issues },
        { status: 400 }
      );
    }
    console.error("[dataset rows DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
