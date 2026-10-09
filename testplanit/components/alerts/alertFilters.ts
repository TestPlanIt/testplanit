/**
 * Alert list filter state, kept apart from the UI so the semantics can be
 * reasoned about (and tested) on their own. Each attribute is a three-way
 * choice: "all" leaves it alone, "on" and "off" keep only matching rows.
 */
export type AlertTriState = "all" | "on" | "off";

export interface AlertFilters {
  enabled: AlertTriState;
  notifyMe: AlertTriState;
  /** Creator user ids to keep; empty means everyone. */
  createdBy: string[];
}

export const EMPTY_ALERT_FILTERS: AlertFilters = {
  enabled: "all",
  notifyMe: "all",
  createdBy: [],
};

export const ALERT_FILTERS_STORAGE_KEY = "tpi.alerts.filters";

/** Whether the list is narrowed at all — drives the "no matches" copy. */
export function isAnyAlertFilterActive(filters: AlertFilters): boolean {
  return (
    filters.enabled !== "all" ||
    filters.notifyMe !== "all" ||
    filters.createdBy.length > 0
  );
}

function matchesTriState(state: AlertTriState, value: boolean): boolean {
  return state === "all" || (state === "on") === value;
}

export function applyAlertFilters<
  T extends { isEnabled: boolean; createdById: string },
>(rows: T[], filters: AlertFilters, isFollowing: (row: T) => boolean): T[] {
  return rows.filter(
    (row) =>
      matchesTriState(filters.enabled, row.isEnabled) &&
      matchesTriState(filters.notifyMe, isFollowing(row)) &&
      (filters.createdBy.length === 0 ||
        filters.createdBy.includes(row.createdById))
  );
}

const toTriState = (value: unknown): AlertTriState =>
  value === "on" || value === "off" ? value : "all";

/**
 * Reads persisted filters, tolerating anything the key might hold: absent,
 * unparseable, or a stale shape from an older build. Every field is coerced
 * rather than trusted, so a bad value degrades to "all".
 */
export function parseStoredAlertFilters(stored: string | null): AlertFilters {
  if (!stored) return EMPTY_ALERT_FILTERS;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") return EMPTY_ALERT_FILTERS;
    const value = parsed as Partial<Record<keyof AlertFilters, unknown>>;
    return {
      enabled: toTriState(value.enabled),
      notifyMe: toTriState(value.notifyMe),
      createdBy: Array.isArray(value.createdBy)
        ? value.createdBy.filter((id): id is string => typeof id === "string")
        : [],
    };
  } catch {
    return EMPTY_ALERT_FILTERS;
  }
}
