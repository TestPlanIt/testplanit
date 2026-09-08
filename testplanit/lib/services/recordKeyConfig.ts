import {
  DEFAULT_TYPE_TOKENS,
  resolveTypeTokens,
  type TypeTokenMap,
} from "~/lib/recordKey";
import type { TxClient } from "~/lib/zenstack";

/**
 * System-level configuration for project-prefixed record keys, persisted as
 * two AppConfig rows.
 *
 * Value semantics for {@link RECORD_KEY_ENABLED_KEY}:
 *   - row missing    → disabled (default-off; admin opts in via
 *                      Admin → Record Keys)
 *   - value === true → enabled
 *   - anything else  → disabled
 *
 * Value semantics for {@link RECORD_KEY_TOKENS_KEY}: a JSON object mapping
 * {@link RecordType} → token string (e.g. `{ "TEST_CASE": "TC" }`). Missing or
 * invalid entries fall back to {@link DEFAULT_TYPE_TOKENS} via
 * {@link resolveTypeTokens}.
 */
export const RECORD_KEY_ENABLED_KEY = "record_key_enabled";
export const RECORD_KEY_TOKENS_KEY = "record_key_type_tokens";

/** Read the system-level record-key master switch. Default-off when absent. */
export async function isRecordKeyFeatureEnabled(
  tx: Pick<TxClient, "appConfig">
): Promise<boolean> {
  const row = await tx.appConfig.findUnique({
    where: { key: RECORD_KEY_ENABLED_KEY },
    select: { value: true },
  });
  return row?.value === true;
}

/**
 * Read the admin-configured type-token map, overlaid onto the defaults. Always
 * returns a complete {@link TypeTokenMap}. Safe to call whether or not the
 * config row exists.
 */
export async function readRecordKeyTypeTokens(
  tx: Pick<TxClient, "appConfig">
): Promise<TypeTokenMap> {
  const row = await tx.appConfig.findUnique({
    where: { key: RECORD_KEY_TOKENS_KEY },
    select: { value: true },
  });
  return resolveTypeTokens(row?.value);
}

/**
 * Read both the enabled flag and the token map in one shot. When the feature is
 * disabled, callers should skip key derivation entirely (display the bare id);
 * the tokens are still returned so a disabled→enabled flip needs no reload.
 */
export async function readRecordKeyConfig(
  tx: Pick<TxClient, "appConfig">
): Promise<{ enabled: boolean; tokens: TypeTokenMap }> {
  const [enabled, tokens] = await Promise.all([
    isRecordKeyFeatureEnabled(tx),
    readRecordKeyTypeTokens(tx),
  ]);
  return { enabled, tokens };
}

export { DEFAULT_TYPE_TOKENS };
