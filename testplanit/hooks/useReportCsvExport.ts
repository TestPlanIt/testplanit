"use client";

/**
 * Export a report's results to CSV. The full result set now lives client-side
 * (no paging), so for most reports this just serializes what's already in
 * memory; the caller supplies `getRows` so the execution log (the one
 * server-paged report) can fetch all pages first.
 *
 * Mirrors `hooks/useDrillDownExport.ts`: Papa.unparse with `escapeFormulae`
 * (CSV-injection safe) + a BOM for Excel, and a `logDataExport` audit entry.
 */

import { useLocale, useTranslations } from "next-intl";
import Papa from "papaparse";
import { useCallback, useState } from "react";
import { logDataExport } from "~/lib/services/auditClient";
import {
  buildReportCsvRows,
  getBaseReportType,
  reportCsvFileName,
} from "~/utils/reportCsvUtils";

export interface ReportCsvExportParams {
  reportType: string;
  isCrossProject: boolean;
  /** Resolves the full row set to export (in-memory or fetch-all). */
  getRows: () => Promise<any[]> | any[];
  dimensions?: Array<{ value: string; label: string }>;
  metrics?: Array<{ value: string; label: string; apiLabel?: string }>;
  projects?: Array<{ id: number; name: string }>;
  consecutiveRuns?: number;
  projectId?: number | string;
}

export function useReportCsvExport() {
  const t = useTranslations();
  const locale = useLocale();
  const [isExporting, setIsExporting] = useState(false);

  const exportCsv = useCallback(
    async (params: ReportCsvExportParams) => {
      setIsExporting(true);
      try {
        const rows = await params.getRows();
        const csvRows = buildReportCsvRows({
          reportType: params.reportType,
          rows: rows ?? [],
          dimensions: params.dimensions,
          metrics: params.metrics,
          projects: params.projects,
          isCrossProject: params.isCrossProject,
          consecutiveRuns: params.consecutiveRuns,
          locale,
          // next-intl types `t` with a strict key union; the CSV builder takes
          // dynamic string keys, so adapt at the boundary.
          t: (key, values) => t(key as never, values as never),
        });

        const csvString = Papa.unparse(csvRows, {
          delimiter: ",",
          header: true,
          quotes: true,
          escapeFormulae: true,
        });

        const blob = new Blob(["﻿" + csvString], {
          type: "text/csv;charset=utf-8;",
        });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = reportCsvFileName(params.reportType, new Date());
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

        void logDataExport({
          exportType: "Report-CSV",
          entityType: getBaseReportType(params.reportType),
          recordCount: csvRows.length,
          filters: { reportType: params.reportType },
          projectId:
            params.projectId != null ? Number(params.projectId) : undefined,
        });
      } finally {
        setIsExporting(false);
      }
    },
    [t, locale]
  );

  return { isExporting, exportCsv };
}
