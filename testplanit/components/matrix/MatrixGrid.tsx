"use client";
/* eslint-disable react-hooks/incompatible-library -- This file consumes a library API (TanStack Table / TanStack Virtual / react-hook-form watch) that returns unstable function references by design; React Compiler auto-skips memoization here and the lint rule reports it. */

import { useVirtualizer } from "@tanstack/react-virtual";
import { RepositoryCaseSource } from "@prisma/client";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import { ConfigurationNameDisplay } from "@/components/ConfigurationNameDisplay";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
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
 * that participates in a rowspan, so a parameterized case emits a
 * dedicated header sub-row (case name only, no cells) followed by one
 * data sub-row per param row; a top border on the header + a continuation
 * indent on the data rows preserves the visual "row span" without breaking
 * virtualization. Non-parameterized cases collapse to a single data row.
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
  caseSource: string;
  caseAutomated: boolean;
  caseHasParameters: boolean;
  rowIndex: number;
  label: string | null;
  kind: "header" | "data";
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
  // row virtualizer can address each cell-row individually. Parameterized
  // cases emit a header sub-row (kind: "header", no cells) followed by one
  // data sub-row per paramRow so the first param doesn't share its row with
  // the case name. Non-parameterized cases keep the single-row layout.
  const subRows = useMemo<SubRow[]>(() => {
    const out: SubRow[] = [];
    for (const c of axes.caseAxis) {
      if (c.hasParameters) {
        out.push({
          caseId: c.caseId,
          caseName: c.caseName,
          caseSource: c.source,
          caseAutomated: c.automated,
          caseHasParameters: c.hasParameters,
          rowIndex: -1,
          label: null,
          kind: "header",
          isFirstSubRow: true,
          subRowCountForCase: c.paramRows.length + 1,
        });
        c.paramRows.forEach((r) => {
          out.push({
            caseId: c.caseId,
            caseName: c.caseName,
            caseSource: c.source,
            caseAutomated: c.automated,
            caseHasParameters: c.hasParameters,
            rowIndex: r.index,
            label: r.label,
            kind: "data",
            isFirstSubRow: false,
            subRowCountForCase: c.paramRows.length + 1,
          });
        });
      } else {
        const r = c.paramRows[0];
        out.push({
          caseId: c.caseId,
          caseName: c.caseName,
          caseSource: c.source,
          caseAutomated: c.automated,
          caseHasParameters: c.hasParameters,
          rowIndex: r.index,
          label: r.label,
          kind: "data",
          isFirstSubRow: true,
          subRowCountForCase: 1,
        });
      }
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
              data-testid={`matrix-column-header-${cfg.configId}`}
            >
              <ConfigurationNameDisplay name={cfg.configName} truncate />
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
            const isCaseRow = sr.isFirstSubRow;
            return (
              <div
                key={vRow.key}
                className={`absolute flex items-center border-r px-2 text-xs ${
                  isCaseRow
                    ? "border-t font-medium"
                    : "pl-4 text-muted-foreground"
                }`}
                style={{
                  top: vRow.start,
                  height: vRow.size,
                  width: LEFT_RAIL_WIDTH,
                }}
                data-testid={
                  isCaseRow
                    ? `matrix-row-case-${sr.caseId}`
                    : `matrix-row-sub-${sr.caseId}-${sr.rowIndex}`
                }
              >
                {isCaseRow ? (
                  // `[&_*]:min-w-0` lets the name truncate inside the nested
                  // flex layout. We deliberately do NOT blanket-force spans to
                  // `block` — that broke CaseDisplay's inline-flex type icon
                  // onto its own line. The name already truncates via the
                  // CaseDisplay `maxLines={1}` below.
                  <div className="min-w-0 flex-1 overflow-hidden [&_*]:min-w-0">
                    <CaseDisplay
                      id={sr.caseId}
                      name={sr.caseName}
                      source={sr.caseSource as RepositoryCaseSource}
                      automated={sr.caseAutomated}
                      hasParameters={sr.caseHasParameters}
                      link={`/projects/repository/${projectId}/${sr.caseId}`}
                      linkTarget="_blank"
                      size="small"
                      maxLines={1}
                    />
                  </div>
                ) : (
                  <span className="min-w-0 flex-1 truncate">
                    {sr.label ?? ""}
                  </span>
                )}
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
            if (sr.kind === "header") return null;
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
