/**
 * Bulk NDJSON export of RepositoryCases — the test-case dimension table.
 *
 * Companion to /api/export/test-run-results: pull this dimension nightly to
 * rebuild the case lookup table used to denormalize execution facts.
 *
 * Note on incremental capture: RepositoryCases has `createdAt` but no
 * `updatedAt` (edits are tracked as new rows in RepositoryCaseVersions).
 * `since` here therefore filters by case CREATION time. Consumers who need
 * an edit feed should either subscribe to the relevant outbound webhooks,
 * or run a full refresh (omit `since`) on the cadence appropriate for
 * dimension churn. `currentVersion` is included in each row so ETL
 * pipelines can detect updates by tracking version increments between runs.
 *
 * Access model and query params match /api/export/test-run-results.
 */

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { getAuthDb } from "~/lib/zenstack";
import { authenticateRequest } from "~/lib/api-token-auth";
import { baseDb } from "~/lib/db";
import { authOptions } from "~/server/auth";
import { readRecordKeyConfig } from "~/lib/services/recordKeyConfig";
import { formatRecordKey, RECORD_TYPES } from "~/lib/recordKey";
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

interface CaseRow {
  id: number;
  projectId: number;
  folderId: number;
  templateId: number;
  stateId: number;
  name: string;
  className: string | null;
  source: string;
  automated: boolean;
  hasParameters: boolean;
  isArchived: boolean;
  estimate: number | null;
  forecastManual: number | null;
  forecastAutomated: number | null;
  currentVersion: number;
  createdAt: string;
  creatorId: string;
  displayKey: string | null;
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

  const where: Record<string, unknown> = { isDeleted: false };
  if (projectId !== null && !Number.isNaN(projectId)) {
    where.projectId = projectId;
  }
  if (since) {
    where.createdAt = { gte: since };
  }
  if (cursor) {
    Object.assign(where, cursorWhere("createdAt", cursor));
  }

  const { enabled: recordKeyEnabled, tokens: recordKeyTokens } =
    await readRecordKeyConfig(reader);

  let exportedCount = 0;
  let lastRow: CaseRow | null = null;

  const pages: PageSource<CaseRow> = (async function* () {
    const rows = await reader.repositoryCases.findMany({
      where: where as never,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: pageSize,
      select: {
        id: true,
        projectId: true,
        folderId: true,
        templateId: true,
        stateId: true,
        name: true,
        className: true,
        source: true,
        automated: true,
        hasParameters: true,
        isArchived: true,
        estimate: true,
        forecastManual: true,
        forecastAutomated: true,
        currentVersion: true,
        createdAt: true,
        creatorId: true,
        project: { select: { key: true } },
      },
    });

    const page: CaseRow[] = rows.map((c) => ({
      id: c.id,
      projectId: c.projectId,
      folderId: c.folderId,
      templateId: c.templateId,
      stateId: c.stateId,
      name: c.name,
      className: c.className,
      source: c.source,
      automated: c.automated,
      hasParameters: c.hasParameters,
      isArchived: c.isArchived,
      estimate: c.estimate,
      forecastManual: c.forecastManual,
      forecastAutomated: c.forecastAutomated,
      currentVersion: c.currentVersion,
      createdAt: c.createdAt.toISOString(),
      creatorId: c.creatorId,
      displayKey: recordKeyEnabled
        ? formatRecordKey({
            projectKey: c.project?.key ?? null,
            type: RECORD_TYPES.TEST_CASE,
            id: c.id,
            tokens: recordKeyTokens,
          })
        : null,
    }));
    exportedCount = page.length;
    lastRow = page[page.length - 1] ?? null;
    yield page;
  })();

  const manifest = buildManifest({
    resource: "repository-cases",
    since,
    pageSize,
    projectId,
  });

  const wrapped: PageSource<CaseRow | Record<string, unknown>> =
    (async function* () {
      for await (const page of pages) yield page;
      let nextCursor: string | null = null;
      if (exportedCount === pageSize && lastRow !== null) {
        const row: CaseRow = lastRow;
        nextCursor = encodeCursor({ k: row.createdAt, i: row.id });
      }
      yield [buildTrailer({ count: exportedCount, cursor: nextCursor })];
    })();

  return ndjsonResponse({ manifest, pages: wrapped });
}
