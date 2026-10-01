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

import type { ReportBuilderStateConfig } from "~/lib/schemas/reportBuilderStateSchema";

/** URL key carrying the id of a persisted Report Builder selection. */
export const REPORT_STATE_URL_KEY = "state";

/**
 * Pre-state keys that spelled the whole selection out in the URL. Still read
 * so bookmarks from before the change restore; never written any more, since
 * a "Select all" over thousands of filter values pushed the URL past what
 * ingress accepts (414).
 */
export const LEGACY_REPORT_SELECTION_URL_KEYS = [
  "dimensions",
  "metrics",
  "startDate",
  "endDate",
  "dimensionFilters",
] as const;

/** Removes every selection-carrying key (state id and legacy params). */
export function stripReportSelectionParams(params: URLSearchParams): void {
  params.delete(REPORT_STATE_URL_KEY);
  for (const key of LEGACY_REPORT_SELECTION_URL_KEYS) {
    params.delete(key);
  }
}

/**
 * True when the URL carries a selection that will trigger an auto-run once
 * it resolves: a state id, or legacy dimensions plus metrics.
 */
export function hasReportSelectionInUrl(params: URLSearchParams): boolean {
  return (
    Boolean(params.get(REPORT_STATE_URL_KEY)) ||
    Boolean(params.get("dimensions") && params.get("metrics"))
  );
}

export interface BuildReportBuilderStateConfigInput {
  dimensions: Array<{ value: string }>;
  metrics: Array<{ value: string }>;
  dateRange?: { from?: Date; to?: Date };
  /** Picker selections per dimension id; only selected dimensions persist. */
  dimensionValueFilters: Record<
    string,
    Array<{ id: string | number }> | undefined
  >;
}

/**
 * The selection to persist after an explicit Run Report: dimension and
 * metric ids in order, the date range as ISO strings, and each selected
 * dimension's filter value ids (names are display-only and resolved on load
 * through the values lookup).
 */
export function buildReportBuilderStateConfig({
  dimensions,
  metrics,
  dateRange,
  dimensionValueFilters,
}: BuildReportBuilderStateConfigInput): ReportBuilderStateConfig {
  const config: ReportBuilderStateConfig = {
    dimensions: dimensions.map((d) => d.value),
    metrics: metrics.map((m) => m.value),
  };

  if (dateRange?.from) {
    config.startDate = dateRange.from.toISOString();
    if (dateRange.to) {
      config.endDate = dateRange.to.toISOString();
    }
  }

  const selectedDimensionIds = new Set(config.dimensions);
  const dimensionFilters: Record<string, Array<string | number>> = {};
  for (const [dimId, values] of Object.entries(dimensionValueFilters)) {
    if (!values || values.length === 0) continue;
    if (!selectedDimensionIds.has(dimId)) continue;
    dimensionFilters[dimId] = values.map((v) => v.id);
  }
  if (Object.keys(dimensionFilters).length > 0) {
    config.dimensionFilters = dimensionFilters;
  }

  return config;
}

/**
 * Reads the legacy spelled-out selection from the URL into the same shape a
 * persisted state returns, so both forms share one restore path. Returns
 * null when none of the legacy keys is present.
 */
export function parseLegacyReportUrlParams(
  params: URLSearchParams
): ReportBuilderStateConfig | null {
  const dimensionsParam = params.get("dimensions");
  const metricsParam = params.get("metrics");
  const startDate = params.get("startDate");
  const endDate = params.get("endDate");
  const dimensionFiltersParam = params.get("dimensionFilters");

  if (
    !dimensionsParam &&
    !metricsParam &&
    !startDate &&
    !dimensionFiltersParam
  ) {
    return null;
  }

  const config: ReportBuilderStateConfig = {
    dimensions: dimensionsParam
      ? dimensionsParam.split(",").filter(Boolean)
      : [],
    metrics: metricsParam ? metricsParam.split(",").filter(Boolean) : [],
  };
  if (startDate) {
    config.startDate = startDate;
    if (endDate) config.endDate = endDate;
  }
  const dimensionFilters = parseLegacyDimensionFilters(dimensionFiltersParam);
  if (dimensionFilters) config.dimensionFilters = dimensionFilters;
  return config;
}

/**
 * Legacy `dimensionFilters` param: JSON `{ dimId: [id, ...] }`, where an
 * entry may also be an `{ id }` object from even older URLs. Malformed input
 * yields null (ignored, filters left as they are).
 */
function parseLegacyDimensionFilters(
  raw: string | null
): Record<string, Array<string | number>> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const out: Record<string, Array<string | number>> = {};
    for (const [dimId, values] of Object.entries(parsed)) {
      if (!Array.isArray(values) || values.length === 0) continue;
      const ids = values
        .map((v: unknown) =>
          typeof v === "object" && v !== null ? (v as { id?: unknown }).id : v
        )
        .filter(
          (id): id is string | number =>
            (typeof id === "string" && id !== "") || typeof id === "number"
        );
      if (ids.length === 0) continue;
      out[dimId] = ids;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Fallback writer used only when the state could not be persisted: spells
 * the selection out in the legacy keys so the URL stays restorable.
 */
export function applyLegacyReportUrlParams(
  params: URLSearchParams,
  config: ReportBuilderStateConfig
): void {
  params.set("dimensions", config.dimensions.join(","));
  params.set("metrics", config.metrics.join(","));
  if (config.startDate) {
    params.set("startDate", config.startDate);
    if (config.endDate) {
      params.set("endDate", config.endDate);
    } else {
      params.delete("endDate");
    }
  } else {
    params.delete("startDate");
    params.delete("endDate");
  }
  if (config.dimensionFilters) {
    params.set("dimensionFilters", JSON.stringify(config.dimensionFilters));
  } else {
    params.delete("dimensionFilters");
  }
}

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

export interface ResolveSyncedActiveTabInput {
  /** `tab` param currently in the URL (may be stale mid-navigation). */
  urlTab: string | null;
  /** `reportType` param currently in the URL. */
  urlReportType: string | null;
  /**
   * Tab a just-initiated tab/report change is navigating toward, or null when
   * no navigation is in flight. While set, the URL is briefly stale and must
   * NOT be used to revert the optimistic activeTab.
   */
  pendingTab: string | null;
  /** Current activeTab state. */
  activeTab: string;
  /** IDs of the pre-built (non-builder) reports, for tab inference. */
  preBuiltReportIds: string[];
}

export interface ResolveSyncedActiveTabResult {
  /** Tab to switch to, or null to leave activeTab unchanged. */
  nextTab: string | null;
  /** Whether the in-flight navigation has landed and pendingTab should reset. */
  clearPending: boolean;
}

/**
 * Decide what the tab-sync effect should do, given the URL, the optimistic
 * activeTab, and any in-flight tab navigation.
 *
 * The effect that calls this re-runs on essentially every render (its
 * preBuiltReports dependency is a fresh array each render), so it constantly
 * re-derives activeTab from the URL. That is fine EXCEPT during the window
 * after a tab click: handleTabChange optimistically sets activeTab and fires an
 * async router.replace, so for a few renders the URL still holds the OLD tab.
 * Without a guard the effect reads that stale tab and reverts the click — the
 * "clicked Reports, bounced back to Report Builder" bug.
 *
 * `pendingTab` closes that window: while a navigation is in flight we leave
 * activeTab alone until the URL catches up (urlTab === pendingTab), then clear
 * the pending marker and resume honoring the URL (so browser back/forward still
 * works). Mirrors isUrlInSyncWithReportType, which guards the metadata effect
 * against the same stale-URL window.
 */
export function resolveSyncedActiveTab({
  urlTab,
  urlReportType,
  pendingTab,
  activeTab,
  preBuiltReportIds,
}: ResolveSyncedActiveTabInput): ResolveSyncedActiveTabResult {
  if (pendingTab !== null) {
    // URL has caught up to the tab we navigated to — navigation landed.
    if (urlTab === pendingTab) return { nextTab: null, clearPending: true };
    // Still in flight: the URL is stale, do not revert the optimistic tab.
    return { nextTab: null, clearPending: false };
  }

  if (urlTab) {
    return {
      nextTab: urlTab !== activeTab ? urlTab : null,
      clearPending: false,
    };
  }

  // No tab in URL — infer it from the reportType (pre-built => "reports").
  if (urlReportType) {
    const correctTab = preBuiltReportIds.includes(urlReportType)
      ? "reports"
      : "builder";
    return {
      nextTab: correctTab !== activeTab ? correctTab : null,
      clearPending: false,
    };
  }

  return { nextTab: null, clearPending: false };
}

export interface ResolveTabChangeInput {
  /** Tab being switched to ("reports" | "builder"). */
  newTab: string;
  /** IDs of the pre-built reports (the "reports" tab list). */
  preBuiltReportIds: string[];
  /** IDs of the custom reports (the "builder" tab list). */
  customReportIds: string[];
}

export interface ResolveTabChangeResult {
  tab: string;
  reportType: string;
}

/**
 * Resolve the full target state for a tab switch: the new tab AND a valid
 * default report FOR that tab.
 *
 * Switching tabs must also switch reportType — otherwise the report dropdown
 * and the rendered panel keep showing the previous tab's report (e.g. a custom
 * "test-execution" report still selected and rendered on the pre-built Reports
 * tab). Returns the first report of the target tab's list, falling back to a
 * known default if that list is somehow empty.
 */
export function resolveTabChange({
  newTab,
  preBuiltReportIds,
  customReportIds,
}: ResolveTabChangeInput): ResolveTabChangeResult {
  const targetIds = newTab === "reports" ? preBuiltReportIds : customReportIds;
  const fallback =
    newTab === "reports" ? "automation-trends" : "test-execution";
  const first = targetIds[0];
  const reportType = first && first.trim() !== "" ? first : fallback;
  return { tab: newTab, reportType };
}

export interface ResolveSyncedReportTypeResult {
  /** Report type to set, or null to leave the current one unchanged. */
  nextReportType: string | null;
  /** Whether the in-flight navigation has landed and the marker should reset. */
  clearPending: boolean;
}

/**
 * reportType counterpart to resolveSyncedActiveTab. The reportType-sync effect
 * has the same stale-URL race: it re-runs on essentially every render and would
 * revert an optimistic reportType change off the still-stale URL during the
 * router.replace window. `pendingReportType` closes that window. Only valid
 * report-type IDs from the URL are honored (an unknown ID is ignored).
 */
export function resolveSyncedReportType({
  urlReportType,
  pendingReportType,
  currentReportType,
  validReportTypeIds,
}: {
  urlReportType: string | null;
  pendingReportType: string | null;
  currentReportType: string;
  validReportTypeIds: string[];
}): ResolveSyncedReportTypeResult {
  if (pendingReportType !== null) {
    if (urlReportType === pendingReportType)
      return { nextReportType: null, clearPending: true };
    return { nextReportType: null, clearPending: false };
  }

  if (
    urlReportType &&
    validReportTypeIds.includes(urlReportType) &&
    urlReportType !== currentReportType
  ) {
    return { nextReportType: urlReportType, clearPending: false };
  }

  return { nextReportType: null, clearPending: false };
}
