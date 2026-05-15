import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";

import { getEnhancedDb } from "~/lib/auth/utils";
import {
  MatrixCellCapExceededError,
  runMatrixAggregation,
} from "~/lib/matrix/matrixAggregation";
import { cellKey } from "~/lib/matrix/types";
import { prisma } from "~/lib/prisma";
import { matrixFiltersSchema } from "~/lib/schemas/matrixFiltersSchema";
import { authOptions } from "~/server/auth";

/**
 * GET /api/projects/[projectId]/matrix/export
 *
 * Streams the matrix as CSV (one row per `case × config × paramRow` cell).
 * Filters are read from URL search params (GET, no body) using the same
 * `matrixFiltersSchema` shape as the sibling cell-count + aggregate routes:
 *
 *   - status     -> repeated key, mapped to filters.statusIds
 *   - config     -> repeated key, mapped to filters.configIds
 *   - dataset    -> repeated key, mapped to filters.datasetIds
 *   - from / to  -> ISO-8601 datetime bounds (filters.dateFrom / dateTo)
 *
 * Column order: Case, Configuration, Parameter row label, then bare
 * parameter columns (no `param.` prefix), Status, Recorded at, Run name,
 * Run id. Bare parameter names come from each case's `parameters` array;
 * sensitive cells were already redacted by `runMatrixAggregation` so we
 * never re-redact here.
 *
 * `Recorded at` reads `cell.mostRecentCompletedAt` directly from the Wave 1
 * `CellSummary` contract (the SQL emits `MAX(iter."completedAt")`); empty
 * string when the cell has no completed iterations.
 *
 * `escapeFormulae: true` on `Papa.unparse` quotes any cell whose first
 * character is `=`, `+`, `-`, `@` so spreadsheet apps cannot interpret a
 * dataset value as a formula on open.
 *
 * The response is prefixed with the UTF-8 BOM so Excel-on-Windows opens
 * non-ASCII parameter values without mojibake. `Cache-Control: no-store`
 * prevents stale CSV downloads (the matrix payload changes whenever runs
 * advance).
 *
 * Security:
 *   - 401 when there is no session.
 *   - 403 when the caller cannot read the requested project. The read-gate
 *     uses `getEnhancedDb(session).projects.findFirst` BEFORE invoking
 *     `runMatrixAggregation`, because the aggregation runs raw SQL which
 *     bypasses ZenStack policies.
 *   - 422 when filters are malformed OR when the cell-count exceeds the
 *     10k cap (defense-in-depth check inside `runMatrixAggregation`). The
 *     user can't export what they can't render, so the cap applies here
 *     identically to the aggregate route.
 */

/**
 * Resolves whether the authenticated user holds the `canReadSensitive`
 * permission on their role. Mirrors the inline helper in
 * `app/api/test-runs/submit-result/route.ts` and
 * `app/api/repository/cases/[caseId]/dataset/route.ts` — sensitive
 * parameter values are sensitive across all surfaces, so the rule is the
 * same broad role-permission check (no per-ApplicationArea scoping).
 */
async function resolveCanReadSensitive(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: { include: { rolePermissions: true } } },
  });
  if (!u) return false;
  if (u.access === "ADMIN") return true;
  const perms = u.role?.rolePermissions ?? [];
  return Array.isArray(perms)
    ? perms.some(
        (p: { canReadSensitive?: boolean }) => p?.canReadSensitive === true
      )
    : false;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { projectId: projectIdParam } = await params;
    const projectId = parseInt(projectIdParam, 10);
    if (Number.isNaN(projectId) || projectId <= 0) {
      return NextResponse.json(
        { error: "Invalid project id" },
        { status: 400 }
      );
    }

    const db = await getEnhancedDb(session);
    const project = await db.projects.findFirst({
      where: { id: projectId, isDeleted: false },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const sp = request.nextUrl.searchParams;
    const filtersInput: Record<string, unknown> = {
      statusIds: sp.getAll("status").map(Number).filter(Number.isFinite),
      configIds: sp.getAll("config").map(Number).filter(Number.isFinite),
      datasetIds: sp.getAll("dataset").map(Number).filter(Number.isFinite),
    };
    const dateFrom = sp.get("from");
    if (dateFrom) filtersInput.dateFrom = dateFrom;
    const dateTo = sp.get("to");
    if (dateTo) filtersInput.dateTo = dateTo;

    const parsed = matrixFiltersSchema.safeParse(filtersInput);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid filters", details: parsed.error.flatten() },
        { status: 422 }
      );
    }

    const viewerCanReadSensitive = await resolveCanReadSensitive(
      session.user.id
    );

    let axes;
    try {
      axes = await runMatrixAggregation(
        prisma,
        projectId,
        parsed.data,
        viewerCanReadSensitive
      );
    } catch (err) {
      if (err instanceof MatrixCellCapExceededError) {
        return NextResponse.json(
          {
            error: "cell_cap_exceeded",
            cellCount: err.result.cellCount,
            threshold: err.result.threshold,
            axisCounts: err.result.axisCounts,
          },
          { status: 422 }
        );
      }
      throw err;
    }

    const rows: Record<string, unknown>[] = [];
    for (const c of axes.caseAxis) {
      for (const cfg of axes.configAxis) {
        for (const r of c.paramRows) {
          const cell = axes.cells.get(
            cellKey(c.caseId, cfg.configId, r.index)
          );
          const status = cell?.worstOfStatusId
            ? axes.statusMap[cell.worstOfStatusId]
            : null;
          const row: Record<string, unknown> = {
            Case: c.caseName,
            Configuration: cfg.configName,
            "Parameter row label": r.label ?? "",
          };
          if (c.parameters) {
            for (const p of c.parameters) {
              // Lock B — bare parameter name, NOT `param.${p.name}`.
              const value = r.values[p.name];
              row[p.name] = value === undefined || value === null ? "" : value;
            }
          }
          row.Status = status?.name ?? "Not run";
          row["Recorded at"] = cell?.mostRecentCompletedAt ?? "";
          // One run per cell column means the first iteration's run metadata
          // is the canonical run identity for the row. When the cell is
          // empty (no iterations yet), leave run name + id blank.
          const firstIter = cell?.iterations[0];
          row["Run name"] = firstIter?.runName ?? "";
          row["Run id"] = firstIter?.runId ?? "";
          rows.push(row);
        }
      }
    }

    // Compute the unified column header set across every case's parameters
    // before Papa.unparse — otherwise the library derives headers from the
    // first row only and silently drops columns belonging to cases with
    // heterogeneous parameter schemas.
    const parameterFieldNames = new Set<string>();
    for (const c of axes.caseAxis) {
      if (!c.parameters) continue;
      for (const p of c.parameters) parameterFieldNames.add(p.name);
    }
    const fields = [
      "Case",
      "Configuration",
      "Parameter row label",
      ...Array.from(parameterFieldNames),
      "Status",
      "Recorded at",
      "Run name",
      "Run id",
    ];

    const csv = Papa.unparse(
      { fields, data: rows },
      {
        delimiter: ",",
        header: true,
        quotes: true,
        escapeFormulae: true,
      }
    );

    const filename = `matrix-${projectId}-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;

    return new NextResponse("﻿" + csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[matrix export GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
