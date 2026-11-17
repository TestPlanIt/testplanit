import { sql } from "kysely";
import { getServerSession } from "next-auth";
import { type NextRequest, NextResponse } from "next/server";
import { getEnhancedDb } from "~/lib/auth/utils";
import { baseDb } from "~/lib/db";
import { authOptions } from "~/server/auth";

const CASE_LIMIT = 50;

export interface SignatureCaseRow {
  caseId: number;
  occurrences: number;
  runCount: number;
  lastSeenAt: string | null;
}

/**
 * GET /api/projects/[projectId]/triage/signatures/[signatureId]/cases
 * The signature's affected cases with how many results and distinct runs
 * each one failed in. Readable by anyone who can read the signature.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; signatureId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const resolved = await params;
  const projectId = Number(resolved.projectId);
  const signatureId = Number(resolved.signatureId);
  if (!Number.isInteger(projectId) || !Number.isInteger(signatureId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    const db = await getEnhancedDb(session);
    const signature = await db.failureSignature.findFirst({
      where: { id: signatureId, projectId },
      select: { id: true },
    });
    if (!signature) {
      return NextResponse.json(
        { error: "Signature not found" },
        { status: 404 }
      );
    }
    const rows = await sql<{
      case_id: number;
      occurrences: number;
      run_count: number;
      last_seen_at: Date | null;
    }>`
      SELECT r."repositoryCaseId" AS case_id,
             COUNT(*)::int AS occurrences,
             COUNT(DISTINCT ts."testRunId")::int AS run_count,
             MAX(COALESCE(r."executedAt", r."createdAt")) AS last_seen_at
      FROM "JUnitTestResult" r
      JOIN "JUnitTestSuite" ts ON ts.id = r."testSuiteId"
      WHERE r."failureSignatureId" = ${signatureId}
      GROUP BY r."repositoryCaseId"
      ORDER BY occurrences DESC, case_id ASC
      LIMIT ${CASE_LIMIT}
    `.execute(baseDb.$qb);
    const cases: SignatureCaseRow[] = rows.rows.map((row) => ({
      caseId: row.case_id,
      occurrences: row.occurrences,
      runCount: row.run_count,
      lastSeenAt: row.last_seen_at
        ? new Date(row.last_seen_at).toISOString()
        : null,
    }));
    return NextResponse.json({ cases });
  } catch (error) {
    console.error("[failure-triage] affected cases failed:", error);
    return NextResponse.json(
      { error: "Failed to load affected cases" },
      { status: 500 }
    );
  }
}
