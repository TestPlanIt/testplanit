/**
 * Pure URL-param helpers for ReportBuilder.
 *
 * Extracted so the report-type-switch logic can be unit tested without
 * mounting the full component. Two rules encoded here:
 *
 * 1. When switching to a new report (tab change or dropdown change), the URL
 *    MUST be reset — any dimensions / metrics / date-range params from the
 *    previous report do not apply to the new one and would otherwise be
 *    re-hydrated by the metadata effect and fed into an auto-run against an
 *    incompatible report (e.g. "Unsupported dimension: creator").
 *
 * 2. When the URL and the current reportType state are out of sync
 *    (router.replace in flight, state update hasn't reached the URL yet), the
 *    metadata effect must skip loading URL-based selections — the URL still
 *    points at the PREVIOUS report, and its selections are invalid for the
 *    new report's dimension options.
 */

export interface BuildCleanReportUrlParamsInput {
  reportType: string;
  tab: string;
  pageSize?: number | "All";
}

/**
 * Build a fresh URLSearchParams for a report-type or tab change. Only the
 * four navigation keys are set — stale dimension/metric/date-range params
 * from the previous report are intentionally dropped.
 */
export function buildCleanReportUrlParams({
  reportType,
  tab,
  pageSize,
}: BuildCleanReportUrlParamsInput): URLSearchParams {
  const params = new URLSearchParams();
  params.set("reportType", reportType);
  params.set("tab", tab);
  params.set("page", "1");
  const resolvedPageSize =
    typeof pageSize === "number" && pageSize > 0 ? String(pageSize) : "10";
  params.set("pageSize", resolvedPageSize);
  return params;
}

/**
 * Returns true when it is safe for the metadata effect to load URL-based
 * dimension/metric selections for the current reportType. False means a
 * router.replace is in flight and the URL still points at the OLD report —
 * loading URL params in that window would seed stale state.
 */
export function isUrlInSyncWithReportType(
  urlReportType: string | null,
  currentReportType: string
): boolean {
  // No reportType in URL — nothing to conflict with; allow loading.
  if (!urlReportType) return true;
  return urlReportType === currentReportType;
}
