/**
 * Ordering rule for sorting cases by a Dropdown custom field: cases follow the
 * admin-defined order of the field's options (FieldOptions.order), not the
 * option ids or names. Pure so it can be exercised directly; the queries live
 * with the server action (app/actions/caseIdsByFieldOption.ts).
 */

/**
 * A Dropdown value is the selected FieldOption id, stored in a Json column as
 * a number or (from older writes and imports) a numeric string. Anything else
 * — arrays (Multi-Select), objects, non-numeric strings — reads as "no
 * selection".
 */
function toOptionId(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

export function sortCaseIdsByFieldOptionOrder(
  caseIds: number[],
  values: { testCaseId: number; value: unknown }[],
  options: { id: number; order: number; name: string }[],
  direction: "asc" | "desc"
): number[] {
  const optionById = new Map(options.map((o) => [o.id, o]));
  const optionByCase = new Map<number, (typeof options)[number]>();
  for (const row of values) {
    const optionId = toOptionId(row.value);
    if (optionId === null) continue;
    const option = optionById.get(optionId);
    if (option) optionByCase.set(row.testCaseId, option);
  }

  const sign = direction === "asc" ? 1 : -1;
  return [...caseIds].sort((a, b) => {
    const left = optionByCase.get(a);
    const right = optionByCase.get(b);
    if (!left && !right) return a - b;
    // A case with no selection (or a stale option id) sorts after every case
    // with one, regardless of direction — same rule the latest-results sort
    // applies to never-executed cases.
    if (!left) return 1;
    if (!right) return -1;
    if (left.order !== right.order) return sign * (left.order - right.order);
    // Options sharing an order value: fall back to a tiebreak the user can
    // see, then to ids for determinism.
    if (left.name !== right.name) {
      return sign * left.name.localeCompare(right.name);
    }
    if (left.id !== right.id) return sign * (left.id - right.id);
    return a - b;
  });
}
