/**
 * Pre-built report filters are multi-select: a body key carries a list of
 * accepted values. The single-value form ("automated", or "all" for no
 * filter) predates that and still arrives from stored share configs and
 * API callers, so both shapes parse to the same result.
 */

/**
 * The accepted values of an enum filter, or null when the filter is
 * inactive (absent, "all", empty, or naming no known value). Unknown
 * values are dropped rather than rejected, matching how the single-value
 * form always treated them.
 */
export function parseEnumFilter<T extends string>(
  raw: unknown,
  allowed: readonly T[]
): T[] | null {
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const accepted = allowed.filter((value) => values.includes(value));
  return accepted.length > 0 ? accepted : null;
}

/**
 * The accepted ids of an id filter, or null when inactive. Accepts one id
 * or a list; anything that is not a positive integer is dropped.
 */
export function parseIdListFilter(raw: unknown): number[] | null {
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const ids = [
    ...new Set(
      values.map(Number).filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];
  return ids.length > 0 ? ids : null;
}

/**
 * The case `automated` flag an Automated/Manual filter selects, or null when
 * it selects both or neither — either way, no restriction.
 */
export function automatedFlagFilter(raw: unknown): boolean | null {
  const selected = parseEnumFilter(raw, ["automated", "manual"] as const);
  return selected?.length === 1 ? selected[0] === "automated" : null;
}
