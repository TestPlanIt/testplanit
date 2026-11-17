/**
 * Paging for the pre-built report handlers that compute their full row
 * set in memory and hand the client one window of it.
 *
 * The request may carry `page`/`pageSize` (API clients) or `offset`
 * (the ReportBuilder's scroll, which asks for "the rows after the N I
 * already have"); `offset` wins when both are present. `pageSize: "All"`,
 * or no pageSize at all, serves the complete set — the default, so API
 * clients and the CSV export keep every row.
 *
 * A handler whose rows form groups the table shows together (an issue and
 * its linked cases) passes `keepTogether`; a window then runs on past
 * `pageSize` until the group at its end is complete, so no group is ever
 * split across pages. That is why the client pages by offset: a page may
 * hold more rows than it asked for.
 */

export interface ReportPageRequest {
  page?: unknown;
  pageSize?: unknown;
  offset?: unknown;
}

export interface ReportPageOptions<T> {
  /** The largest window a caller may request. */
  maxPageSize: number;
  /** When true for two adjacent rows, a window never ends between them. */
  keepTogether?: (previous: T, next: T) => boolean;
}

export interface ReportPage<T> {
  rows: T[];
  /** Index of the first row served (0 for the complete set). */
  offset: number;
  /** 1-based page number implied by the request (1 for the complete set). */
  page: number;
  /** The window asked for, or "All". */
  pageSize: number | "All";
}

function toPositiveInt(value: unknown): number | null {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function pageReportRows<T>(
  rows: T[],
  request: ReportPageRequest,
  { maxPageSize, keepTogether }: ReportPageOptions<T>
): ReportPage<T> {
  const { page, pageSize, offset } = request;
  if (pageSize === "All" || pageSize == null) {
    return { rows, offset: 0, page: 1, pageSize: "All" };
  }

  const pageSizeNum = Math.min(
    Math.max(1, toPositiveInt(pageSize) ?? 1),
    maxPageSize
  );
  const pageNum = Math.max(1, toPositiveInt(page) ?? 1);
  const offsetNum = toPositiveInt(offset);
  const start = Math.min(offsetNum ?? (pageNum - 1) * pageSizeNum, rows.length);

  let end = Math.min(start + pageSizeNum, rows.length);
  if (keepTogether) {
    while (end < rows.length && keepTogether(rows[end - 1], rows[end])) {
      end++;
    }
  }

  return {
    rows: rows.slice(start, end),
    offset: start,
    page: offsetNum != null ? Math.floor(start / pageSizeNum) + 1 : pageNum,
    pageSize: pageSizeNum,
  };
}
