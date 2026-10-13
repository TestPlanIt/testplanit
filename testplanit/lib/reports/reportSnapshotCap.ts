import type { SharedReportPayload } from "./sharedReportPayload";

/** Rows a frozen report keeps when REPORT_SNAPSHOT_MAX_ROWS is unset. */
export const DEFAULT_REPORT_SNAPSHOT_MAX_ROWS = 10000;

/** The row cap for frozen reports, from REPORT_SNAPSHOT_MAX_ROWS. */
export function getReportSnapshotMaxRows(): number {
  const raw = process.env.REPORT_SNAPSHOT_MAX_ROWS;
  if (!raw) return DEFAULT_REPORT_SNAPSHOT_MAX_ROWS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_REPORT_SNAPSHOT_MAX_ROWS;
}

/**
 * The payload's row count: table rows, chart points, or matrix cells,
 * whichever is largest.
 */
export function countSnapshotRows(payload: SharedReportPayload): number {
  return Math.max(
    payload.results?.length ?? 0,
    payload.chartData?.length ?? 0,
    payload.matrixAxes?.cells?.length ?? 0
  );
}

/** Cut every row array in the payload to `maxRows`. */
export function truncateSnapshotPayload(
  payload: SharedReportPayload,
  maxRows: number
): SharedReportPayload {
  const truncated: SharedReportPayload = {
    ...payload,
    results: (payload.results ?? []).slice(0, maxRows),
    chartData: (payload.chartData ?? []).slice(0, maxRows),
  };
  if (Array.isArray(payload.matrixAxes?.cells)) {
    const cells = payload.matrixAxes.cells.slice(0, maxRows);
    truncated.matrixAxes = {
      ...payload.matrixAxes,
      cells,
      cellCount: cells.length,
    };
  }
  return truncated;
}
