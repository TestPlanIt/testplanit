import type { ReportBuilderStateConfig } from "~/lib/schemas/reportBuilderStateSchema";

/**
 * Links INTO the Report Builder from outside it: the share page's
 * redirect for signed-in project members, the shared viewer's "View in
 * Full App" button, and the Saved Reports menu. All rebuild the builder
 * from a stored report config (ShareLink.entityConfig, the exact request
 * body of the run), serialized by reportShareParams.ts.
 *
 * The builder's own Run Report keeps its selection in a ReportBuilderState
 * row and puts only `state=<id>` in the URL, because a "Select all" over
 * thousands of filter values made the spelled-out `dimensionFilters` URL
 * longer than ingress accepts (414). A stored config carries that same
 * expanded list, so these producers go through the same row: mint a state
 * for the config's selection, and leave the selection keys out of the URL.
 */

/** The config keys a ReportBuilderState row carries. Every other key stays a URL param. */
export const REPORT_STATE_CONFIG_KEYS = [
  "dimensions",
  "metrics",
  "startDate",
  "endDate",
  "dimensionFilters",
] as const;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * The builder selection inside a stored report config, or null when the
 * config has none to move out of the URL. Pre-built reports (no
 * dimensions) keep their bounded params in the URL as before.
 */
export function reportBuilderStateConfigFromReportConfig(
  config: unknown
): ReportBuilderStateConfig | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return null;
  }
  const source = config as Record<string, unknown>;
  if (!isStringArray(source.dimensions) || source.dimensions.length === 0) {
    return null;
  }

  const stateConfig: ReportBuilderStateConfig = {
    dimensions: source.dimensions,
    metrics: isStringArray(source.metrics) ? source.metrics : [],
  };
  if (typeof source.startDate === "string" && source.startDate) {
    stateConfig.startDate = source.startDate;
  }
  if (typeof source.endDate === "string" && source.endDate) {
    stateConfig.endDate = source.endDate;
  }

  const rawFilters = source.dimensionFilters;
  if (
    rawFilters &&
    typeof rawFilters === "object" &&
    !Array.isArray(rawFilters)
  ) {
    const dimensionFilters: Record<string, Array<string | number>> = {};
    for (const [dimId, values] of Object.entries(rawFilters)) {
      if (!Array.isArray(values)) continue;
      const ids = values.filter(
        (v): v is string | number =>
          typeof v === "string" || typeof v === "number"
      );
      if (ids.length > 0) dimensionFilters[dimId] = ids;
    }
    if (Object.keys(dimensionFilters).length > 0) {
      stateConfig.dimensionFilters = dimensionFilters;
    }
  }

  return stateConfig;
}

export interface MintReportBuilderStateInput {
  projectId?: number | null;
  reportType: string;
  config: ReportBuilderStateConfig;
}

/**
 * Saves a builder selection and returns the row id, or null when it could
 * not be saved (callers then spell the selection out in the URL as before).
 */
export async function mintReportBuilderStateId(
  input: MintReportBuilderStateInput,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  try {
    const response = await fetchImpl("/api/reports/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(input.projectId ? { projectId: input.projectId } : {}),
        reportType: input.reportType,
        config: input.config,
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data?.id === "string" ? data.id : null;
  } catch {
    return null;
  }
}

/**
 * The state id for a stored report config: null when the config has no
 * builder selection, names no report type, or the save failed.
 */
export async function resolveReportBuilderStateId(
  config: unknown,
  projectId: number | null | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  const stateConfig = reportBuilderStateConfigFromReportConfig(config);
  const reportType = (config as { reportType?: unknown } | null)?.reportType;
  if (!stateConfig || typeof reportType !== "string" || !reportType) {
    return null;
  }
  return mintReportBuilderStateId(
    { projectId: projectId ?? null, reportType, config: stateConfig },
    fetchImpl
  );
}
