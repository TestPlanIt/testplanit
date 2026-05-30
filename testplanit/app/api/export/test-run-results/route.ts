/**
 * Bulk NDJSON export of TestRunResults — the test-execution fact table.
 *
 * Designed for data-lake ETL: pair a regular cursor-paged GET with the
 * `since` filter to incrementally ingest results into Snowflake / BigQuery /
 * Databricks / etc. Each line is a denormalized result row; the manifest
 * (first line) and trailer (last line) wrap the page with metadata so the
 * consumer can loop on cursor without re-parsing the body.
 *
 * Access model:
 * - Admin: cross-project. Optional `projectId` query param narrows to one.
 * - Non-admin: `projectId` is REQUIRED, and the enhanced ZenStack client
 *   enforces project-membership policy on the read.
 *
 * Query parameters:
 * - `since`     ISO-8601 timestamp; rows with `executedAt >= since` only.
 * - `cursor`    Opaque cursor returned in the previous page's trailer.
 * - `pageSize`  1..MAX_PAGE_SIZE (default 1000).
 * - `projectId` Required for non-admins; optional for admins.
 */

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { enhance } from "@zenstackhq/runtime";
import { authenticateRequest } from "~/lib/api-token-auth";
import { prisma } from "~/lib/prisma";
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

interface ResultRow {
  id: number;
  testRunId: number;
  testRunCaseId: number;
  testCaseId: number;
  projectId: number;
  statusId: number;
  statusName: string;
  isPass: boolean;
  isFail: boolean;
  executedAt: string;
  executedById: string;
  elapsedMs: number | null;
  attempt: number;
  iterationId: number | null;
  editedAt: string | null;
  editedById: string | null;
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

  // For non-admins we read through the enhanced client so ZenStack's
  // project-membership policy enforces access. Admins use raw prisma so
  // cross-project export is unrestricted (see preflight route for the same
  // pattern; the policy layer has been observed to return zero rows under
  // heavy parallel load even when @@allow is unconditional).
  let reader = prisma as unknown as typeof prisma;
  if (!isAdmin) {
    const userRecord = await prisma.user.findUnique({
      where: { id: auth.user.userId },
      include: { role: { include: { rolePermissions: true } } },
    });
    if (!userRecord) {
      return NextResponse.json({ error: "User not found" }, { status: 401 });
    }
    reader = enhance(prisma, { user: userRecord }) as unknown as typeof prisma;

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
    where.testRun = { projectId, isDeleted: false };
  }
  if (since) {
    where.executedAt = { gte: since };
  }
  if (cursor) {
    Object.assign(where, cursorWhere("executedAt", cursor));
  }

  let exportedCount = 0;
  let lastRow: ResultRow | null = null;

  const pages: PageSource<ResultRow> = (async function* () {
    const rows = await reader.testRunResults.findMany({
      where: where as never,
      orderBy: [{ executedAt: "asc" }, { id: "asc" }],
      take: pageSize,
      select: {
        id: true,
        testRunId: true,
        testRunCaseId: true,
        executedAt: true,
        executedById: true,
        elapsed: true,
        attempt: true,
        iterationId: true,
        editedAt: true,
        editedById: true,
        statusId: true,
        status: { select: { name: true, isSuccess: true, isFailure: true } },
        testRun: { select: { projectId: true } },
        testRunCase: { select: { repositoryCaseId: true } },
      },
    });

    const page: ResultRow[] = rows.map((r) => ({
      id: r.id,
      testRunId: r.testRunId,
      testRunCaseId: r.testRunCaseId,
      testCaseId: r.testRunCase.repositoryCaseId,
      projectId: r.testRun.projectId,
      statusId: r.statusId,
      statusName: r.status.name,
      isPass: r.status.isSuccess,
      isFail: r.status.isFailure,
      executedAt: r.executedAt.toISOString(),
      executedById: r.executedById,
      elapsedMs: r.elapsed,
      attempt: r.attempt,
      iterationId: r.iterationId,
      editedAt: r.editedAt ? r.editedAt.toISOString() : null,
      editedById: r.editedById,
    }));
    exportedCount = page.length;
    lastRow = page[page.length - 1] ?? null;
    yield page;
  })();

  const manifest = buildManifest({
    resource: "test-run-results",
    since,
    pageSize,
    projectId,
  });

  const wrapped: PageSource<ResultRow | Record<string, unknown>> =
    (async function* () {
      for await (const page of pages) yield page;
      let nextCursor: string | null = null;
      if (exportedCount === pageSize && lastRow !== null) {
        const row: ResultRow = lastRow;
        nextCursor = encodeCursor({ k: row.executedAt, i: row.id });
      }
      yield [buildTrailer({ count: exportedCount, cursor: nextCursor })];
    })();

  return ndjsonResponse({ manifest, pages: wrapped });
}
