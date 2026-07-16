import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod/v4";

import {
  enrichFromApiAuth,
  withAuditContext,
} from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import {
  clampTtlSeconds,
  extendLease,
  loadReadableDataset,
  resolveLeaseApiUser,
} from "~/lib/services/datasetLease";

/**
 * POST /api/datasets/{dataSetId}/rows/{rowId}/extend — 999.12.
 *
 * Renews a live lease's TTL. Fencing: requires the matching `leaseToken` (or
 * ADMIN). Fails closed on an already-expired lease — a dead lease must be
 * re-acquired, not silently revived (so a paused holder can't stomp a row
 * another job has since claimed). No webhook (extend is not a lifecycle
 * transition subscribers coordinate on).
 *
 * Responses:
 *   200 { extended: true, leaseExpiresAt }
 *   409 { error: "lease_expired" }    — TTL already lapsed; re-acquire
 *   409 { error: "lease_conflict" }   — token mismatch (non-admin)
 *   409 { error: "not_leased" }       — row is not currently leased
 *   404 — dataset or row not found
 */

const extendBodySchema = z.object({
  leaseToken: z.string().min(1).optional(),
  ttlSeconds: z.number().int().positive().optional(),
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
      let ttlSeconds: number | undefined;
      try {
        const raw = await request.json();
        const parsed = extendBodySchema.parse(raw ?? {});
        leaseToken = parsed.leaseToken ?? null;
        ttlSeconds = parsed.ttlSeconds;
      } catch (err) {
        if (err instanceof ZodError) {
          return NextResponse.json(
            { error: "Invalid body", details: err.issues },
            { status: 400 }
          );
        }
        leaseToken = null;
      }
      const ttl = clampTtlSeconds(ttlSeconds);

      const dataset = await loadReadableDataset(auth.user.userId, dataSetId);
      if (!dataset) {
        return NextResponse.json(
          { error: "Dataset not found" },
          { status: 404 }
        );
      }

      const isAdmin = auth.user.access === "ADMIN";
      const outcome = await extendLease(baseDb, {
        dataSetId,
        rowId,
        leaseToken,
        ttlSeconds: ttl,
        isAdmin,
      });

      switch (outcome.status) {
        case "extended":
          return NextResponse.json({
            extended: true,
            leaseExpiresAt: outcome.row.leaseExpiresAt?.toISOString() ?? null,
          });
        case "expired":
          return NextResponse.json({ error: "lease_expired" }, { status: 409 });
        case "conflict":
          return NextResponse.json(
            { error: "lease_conflict" },
            { status: 409 }
          );
        case "not_leased":
          return NextResponse.json({ error: "not_leased" }, { status: 409 });
        case "not_found":
          return NextResponse.json({ error: "Row not found" }, { status: 404 });
      }
    } catch (err) {
      console.error("[dataset row extend]", err);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  }
);
