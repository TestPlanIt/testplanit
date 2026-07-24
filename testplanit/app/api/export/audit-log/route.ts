/**
 * Bulk NDJSON export of AuditLog — the compliance / change-history feed.
 *
 * Admin-only across all projects; non-admins are gated to the audit rows for
 * a specific project they have access to (via the enhanced client).
 *
 * Sorted by (timestamp asc, id asc) with the standard `since` / `cursor` /
 * `pageSize` triplet. Each row carries the actor, the entity touched, the
 * action, the changes diff (when captured), and the metadata blob (IP, UA,
 * request id) recorded at the time of the event. Schema reference:
 * `model AuditLog` in schema.zmodel.
 */

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { getAuthDb } from "~/lib/zenstack";
import { authenticateRequest } from "~/lib/api-token-auth";
import { baseDb } from "~/lib/db";
import { authOptions } from "~/server/auth";
import { ndjsonResponse, type PageSource } from "~/lib/export/ndjson";
import {
  buildManifest,
  buildTrailer,
  cursorWhere,
  decodeCursor,
  encodeCursor,
  parsePageSize,
  parseSince,
} from "~/lib/export/queryParams";

interface AuditRow {
  id: string;
  timestamp: string;
  action: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  projectId: number | null;
  changes: unknown;
  metadata: unknown;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const auth = await authenticateRequest(request, session);
  if (!auth.authenticated) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status ?? 401 }
    );
  }

  const url = new URL(request.url);
  const since = parseSince(url.searchParams.get("since"));
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const pageSize = parsePageSize(url.searchParams.get("pageSize"));
  const projectIdRaw = url.searchParams.get("projectId");
  const projectId = projectIdRaw ? Number.parseInt(projectIdRaw, 10) : null;

  const isAdmin = auth.user.access === "ADMIN";

  if (!isAdmin && (projectId === null || Number.isNaN(projectId))) {
    return NextResponse.json(
      { error: "projectId is required for non-admin tokens" },
      { status: 400 }
    );
  }

  let reader = baseDb as unknown as typeof baseDb;
  if (!isAdmin) {
    const userRecord = await baseDb.user.findUnique({
      where: { id: auth.user.userId },
      include: { role: { include: { rolePermissions: true } } },
    });
    if (!userRecord) {
      return NextResponse.json({ error: "User not found" }, { status: 401 });
    }
    reader = (await getAuthDb(userRecord)) as unknown as typeof baseDb;

    const accessible = await reader.projects.findFirst({
      where: { id: projectId!, isDeleted: false },
      select: { id: true },
    });
    if (!accessible) {
      return NextResponse.json(
        { error: "No access to project" },
        { status: 403 }
      );
    }
  }

  const where: Record<string, unknown> = {};
  if (projectId !== null && !Number.isNaN(projectId)) {
    where.projectId = projectId;
  }
  if (since) {
    where.timestamp = { gte: since };
  }
  if (cursor) {
    Object.assign(where, cursorWhere("timestamp", cursor));
  }

  let exportedCount = 0;
  let lastRow: AuditRow | null = null;

  const pages: PageSource<AuditRow> = (async function* () {
    const rows = await reader.auditLog.findMany({
      where: where as never,
      orderBy: [{ timestamp: "asc" }, { id: "asc" }],
      take: pageSize,
      select: {
        id: true,
        timestamp: true,
        action: true,
        entityType: true,
        entityId: true,
        entityName: true,
        userId: true,
        userEmail: true,
        userName: true,
        projectId: true,
        changes: true,
        metadata: true,
      },
    });

    const page: AuditRow[] = rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp.toISOString(),
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      entityName: r.entityName,
      userId: r.userId,
      userEmail: r.userEmail,
      userName: r.userName,
      projectId: r.projectId,
      changes: r.changes,
      metadata: r.metadata,
    }));
    exportedCount = page.length;
    lastRow = page[page.length - 1] ?? null;
    yield page;
  })();

  const manifest = buildManifest({
    resource: "audit-log",
    since,
    pageSize,
    projectId,
  });

  const wrapped: PageSource<AuditRow | Record<string, unknown>> =
    (async function* () {
      for await (const page of pages) yield page;
      let nextCursor: string | null = null;
      if (exportedCount === pageSize && lastRow !== null) {
        const row: AuditRow = lastRow;
        nextCursor = encodeCursor({ k: row.timestamp, i: row.id });
      }
      yield [buildTrailer({ count: exportedCount, cursor: nextCursor })];
    })();

  return ndjsonResponse({ manifest, pages: wrapped });
}
