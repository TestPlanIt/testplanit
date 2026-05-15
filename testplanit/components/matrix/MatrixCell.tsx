"use client";

import { useTranslations } from "next-intl";

import {
  glyphFromStatus,
  IterationStatusPip,
} from "@/components/iterations/IterationStatusPip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { CellSummary, StatusMapEntry } from "~/lib/matrix/types";

import { MatrixCellPopover } from "./MatrixCellPopover";

/**
 * Renders one cell of the matrix grid.
 *
 * Two visual modes:
 *   - "Not run" — no iterations exist for this (case, config, paramRow)
 *     tuple; renders an em-dash placeholder, not a popover trigger.
 *   - Aggregated — renders a status pip (color from the worst-of status
 *     resolved by the aggregation route) plus a `pass/fail/notRun` count
 *     rollup. Click opens the drill-down popover with the iteration list.
 *
 * The pip reuses `IterationStatusPip` from the iterations surface so the
 * matrix and the iteration sidebar share one color/glyph mapping. The
 * popover is click-only by design — hover-to-open was rejected as too
 * aggressive for a dense grid where horizontal mouse travel is constant.
 */
export function MatrixCell({
  cell,
  configId,
  rowIndex,
  statusMap,
  projectId,
  caseId,
}: {
  cell: CellSummary | undefined;
  configId: number;
  rowIndex: number;
  statusMap: Record<number, StatusMapEntry>;
  projectId: number;
  caseId: number;
}) {
  const t = useTranslations("projects.matrix");

  if (!cell || cell.iterationCount === 0) {
    return (
      <div
        className="flex h-full w-full items-center justify-center text-muted-foreground"
        data-testid={`matrix-cell-not-run-${caseId}-${configId}-${rowIndex}`}
        aria-label={t("cellNotRun")}
      >
        {"—"}
      </div>
    );
  }

  const worst = cell.worstOfStatusId ? statusMap[cell.worstOfStatusId] : null;
  const glyph = glyphFromStatus(
    worst
      ? {
          isSuccess: worst.isSuccess,
          isFailure: worst.isFailure,
          isCompleted: worst.isCompleted,
        }
      : null,
    false
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-full w-full items-center justify-center gap-1 hover:bg-accent"
          data-testid={`matrix-cell-${caseId}-${cell.configId}-${cell.rowIndex}`}
          aria-label={t("cellSummary", {
            pass: cell.pass,
            fail: cell.fail,
            notRun: cell.notRun,
          })}
        >
          <IterationStatusPip glyph={glyph} statusColor={worst?.colorValue} />
          <span className="text-xs tabular-nums">
            {cell.pass}/{cell.fail}/{cell.notRun}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-80 p-0">
        <MatrixCellPopover
          cell={cell}
          statusMap={statusMap}
          projectId={projectId}
          caseId={caseId}
        />
      </PopoverContent>
    </Popover>
  );
}
