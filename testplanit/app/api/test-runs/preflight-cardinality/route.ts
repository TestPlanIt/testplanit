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
    //
    // We also include the case's shared-dataset assignment (if any) so we
    // can derive the row count from a pinned or follow-latest version.
    // CaseSharedDataSetAssignment has no isDeleted field of its own (it
    // cascades from RepositoryCases.isDeleted), so the inner select carries
    // no `where` filter.
    const cases: Array<{
      id: number;
      name: string;
      hasParameters: boolean;
      ownedDataSets: Array<{ _count: { rows: number } }>;
      sharedDataSetAssignment: {
        sharedDataSetId: number;
        pinnedVersionId: number | null;
        pinnedVersion: { rowCount: number } | null;
        sharedDataSet: { id: number; version: number; isDeleted: boolean };
      } | null;
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
        sharedDataSetAssignment: {
          select: {
            sharedDataSetId: true,
            pinnedVersionId: true,
            pinnedVersion: { select: { rowCount: true } },
            sharedDataSet: {
              select: { id: true, version: true, isDeleted: true },
            },
          },
        },
      },
    });

    const inputs: PreflightCaseInput[] = await Promise.all(
      cases.map(async (c) => {
        const ownerRowCount = c.ownedDataSets[0]?._count.rows ?? 0;
        let assignedRowCount = 0;

        // Owner-wins: when an owner dataset is present we ignore the
        // shared assignment's row count (owner is the iteration source).
        if (ownerRowCount === 0) {
          const a = c.sharedDataSetAssignment;
          if (a && !a.sharedDataSet?.isDeleted) {
            if (a.pinnedVersionId && a.pinnedVersion) {
              assignedRowCount = a.pinnedVersion.rowCount;
            } else if (a.sharedDataSetId) {
              // Follow-latest: resolve the current version's rowCount.
              // One extra query per case-with-shared-assignment-and-no-owner.
              // Acceptable for preflight (per-case cardinality is intrinsically
              // O(N cases) anyway). Batch via IN clause if profiling flags it.
              const latest = await db.dataSetVersion.findFirst({
                where: { dataSetId: a.sharedDataSetId },
                orderBy: { version: "desc" },
                select: { rowCount: true },
              });
              assignedRowCount = latest?.rowCount ?? 0;
            }
          }
        }

        return {
          caseId: c.id,
          caseTitle: c.name,
          // A case is "parameterized for fan-out purposes" only if it
          // has the flag. Row count drives `iterations`; hasParameters
          // drives perCase inclusion (so a parameterized case with zero
          // rows still surfaces as a UI hint).
          hasParameters: c.hasParameters,
          rowCount: ownerRowCount,
          assignedRowCount,
        };
      }),
    );

    const result = computePreflight(inputs, configIds.length, thresholds);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[preflight-cardinality]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
