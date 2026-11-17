/**
 * GET /api/admin/audit-logs/archives?from=<ISO>&to=<ISO>&skip=<n>&take=<n>
 *
 * Lists the cold-storage archive objects holding audit log entries moved out
 * of the database by the archive worker, oldest first. `from`/`to` keep only
 * archives whose entries overlap that range. Admin session or admin API token.
 */

import { NextRequest, NextResponse } from "next/server";

import { getCurrentTenantId, getTenantConfig } from "~/lib/multiTenantDb";
import { resolveAuditLogRetention } from "~/lib/services/auditLogRetention";
import { db } from "~/server/db";

import { requireArchiveAdmin } from "./auth";

const DEFAULT_TAKE = 100;
const MAX_TAKE = 1000;

function intParam(raw: string | null, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function dateParam(raw: string | null): Date | null | "invalid" {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "invalid" : date;
}

function currentTenantConfig() {
  const tenantId = getCurrentTenantId();
  return tenantId ? getTenantConfig(tenantId) : undefined;
}

export async function GET(request: NextRequest) {
  const auth = await requireArchiveAdmin(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const from = dateParam(searchParams.get("from"));
  const to = dateParam(searchParams.get("to"));
  if (from === "invalid" || to === "invalid") {
    return NextResponse.json(
      { error: "from and to must be ISO 8601 dates" },
      { status: 400 }
    );
  }
  const skip = intParam(searchParams.get("skip"), 0);
  const take = Math.min(
    Math.max(intParam(searchParams.get("take"), DEFAULT_TAKE), 1),
    MAX_TAKE
  );

  const where = {
    ...(from ? { lastTimestamp: { gte: from } } : {}),
    ...(to ? { firstTimestamp: { lte: to } } : {}),
  };

  try {
    const [archives, total] = await Promise.all([
      db.auditLogArchive.findMany({
        where,
        orderBy: [{ firstTimestamp: "asc" }, { id: "asc" }],
        skip,
        take,
        select: {
          id: true,
          periodStart: true,
          firstTimestamp: true,
          lastTimestamp: true,
          rowCount: true,
          byteSize: true,
          sha256: true,
          createdAt: true,
        },
      }),
      db.auditLogArchive.count({ where }),
    ]);

    return NextResponse.json({
      retention: resolveAuditLogRetention(currentTenantConfig()),
      total,
      skip,
      take,
      archives,
    });
  } catch (error) {
    console.error("Error listing audit log archives:", error);
    return NextResponse.json(
      { error: "Failed to list audit log archives" },
      { status: 500 }
    );
  }
}
