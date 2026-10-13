/**
 * Which flagged Code Pins a stale cleanup removes. Kept free of server
 * imports because the settings page (a client component) counts by the same
 * rule.
 */

/** Pin sources the repository itself maintains; a stale check never removes them. */
export const MANAGED_PIN_SOURCES = ["ANNOTATION", "MAPFILE"] as const;

/** The filter the cleanup removes and the settings page counts. */
export function removableStalePinsWhere(configId: number) {
  return {
    configId,
    isDeleted: false,
    staleReason: { not: null },
    staleDismissedAt: null,
    source: { notIn: [...MANAGED_PIN_SOURCES] },
  };
}
