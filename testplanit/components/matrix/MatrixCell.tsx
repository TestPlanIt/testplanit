"use client";

import { useTranslations } from "next-intl";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { CellSummary, StatusMapEntry } from "~/lib/matrix/types";

import { MatrixCellPopover } from "./MatrixCellPopover";

// Hardcoded swatch colors mirror the seeded Passed / Failed / Untested
// status palette and the legend strip above the grid. Untested uses the
// lighter Black-shade #C8C9CA.
const PIP_COLORS = {
  passed: "#2A843F",
  failed: "#F44B25",
  untested: "#C8C9CA",
} as const;

/**
 * Renders one cell of the matrix grid.
 *
 * Two visual modes:
 *   - "Not run" — no iterations exist for this (case, config, paramRow)
 *     tuple; renders an em-dash placeholder, not a popover trigger.
 *   - Aggregated — renders three (pip, count) pairs, one per outcome
 *     bucket: passed (green), failed (red), untested (gray). The pip
 *     colors mirror the legend strip above the grid so users can map
 *     a count to a status without hovering. Click opens the drill-down
 *     popover with the per-iteration list.
 *
 * Note: the prior single "worst-of pip" renderer was dropped — the
 * three-pip layout already conveys cell health (any non-zero red pip
 * stands out) without needing a separate summary indicator.
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

  const summary = t("cellSummary", {
    pass: cell.pass,
    fail: cell.fail,
    notRun: cell.notRun,
  });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          // Click affordance: hover bg signals interactivity. Numbers
          // use the themed `text-foreground` (default) so they render
          // legibly on both light and dark themes without competing
          // with the primary brand color.
          className="flex h-full w-full items-center justify-center gap-2 hover:bg-accent text-foreground"
          data-testid={`matrix-cell-${caseId}-${cell.configId}-${cell.rowIndex}`}
          aria-label={summary}
        >
          <CountPip color={PIP_COLORS.passed} count={cell.pass} />
          <CountPip color={PIP_COLORS.failed} count={cell.fail} />
          <CountPip color={PIP_COLORS.untested} count={cell.notRun} />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-[28rem] p-0">
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

function CountPip({ color, count }: { color: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs tabular-nums">
      <span
        aria-hidden="true"
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: color }}
      />
      {count}
    </span>
  );
}
