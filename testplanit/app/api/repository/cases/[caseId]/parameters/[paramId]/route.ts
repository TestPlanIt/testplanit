import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod/v4";

import { getEnhancedDb } from "~/lib/auth/utils";
import { parameterUpdateSchema } from "~/lib/schemas/parameterSchema";
import {
  softDeleteParameterInTransaction,
  updateParameterInTransaction,
} from "~/lib/services/parameterMutations";
import { authOptions } from "~/server/auth";

/**
 * Phase 2 Plan 02-02 — PATCH /api/repository/cases/[caseId]/parameters/[paramId]
 *
 * Updates a TestCaseParameter (partial). When the `name` field changes,
 * `updateParameterInTransaction` invokes `rewriteParameterReferences` to
 * atomically rewrite every Tiptap step JSON reference and DataSet row key
 * inside the same `$transaction` (PARAM-05 atomic rename).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ caseId: string; paramId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { caseId: caseIdParam, paramId: paramIdParam } = await params;
    const caseId = parseInt(caseIdParam, 10);
    const paramId = parseInt(paramIdParam, 10);
    if (isNaN(caseId) || isNaN(paramId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = await request.json();
    const data = parameterUpdateSchema.parse(body);

    const db = await getEnhancedDb(session);

    const result = await db.$transaction(async (tx: unknown) => {
      return updateParameterInTransaction(tx, caseId, paramId, data, {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
      });
    });

    return NextResponse.json({ success: true, parameter: result });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: err.issues },
        { status: 400 }
      );
    }
    console.error("[parameters PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * Phase 2 Plan 02-02 — DELETE /api/repository/cases/[caseId]/parameters/[paramId]
 *
 * Soft-deletes the parameter. Per `feedback_soft_delete`, NEVER hard delete.
 * The helper bumps version + updates hasParameters (which recomputes false
 * if this was the last non-deleted param).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ caseId: string; paramId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { caseId: caseIdParam, paramId: paramIdParam } = await params;
    const caseId = parseInt(caseIdParam, 10);
    const paramId = parseInt(paramIdParam, 10);
    if (isNaN(caseId) || isNaN(paramId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const db = await getEnhancedDb(session);

    await db.$transaction(async (tx: unknown) => {
      await softDeleteParameterInTransaction(tx, caseId, paramId, {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
      });
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[parameters DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
