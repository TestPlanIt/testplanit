import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getEnhancedDb } from "~/lib/auth/utils";
import { getLatestTestResultsByCase } from "~/lib/services/latestTestResults";
import { LATEST_RESULTS_COUNT } from "~/lib/types/latestTestResults";
import { authOptions } from "~/server/auth";

/**
 * POST /api/repository-cases/latest-results
 *
 * The most recent executions for each of the given cases, keyed by case id.
 *
 * A route rather than a Server Action because several panels ask for this
 * concurrently on one page, and Next funnels every Server Action through a
 * single pending slot per client — one slow call would hold up the others.
 *
 * The ranking query spans TestRunResults and JUnitTestResult and so runs on
 * the raw client; the ids are narrowed through the policy layer first, so a
 * caller only ever learns about cases it may already read.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { caseIds, limit } = body as {
      caseIds?: unknown;
      limit?: unknown;
    };

    if (!Array.isArray(caseIds)) {
      return NextResponse.json({ error: "Invalid case IDs" }, { status: 400 });
    }

    const ids = caseIds.filter(
      (id): id is number => typeof id === "number" && Number.isInteger(id)
    );
    if (ids.length === 0) {
      return NextResponse.json({ results: {} });
    }

    const resolvedLimit =
      typeof limit === "number" && Number.isInteger(limit) && limit > 0
        ? Math.min(limit, LATEST_RESULTS_COUNT)
        : LATEST_RESULTS_COUNT;

    const db = await getEnhancedDb(session);
    const visible = await db.repositoryCases.findMany({
      where: { id: { in: ids }, isDeleted: false },
      select: { id: true },
    });

    const byCase = await getLatestTestResultsByCase(
      visible.map((c: { id: number }) => c.id),
      resolvedLimit
    );

    return NextResponse.json({ results: Object.fromEntries(byCase) });
  } catch (error) {
    console.error("Error fetching latest test results:", error);
    return NextResponse.json(
      { error: "Failed to fetch results" },
      { status: 500 }
    );
  }
}
