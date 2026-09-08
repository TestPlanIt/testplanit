import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod/v4";

import {
  enrichFromApiAuth,
  withAuditContext,
} from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import {
  loadReadableDataset,
  releaseRow,
  resolveLeaseApiUser,
} from "~/lib/services/datasetLease";
import { emitDatasetRowReleased } from "~/lib/webhooks/event-emitters/datasetLeaseEvents";

/**
 * POST /api/datasets/{dataSetId}/rows/{rowId}/release — 999.12.
 *
 * Hands a leased row back to the pool. Fencing: succeeds only if the caller
 * presents the matching `leaseToken` (so distinct parallel jobs sharing one
 * API token release only their OWN rows) or is ADMIN. Emits
 * `dataset.row.released` (reason=released) atomically with the clear.
 *
 * Responses:
 *   200 { released: true, rowId }
 *   200 { released: false, reason: "not_leased" }  — idempotent (already free)
 *   409 { error: "lease_conflict" }                — token mismatch (non-admin)
 *   404 — dataset or row not found
 */

const releaseBodySchema = z.object({
  leaseToken: z.string().min(1).optional(),
});

export const POST = withAuditContext(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ dataSetId: string; rowId: string }> }
  ) => {
    try {
      const { dataSetId: dataSetIdParam, rowId: rowIdParam } = await params;
      const dataSetId = parseInt(dataSetIdParam, 10);
      const rowId = parseInt(rowIdParam, 10);
      if (isNaN(dataSetId) || isNaN(rowId)) {
        return NextResponse.json(
          { error: "Invalid path parameter" },
          { status: 400 }
        );
      }

      const auth = await resolveLeaseApiUser(request);
      if (!auth.ok) {
        return NextResponse.json(
          { error: auth.error, code: auth.code },
          { status: auth.status }
        );
      }
      enrichFromApiAuth({
        userId: auth.user.userId,
        userEmail: auth.user.userEmail,
        userName: auth.user.userName,
        scopes: auth.user.scopes,
      });

      let leaseToken: string | null = null;
      try {
        const raw = await request.json();
        leaseToken = releaseBodySchema.parse(raw ?? {}).leaseToken ?? null;
      } catch (err) {
        if (err instanceof ZodError) {
          return NextResponse.json(
            { error: "Invalid body", details: err.issues },
            { status: 400 }
          );
        }
        leaseToken = null;
      }

      const dataset = await loadReadableDataset(auth.user.userId, dataSetId);
      if (!dataset) {
        return NextResponse.json(
          { error: "Dataset not found" },
          { status: 404 }
        );
      }

      const isAdmin = auth.user.access === "ADMIN";
      const outcome = await baseDb.$transaction(async (tx) => {
        const result = await releaseRow(tx, {
          dataSetId,
          rowId,
          leaseToken,
          isAdmin,
        });
        if (result.status === "released") {
          await emitDatasetRowReleased(
            {
              dataSetId,
              rowId: result.row.id,
              rowIndex: result.row.rowIndex,
              label: result.row.label,
              projectId: dataset.projectId,
              leasedById: result.row.leasedById,
              leaseExpiresAt: result.row.leaseExpiresAt?.toISOString() ?? null,
            },
            "released",
            tx,
            { actorUserId: auth.user.userId }
          );
        }
        return result;
      });

      switch (outcome.status) {
        case "released":
          return NextResponse.json({ released: true, rowId });
        case "not_leased":
          return NextResponse.json({ released: false, reason: "not_leased" });
        case "conflict":
          return NextResponse.json(
            { error: "lease_conflict" },
            { status: 409 }
          );
        case "not_found":
          return NextResponse.json({ error: "Row not found" }, { status: 404 });
      }
    } catch (err) {
      console.error("[dataset row release]", err);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  }
);
