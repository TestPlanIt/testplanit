/**
 * The pre-built report types the ReportBuilder fetches a page at a time
 * (real server paging: `page`/`pageSize` in the request, `total` in the
 * response, more rows appended on scroll, a refetch on header sort) and
 * the page size it asks for. Every other pre-built report returns its
 * full set in one request and is sorted in the browser.
 *
 * Page sizes stay within each route's per-request clamp so the
 * `loaded < total` arithmetic holds: execution-log clamps to 200,
 * test-case-health to 500.
 */
const SERVER_PAGE_SIZES: Record<string, number> = {
  "execution-log": 100,
  "test-case-health": 250,
};

function baseReportType(reportType: string): string {
  return reportType.replace(/^cross-project-/, "");
}

export function serverPageSize(
  reportType: string | null | undefined
): number | null {
  if (!reportType) return null;
  return SERVER_PAGE_SIZES[baseReportType(reportType)] ?? null;
}

export function isServerPagedReport(
  reportType: string | null | undefined
): boolean {
  return serverPageSize(reportType) !== null;
}
