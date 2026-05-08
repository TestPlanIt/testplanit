/**
 * Generic Object diff applied to outbound `*.updated` events.
 *
 * The helper computes a top-level field-by-field diff and produces the
 * `{changedFields, before, after}` payload shape that Slack formatters
 * (lib/webhooks/adapters/slack/formatters/) consume to render
 * "Title changed: X → Y" without an API round-trip.
 *
 * SCOPE — what this helper IS:
 *  - A top-level shallow comparison: each property key on the union of
 *    `before` and `after` is compared via deep equality.
 *  - Array reorder is treated as unchanged (cases array fields like `tags`
 *    should not surface as a change when the user only rearranged them).
 *  - Date instances compare by `getTime()`.
 *  - Nested objects are compared deeply (via JSON-shaped equality), but
 *    `changedFields` only contains TOP-LEVEL keys. Slack formatters that
 *    want a deep-path representation (e.g. "Status name: foo→bar") drill
 *    into `before[key]` and `after[key]` themselves.
 *
 * SCOPE — what this helper is NOT:
 *  - Not a structural editor: it does not produce JSON-Patch ops.
 *  - Not a custom-equality framework: callers needing field-by-field
 *    semantics (e.g. "ignore updatedAt") pre-strip those keys before
 *    calling computeObjectDiff.
 */

export interface ObjectDiff<T = Record<string, unknown>> {
  changedFields: string[];
  before: Partial<T>;
  after: Partial<T>;
}

export function computeObjectDiff<T extends Record<string, unknown>>(
  before: T | null | undefined,
  after: T | null | undefined
): ObjectDiff<T> {
  const safeBefore = (before ?? {}) as Record<string, unknown>;
  const safeAfter = (after ?? {}) as Record<string, unknown>;
  const allKeys = new Set([
    ...Object.keys(safeBefore),
    ...Object.keys(safeAfter),
  ]);
  const changedFields: string[] = [];
  const beforeOut: Record<string, unknown> = {};
  const afterOut: Record<string, unknown> = {};
  for (const key of allKeys) {
    const b = safeBefore[key];
    const a = safeAfter[key];
    if (!isEqual(b, a)) {
      changedFields.push(key);
      beforeOut[key] = b;
      afterOut[key] = a;
    }
  }
  return {
    changedFields,
    before: beforeOut as Partial<T>,
    after: afterOut as Partial<T>,
  };
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (a === undefined || b === undefined) return a === b;
  if (a instanceof Date && b instanceof Date)
    return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) return arraysEqualUnordered(a, b);
  if (typeof a === "object" && typeof b === "object") {
    return jsonEqual(a, b);
  }
  // Final fallback uses JSON-stringified equality so two NaN values land in
  // the "equal" bucket (JSON.stringify(NaN) === "null"). This matches the
  // documented "generic helper" contract — emitter sites avoid passing NaN.
  return jsonEqual(a, b);
}

function arraysEqualUnordered(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  // Convert to JSON-stringified, sorted comparison (array reorder = unchanged).
  // Stable for primitive arrays; object arrays compared by JSON shape.
  const ka = a.map((v) => JSON.stringify(v)).sort();
  const kb = b.map((v) => JSON.stringify(v)).sort();
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return false;
  }
  return true;
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
