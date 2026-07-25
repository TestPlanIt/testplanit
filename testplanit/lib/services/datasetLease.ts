import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";

import {
  authenticateApiTokenForMethod,
  extractBearerToken,
} from "~/lib/api-token-auth";
import { getUserWithRole } from "~/lib/auth/utils";
import { baseDb } from "~/lib/db";
import { authOptions } from "~/server/auth";
import { getAuthDb } from "~/lib/zenstack";
import type { DbClient, TxClient } from "~/lib/zenstack";

/**
 * DataSetRow lease primitive (999.12) — server-side helpers.
 *
 * Shared by the three lease routes (acquire / release / extend) and the
 * sweep worker. The raw-SQL ops run against the base client because the
 * atomic "claim next free row" (`FOR UPDATE SKIP LOCKED`) and the
 * check-and-clear release cannot be expressed through the ORM. Callers
 * authorize BEFORE invoking these (dataset-readable == project member; the
 * fencing `leaseToken` or ADMIN for release/extend), then run the op inside
 * a `$transaction` so the webhook outbox row commits atomically with the
 * lease write.
 */

/** Default lease TTL when the caller doesn't specify one. */
export const DEFAULT_LEASE_TTL_SECONDS = 300;
/** Hard cap so a client can't pin a row indefinitely. */
export const MAX_LEASE_TTL_SECONDS = 3600;
/** Floor — a sub-second lease is almost certainly a client bug. */
export const MIN_LEASE_TTL_SECONDS = 1;

/**
 * Clamp a requested TTL into [MIN, MAX]; fall back to the default when
 * undefined/NaN. Non-integers are floored (the SQL uses whole seconds).
 */
export function clampTtlSeconds(requested: number | undefined): number {
  if (requested === undefined || Number.isNaN(requested)) {
    return DEFAULT_LEASE_TTL_SECONDS;
  }
  const floored = Math.floor(requested);
  if (floored < MIN_LEASE_TTL_SECONDS) return MIN_LEASE_TTL_SECONDS;
  if (floored > MAX_LEASE_TTL_SECONDS) return MAX_LEASE_TTL_SECONDS;
  return floored;
}

/** Mint a fresh opaque fencing token for one acquisition. */
export function mintLeaseToken(): string {
  return `lease_${randomUUID()}`;
}

export interface LeaseApiUser {
  userId: string;
  access: string | null | undefined;
  userName?: string;
  userEmail?: string;
  scopes?: string[];
}

/**
 * Resolve the caller from a browser session first, then a Bearer API token
 * (the CI/orchestration path). Mirrors the idiom in
 * app/api/projects/[projectId]/cases/bulk-create/route.ts. Returns the
 * user, or a `{ error, status }` the route surfaces verbatim. Write-method
 * read-only tokens are rejected with 403 by `authenticateApiTokenForMethod`.
 */
export async function resolveLeaseApiUser(
  request: NextRequest
): Promise<
  | { ok: true; user: LeaseApiUser }
  | { ok: false; error: string; code?: string; status: number }
> {
  const session = await getServerSession(authOptions);
  if (session?.user?.id) {
    return {
      ok: true,
      user: {
        userId: session.user.id,
        access: session.user.access,
        userName: session.user.name ?? undefined,
        userEmail: session.user.email ?? undefined,
      },
    };
  }

  const token = extractBearerToken(request);
  if (!token) {
    return { ok: false, error: "Unauthorized", status: 401 };
  }
  const apiAuth = await authenticateApiTokenForMethod(request);
  if (!apiAuth.authenticated) {
    const status = apiAuth.errorCode === "READ_ONLY_TOKEN" ? 403 : 401;
    return {
      ok: false,
      error: apiAuth.error ?? "Unauthorized",
      code: apiAuth.errorCode,
      status,
    };
  }

  const dbUser = await baseDb.user.findUnique({
    where: { id: apiAuth.userId! },
    select: { name: true, email: true },
  });
  return {
    ok: true,
    user: {
      userId: apiAuth.userId!,
      access: apiAuth.access,
      userName: dbUser?.name ?? undefined,
      userEmail: dbUser?.email ?? undefined,
      scopes: apiAuth.scopes,
    },
  };
}

/**
 * Membership gate: resolve the target dataset through the caller's enhanced
 * (policy-enforced) client. A visible row means the user can read the
 * dataset — i.e. is a project member. Returns `{ projectId }` or null when
 * the dataset is missing/deleted/not-readable (all surfaced as 404).
 */
export async function loadReadableDataset(
  userId: string,
  dataSetId: number
): Promise<{ id: number; projectId: number } | null> {
  const user = await getUserWithRole(userId);
  if (!user) return null;
  const db = await getAuthDb(user);
  const dataset = await db.dataSet.findFirst({
    where: { id: dataSetId, isDeleted: false },
    select: { id: true, projectId: true },
  });
  return dataset ?? null;
}

/** A DataSetRow with its lease columns, as returned by the raw ops. */
export interface LeasedRow {
  id: number;
  rowIndex: number;
  label: string | null;
  valuesJson: unknown;
  leasedById: string | null;
  leasedAt: Date | null;
  leaseExpiresAt: Date | null;
  leaseToken: string | null;
}

/**
 * Atomically claim the lowest-`rowIndex` free row in a dataset (pool).
 * A row is free when it has never been leased (`leaseToken IS NULL`) or its
 * TTL has lapsed (`leaseExpiresAt < now()`) — lazy expiry means a down sweep
 * never blocks acquisition. `FOR UPDATE SKIP LOCKED` lets concurrent
 * acquirers claim DISTINCT rows without blocking each other. Returns the
 * claimed row, or null when the pool is exhausted.
 */
export async function acquireNextRow(
  client: DbClient | TxClient,
  params: {
    dataSetId: number;
    userId: string;
    ttlSeconds: number;
    leaseToken: string;
  }
): Promise<LeasedRow | null> {
  const rows = await client.$queryRaw<LeasedRow[]>`
    UPDATE "DataSetRow" AS r SET
      "leasedById" = ${params.userId},
      "leasedAt" = now(),
      "leaseExpiresAt" = now() + make_interval(secs => ${params.ttlSeconds}),
      "leaseToken" = ${params.leaseToken}
    WHERE r."id" = (
      SELECT "id" FROM "DataSetRow"
       WHERE "dataSetId" = ${params.dataSetId}
         AND "isDeleted" = false
         AND ("leaseToken" IS NULL OR "leaseExpiresAt" < now())
       ORDER BY "rowIndex" ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
    )
    RETURNING r."id", r."rowIndex", r."label", r."valuesJson",
              r."leasedById", r."leasedAt", r."leaseExpiresAt", r."leaseToken"
  `;
  return rows[0] ?? null;
}

export type ReleaseOutcome =
  | { status: "released"; row: LeaseSummary }
  | { status: "not_leased" }
  | { status: "conflict" }
  | { status: "not_found" };

export type ExtendOutcome =
  | { status: "extended"; row: LeaseSummary }
  | { status: "expired" }
  | { status: "conflict" }
  | { status: "not_leased" }
  | { status: "not_found" };

/** Identifier + pre/post lease info returned by release/extend. */
export interface LeaseSummary {
  id: number;
  rowIndex: number;
  label: string | null;
  leasedById: string | null;
  leaseExpiresAt: Date | null;
}

interface ReleaseRawRow {
  id: number;
  rowIndex: number;
  label: string | null;
  leasedById: string | null;
  leaseExpiresAt: Date | null;
  leaseToken: string | null;
  updated: boolean;
}

/**
 * Release a lease. Clears the four lease columns iff the caller presents the
 * matching `leaseToken` (fencing) or is ADMIN. Single atomic statement: a
 * `FOR UPDATE`-locked CTE captures the PRE-clear holder/deadline (so the
 * `released` event can name who held it) and a data-modifying CTE performs
 * the conditional clear. `updated=false` is classified from the pre-state:
 * unleased row → idempotent `not_leased`; else token mismatch → `conflict`.
 */
export async function releaseRow(
  client: DbClient | TxClient,
  params: {
    dataSetId: number;
    rowId: number;
    leaseToken: string | null;
    isAdmin: boolean;
  }
): Promise<ReleaseOutcome> {
  const rows = await client.$queryRaw<ReleaseRawRow[]>`
    WITH target AS (
      SELECT "id", "rowIndex", "label", "leasedById", "leaseExpiresAt", "leaseToken"
        FROM "DataSetRow"
       WHERE "id" = ${params.rowId}
         AND "dataSetId" = ${params.dataSetId}
         AND "isDeleted" = false
       FOR UPDATE
    ), upd AS (
      UPDATE "DataSetRow" SET
        "leasedById" = NULL, "leasedAt" = NULL,
        "leaseExpiresAt" = NULL, "leaseToken" = NULL
      WHERE "id" = (SELECT "id" FROM target)
        AND (SELECT "leaseToken" FROM target) IS NOT NULL
        AND (${params.isAdmin} OR (SELECT "leaseToken" FROM target) = ${params.leaseToken})
      RETURNING "id"
    )
    SELECT t."id", t."rowIndex", t."label", t."leasedById",
           t."leaseExpiresAt", t."leaseToken",
           (SELECT count(*) FROM upd) > 0 AS "updated"
      FROM target t
  `;
  if (rows.length === 0) return { status: "not_found" };
  const r = rows[0];
  if (r.updated) {
    return {
      status: "released",
      row: {
        id: r.id,
        rowIndex: r.rowIndex,
        label: r.label,
        leasedById: r.leasedById,
        leaseExpiresAt: r.leaseExpiresAt,
      },
    };
  }
  if (r.leaseToken === null) return { status: "not_leased" };
  return { status: "conflict" };
}

interface ExtendRawRow {
  id: number;
  rowIndex: number;
  label: string | null;
  leasedById: string | null;
  leaseToken: string | null;
  oldExpires: Date | null;
  newExpires: Date | null;
  /** The database's `now()` at query time — compared against oldExpires to
   *  classify expiry with the SAME clock the update guard used (no app/DB skew). */
  dbNow: Date;
  updated: boolean;
}

/**
 * Extend a live lease's TTL. Fails closed on an already-expired lease
 * (`expired` → the holder must re-acquire, not silently revive a dead
 * lease — fencing semantics). Requires the matching `leaseToken` or ADMIN.
 */
export async function extendLease(
  client: DbClient | TxClient,
  params: {
    dataSetId: number;
    rowId: number;
    leaseToken: string | null;
    ttlSeconds: number;
    isAdmin: boolean;
  }
): Promise<ExtendOutcome> {
  const rows = await client.$queryRaw<ExtendRawRow[]>`
    WITH target AS (
      SELECT "id", "rowIndex", "label", "leasedById", "leaseExpiresAt", "leaseToken"
        FROM "DataSetRow"
       WHERE "id" = ${params.rowId}
         AND "dataSetId" = ${params.dataSetId}
         AND "isDeleted" = false
       FOR UPDATE
    ), upd AS (
      UPDATE "DataSetRow" SET
        "leaseExpiresAt" = now() + make_interval(secs => ${params.ttlSeconds})
      WHERE "id" = (SELECT "id" FROM target)
        AND (SELECT "leaseToken" FROM target) IS NOT NULL
        AND (SELECT "leaseExpiresAt" FROM target) > now()
        AND (${params.isAdmin} OR (SELECT "leaseToken" FROM target) = ${params.leaseToken})
      RETURNING "id", "leaseExpiresAt"
    )
    SELECT t."id", t."rowIndex", t."label", t."leasedById", t."leaseToken",
           t."leaseExpiresAt" AS "oldExpires",
           (SELECT "leaseExpiresAt" FROM upd) AS "newExpires",
           now() AS "dbNow",
           (SELECT count(*) FROM upd) > 0 AS "updated"
      FROM target t
  `;
  if (rows.length === 0) return { status: "not_found" };
  const r = rows[0];
  if (r.updated) {
    return {
      status: "extended",
      row: {
        id: r.id,
        rowIndex: r.rowIndex,
        label: r.label,
        leasedById: r.leasedById,
        leaseExpiresAt: r.newExpires,
      },
    };
  }
  if (r.leaseToken === null) return { status: "not_leased" };
  // Expired dominates a token mismatch: a lapsed lease is dead regardless of
  // who asks — the holder must re-acquire. Compare against the DB clock the
  // update guard used so there is no app/DB skew at the millisecond boundary.
  if (r.oldExpires !== null && r.oldExpires.getTime() <= r.dbNow.getTime()) {
    return { status: "expired" };
  }
  return { status: "conflict" };
}
