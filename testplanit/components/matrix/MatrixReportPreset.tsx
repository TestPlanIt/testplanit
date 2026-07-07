"use client";

import { Download, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { MatrixCellCapNotice } from "@/components/matrix/MatrixCellCapNotice";
import { MatrixGrid } from "@/components/matrix/MatrixGrid";
import { Button } from "@/components/ui/button";
import { useMatrixAggregation } from "~/hooks/useMatrixAggregation";
import { useMatrixCsvExport } from "~/hooks/useMatrixCsvExport";
import { useMatrixFilters } from "~/hooks/useMatrixFilters";
import type { AxesShape, CellSummary } from "~/lib/matrix/types";

interface MatrixReportPresetProps {
  projectId: number;
  /**
   * Pre-fetched axes payload from the shared-link route. When present, the
   * preset skips `useMatrixAggregation` (which requires an authenticated
   * project-read) and renders directly. `cells` arrives JSON-serialized as
   * an `Array<[key, value]>` and is reconstructed into a Map here.
   */
  prefetchedAxes?: {
    caseAxis: AxesShape["caseAxis"];
    configAxis: AxesShape["configAxis"];
    cells: Array<[string, CellSummary]>;
    cellCount: number;
    statusMap: AxesShape["statusMap"];
  };
  /**
   * Shared-link viewer mode. Hides the export button (no client session to
   * gate sensitive params) and treats the prefetched filters/cap state as a
   * frozen snapshot — no filter editing.
   */
  readOnly?: boolean;
  /**
   * Header actions from the ReportBuilder shell (e.g. the Share button).
   * Rendered alongside the Export CSV button. Omitted in shared-link mode
   * since the shell isn't rendered.
   */
  headerActions?: React.ReactNode;
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
export function MatrixReportPreset({
  projectId,
  prefetchedAxes,
  readOnly = false,
  headerActions,
}: MatrixReportPresetProps) {
  const t = useTranslations("projects.matrix");
  const tCommon = useTranslations("common");
  const { filters, setFilters } = useMatrixFilters();
  // When the share endpoint pre-fetches the matrix, skip the authenticated
  // aggregate hook entirely — viewers of a public share have no session to
  // gate `/api/projects/.../matrix/aggregate`. The provided axes are the
  // snapshot the share was captured at.
  const query = useMatrixAggregation(
    prefetchedAxes ? null : projectId,
    filters
  );

  const sharedAxes: AxesShape | null = useMemo(() => {
    if (!prefetchedAxes) return null;
    return {
      caseAxis: prefetchedAxes.caseAxis,
      configAxis: prefetchedAxes.configAxis,
      cells: new Map<string, CellSummary>(prefetchedAxes.cells),
      cellCount: prefetchedAxes.cellCount,
      statusMap: prefetchedAxes.statusMap,
    };
  }, [prefetchedAxes]);

  const axes = sharedAxes ?? query.data ?? null;
  const isLoading = !sharedAxes && query.isLoading;
  const error = sharedAxes ? null : query.error;
  const exportCsv = useMatrixCsvExport();
  const hasData = Boolean(axes && axes.cellCount > 0);

  const showTopBar = !readOnly || headerActions;
  return (
    <div className="flex flex-col" data-testid="matrix-report-preset">
      {showTopBar && (
        <div className="flex items-center justify-end gap-2 border-b p-2">
          {!readOnly && (
            <Button
              variant="ghost"
              size="sm"
              disabled={!hasData}
              onClick={() => {
                if (axes) exportCsv(axes, String(projectId));
              }}
              className="group gap-0 overflow-hidden transition-all hover:gap-2"
              data-testid="matrix-preset-export-csv"
            >
              <Download className="h-4 w-4 shrink-0" />
              <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all group-hover:max-w-xs">
                {t("exportCsv")}
              </span>
            </Button>
          )}
          {headerActions}
        </div>
      )}
      {isLoading && (
        <div
          className="flex flex-1 items-center justify-center gap-2 py-12 text-muted-foreground"
          data-testid="matrix-loading"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {tCommon("loading")}
        </div>
      )}

      {error?.matrixError?.type === "cell_cap_exceeded" && (
        <MatrixCellCapNotice
          error={error.matrixError}
          filters={filters}
          onChange={setFilters}
        />
      )}

      {error && !error.matrixError && (
        <div
          className="m-4 rounded-md border border-destructive bg-destructive/10 p-4 text-destructive"
          data-testid="matrix-error"
        >
          {t("loadError")}
        </div>
      )}

      {axes && (
        <>
          <MatrixCellLegend />
          <MatrixGrid axes={axes} projectId={projectId} />
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
      <span className="ms-auto italic">{t("legendClickHint")}</span>
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
