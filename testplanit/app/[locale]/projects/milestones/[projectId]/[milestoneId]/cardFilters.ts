/**
 * Filter state for the milestone detail page's Test Runs and Sessions cards.
 *
 * Two independent controls rather than one four-way choice: status is
 * one-of-three (a run is either active or completed, never both), while
 * "mine" cuts across both — folding it in as a fourth status would make
 * "my active runs" unreachable.
 */
export type CardStatusFilter = "all" | "active" | "completed";

export interface CardFilters {
  status: CardStatusFilter;
  mine: boolean;
}

export const EMPTY_CARD_FILTERS: CardFilters = {
  status: "all",
  mine: false,
};

export const CARD_STATUS_FILTERS: readonly CardStatusFilter[] = [
  "all",
  "active",
  "completed",
] as const;

export const runsCardFiltersStorageKey = (milestoneId: string | number) =>
  `tpi.milestone.${milestoneId}.testRuns.filters`;

export const sessionsCardFiltersStorageKey = (milestoneId: string | number) =>
  `tpi.milestone.${milestoneId}.sessions.filters`;

/** Whether the card is narrowed at all — drives the "no matches" copy. */
export function isAnyCardFilterActive(filters: CardFilters): boolean {
  return filters.status !== "all" || filters.mine;
}

/**
 * Applies the status half of the filter. Membership ("mine") is resolved by
 * the caller, which owns the definition per entity type.
 */
export function matchesCardStatus(
  filters: CardFilters,
  isCompleted: boolean
): boolean {
  if (filters.status === "active") return !isCompleted;
  if (filters.status === "completed") return isCompleted;
  return true;
}

/**
 * Reads persisted filters, tolerating anything the key might hold: absent,
 * unparseable, or a stale shape from an older build. Every field is coerced
 * rather than trusted, so a bad value degrades to "unfiltered" instead of
 * hiding rows for a reason the user can't see.
 */
export function parseStoredCardFilters(stored: string | null): CardFilters {
  if (!stored) return EMPTY_CARD_FILTERS;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") return EMPTY_CARD_FILTERS;
    const value = parsed as Partial<CardFilters>;
    return {
      status: CARD_STATUS_FILTERS.includes(value.status as CardStatusFilter)
        ? (value.status as CardStatusFilter)
        : "all",
      mine: value.mine === true,
    };
  } catch {
    return EMPTY_CARD_FILTERS;
  }
}
