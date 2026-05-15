"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import { cellKey, type AxesShape } from "~/lib/matrix/types";

import { MatrixCell } from "./MatrixCell";

/**
 * Virtualized 3-axis grid for the Matrix view.
 *
 * Layout strategy
 * ---------------
 * One scrollable container (`parentRef`) hosts four overlapping regions
 * stacked by z-index so the sticky-top + sticky-left intersection works
 * cleanly without table-element semantics:
 *
 *   - Top-left corner (sticky top + left, `z-30`)
 *   - Column header strip (sticky top, `z-20`, runs the full data width)
 *   - Left case-name rail (sticky left, `z-10`, runs the full data height)
 *   - Data viewport (`z-0`, sized to virtualizer totals)
 *
 * Higher `z-index` for the corner ensures it stays on top when both axes
 * scroll at once; the column header sits above the data so virtualized
 * cells slide under it as the user scrolls vertically; the left rail sits
 * above the data for the same reason horizontally. HTML `<table>` rowspan
 * is intentionally NOT used — TanStack Virtual cannot virtualize a `<tr>`
 * that participates in a rowspan, so each parameter sub-row is its own
 * virtualizer item and the case name renders only on the first sub-row;
 * a left-side border on the leading sub-row + a continuation indent on
 * subsequent sub-rows preserves the visual "row span" without breaking
 * virtualization.
 *
 * Cell lookup goes through `cellKey()` from `lib/matrix/types` so the
 * Map key format stays in lock-step with the aggregation route + buildAxes.
 */

const CELL_WIDTH = 140;
const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 40;
const LEFT_RAIL_WIDTH = 240;

interface SubRow {
  caseId: number;
  caseName: string;
  rowIndex: number;
  label: string | null;
  isFirstSubRow: boolean;
  subRowCountForCase: number;
}

export function MatrixGrid({
  axes,
  projectId,
}: {
  axes: AxesShape;
  projectId: number;
}) {
  const t = useTranslations("projects.matrix");
  const parentRef = useRef<HTMLDivElement>(null);

  // Dynamically size the scroll container to fit between its top edge and
  // the viewport bottom (minus a small bottom margin). Without a bounded
  // height, TanStack Virtual sees the parent as "infinitely tall," reports
  // every row as visible, and renders the entire grid (~166k DOM nodes for
  // a 5,895-row × 29-col case). Computing from `getBoundingClientRect().top`
  // adapts to whatever chrome (app nav, project nav, toolbar, filter bar)
  // sits above the grid in any surface — dedicated page or report-builder
  // shell — without hard-coding offsets.
  const [maxHeight, setMaxHeight] = useState<number | null>(null);
  useEffect(() => {
    const compute = () => {
      const el = parentRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setMaxHeight(Math.max(200, window.innerHeight - top - 16));
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  // Flatten case axis × paramRows into a single list of sub-rows so the
  // row virtualizer can address each cell-row individually. The sub-row
  // carries enough metadata for the left-rail renderer to pick "case name"
  // vs "continuation indent" without re-walking the case axis.
  const subRows = useMemo<SubRow[]>(() => {
    const out: SubRow[] = [];
    for (const c of axes.caseAxis) {
      c.paramRows.forEach((r, i) => {
        out.push({
          caseId: c.caseId,
          caseName: c.caseName,
          rowIndex: r.index,
          label: r.label,
          isFirstSubRow: i === 0,
          subRowCountForCase: c.paramRows.length,
        });
      });
    }
    return out;
  }, [axes]);

  const rowVirtualizer = useVirtualizer({
    count: subRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: axes.configAxis.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CELL_WIDTH,
    overscan: 4,
  });

  const totalGridHeight = rowVirtualizer.getTotalSize();
  const totalGridWidth = columnVirtualizer.getTotalSize();
  const containerWidth = totalGridWidth + LEFT_RAIL_WIDTH;
  const containerHeight = totalGridHeight + HEADER_HEIGHT;

  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualColumns = columnVirtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      className="relative overflow-auto bg-background"
      style={{ height: maxHeight ?? undefined }}
      data-testid="matrix-grid"
    >
      <div
        className="relative"
        style={{ width: containerWidth, height: containerHeight }}
      >
        {/* Top-left corner — sticky top + left so it always covers the
            intersection of the column-header strip and the left rail. */}
        <div
          className="sticky top-0 left-0 z-30 flex items-center border-r border-b bg-background px-2 text-xs font-medium text-muted-foreground"
          style={{
            width: LEFT_RAIL_WIDTH,
            height: HEADER_HEIGHT,
            marginBottom: -HEADER_HEIGHT,
          }}
          data-testid="matrix-corner"
        >
          {t("caseColumnHeader")}
        </div>

        {/* Column-header strip — sticky-top, full data width, renders all
            configs (the cell-cap math caps configCount at ~100 in practice). */}
        <div
          className="sticky top-0 z-20 border-b bg-background"
          style={{
            marginLeft: LEFT_RAIL_WIDTH,
            width: totalGridWidth,
            height: HEADER_HEIGHT,
            marginBottom: -HEADER_HEIGHT,
          }}
          data-testid="matrix-column-headers"
        >
          {axes.configAxis.map((cfg, i) => (
            <div
              key={cfg.configId}
              className="absolute flex items-center border-r px-2 text-xs font-medium"
              style={{
                left: i * CELL_WIDTH,
                width: CELL_WIDTH,
                height: HEADER_HEIGHT,
              }}
              title={cfg.configName}
              data-testid={`matrix-column-header-${cfg.configId}`}
            >
              <span className="truncate">{cfg.configName}</span>
            </div>
          ))}
        </div>

        {/* Left case-name rail — sticky-left, virtualized, sized to the
            row-virtualizer total height. The leading sub-row of each case
            renders the case name + a top border to imply the row-span. */}
        <div
          className="sticky left-0 z-10 bg-background"
          style={{
            width: LEFT_RAIL_WIDTH,
            height: totalGridHeight,
            marginTop: HEADER_HEIGHT,
          }}
          data-testid="matrix-left-rail"
        >
          {virtualRows.map((vRow) => {
            const sr = subRows[vRow.index];
            return (
              <div
                key={vRow.key}
                className={`absolute flex items-center border-r px-2 text-xs ${
                  sr.isFirstSubRow
                    ? "border-t font-medium"
                    : "pl-4 text-muted-foreground"
                }`}
                style={{
                  top: vRow.start,
                  height: vRow.size,
                  width: LEFT_RAIL_WIDTH,
                }}
                data-testid={
                  sr.isFirstSubRow
                    ? `matrix-row-case-${sr.caseId}`
                    : `matrix-row-sub-${sr.caseId}-${sr.rowIndex}`
                }
              >
                <span className="truncate">
                  {sr.isFirstSubRow ? sr.caseName : (sr.label ?? "")}
                </span>
                {sr.isFirstSubRow && sr.label ? (
                  <span className="ml-2 truncate text-muted-foreground">
                    {sr.label}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Data viewport — absolute-positioned virtualized cells inside a
            sized container. Negative top-margin pulls the viewport up under
            the column-header strip; the strip's sticky positioning keeps it
            visually on top via `z-20`. */}
        <div
          className="absolute"
          style={{
            top: HEADER_HEIGHT,
            left: LEFT_RAIL_WIDTH,
            width: totalGridWidth,
            height: totalGridHeight,
          }}
          data-testid="matrix-data-viewport"
        >
          {virtualRows.map((vRow) => {
            const sr = subRows[vRow.index];
            return virtualColumns.map((vCol) => {
              const cfg = axes.configAxis[vCol.index];
              const cell = axes.cells.get(
                cellKey(sr.caseId, cfg.configId, sr.rowIndex)
              );
              return (
                <div
                  key={`${vRow.key}-${vCol.key}`}
                  className="absolute border-r border-b"
                  style={{
                    top: vRow.start,
                    left: vCol.start,
                    height: vRow.size,
                    width: vCol.size,
                  }}
                >
                  <MatrixCell
                    cell={cell}
                    configId={cfg.configId}
                    rowIndex={sr.rowIndex}
                    statusMap={axes.statusMap}
                    projectId={projectId}
                    caseId={sr.caseId}
                  />
                </div>
              );
            });
          })}
        </div>
      </div>
    </div>
  );
}
