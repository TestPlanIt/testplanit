/**
 * The share-redirect parameter contract.
 *
 * An AUTHENTICATED share (and the shared viewer's "View in Full App"
 * button) redirects a project member from /share/:key to the Reports
 * page, carrying the stored report configuration
 * (ShareLink.entityConfig — the exact request body of the run that was
 * shared) as URL params. ReportBuilder then rebuilds the same report
 * from those params.
 *
 * Both halves of that round trip live here — the serializer the share
 * surfaces use, and the parser ReportBuilder hydrates its per-type
 * state from — so a new report parameter joins the contract in one
 * place and the two directions cannot drift apart.
 */

/** Matches ReportBuilder's local getBaseReportType (cross-project variants). */
function baseReportType(reportType: string): string {
  return reportType.replace(/^cross-project-/, "");
}

/**
 * Keys that must not become URL params: the redirect target's path
 * already carries the project id.
 */
const OMITTED_CONFIG_KEYS = new Set(["projectId"]);

/**
 * The iteration-matrix preset keeps its filters in URL state
 * (useMatrixFilters), so its share config stores one `filters` object
 * instead of riding lastRequestBody. Map its fields onto the exact
 * param names the matrix page reads — the id lists as repeated params.
 */
const MATRIX_FILTER_PARAMS: Array<{
  filterKey: string;
  paramName: string;
  repeated: boolean;
}> = [
  { filterKey: "statusIds", paramName: "status", repeated: true },
  { filterKey: "configIds", paramName: "config", repeated: true },
  { filterKey: "datasetIds", paramName: "dataset", repeated: true },
  { filterKey: "dateFrom", paramName: "startDate", repeated: false },
  { filterKey: "dateTo", paramName: "endDate", repeated: false },
];

function isScalar(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/**
 * Serialize a stored share config into Reports-page URL params.
 *
 * Every config key is carried — scalars as strings, all-scalar arrays
 * comma-joined (the split(",") shapes the hydrators expect), anything
 * else (objects, arrays containing null/objects) as JSON so no value is
 * mangled. Nothing is enumerated per report type: a parameter added to
 * a report's request body reaches the redirect automatically.
 */
export function buildSharedReportSearchParams(
  config: unknown
): URLSearchParams {
  const params = new URLSearchParams();
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return params;
  }

  for (const [key, value] of Object.entries(
    config as Record<string, unknown>
  )) {
    if (OMITTED_CONFIG_KEYS.has(key) || value == null || value === "") {
      continue;
    }

    if (
      key === "filters" &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      const filters = value as Record<string, unknown>;
      for (const { filterKey, paramName, repeated } of MATRIX_FILTER_PARAMS) {
        const filterValue = filters[filterKey];
        if (filterValue == null) continue;
        if (repeated && Array.isArray(filterValue)) {
          for (const item of filterValue) {
            if (item != null) params.append(paramName, String(item));
          }
        } else if (!repeated && isScalar(filterValue)) {
          params.set(paramName, String(filterValue));
        }
      }
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      params.set(
        key,
        value.every(isScalar) ? value.join(",") : JSON.stringify(value)
      );
      continue;
    }

    if (typeof value === "object") {
      if (Object.keys(value).length === 0) continue;
      params.set(key, JSON.stringify(value));
      continue;
    }

    params.set(key, String(value));
  }

  return params;
}

/** The subset of URLSearchParams both directions of the contract need. */
interface ReadableSearchParams {
  get(name: string): string | null;
}

export type AutomatedFilterValue = "all" | "automated" | "manual";
export type HealthStatusFilterValue =
  "all" | "healthy" | "never_executed" | "always_passing" | "always_failing";
export type HealthStaleFilterValue = "all" | "stale" | "notStale";
export type DateGroupingValue =
  "daily" | "weekly" | "monthly" | "quarterly" | "annually";
export type RequirementCoverageStateValue =
  "PASSED" | "FAILED" | "NOT_RUN" | "UNCOVERED";

/**
 * The per-type state ReportBuilder initializes from the URL. Every
 * field carries its control's default when the param is absent or
 * invalid, so the parser's output can seed state unconditionally.
 */
export interface PerTypeReportUrlState {
  consecutiveRuns: number;
  flipThreshold: number;
  flakyAutomatedFilter: AutomatedFilterValue;
  staleDaysThreshold: number;
  minExecutionsForRate: number;
  lookbackDays: number;
  healthAutomatedFilter: AutomatedFilterValue;
  healthStatusFilter: HealthStatusFilterValue;
  healthStaleFilter: HealthStaleFilterValue;
  requirementIds: number[];
  requirementCoverageStates: RequirementCoverageStateValue[];
  /** Gaps/traceability execution scope (milestone/configuration) — the
   * frame the coverage numbers count under. Empty = axis inactive. */
  requirementMilestoneIds: number[];
  requirementConfigIds: number[];
  includeNotRunDebt: boolean;
  /** Gaps/traceability: the persisted snapshot to render; null = live. */
  requirementSnapshotId: number | null;
  /** Coverage changes: the baseline snapshot (required to run) and what
   * to compare it to (null = the live matrix). */
  baselineSnapshotId: number | null;
  compareSnapshotId: number | null;
  includeUnchanged: boolean;
  dateGrouping: DateGroupingValue;
  trendsFilterValues: Record<string, Array<string | number>>;
}

export const PER_TYPE_REPORT_PARAM_DEFAULTS: PerTypeReportUrlState = {
  consecutiveRuns: 10,
  flipThreshold: 5,
  flakyAutomatedFilter: "all",
  staleDaysThreshold: 30,
  minExecutionsForRate: 5,
  lookbackDays: 90,
  healthAutomatedFilter: "all",
  healthStatusFilter: "all",
  healthStaleFilter: "all",
  requirementIds: [],
  requirementCoverageStates: [],
  requirementMilestoneIds: [],
  requirementConfigIds: [],
  // ON by default (operator direction 2026-08-30): never-run linked
  // cases are as evidence-free as true gaps, so the debt report opens
  // complete. The run body always sends the explicit boolean, so a
  // share made with it off restores off.
  includeNotRunDebt: true,
  requirementSnapshotId: null,
  baselineSnapshotId: null,
  compareSnapshotId: null,
  includeUnchanged: false,
  dateGrouping: "weekly",
  trendsFilterValues: {},
};

const AUTOMATED_FILTER_VALUES: readonly AutomatedFilterValue[] = [
  "all",
  "automated",
  "manual",
];
const HEALTH_STATUS_FILTER_VALUES: readonly HealthStatusFilterValue[] = [
  "all",
  "healthy",
  "never_executed",
  "always_passing",
  "always_failing",
];
const HEALTH_STALE_FILTER_VALUES: readonly HealthStaleFilterValue[] = [
  "all",
  "stale",
  "notStale",
];
const DATE_GROUPING_VALUES: readonly DateGroupingValue[] = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "annually",
];
const REQUIREMENT_COVERAGE_STATE_VALUES: readonly RequirementCoverageStateValue[] =
  ["PASSED", "FAILED", "NOT_RUN", "UNCOVERED"];

/** Mirrors the server's requirementIds cap (reportRequestSchema). */
const MAX_REQUIREMENT_SCOPE_IDS = 1000;

/** Mirrors the server's per-axis execution-scope cap
 * (lib/services/executionScopeParam.ts). */
const MAX_EXECUTION_SCOPE_IDS = 200;

function positiveIntParam(
  params: ReadableSearchParams,
  name: string,
  fallback: number
): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** A positive-integer id param whose absence (or garbage) means "none". */
function optionalIdParam(
  params: ReadableSearchParams,
  name: string
): number | null {
  const raw = params.get(name);
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function enumParam<T extends string>(
  params: ReadableSearchParams,
  name: string,
  allowed: readonly T[],
  fallback: T
): T {
  const raw = params.get(name);
  return raw !== null && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : fallback;
}

function booleanParam(
  params: ReadableSearchParams,
  name: string,
  fallback: boolean
): boolean {
  const raw = params.get(name);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

/**
 * Parse a serialized value list — comma-joined ("1,2,3") or, when the
 * source array contained nulls/objects, JSON ("[1,null]"). Members that
 * parse as finite numbers come back numeric so they compare equal to
 * the filter options' ids.
 */
function valueListParam(
  params: ReadableSearchParams,
  name: string
): Array<string | number> | null {
  const raw = params.get(name);
  if (raw === null || raw === "") return null;
  let members: unknown[];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      members = parsed;
    } catch {
      return null;
    }
  } else {
    members = raw.split(",");
  }
  const values = members
    .filter(
      (member): member is string | number | boolean | null =>
        isScalar(member) || member === null
    )
    .map((member) => {
      if (typeof member === "string" && member.trim() !== "") {
        const numeric = Number(member);
        return Number.isFinite(numeric) ? numeric : member;
      }
      return member as string | number;
    });
  return values.length > 0 ? values : null;
}

function idListParam(
  params: ReadableSearchParams,
  name: string,
  max: number
): number[] {
  const values = valueListParam(params, name);
  if (!values) return [];
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const value of values) {
    const id = typeof value === "number" ? value : Number(value);
    if (Number.isInteger(id) && id > 0 && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
    if (ids.length >= max) break;
  }
  return ids;
}

/**
 * Parse the per-type report params out of the mounted URL.
 *
 * Gated by report type: a param only hydrates the state its type owns
 * (the flaky and health presets share the `automatedFilter` body key,
 * and a stale param from another type must not leak into this one's
 * controls). Absent or invalid params fall back to the control
 * defaults, so the result seeds state unconditionally.
 */
export function parsePerTypeReportParams(
  params: ReadableSearchParams,
  reportType: string
): PerTypeReportUrlState {
  const state: PerTypeReportUrlState = {
    ...PER_TYPE_REPORT_PARAM_DEFAULTS,
    requirementIds: [],
    requirementCoverageStates: [],
    requirementMilestoneIds: [],
    requirementConfigIds: [],
    trendsFilterValues: {},
  };
  const base = baseReportType(reportType);

  if (base === "flaky-tests") {
    state.consecutiveRuns = positiveIntParam(
      params,
      "consecutiveRuns",
      state.consecutiveRuns
    );
    const flipThreshold = positiveIntParam(
      params,
      "flipThreshold",
      state.flipThreshold
    );
    // The control caps the threshold below the run count.
    state.flipThreshold = Math.min(flipThreshold, state.consecutiveRuns - 1);
    state.flakyAutomatedFilter = enumParam(
      params,
      "automatedFilter",
      AUTOMATED_FILTER_VALUES,
      state.flakyAutomatedFilter
    );
  }

  if (base === "test-case-health") {
    state.staleDaysThreshold = positiveIntParam(
      params,
      "staleDaysThreshold",
      state.staleDaysThreshold
    );
    state.minExecutionsForRate = positiveIntParam(
      params,
      "minExecutionsForRate",
      state.minExecutionsForRate
    );
    state.lookbackDays = positiveIntParam(
      params,
      "lookbackDays",
      state.lookbackDays
    );
    state.healthAutomatedFilter = enumParam(
      params,
      "automatedFilter",
      AUTOMATED_FILTER_VALUES,
      state.healthAutomatedFilter
    );
    state.healthStatusFilter = enumParam(
      params,
      "healthStatusFilter",
      HEALTH_STATUS_FILTER_VALUES,
      state.healthStatusFilter
    );
    state.healthStaleFilter = enumParam(
      params,
      "staleFilter",
      HEALTH_STALE_FILTER_VALUES,
      state.healthStaleFilter
    );
  }

  if (
    base === "requirement-coverage-gaps" ||
    base === "requirement-traceability" ||
    base === "requirement-coverage-changes"
  ) {
    state.requirementIds = idListParam(
      params,
      "requirementIds",
      MAX_REQUIREMENT_SCOPE_IDS
    );
  }
  if (
    base === "requirement-coverage-gaps" ||
    base === "requirement-traceability"
  ) {
    state.requirementSnapshotId = optionalIdParam(params, "snapshotId");
    // The execution scope only ever rides a LIVE run's body (the server
    // refuses it beside a snapshotId), so restoring both is safe: the
    // builder ignores the scope while a snapshot is selected.
    state.requirementMilestoneIds = idListParam(
      params,
      "milestoneIds",
      MAX_EXECUTION_SCOPE_IDS
    );
    state.requirementConfigIds = idListParam(
      params,
      "configIds",
      MAX_EXECUTION_SCOPE_IDS
    );
  }
  if (base === "requirement-coverage-changes") {
    state.baselineSnapshotId = optionalIdParam(params, "baselineSnapshotId");
    state.compareSnapshotId = optionalIdParam(params, "compareSnapshotId");
    state.includeUnchanged = booleanParam(
      params,
      "includeUnchanged",
      state.includeUnchanged
    );
  }
  if (base === "requirement-traceability") {
    const rawStates = valueListParam(params, "coverageStates") ?? [];
    state.requirementCoverageStates = rawStates.filter(
      (value): value is RequirementCoverageStateValue =>
        typeof value === "string" &&
        (REQUIREMENT_COVERAGE_STATE_VALUES as readonly string[]).includes(value)
    );
  }
  if (base === "requirement-coverage-gaps") {
    state.includeNotRunDebt = booleanParam(
      params,
      "includeNotRun",
      state.includeNotRunDebt
    );
  }

  if (base === "automation-trends") {
    state.dateGrouping = enumParam(
      params,
      "dateGrouping",
      DATE_GROUPING_VALUES,
      state.dateGrouping
    );
    // The reverse of the run body's selectedFilterValues mapping.
    const filterValues: Record<string, Array<string | number>> = {};
    const simpleFilters: Array<[string, string]> = [
      ["projectIds", "projects"],
      ["templateIds", "templates"],
      ["stateIds", "states"],
      ["automated", "automated"],
    ];
    for (const [paramName, filterKey] of simpleFilters) {
      const values = valueListParam(params, paramName);
      if (values) filterValues[filterKey] = values;
    }
    const dynamicRaw = params.get("dynamicFieldFilters");
    if (dynamicRaw) {
      try {
        const parsed = JSON.parse(dynamicRaw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const [fieldId, values] of Object.entries(parsed)) {
            if (!Array.isArray(values) || values.length === 0) continue;
            const scalars = values.filter(
              (member): member is string | number =>
                typeof member === "string" || typeof member === "number"
            );
            if (scalars.length > 0) {
              filterValues[`dynamic_${fieldId}`] = scalars;
            }
          }
        }
      } catch {
        // Malformed param — leave the dynamic filters unset.
      }
    }
    state.trendsFilterValues = filterValues;
  }

  return state;
}
