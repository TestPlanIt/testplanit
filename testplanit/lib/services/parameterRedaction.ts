/**
 * Schema entry for a single parameter declared on a test case.
 *
 * Only the fields the redaction helper needs are required. The full row in
 * the database has many more columns (id, type, defaultValue, ...), but the
 * helper is intentionally narrow so callers can construct fixtures cheaply
 * (audit-log, webhook payload, iteration drill-down UI all consume this
 * primitive in later phases).
 */
export interface ParameterSchemaEntry {
  name: string;
  sensitive: boolean;
}

/**
 * The redaction sentinel string. Matches the existing audit-log convention
 * in lib/services/auditLog.ts so downstream consumers (audit rows, webhook
 * payloads, UI redacted-value badges) all render the same token.
 */
const REDACTION_SENTINEL = "[REDACTED]";

/**
 * Returns a copy of `values` with sensitive parameter values replaced by
 * "[REDACTED]" when the viewer lacks the read-sensitive permission.
 *
 * Behavior:
 * - viewerCanReadSensitive === true  -> all entries pass through unchanged.
 * - viewerCanReadSensitive === false -> for each (key, value) in values:
 *     * If a matching schema entry has sensitive === true, the value is
 *       replaced by "[REDACTED]".
 *     * If a matching schema entry has sensitive === false, the original
 *       value is preserved.
 *     * If no matching schema entry exists (unknown parameter name), the
 *       original value is preserved (defensive fall-through per RESEARCH.md
 *       Q5; Phase 3 schema validation guards against unknowns reaching
 *       audit metadata in the first place).
 *
 * The function is pure: it does not perform I/O, mutate its inputs, or
 * import Prisma / ZenStack / React. This keeps it consumable from workers,
 * server actions, and the Edge runtime alike.
 *
 * Used by:
 * - Phase 3 audit-log integration (call before captureAuditEvent)
 * - Phase 3 iteration drill-down UI
 * - Phase 6 webhook payload generation
 *
 * @param values                   Iteration values map (e.g., the snapshot
 *                                 stored in TestRunCaseIteration.valuesJson).
 * @param paramSchema              Per-case parameter schema (name + sensitive).
 * @param viewerCanReadSensitive   Whether the viewer is permitted to see
 *                                 plaintext for sensitive entries.
 * @returns                        A new values map with sensitive entries
 *                                 redacted as appropriate. The input is
 *                                 never mutated.
 */
export function redactValues(
  values: Record<string, unknown>,
  paramSchema: ParameterSchemaEntry[],
  viewerCanReadSensitive: boolean,
): Record<string, unknown> {
  if (viewerCanReadSensitive) {
    return { ...values };
  }
  const sensitiveSet = new Set(
    paramSchema.filter((p) => p.sensitive).map((p) => p.name),
  );
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    out[k] = sensitiveSet.has(k) ? REDACTION_SENTINEL : v;
  }
  return out;
}
