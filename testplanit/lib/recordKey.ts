/**
 * Project-prefixed record keys.
 *
 * A record key like `PROJECT-TC-1234` is a purely cosmetic decoration of a
 * record's existing numeric `id`. It tells a reader at a glance which project a
 * record belongs to (`PROJECT`) and what kind of record it is (`TC` = test
 * case) — while the number (`1234`) remains the canonical, immutable global
 * `id`. Nothing is sequenced per project and nothing is stored: keys are
 * derived on read and parsed leniently so that anywhere an id is accepted, the
 * prefixed form and the bare id resolve to the same record.
 *
 * Two config inputs feed the derivation:
 *   - `Projects.key`         — the per-project prefix (e.g. `PROJECT`), optional.
 *   - the system token map   — record type → token (e.g. TEST_CASE → `TC`),
 *                              admin-overridable, defaults below.
 */

/**
 * Canonical record types that can carry a cosmetic project-prefixed key. Chosen
 * from the user-facing, per-project entities that are referenced by numeric id
 * across TestPlanIt's URLs, exports, webhooks, and audit trail. The routed
 * subset (test case, run, session, milestone, tag, data set) also participates
 * in symmetric URL lookup; the rest are display-only (results, issues, shared
 * steps have no standalone `[id]` route).
 */
export const RECORD_TYPES = {
  TEST_CASE: "TEST_CASE",
  TEST_RUN: "TEST_RUN",
  SESSION: "SESSION",
  MILESTONE: "MILESTONE",
  RESULT: "RESULT",
  DATASET: "DATASET",
  TAG: "TAG",
  SHARED_STEPS: "SHARED_STEPS",
  ISSUE: "ISSUE",
} as const;

export type RecordType = (typeof RECORD_TYPES)[keyof typeof RECORD_TYPES];

/** Stable, ordered list of the record types (handy for config UIs). */
export const RECORD_TYPE_LIST: readonly RecordType[] = [
  RECORD_TYPES.TEST_CASE,
  RECORD_TYPES.TEST_RUN,
  RECORD_TYPES.SESSION,
  RECORD_TYPES.MILESTONE,
  RECORD_TYPES.RESULT,
  RECORD_TYPES.DATASET,
  RECORD_TYPES.TAG,
  RECORD_TYPES.SHARED_STEPS,
  RECORD_TYPES.ISSUE,
];

/**
 * Default, admin-overridable type tokens. Tokens are uppercase and contain no
 * hyphens (hyphen is the key separator). Two-letter tokens follow the qTest /
 * Zephyr convention of a short mnemonic per artifact type.
 */
export const DEFAULT_TYPE_TOKENS: Readonly<Record<RecordType, string>> = {
  TEST_CASE: "TC",
  TEST_RUN: "TR",
  SESSION: "SN",
  MILESTONE: "MS",
  RESULT: "RS",
  DATASET: "DS",
  TAG: "TG",
  SHARED_STEPS: "SS",
  ISSUE: "IS",
};

export type TypeTokenMap = Record<RecordType, string>;

/**
 * Validation shape for a project key: uppercase letters only, 2–10 chars (e.g.
 * `PROJECT`, `PAY`, `RETAIL`). Digits are disallowed so the only number in a key
 * is the record's id — `PAY2-TC-1234` would read confusingly. Lowercase input is
 * normalized to uppercase before validation via {@link normalizeProjectKey}.
 */
export const PROJECT_KEY_REGEX = /^[A-Z]{2,10}$/;

/** Validation shape for a single type token: 1–6 uppercase letters (no digits). */
export const TYPE_TOKEN_REGEX = /^[A-Z]{1,6}$/;

/**
 * Normalize raw user input for a project key: trim + uppercase. Returns `null`
 * for empty input so callers can clear the field. Does not validate — pair with
 * {@link isValidProjectKey}.
 */
export function normalizeProjectKey(
  input: string | null | undefined
): string | null {
  if (input == null) return null;
  const s = input.trim().toUpperCase();
  return s === "" ? null : s;
}

export function isValidProjectKey(key: string): boolean {
  return PROJECT_KEY_REGEX.test(key);
}

/**
 * Sanitize raw keystrokes for a project code or type-token field: drop anything
 * that isn't a letter and uppercase the rest. Used in input `onChange` so users
 * simply cannot type digits or symbols into a prefix.
 */
export function sanitizeKeyInput(input: string): string {
  return input.replace(/[^A-Za-z]/g, "").toUpperCase();
}

/**
 * Suggest a project code from a project's (possibly long) name, following the
 * familiar Jira-style heuristic: initials for a multi-word name
 * ("Mobile Banking App" → "MBA"), or the leading letters of a single word
 * ("Web" → "WEB"). Only letters are considered; the result is uppercase and
 * clamped to the valid 2–10 length. Returns "" when no valid code can be formed
 * (e.g. a name with no letters), so callers can fall back to a generic hint.
 */
export function suggestProjectKey(name: string | null | undefined): string {
  const words = (name ?? "")
    .split(/[\s_./\\-]+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ""))
    .filter(Boolean);
  if (words.length === 0) return "";

  let code = words.length >= 2 ? words.map((w) => w[0]).join("") : words[0];
  code = code.toUpperCase().slice(0, 10);

  // A multi-word acronym can still be too short (e.g. a single usable word);
  // fall back to the leading letters of the concatenated words.
  if (code.length < 2) {
    code = words.join("").toUpperCase().slice(0, 3);
  }
  return code.length >= 2 ? code : "";
}

/** Normalize a raw type-token input: trim + uppercase (no emptiness handling). */
export function normalizeTypeToken(input: string): string {
  return input.trim().toUpperCase();
}

export function isValidTypeToken(token: string): boolean {
  return TYPE_TOKEN_REGEX.test(token);
}

/**
 * Merge a partial/untrusted token map (e.g. an AppConfig JSON value) over the
 * defaults, keeping only valid tokens. Always returns a complete map so callers
 * never have to null-check individual types.
 */
export function resolveTypeTokens(raw: unknown): TypeTokenMap {
  const tokens: TypeTokenMap = { ...DEFAULT_TYPE_TOKENS };
  if (raw && typeof raw === "object") {
    for (const type of RECORD_TYPE_LIST) {
      const value = (raw as Record<string, unknown>)[type];
      if (typeof value === "string") {
        const normalized = normalizeTypeToken(value);
        if (isValidTypeToken(normalized)) tokens[type] = normalized;
      }
    }
  }
  return tokens;
}

/**
 * Derive the cosmetic display key for a record.
 *
 * Returns `null` when the project has no key configured — the feature is
 * additive, so callers fall back to showing the bare numeric id in that case.
 *
 * @example formatRecordKey({ projectKey: "PROJECT", type: "TEST_CASE", id: 1234 })
 *          // => "PROJECT-TC-1234"
 */
export function formatRecordKey(args: {
  projectKey: string | null | undefined;
  type: RecordType;
  id: number;
  tokens?: TypeTokenMap;
}): string | null {
  const projectKey = normalizeProjectKey(args.projectKey);
  if (!projectKey) return null;
  const token = (args.tokens ?? DEFAULT_TYPE_TOKENS)[args.type];
  return `${projectKey}-${token}-${args.id}`;
}

/**
 * Extract the canonical numeric id from either a bare id or a prefixed record
 * key. This is the load-bearing primitive for symmetric lookup: it is called
 * wherever a string route param / search term must become the record's id.
 *
 * Lenient by design — the trailing integer is authoritative and any
 * `PREFIX-TOKEN-` head is discarded:
 *   "1234"             -> 1234
 *   "PROJECT-TC-1234"  -> 1234
 *   "TC-1234"          -> 1234
 *   "project-tc-1234"  -> 1234
 *
 * Returns `null` when there is no positive trailing integer (e.g. "", "abc",
 * "TC-", "12.5") so callers can guard exactly as they did with `Number()` /
 * `parseInt` + `isNaN`.
 */
export function parseRecordId(input: string | null | undefined): number | null {
  if (input == null) return null;
  const s = String(input).trim();
  if (s === "") return null;
  // Trailing run of digits, optionally preceded by a non-empty `PREFIX-` head.
  const match = s.match(/^(?:.+-)?(\d+)$/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export interface ParsedRecordKey {
  /** The canonical numeric id (authoritative). */
  id: number;
  /** Uppercased type token if the input carried one, else `null`. */
  token: string | null;
  /** Uppercased project key if the input carried one, else `null`. */
  projectKey: string | null;
}

/**
 * Fully parse a prefixed record key into its parts. Unlike {@link parseRecordId}
 * this preserves the type token and project key so the search resolver can map
 * a token to a record type and (optionally) validate the project prefix.
 *
 * Classification of a single head segment ("X-1234") is disambiguated against
 * `knownTokens` when provided: a segment matching a known token is treated as a
 * token, otherwise as a project key. Without `knownTokens`, a lone head segment
 * is treated as a token.
 *
 * Returns `null` when there is no valid trailing id.
 */
export function parseRecordKey(
  input: string | null | undefined,
  knownTokens?: Iterable<string>
): ParsedRecordKey | null {
  if (input == null) return null;
  const s = String(input).trim();
  if (s === "") return null;

  const parts = s.split("-");
  const idPart = parts[parts.length - 1];
  if (!/^\d+$/.test(idPart)) return null;
  const id = Number(idPart);
  if (!Number.isSafeInteger(id) || id <= 0) return null;

  const head = parts.slice(0, -1).map((p) => p.trim().toUpperCase());

  if (head.length === 0) {
    return { id, token: null, projectKey: null };
  }

  if (head.length === 1) {
    const only = head[0];
    const tokenSet = knownTokens
      ? new Set(Array.from(knownTokens, (t) => t.toUpperCase()))
      : null;
    if (tokenSet && !tokenSet.has(only)) {
      return { id, token: null, projectKey: only };
    }
    return { id, token: only, projectKey: null };
  }

  // Two or more head segments: the last is the token, the one before it is the
  // project key. Any earlier segments are ignored (project keys have no hyphen).
  return {
    id,
    token: head[head.length - 1],
    projectKey: head[head.length - 2],
  };
}

/**
 * Reverse the token map: token -> record type. Used by the search resolver to
 * turn a parsed token (e.g. `TC`) back into a {@link RecordType}. Case-insensitive.
 */
export function recordTypeForToken(
  token: string | null | undefined,
  tokens: TypeTokenMap = { ...DEFAULT_TYPE_TOKENS }
): RecordType | null {
  if (!token) return null;
  const upper = token.toUpperCase();
  for (const type of RECORD_TYPE_LIST) {
    if (tokens[type].toUpperCase() === upper) return type;
  }
  return null;
}
