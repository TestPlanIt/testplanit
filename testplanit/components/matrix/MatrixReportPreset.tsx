"use client";

import { Download, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { MatrixCellCapNotice } from "@/components/matrix/MatrixCellCapNotice";
import { MatrixGrid } from "@/components/matrix/MatrixGrid";
import { Button } from "@/components/ui/button";
import { useMatrixAggregation } from "~/hooks/useMatrixAggregation";
import { useMatrixFilters } from "~/hooks/useMatrixFilters";

interface MatrixReportPresetProps {
  projectId: number;
}

/**
 * Self-fetching matrix wrapper for the report-builder shell.
 *
 * Mirrors the dedicated `/projects/[id]/matrix` page's data flow 1:1
 * (`useMatrixFilters` + `useMatrixAggregation`) so cell-cap handling, filter
 * UX, and URL-backed share state come along for free. The outer report shell
 * provides title / save / share chrome; we just render the filter bar, cap
 * notice (when applicable), and grid.
 *
 * The `/api/report-builder/iteration-matrix` proxy still exists for the
 * report-builder metadata GET stub, but data fetching goes directly through
 * the dedicated aggregate route to inherit `MatrixAggregationError` typing.
 */
export function MatrixReportPreset({ projectId }: MatrixReportPresetProps) {
  const t = useTranslations("projects.matrix");
  const { filters, setFilters } = useMatrixFilters();
  const query = useMatrixAggregation(projectId, filters);
  const hasData = Boolean(query.data && query.data.cellCount > 0);

  const exportUrl = useMemo(() => {
    const sp = new URLSearchParams();
    filters.statusIds?.forEach((id) => sp.append("status", String(id)));
    filters.configIds?.forEach((id) => sp.append("config", String(id)));
    filters.datasetIds?.forEach((id) => sp.append("dataset", String(id)));
    if (filters.dateFrom) sp.set("from", filters.dateFrom);
    if (filters.dateTo) sp.set("to", filters.dateTo);
    const qs = sp.toString();
    return qs
      ? `/api/projects/${projectId}/matrix/export?${qs}`
      : `/api/projects/${projectId}/matrix/export`;
  }, [projectId, filters]);

  return (
    <div className="flex flex-col" data-testid="matrix-report-preset">
      <div className="flex justify-end border-b p-2">
        {hasData ? (
          <Button
            asChild
            variant="outline"
            size="sm"
            data-testid="matrix-preset-export-csv"
          >
            <a href={exportUrl} download>
              <Download className="h-4 w-4" />
              {t("exportCsv")}
            </a>
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled
            data-testid="matrix-preset-export-csv"
          >
            <Download className="h-4 w-4" />
            {t("exportCsv")}
          </Button>
        )}
      </div>
      {query.isLoading && (
        <div
          className="flex flex-1 items-center justify-center gap-2 text-muted-foreground"
          data-testid="matrix-loading"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t("loading")}
        </div>
      )}

      {query.error?.matrixError?.type === "cell_cap_exceeded" && (
        <MatrixCellCapNotice
          error={query.error.matrixError}
          filters={filters}
          onChange={setFilters}
        />
      )}

      {query.error && !query.error.matrixError && (
        <div
          className="m-4 rounded-md border border-destructive bg-destructive/10 p-4 text-destructive"
          data-testid="matrix-error"
        >
          {t("loadError")}
        </div>
      )}

      {query.data && (
        <>
          <MatrixCellLegend />
          <MatrixGrid axes={query.data} projectId={projectId} />
        </>
      )}
    </div>
  );
}

// Hardcoded swatch colors mirror the seeded Passed / Failed / Untested
// status palette. Untested uses the lighter Black-shade #C8C9CA.
const LEGEND_COLORS = {
  passed: "#2A843F",
  failed: "#F44B25",
  untested: "#C8C9CA",
} as const;

/**
 * Tiny legend strip explaining what each cell shows. Sits above the
 * matrix so users have a single static reference point.
 *
 * Three columns — Passed / Failed / Untested — each combining the
 * status name, its pip swatch, and a `#` placeholder for the per-cell
 * count. The `#` is a generic "any count" stand-in: cells render real
 * numbers, the legend just teaches the format.
 */
function MatrixCellLegend() {
  const t = useTranslations("projects.matrix");
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground"
      data-testid="matrix-cell-legend"
    >
      <LegendColumn name={t("legendPassedName")} color={LEGEND_COLORS.passed} />
      <span aria-hidden="true">|</span>
      <LegendColumn name={t("legendFailedName")} color={LEGEND_COLORS.failed} />
      <span aria-hidden="true">|</span>
      <LegendColumn
        name={t("legendUntestedName")}
        color={LEGEND_COLORS.untested}
      />
      <span className="ml-auto italic">{t("legendClickHint")}</span>
    </div>
  );
}

function LegendColumn({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span>{name}</span>
    </span>
  );
}
