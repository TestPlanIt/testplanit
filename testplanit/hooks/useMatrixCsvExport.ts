"use client";

import { format } from "date-fns";
import Papa from "papaparse";
import { useCallback } from "react";

import { cellKey, type AxesShape } from "~/lib/matrix/types";

/**
 * Client-side CSV emit for the matrix view, used by the report-builder
 * preset (`MatrixReportPreset`) where the AxesShape is already in memory.
 *
 * The dedicated /matrix page uses the server-side streaming export route
 * because the page never holds the full AxesShape locally — it is fetched
 * once by `useMatrixAggregation` and never re-shaped. The report preset
 * surface, by contrast, has the AxesShape in scope from the report shell's
 * fetch — re-fetching server-side would double-aggregate, so a client-side
 * `Papa.unparse` is the correct seam here.
 *
 * Output column shape mirrors the server-side route 1:1 so a user
 * exporting from either surface gets bit-identical CSVs:
 *   Case, Configuration, Parameter row label, <param columns…>, Status,
 *   Recorded at, Run name, Run id
 *
 * `escapeFormulae: true` is required even client-side — the same CSV
 * injection threat applies regardless of which surface emitted the file.
 */
export function useMatrixCsvExport() {
  return useCallback((axes: AxesShape, fileLabel: string) => {
    const rows: Record<string, unknown>[] = [];
    for (const c of axes.caseAxis) {
      for (const cfg of axes.configAxis) {
        for (const r of c.paramRows) {
          const cell = axes.cells.get(cellKey(c.caseId, cfg.configId, r.index));
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
              // Bare parameter name as the column header — same convention
              // as the server-side export route.
              row[p.name] = r.values[p.name] ?? "";
            }
          }
          row.Status = status?.name ?? "Not run";
          row["Recorded at"] = cell?.mostRecentCompletedAt ?? "";
          row["Run name"] = cell?.iterations[0]?.runName ?? "";
          row["Run id"] = cell?.iterations[0]?.runId ?? "";
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

    const blob = new Blob(["﻿" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `matrix-${fileLabel}-${format(new Date(), "yyyy-MM-dd-HHmmss")}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }, []);
}
