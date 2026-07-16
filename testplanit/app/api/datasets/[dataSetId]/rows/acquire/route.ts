import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod/v4";

import {
  enrichFromApiAuth,
  withAuditContext,
} from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import {
  acquireNextRow,
  clampTtlSeconds,
  loadReadableDataset,
  mintLeaseToken,
  resolveLeaseApiUser,
} from "~/lib/services/datasetLease";
import { emitDatasetRowAcquired } from "~/lib/webhooks/event-emitters/datasetLeaseEvents";

/**
 * POST /api/datasets/{dataSetId}/rows/acquire — 999.12 lease primitive.
 *
 * Atomically checks out the lowest-`rowIndex` unlocked row in the dataset
 * (pool) so parallel CI jobs never provision the same external fixture. The
 * caller authenticates with a browser session OR a Bearer API token (the
 * orchestration path). Authorization = the dataset is readable through the
 * caller's policy client (== project member). The claim itself runs as raw
 * SQL on the base client (`FOR UPDATE SKIP LOCKED`) inside a transaction so
 * the `dataset.row.acquired` outbox row commits atomically with it.
 *
 * Responses:
 *   200 { acquired: true, row: {...incl valuesJson}, leaseToken, leaseExpiresAt }
 *   200 { acquired: false, row: null }   — pool exhausted (CI polls/backs off)
 *   404 — dataset missing/deleted/not a member
 */

const acquireBodySchema = z.object({
  ttlSeconds: z.number().int().positive().optional(),
});

export const POST = withAuditContext(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ dataSetId: string }> }
  ) => {
    try {
      const { dataSetId: dataSetIdParam } = await params;
      const dataSetId = parseInt(dataSetIdParam, 10);
      if (isNaN(dataSetId)) {
        return NextResponse.json(
          { error: "Invalid dataset id" },
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

      // Body is optional; tolerate an empty/absent body.
      let ttlSeconds: number | undefined;
      try {
        const raw = await request.json();
        ttlSeconds = acquireBodySchema.parse(raw ?? {}).ttlSeconds;
      } catch (err) {
        if (err instanceof ZodError) {
          return NextResponse.json(
            { error: "Invalid body", details: err.issues },
            { status: 400 }
          );
        }
        // No/blank JSON body → default TTL.
        ttlSeconds = undefined;
      }
      const ttl = clampTtlSeconds(ttlSeconds);

      const dataset = await loadReadableDataset(auth.user.userId, dataSetId);
      if (!dataset) {
        return NextResponse.json(
          { error: "Dataset not found" },
          { status: 404 }
        );
      }

      const leaseToken = mintLeaseToken();
      const claimed = await baseDb.$transaction(async (tx) => {
        const row = await acquireNextRow(tx, {
          dataSetId,
          userId: auth.user.userId,
          ttlSeconds: ttl,
          leaseToken,
        });
        if (row) {
          await emitDatasetRowAcquired(
            {
              dataSetId,
              rowId: row.id,
              rowIndex: row.rowIndex,
              label: row.label,
              projectId: dataset.projectId,
              leasedById: row.leasedById,
              leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
            },
            tx,
            { actorUserId: auth.user.userId }
          );
        }
        return row;
      });

      if (!claimed) {
        return NextResponse.json({ acquired: false, row: null });
      }

      return NextResponse.json({
        acquired: true,
        row: {
          id: claimed.id,
          rowIndex: claimed.rowIndex,
          label: claimed.label,
          valuesJson: claimed.valuesJson,
        },
        leaseToken,
        leaseExpiresAt: claimed.leaseExpiresAt?.toISOString() ?? null,
      });
    } catch (err) {
      console.error("[dataset row acquire]", err);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  }
);
