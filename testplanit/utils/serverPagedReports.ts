/**
 * The pre-built report types the ReportBuilder fetches a page at a time
 * (real server paging: `page`/`pageSize` in the request, `total` in the
 * response, more rows appended on scroll, a refetch on header sort) and
 * the page size it asks for. Every other pre-built report returns its
 * full set in one request and is sorted in the browser.
 *
 * Page sizes stay within each route's per-request clamp so the
 * `loaded < total` arithmetic holds: execution-log clamps to 200, the
 * others to 500. A route may return MORE than the page size to finish a
 * row group (issue-test-coverage never splits an issue's cases across
 * pages), so the client asks for the next page by `offset` = rows loaded,
 * never by multiplying the page number.
 */
const SERVER_PAGE_SIZES: Record<string, number> = {
  "execution-log": 100,
  "test-case-health": 250,
  "issue-test-coverage": 250,
  "requirement-traceability": 250,
  "requirement-coverage-gaps": 250,
  "requirement-coverage-changes": 250,
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
