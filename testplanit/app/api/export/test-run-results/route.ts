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

const DEFAULT_PAGE_SIZE = 1000;
const MAX_PAGE_SIZE = 5000;

interface Cursor {
  e: string; // executedAt ISO-8601
  i: number; // result id (tiebreak)
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(Buffer.from(raw, "base64url").toString("utf-8"));
    if (typeof obj?.e === "string" && typeof obj?.i === "number") return obj;
  } catch {
    /* fall through */
  }
  return null;
}

function parsePageSize(raw: string | null): number {
  if (!raw) return DEFAULT_PAGE_SIZE;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(n, MAX_PAGE_SIZE);
}

function parseSince(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

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

    // Verify project access up-front to fail fast with a clear 403, rather
    // than silently streaming an empty body.
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
    const cursorDate = new Date(cursor.e);
    // (executedAt, id) > (cursorE, cursorI) — strict forward iteration with
    // stable tiebreak so identical timestamps don't get skipped or duplicated.
    where.OR = [
      { executedAt: { gt: cursorDate } },
      { executedAt: cursorDate, id: { gt: cursor.i } },
    ];
    // Stripping the top-level executedAt filter is unnecessary — the OR is
    // ANDed with everything else; the cursor is strictly tighter than `since`.
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

  const manifest = {
    type: "manifest",
    schemaVersion: 1,
    resource: "test-run-results",
    exportedAt: new Date().toISOString(),
    since: since?.toISOString() ?? null,
    pageSize,
    projectId: projectId ?? null,
  };

  // The trailer is computed after the page generator runs, so we wrap the
  // generator and append the trailer line as part of the stream itself.
  // ndjsonResponse streams pages directly; for the trailer we wrap with a
  // generator that yields rows then a one-element page containing the
  // trailer record.
  const wrapped: PageSource<
    ResultRow | { type: string; [k: string]: unknown }
  > = (async function* () {
    for await (const page of pages) yield page;
    let nextCursor: string | null = null;
    if (exportedCount === pageSize && lastRow !== null) {
      const row: ResultRow = lastRow;
      nextCursor = encodeCursor({ e: row.executedAt, i: row.id });
    }
    yield [
      {
        type: "end",
        count: exportedCount,
        cursor: nextCursor,
      },
    ];
  })();

  return ndjsonResponse({
    manifest,
    pages: wrapped,
  });
}
