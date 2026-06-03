/**
 * Automation case-ID resolution for test-results import.
 *
 * Lets an automated test declare which existing TestPlanIt case its result
 * belongs to, so renaming the test no longer creates a duplicate case. Two
 * channels are supported, mirroring the conventions used across the market
 * (TestRail, Xray, Zephyr):
 *
 *   1. An ID embedded in the test name, parsed with one of a fixed set of
 *      curated presets (no caller-supplied regex ever runs server-side).
 *   2. An ID carried in a JUnit `<property>` (`test_id` / `testplanit_case_id`).
 *
 * When both are present the property wins (explicit metadata over a parsed
 * name). Multiple IDs per test are supported; each resolved case receives the
 * same result.
 *
 * All matching uses compiled constant regexes on bounded inputs, so there is
 * no ReDoS surface.
 */

export type CaseMatcher = "off" | "name" | "property" | "auto";
export type CaseIdFormat = "brackets" | "c" | "tc";

export const CASE_MATCHERS: readonly CaseMatcher[] = [
  "off",
  "name",
  "property",
  "auto",
];

export const CASE_ID_FORMATS: readonly CaseIdFormat[] = ["brackets", "c", "tc"];

/**
 * Property names recognized for property-based matching. `test_id` is the
 * de-facto standard (TestRail, Xray); `testplanit_case_id` is the explicit
 * alias. Lookup is case-insensitive.
 */
export const CASE_ID_PROPERTY_NAMES: readonly string[] = [
  "test_id",
  "testplanit_case_id",
];

/** Coerce an untrusted form value to a known matcher, defaulting to `off`. */
export function parseCaseMatcher(
  value: string | null | undefined
): CaseMatcher {
  return (CASE_MATCHERS as readonly string[]).includes(value ?? "")
    ? (value as CaseMatcher)
    : "off";
}

/** Coerce an untrusted form value to a known format, defaulting to `brackets`. */
export function parseCaseIdFormat(
  value: string | null | undefined
): CaseIdFormat {
  return (CASE_ID_FORMATS as readonly string[]).includes(value ?? "")
    ? (value as CaseIdFormat)
    : "brackets";
}

export interface CaseIdResolution {
  /** Resolved numeric case IDs, de-duplicated, in first-seen order. */
  ids: number[];
  /** Which channel produced the IDs, or `null` when none matched. */
  source: "property" | "name" | null;
}

const ID_TOKEN = /^[Cc]?#?(\d+)$/;

function toCaseId(token: string): number | null {
  const match = ID_TOKEN.exec(token.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function dedupe(ids: number[]): number[] {
  return [...new Set(ids)];
}

/**
 * Extract IDs from bracketed segments: `[123]`, `[C123]`, `[123, 456]`,
 * `[C1 C2]`. Each bracket's contents must be only id tokens separated by
 * commas/whitespace/underscores, so incidental brackets (e.g. `[2024-01-01]`)
 * are ignored.
 */
function extractBrackets(name: string): number[] {
  const ids: number[] = [];
  const bracket = /\[([^\]]*)\]/g;
  let match: RegExpExecArray | null;
  while ((match = bracket.exec(name)) !== null) {
    for (const token of match[1].split(/[,\s_]+/).filter(Boolean)) {
      const id = toCaseId(token);
      if (id !== null) ids.push(id);
    }
  }
  return ids;
}

/** Extract `C123`-style IDs. A preceding letter (e.g. `ABC123`) is rejected. */
function extractCPrefix(name: string): number[] {
  const ids: number[] = [];
  const re = /(?<![A-Za-z])[Cc]#?(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(name)) !== null) {
    const n = Number(match[1]);
    if (Number.isSafeInteger(n) && n > 0) ids.push(n);
  }
  return ids;
}

/** Extract `TC-123` / `TC123`-style IDs. A preceding letter is rejected. */
function extractTcPrefix(name: string): number[] {
  const ids: number[] = [];
  const re = /(?<![A-Za-z])TC[-_]?(\d+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(name)) !== null) {
    const n = Number(match[1]);
    if (Number.isSafeInteger(n) && n > 0) ids.push(n);
  }
  return ids;
}

/** Parse case IDs out of a test name using the given preset. */
export function parseCaseIdsFromName(
  name: string,
  format: CaseIdFormat
): number[] {
  if (!name) return [];
  switch (format) {
    case "c":
      return dedupe(extractCPrefix(name));
    case "tc":
      return dedupe(extractTcPrefix(name));
    case "brackets":
    default:
      return dedupe(extractBrackets(name));
  }
}

/**
 * Parse case IDs out of the parsed JUnit `<property>` map. Values may be a
 * single id or a comma/space separated list (`"C123, C456"`).
 */
export function parseCaseIdsFromProperty(
  metadata: Record<string, string> | undefined,
  propertyNames: readonly string[] = CASE_ID_PROPERTY_NAMES
): number[] {
  if (!metadata) return [];
  const lowered = propertyNames.map((n) => n.toLowerCase());
  const ids: number[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (!lowered.includes(key.toLowerCase())) continue;
    for (const token of String(value)
      .split(/[,\s]+/)
      .filter(Boolean)) {
      const id = toCaseId(token);
      if (id !== null) ids.push(id);
    }
  }
  return dedupe(ids);
}

/**
 * Resolve the case-ID references for a single test case, applying the
 * configured matcher mode. Property matches take precedence over name
 * matches. Returns an empty result (and `source: null`) when matching is
 * off or nothing is found — the caller then falls back to name+className.
 */
export function resolveCaseIdRefs(
  input: { name: string; metadata?: Record<string, string> },
  opts: {
    matcher: CaseMatcher;
    format: CaseIdFormat;
    propertyNames?: readonly string[];
  }
): CaseIdResolution {
  if (opts.matcher === "off") return { ids: [], source: null };

  const tryProperty = opts.matcher === "property" || opts.matcher === "auto";
  const tryName = opts.matcher === "name" || opts.matcher === "auto";

  if (tryProperty) {
    const ids = parseCaseIdsFromProperty(input.metadata, opts.propertyNames);
    if (ids.length > 0) return { ids, source: "property" };
  }
  if (tryName) {
    const ids = parseCaseIdsFromName(input.name, opts.format);
    if (ids.length > 0) return { ids, source: "name" };
  }
  return { ids: [], source: null };
}
