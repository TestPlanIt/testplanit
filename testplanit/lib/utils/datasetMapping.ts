/**
 * Dataset column → parameter mapping.
 *
 * Pure helper. No Prisma, no React, no I/O. Safe to bundle into client code.
 *
 * Used by:
 *   - Server: `lib/services/iterationFanOut.ts` re-exports `applyMapping` and
 *     `SKIP_SENTINEL` so existing snapshot-resolver imports do not have to
 *     learn a new module path.
 *   - Client: read-only mapped views import directly from this module so the
 *     bundler does NOT pull `iterationFanOut.ts` (and its Prisma type imports)
 *     into the client bundle.
 *
 * The mapping maps source-dataset COLUMN names → case PARAMETER names. The
 * `SKIP_SENTINEL` value lets a column be explicitly excluded from the mapped
 * output without having to drop it from the mapping object.
 */

/**
 * Reserved value used in `mapping[columnName]` to indicate "drop this column
 * from the mapped output even though it exists in the raw row".
 */
export const SKIP_SENTINEL = "__skip__" as const;

/**
 * Project the columns of `rawRow` onto parameter names according to `mapping`.
 *
 * - Iterates `Object.entries(mapping)` so prototype keys (e.g., `__proto__`)
 *   that the caller did NOT explicitly enumerate cannot leak through.
 * - Uses `Object.prototype.hasOwnProperty.call` (NOT the `in` operator) when
 *   reading from `rawRow`, so prototype-pollution attempts via crafted
 *   column names cannot escalate into the output object.
 * - Skips any mapping whose value is `SKIP_SENTINEL`.
 * - Skips any mapping whose source column is missing from the raw row (no
 *   `undefined` written into the output).
 */
export function applyMapping(
  rawRow: Record<string, unknown>,
  mapping: Record<string, string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [columnName, paramName] of Object.entries(mapping)) {
    if (paramName === SKIP_SENTINEL) continue;
    if (Object.prototype.hasOwnProperty.call(rawRow, columnName)) {
      out[paramName] = rawRow[columnName];
    }
  }
  return out;
}

/**
 * Build an initial column → parameter mapping by case-insensitive name match.
 *
 * Mirrors the auto-map heuristic in `components/parameters/wizard/MapColumnsStep.tsx`
 * so the CSV-import wizard and the shared-dataset assignment dialog stay in
 * vocabulary-sync. Columns with no matching parameter are mapped to
 * `SKIP_SENTINEL` so the result is a complete projection (every column is
 * accounted for).
 *
 * Pure function. Safe to bundle into client code.
 */
export function autoMapColumns(
  columns: string[],
  parameters: { name: string }[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const column of columns) {
    const match = parameters.find(
      (p) => p.name.toLowerCase() === column.toLowerCase()
    );
    out[column] = match ? match.name : SKIP_SENTINEL;
  }
  return out;
}

/**
 * Required parameters whose name is NOT the target of any non-skip column
 * mapping. Used to gate "Save" in the assignment dialog and to render the
 * red-border hint on individual mapping rows.
 *
 * Pure function. Safe to bundle into client code.
 */
export function findUnmappedRequiredParameters(
  mapping: Record<string, string>,
  parameters: { name: string; required: boolean }[]
): { name: string }[] {
  const mappedParamNames = new Set(
    Object.values(mapping).filter((v) => v !== SKIP_SENTINEL)
  );
  return parameters
    .filter((p) => p.required && !mappedParamNames.has(p.name))
    .map((p) => ({ name: p.name }));
}
