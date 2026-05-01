import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { getEnhancedDb } from "~/lib/auth/utils";
import { scanParameterReferences } from "~/lib/services/parameterReferences";
import { authOptions } from "~/server/auth";

/**
 * Phase 2 Plan 02-02 — GET /api/repository/cases/[caseId]/parameters/[paramId]/scan-references
 *
 * Returns the count of step JSON references and DataSet row keys that
 * reference this parameter's name. Powers the destructive-action AlertDialog
 * (PARAM-05) — the user sees "this parameter is used in N steps and M
 * dataset rows" before confirming a rename or delete.
 *
 * Read-only: invoked through the enhanced ZenStack client so policy
 * enforcement applies. The scan helper accepts the enhanced client as `tx`
 * (the ZenStack v2 enhanced client supports the same query API as a
 * transaction client for read operations).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ caseId: string; paramId: string }> },
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

    const param = await db.testCaseParameter.findFirst({
      where: { id: paramId, testCaseId: caseId, isDeleted: false },
      select: { name: true },
    });
    if (!param) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const refs = await scanParameterReferences(db, caseId, param.name);
    return NextResponse.json(refs);
  } catch (err) {
    console.error("[parameters scan-references GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
