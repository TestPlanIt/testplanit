/**
 * One selected value in an issue list facet. `null` is the "not set" bucket —
 * issues that carry no value for that field at all (a type only lands on an
 * issue when it is synced or created through an integration, and several
 * providers never supply one, so untyped issues are common).
 */
export type IssueFacetValue = string | null;

/**
 * Where-conditions for the multi-select issue list facets (status, priority,
 * issue type). Each selected value contributes a case-insensitive `equals` —
 * external trackers spell the same value with different casing, and the
 * dropdowns offer one spelling per value (see `useIssueFilterOptions`).
 *
 * Values within a facet are OR'd; the returned conditions are AND'd by the
 * caller, so picking two statuses and one priority means
 * "(status A or status B) and that priority". An empty selection contributes
 * nothing, which is what "no filter" looks like.
 *
 * A `null` selection matches both NULL and empty string, mirroring
 * `useIssueFilterOptions`, which treats a blank value as no value.
 */
export function issueFacetConditions(
  facets: Record<string, IssueFacetValue[]>
): Array<Record<string, unknown>> {
  return Object.entries(facets)
    .filter(([, values]) => values.length > 0)
    .map(([field, values]) => ({
      OR: values.map((value) =>
        value === null
          ? { OR: [{ [field]: null }, { [field]: "" }] }
          : { [field]: { equals: value, mode: "insensitive" as const } }
      ),
    }));
}
