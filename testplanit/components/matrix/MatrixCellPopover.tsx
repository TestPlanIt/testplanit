"use client";

import { useTranslations } from "next-intl";

import {
  glyphFromStatus,
  IterationStatusPip,
} from "@/components/iterations/IterationStatusPip";
import { RelativeTimeTooltip } from "@/components/RelativeTimeTooltip";
import { TestRunLinkDisplay } from "@/components/tables/TestRunsListDisplay";
import type { CellSummary, StatusMapEntry } from "~/lib/matrix/types";

/**
 * Drill-down popover surfaced by `MatrixCell` on click.
 *
 * Renders one row per iteration in the cell with:
 *   - status pip (worst-of color)
 *   - iteration ordinal + optional label  (e.g. "Iteration 3 — Bad password")
 *     using the 1-indexed display number (matches the run page's iteration
 *     sidebar, NOT the DB id)
 *   - the run as a `TestRunLinkDisplay` so users see the canonical
 *     PlayCircle icon + run-name treatment used everywhere else
 *
 * The link target preselects the iteration via `?iteration=N` (1-indexed,
 * matches `useActiveIterationFromUrl` on the run page) and the case via
 * `?selectedCase=` so the iteration sidebar opens to the right row.
 *
 * In-flight iterations (those without a recorded result yet) don't appear
 * in `cell.iterations` because the aggregation route only returns
 * iterations that have been touched. The footer hint surfaces that to
 * the user explicitly.
 */
export function MatrixCellPopover({
  cell,
  statusMap,
  projectId,
  caseId,
}: {
  cell: CellSummary;
  statusMap: Record<number, StatusMapEntry>;
  projectId: number;
  caseId: number;
}) {
  const t = useTranslations("projects.matrix");

  return (
    <div className="p-3" data-testid="matrix-cell-popover">
      <div className="mb-2 font-medium">
        {t("popoverTitle", { count: cell.iterationCount })}
      </div>
      <ul className="max-h-64 space-y-1 overflow-auto">
        {cell.iterations.map((iter) => {
          const status = iter.statusId ? statusMap[iter.statusId] : null;
          const glyph = glyphFromStatus(
            status
              ? {
                  isSuccess: status.isSuccess,
                  isFailure: status.isFailure,
                  isCompleted: status.isCompleted,
                }
              : null,
            false
          );
          const ordinal = iter.rowIndex + 1;
          // Every iteration in a single cell sits on the same paramRow, so
          // the dataset row label would just repeat across every row.
          // Show the iteration's status name instead — that's the actual
          // differentiator across runs (e.g. Passed / Failed / Not run).
          const displayLabel = status?.name ?? t("cellNotRun");
          return (
            <li
              key={iter.id}
              className="flex items-center gap-2 text-sm"
              data-testid={`matrix-popover-row-${iter.id}`}
            >
              <IterationStatusPip
                glyph={glyph}
                // Null statusId means "not yet executed" — fall back to
                // the same #C8C9CA Untested swatch the cells use, so the
                // popover row is visually consistent with the legend.
                statusColor={status?.colorValue ?? "#C8C9CA"}
              />
              <span className="w-20 shrink-0 truncate">{displayLabel}</span>
              {iter.completedAt ? (
                <span
                  className="w-28 shrink-0 truncate text-xs text-muted-foreground"
                  data-testid={`matrix-popover-time-${iter.id}`}
                >
                  <RelativeTimeTooltip date={iter.completedAt} />
                </span>
              ) : (
                <span
                  className="w-28 shrink-0 text-xs text-muted-foreground/60"
                  data-testid={`matrix-popover-time-${iter.id}`}
                >
                  {t("popoverNoTimestamp")}
                </span>
              )}
              <span
                className="min-w-0 flex-1 text-xs"
                data-testid={`matrix-popover-link-${iter.id}`}
              >
                <TestRunLinkDisplay
                  id={iter.runId}
                  name={iter.runName}
                  projectId={projectId}
                  isCompleted={iter.runIsCompleted}
                  maxLines={1}
                  searchParams={{
                    iteration: ordinal,
                    selectedCase: caseId,
                  }}
                />
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        {t("popoverInflightHint")}
      </p>
    </div>
  );
}
