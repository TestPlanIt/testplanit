import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod/v4";

import { getEnhancedDb } from "~/lib/auth/utils";
import { parameterCreateSchema } from "~/lib/schemas/parameterSchema";
import { createParameterInTransaction } from "~/lib/services/parameterMutations";
import { authOptions } from "~/server/auth";

/**
 * Phase 2 Plan 02-02 — POST /api/repository/cases/[caseId]/parameters
 *
 * Creates a TestCaseParameter for the case. Wraps the write inside a
 * `$transaction` and delegates to `createParameterInTransaction`, which:
 *   1. tx.testCaseParameter.create
 *   2. updateHasParameters(caseId, tx)             // Phase 1 carry-forward
 *   3. tx.repositoryCases.update({ currentVersion: { increment: 1 } })
 *   4. createTestCaseVersionInTransaction(tx, caseId, ...)  // PARAM-06
 *
 * Validation: parameterCreateSchema enforces SELECT XOR (allowedValuesJson
 * XOR lookupDataSetId) at the boundary; the schema's @@validate clause
 * provides server-side belt-and-suspenders.
 */
export async function POST(
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

    const body = await request.json();
    const data = parameterCreateSchema.parse({ ...body, testCaseId: caseId });

    const db = await getEnhancedDb(session);

    const result = await db.$transaction(async (tx: unknown) => {
      return createParameterInTransaction(tx, caseId, data, {
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
        { status: 400 },
      );
    }
    console.error("[parameters POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
