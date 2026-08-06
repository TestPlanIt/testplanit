/**
 * Test-run list filter state, kept apart from the chip UI so the semantics
 * below can be reasoned about (and tested) on their own.
 *
 * Manual and Automated are independent toggles rather than one three-way
 * control: "neither" and "both" then mean the same thing — show every run —
 * which makes turning a chip back off the obvious way to an unfiltered list.
 */
export interface RunFilters {
  manual: boolean;
  automated: boolean;
  mine: boolean;
}

export const EMPTY_RUN_FILTERS: RunFilters = {
  manual: false,
  automated: false,
  mine: false,
};

export const runFiltersStorageKey = (projectId: string | number) =>
  `tpi.runs.${projectId}.filters`;

/** Collapses the two type chips onto the run-type value both tabs query with. */
export function runTypeFilterFor(
  filters: RunFilters
): "both" | "manual" | "automated" {
  if (filters.manual === filters.automated) return "both";
  return filters.manual ? "manual" : "automated";
}

/** Whether the list is narrowed at all — drives the "no matches" copy. */
export function isAnyRunFilterActive(filters: RunFilters): boolean {
  return runTypeFilterFor(filters) !== "both" || filters.mine;
}

/**
 * Reads persisted filters, tolerating anything the key might hold: absent,
 * unparseable, or a stale shape from an older build. Every field is coerced
 * rather than trusted, so a bad value degrades to "off" instead of poisoning
 * the query with a non-boolean.
 */
export function parseStoredRunFilters(stored: string | null): RunFilters {
  if (!stored) return EMPTY_RUN_FILTERS;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") return EMPTY_RUN_FILTERS;
    const value = parsed as Partial<RunFilters>;
    return {
      manual: value.manual === true,
      automated: value.automated === true,
      mine: value.mine === true,
    };
  } catch {
    return EMPTY_RUN_FILTERS;
  }
}
