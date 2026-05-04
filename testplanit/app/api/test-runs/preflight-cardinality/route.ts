import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getEnhancedDb } from "~/lib/auth/utils";
import {
  computePreflight,
  readCardinalityThresholds,
  type PreflightCaseInput,
} from "~/lib/services/iterationCardinality";
import { authOptions } from "~/server/auth";

/**
 * POST /api/test-runs/preflight-cardinality
 *
 * Live cardinality preflight for the AddTestRunModal. Caller passes the
 * currently-selected case IDs and config IDs; server resolves dataset row
 * counts and returns the band classification.
 *
 * Used by the preflight chip in modal Step 1 (Task 7) — does NOT create
 * any TestRun rows. The actual fan-out lives in
 * POST /api/test-runs/[runId]/generate-iterations.
 *
 * Access enforcement: getEnhancedDb(session) means cases the caller cannot
 * read are silently dropped from the result (the caller can see the chip
 * count drop and infer they lack access). Cross-project case IDs are
 * filtered out by the explicit projectId WHERE clause.
 */

const requestSchema = z.object({
  caseIds: z.array(z.number().int().positive()).max(10000),
  configIds: z.array(z.number().int().positive()).max(1000).default([]),
  projectId: z.number().int().positive(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { caseIds, configIds, projectId } = parsed.data;
    const thresholds = readCardinalityThresholds();

    // Empty selection → zero iterations, no DB round trip needed.
    if (caseIds.length === 0) {
      return NextResponse.json(
        computePreflight([], configIds.length, thresholds)
      );
    }

    const db = await getEnhancedDb(session);

    // Resolve cases the caller can read AND that belong to the requested
    // project. The explicit projectId filter is the Phase 1 cross-project
    // carry-forward — DataSet @@deny does not block cross-project reads.
    const cases: Array<{
      id: number;
      name: string;
      hasParameters: boolean;
      ownedDataSets: Array<{
        _count: { rows: number };
      }>;
    }> = await db.repositoryCases.findMany({
      where: {
        id: { in: caseIds },
        projectId,
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        hasParameters: true,
        ownedDataSets: {
          where: { isDeleted: false },
          select: {
            _count: {
              select: { rows: { where: { isDeleted: false } } },
            },
          },
          take: 1,
        },
      },
    });

    const inputs: PreflightCaseInput[] = cases.map((c) => {
      const rowCount = c.ownedDataSets[0]?._count.rows ?? 0;
      return {
        caseId: c.id,
        caseTitle: c.name,
        // A case is "parameterized for fan-out purposes" only if it both
        // has the flag AND has at least one dataset row. A case flagged
        // hasParameters with a zero-row dataset still contributes 0
        // iterations — we report it in perCase so the UI can hint, but
        // hasParameters drives perCase inclusion (not row count > 0).
        hasParameters: c.hasParameters,
        rowCount,
      };
    });

    const result = computePreflight(inputs, configIds.length, thresholds);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[preflight-cardinality]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
