/**
 * URL codec for repository filter predicates.
 *
 * Wire grammar (repeated `f` query params, one per predicate):
 *
 *   f-param = dimension ":" operator [":" values]
 *   values  = value *("," value)      ; each value encodeURIComponent'd BEFORE join
 *
 * Example: ?f=templates:in:1,2&f=tags:any&f=field_12:contains:foo%2Cbar
 *
 * Parsing is indexOf-based (never a global split(":")) so hand-typed
 * unencoded colons inside ISO dates survive. Serialization component-encodes
 * each value before joining, which is what makes the %3A/%2C readability pass
 * lossless: literal ":"/"," inside values arrive double-encoded (%253A/%252C)
 * and are untouched by the restore.
 *
 * Over FILTER_URL_PARAM_BUDGET the readable form is replaced by a single
 * compressed `fz` param — but only when that form measures SHORTER (see
 * `encodeFilterPredicatesForUrl`). Readers accept either form; `fz` wins.
 * Whichever form wins, the hard caps are applied at write time, so an
 * over-cap predicate array is trimmed (and reported) rather than emitted.
 */

// fflate's deflateSync/inflateSync ARE raw DEFLATE (no zlib/gzip wrapper) —
// the `Raw` suffix is Node's zlib naming, not fflate's.
import { deflateSync, inflateSync } from "fflate";

import type { FilterDimensionRegistry } from "./filterDimensions";
import {
  applyFilterPredicateCap,
  clampFilterPredicates,
  coerceFilterPredicate,
  filterPredicateInputSchema,
  MAX_FILTER_PREDICATES,
  MAX_VALUES_PER_PREDICATE,
  type FilterCapTruncation,
  type FilterPredicate,
} from "~/lib/schemas/repositoryFilterPredicates";

export const FILTER_PARAM = "f";
export const COMPRESSED_FILTER_PARAM = "fz";

/**
 * Character budget for the `f`-param share of the query string, measured
 * exactly as it appears in the address bar (post-readability-pass).
 *
 * ~2000 chars is the universally-safe TOTAL URL length. The repository page's
 * other params (view/node/case/selectedCase/columns/q) plus origin+path
 * typically spend 150-350 of it, so 1800 is a deliberately generous TRIGGER
 * threshold, not a guarantee: a filter set sitting exactly at the budget can
 * land slightly over 2000 total while staying far below nginx's 8k default
 * request-line limit. Anything above it switches to the compressed form, which
 * is where the genuinely dangerous multi-kilobyte cases live.
 */
export const FILTER_URL_PARAM_BUDGET = 1800;

/**
 * Parses one raw `f` param value (as returned by searchParams.getAll("f"),
 * i.e. already form-decoded once). Returns null (drop) on any malformation:
 * missing tokens, malformed % escapes, or registry/arity/coercion failure.
 */
export function parseFilterParam(
  raw: string,
  registry: FilterDimensionRegistry
): FilterPredicate | null {
  const firstColon = raw.indexOf(":");
  if (firstColon <= 0) return null;
  const dimension = raw.slice(0, firstColon);

  const secondColon = raw.indexOf(":", firstColon + 1);
  const operator =
    secondColon === -1
      ? raw.slice(firstColon + 1)
      : raw.slice(firstColon + 1, secondColon);
  if (operator.length === 0) return null;

  // Everything after the second colon is the values segment — colons inside
  // it (hand-typed ISO dates) belong to the values, not the grammar. An empty
  // segment ("tags:any:") is treated as the bare form.
  const valuesSegment = secondColon === -1 ? "" : raw.slice(secondColon + 1);
  let values: string[] = [];
  if (valuesSegment !== "") {
    try {
      values = valuesSegment
        .split(",")
        .map((piece) => decodeURIComponent(piece));
    } catch {
      return null;
    }
  }

  const structural = filterPredicateInputSchema.safeParse({
    dimension,
    operator,
    values,
  });
  if (!structural.success) return null;
  return coerceFilterPredicate(structural.data, registry);
}

/**
 * Lenient batch parse: invalid params are dropped, order is preserved.
 * Dimensions absent from the registry (e.g. run dims outside run mode) drop
 * their predicates here.
 */
export function parseFilterParams(
  rawFParams: readonly string[],
  registry: FilterDimensionRegistry
): FilterPredicate[] {
  return rawFParams.flatMap((raw): FilterPredicate[] => {
    const predicate = parseFilterParam(raw, registry);
    return predicate ? [predicate] : [];
  });
}

/** Serializes one predicate to its `f` param value (pre-URLSearchParams). */
export function serializeFilterPredicate(predicate: FilterPredicate): string {
  const head = `${predicate.dimension}:${predicate.operator}`;
  if (predicate.values.length === 0) return head;
  const values = predicate.values
    .map((value) => encodeURIComponent(String(value)))
    .join(",");
  return `${head}:${values}`;
}

/**
 * Serializes predicates to `f` param values in array order. Callers append
 * each to a URLSearchParams built from window.location.search (delete-all-
 * then-append), call .toString(), then applyReadabilityPass on the result.
 */
export function serializeFilterPredicates(
  predicates: readonly FilterPredicate[]
): string[] {
  return predicates.map(serializeFilterPredicate);
}

/**
 * Restores the structural ":" and "," that URLSearchParams.toString()
 * form-encoded, keeping URLs hand-readable. Provably lossless: any literal
 * ":"/"," inside a value was component-encoded first (%3A/%2C), then
 * form-encoded again (%253A/%252C) — strings this replace never matches.
 */
export function applyReadabilityPass(queryString: string): string {
  return queryString.replace(/%3A/g, ":").replace(/%2C/g, ",");
}

/**
 * Length of the `f`-param share of the query string exactly as it will appear
 * (form-encoded by URLSearchParams, then readability-restored) — the number
 * FILTER_URL_PARAM_BUDGET is compared against.
 */
export function measureFilterParams(
  predicates: readonly FilterPredicate[]
): number {
  if (predicates.length === 0) return 0;
  const query = new URLSearchParams();
  for (const token of serializeFilterPredicates(predicates)) {
    query.append(FILTER_PARAM, token);
  }
  return applyReadabilityPass(query.toString()).length;
}

/** Length of the `fz=<payload>` share of the query string. */
export function measureCompressedFilterParam(payload: string): number {
  // base64url + the leading algorithm tag are all unreserved characters, so
  // URLSearchParams never percent-encodes them — length is exact.
  return COMPRESSED_FILTER_PARAM.length + 1 + payload.length;
}

// --- Compressed fallback param (`fz`) -------------------------------------
//
// Wire format: fz=<algo><base64url payload, no padding>
//   algo "u" — payload is the UTF-8 compact JSON, uncompressed
//   algo "z" — payload is raw-deflate (RFC 1951) of that same JSON
//
// Compact JSON is positional: [[dimension, operator, ...values], ...]. Values
// keep their JSON types, so the round trip is lossless for numbers, strings,
// unicode and emoji alike.
//
// Compression uses fflate's synchronous raw deflate (the platform's
// CompressionStream is async, and this serialize path is synchronous).
// `encodeFilterPredicatesForUrl` measures both forms and emits whichever is
// genuinely shorter: deflate wins on the repetitive id-heavy sets and on
// text-heavy ones (where a space or comma inside a value costs 5 chars —
// %2520/%252C — after double encoding), while very small sets stay readable
// because base64 framing costs more than it saves. The hard-cap clamp remains
// the final backstop for sets that exceed the budget even compressed.
//
// A "z" payload decoded with no compressor registered is treated as corrupt
// (drops to no filters) rather than throwing.

export const FILTER_COMPRESSION_IDENTITY = "u";
export const FILTER_COMPRESSION_DEFLATE_RAW = "z";

export interface SyncFilterCompressor {
  deflateRaw(input: Uint8Array): Uint8Array;
  inflateRaw(input: Uint8Array): Uint8Array;
}

const fflateCompressor: SyncFilterCompressor = {
  deflateRaw: (input) => deflateSync(input),
  inflateRaw: (input) => inflateSync(input),
};

let activeCompressor: SyncFilterCompressor | null = fflateCompressor;

/**
 * Overrides (or disables, with null) the synchronous raw-deflate codec.
 * Production runs on fflate by default; this exists so tests can pin a
 * specific implementation or assert the no-compressor path.
 */
export function setFilterUrlCompressor(
  compressor: SyncFilterCompressor | null
): void {
  activeCompressor = compressor;
}

export function getFilterUrlCompressor(): SyncFilterCompressor | null {
  return activeCompressor;
}

const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const BASE64URL_VALUES: Readonly<Record<string, number>> = Object.fromEntries(
  Array.from(BASE64URL_ALPHABET, (char, index) => [char, index])
);

function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : null;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : null;
    out += BASE64URL_ALPHABET[b0 >> 2];
    out += BASE64URL_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === null) break;
    out += BASE64URL_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === null) break;
    out += BASE64URL_ALPHABET[b2 & 0x3f];
  }
  return out;
}

function fromBase64Url(text: string): Uint8Array {
  // A 4n+1 group carries no whole byte — it can only come from corruption.
  if (text.length % 4 === 1) throw new Error("invalid base64url length");
  const bytes = new Uint8Array(Math.floor((text.length * 3) / 4));
  let bits = 0;
  let bitCount = 0;
  let index = 0;
  for (const char of text) {
    const value = BASE64URL_VALUES[char];
    if (value === undefined) throw new Error("invalid base64url character");
    bits = (bits << 6) | value;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes[index++] = (bits >> bitCount) & 0xff;
    }
  }
  return bytes.subarray(0, index);
}

type CompactPredicate = Array<string | number>;

function toCompact(predicate: FilterPredicate): CompactPredicate {
  return [predicate.dimension, predicate.operator, ...predicate.values];
}

/**
 * Encodes the ENTIRE predicate array into one `fz` param value. Returns null
 * for an empty array (no param to write).
 */
export function encodeCompressedFilterParam(
  predicates: readonly FilterPredicate[]
): string | null {
  if (predicates.length === 0) return null;
  const json = JSON.stringify(predicates.map(toCompact));
  const bytes = new TextEncoder().encode(json);
  const compressor = activeCompressor;
  if (compressor) {
    try {
      const deflated = compressor.deflateRaw(bytes);
      if (deflated.length < bytes.length) {
        return FILTER_COMPRESSION_DEFLATE_RAW + toBase64Url(deflated);
      }
    } catch {
      // Fall through to the identity form — never lose the filters over a
      // compression failure.
    }
  }
  return FILTER_COMPRESSION_IDENTITY + toBase64Url(bytes);
}

/**
 * Decodes an `fz` param value. Returns null when the payload is corrupt
 * (bad tag, bad base64url, bad deflate stream, non-JSON, non-array, or a "z"
 * payload with no compressor registered) — callers treat that as "no filters",
 * never as a throw. Individual entries that fail registry validation are
 * dropped leniently, exactly like `f` params.
 */
export function decodeCompressedFilterParam(
  raw: string,
  registry: FilterDimensionRegistry
): FilterPredicate[] | null {
  const payload = decodeCompactPayload(raw);
  if (!payload) return null;
  return applyFilterPredicateCap(
    payload.flatMap((entry) => {
      const predicate = coerceCompactEntry(entry, registry);
      return predicate ? [predicate] : [];
    })
  );
}

/** Decodes `fz` to its raw compact array, or null when corrupt. */
function decodeCompactPayload(raw: string): unknown[] | null {
  if (raw.length === 0) return null;
  const algo = raw.slice(0, 1);
  let parsed: unknown;
  try {
    let bytes = fromBase64Url(raw.slice(1));
    if (algo === FILTER_COMPRESSION_DEFLATE_RAW) {
      const compressor = activeCompressor;
      if (!compressor) return null;
      bytes = compressor.inflateRaw(bytes);
    } else if (algo !== FILTER_COMPRESSION_IDENTITY) {
      return null;
    }
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  return Array.isArray(parsed) ? parsed : null;
}

function coerceCompactEntry(
  entry: unknown,
  registry: FilterDimensionRegistry
): FilterPredicate | null {
  const shape = compactEntryShape(entry);
  if (!shape) return null;
  const structural = filterPredicateInputSchema.safeParse(shape);
  if (!structural.success) return null;
  return coerceFilterPredicate(structural.data, registry);
}

function compactEntryShape(
  entry: unknown
): { dimension: unknown; operator: unknown; values: unknown[] } | null {
  if (!Array.isArray(entry) || entry.length < 2) return null;
  return {
    dimension: entry[0],
    operator: entry[1],
    values: entry.slice(2),
  };
}

/**
 * Pre-validation split of one `f` param — used only to see how many values the
 * URL actually carried, before the per-predicate cap trimmed them.
 */
function rawFParamShape(
  raw: string
): { dimension: string; values: string[] } | null {
  const firstColon = raw.indexOf(":");
  if (firstColon <= 0) return null;
  const secondColon = raw.indexOf(":", firstColon + 1);
  const valuesSegment = secondColon === -1 ? "" : raw.slice(secondColon + 1);
  return {
    dimension: raw.slice(0, firstColon),
    values: valuesSegment === "" ? [] : valuesSegment.split(","),
  };
}

export type FilterUrlForm =
  typeof FILTER_PARAM | typeof COMPRESSED_FILTER_PARAM;

export interface FilterUrlEncoding {
  /** Which param family the write path should emit. */
  form: FilterUrlForm;
  /** `f` param values, in predicate order. Empty when form is "fz". */
  fParams: string[];
  /** The single `fz` param value. Null when form is "f". */
  compressed: string | null;
  /** Measured length of the readable `f` form (what the budget gates on). */
  fLength: number;
  /** Measured length of the `fz` form, or null when it was not built. */
  compressedLength: number | null;
  /**
   * The predicates actually encoded — the input after the hard-cap clamp.
   * Callers hold this as their new state so state and URL never disagree.
   */
  predicates: FilterPredicate[];
  /** What the clamp cut off the input (all zeros when it cut nothing). */
  truncation: FilterCapTruncation;
}

/**
 * The single write-path entry point: clamps to the hard caps, then picks the
 * shorter of the two wire forms.
 *
 * 1. **Final clamp.** MAX_FILTER_PREDICATES / MAX_VALUES_PER_PREDICATE are
 *    applied HERE, not only at parse time, so no caller can emit a URL whose
 *    values the next read would silently drop. The surviving predicates stay
 *    in the URL and `truncation` reports the cut, so the FilterBar can say so —
 *    nothing disappears without the user being told.
 * 2. **Form choice by measurement.** The readable `f` form wins while it fits
 *    FILTER_URL_PARAM_BUDGET (hand-editable, shareable URLs are the point).
 *    Above the budget both forms are measured and the SHORTER one is emitted:
 *    with the identity payload that is `fz` for text-heavy sets and `f` for
 *    id-heavy ones (see the compression block comment). Emitting a longer URL
 *    to "mitigate" URL length would be strictly counterproductive, so `fz` is
 *    never chosen on faith.
 *
 * The budget is a trigger threshold, not a guarantee: a clamped set can still
 * measure above it (50 chips × 200 ids is a legal filter state). The caps are
 * what bounds the URL deterministically; registering a real deflate codec is
 * what would shrink the far end of that range.
 */
export function encodeFilterPredicatesForUrl(
  input: readonly FilterPredicate[]
): FilterUrlEncoding {
  const { predicates, truncation } = clampFilterPredicates(input);
  const fParams = serializeFilterPredicates(predicates);
  const fLength = measureFilterParams(predicates);
  const readable: FilterUrlEncoding = {
    form: FILTER_PARAM,
    fParams,
    compressed: null,
    fLength,
    compressedLength: null,
    predicates,
    truncation,
  };
  if (fLength <= FILTER_URL_PARAM_BUDGET) return readable;

  const compressed = encodeCompressedFilterParam(predicates);
  if (!compressed) return readable;
  const compressedLength = measureCompressedFilterParam(compressed);
  if (compressedLength >= fLength) {
    return { ...readable, compressedLength };
  }
  return {
    ...readable,
    form: COMPRESSED_FILTER_PARAM,
    fParams: [],
    compressed,
    compressedLength,
  };
}

export interface FilterUrlParamsInput {
  /** searchParams.getAll("f") — already form-decoded once. */
  f: readonly string[];
  /** searchParams.get("fz") — null when absent. */
  fz?: string | null;
}

/**
 * The read path for both forms. `fz` is the single source of truth when
 * present: any `f` params alongside it are IGNORED (a half-applied merge of a
 * stale readable set with a fresh compressed one would silently change the
 * user's filters). Corrupt `fz` yields no predicates rather than falling back
 * to `f`, for the same reason.
 */
export function parseFilterUrlParams(
  input: FilterUrlParamsInput,
  registry: FilterDimensionRegistry
): FilterPredicate[] {
  return applyFilterPredicateCap(parseUrlFormsUncapped(input, registry).valid);
}

export interface FilterUrlParseResult {
  predicates: FilterPredicate[];
  truncation: FilterCapTruncation;
}

/** `parseFilterUrlParams` plus what the hard caps trimmed off the URL. */
export function parseFilterUrlParamsWithReport(
  input: FilterUrlParamsInput,
  registry: FilterDimensionRegistry
): FilterUrlParseResult {
  const { valid, rawShapes } = parseUrlFormsUncapped(input, registry);
  return {
    predicates: applyFilterPredicateCap(valid),
    truncation: {
      predicatesDropped: Math.max(0, valid.length - MAX_FILTER_PREDICATES),
      valuesTruncated: rawShapes
        .filter((shape) => shape.values.length > MAX_VALUES_PER_PREDICATE)
        .map((shape) => shape.dimension),
    },
  };
}

interface UncappedUrlParse {
  /** Registry-valid predicates, pre-cap, in URL order. */
  valid: FilterPredicate[];
  /** Pre-validation (dimension, raw value count) pairs, for cap reporting. */
  rawShapes: Array<{ dimension: string; values: unknown[] }>;
}

function parseUrlFormsUncapped(
  { f, fz }: FilterUrlParamsInput,
  registry: FilterDimensionRegistry
): UncappedUrlParse {
  if (fz) {
    const payload = decodeCompactPayload(fz);
    if (!payload) return { valid: [], rawShapes: [] };
    const valid: FilterPredicate[] = [];
    const rawShapes: UncappedUrlParse["rawShapes"] = [];
    for (const entry of payload) {
      const shape = compactEntryShape(entry);
      if (shape && typeof shape.dimension === "string") {
        rawShapes.push({ dimension: shape.dimension, values: shape.values });
      }
      const predicate = coerceCompactEntry(entry, registry);
      if (predicate) valid.push(predicate);
    }
    return { valid, rawShapes };
  }
  const valid: FilterPredicate[] = [];
  const rawShapes: UncappedUrlParse["rawShapes"] = [];
  for (const token of f) {
    const shape = rawFParamShape(token);
    if (shape) rawShapes.push(shape);
    const predicate = parseFilterParam(token, registry);
    if (predicate) valid.push(predicate);
  }
  return { valid, rawShapes };
}

function compareStrings(a: string, b: string): number {
  // Plain code-unit comparison — locale-independent, unlike localeCompare.
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Deterministic key for React Query keys / remount keys: stable under
 * predicate reordering and value reordering. Predicates sort by dimension,
 * then operator, then serialized values; values sort within each predicate —
 * safe because `between` is parse-normalized ascending, so value order never
 * carries information.
 */
export function canonicalPredicateKey(
  predicates: readonly FilterPredicate[]
): string {
  return predicates
    .map((predicate) => ({
      dimension: predicate.dimension,
      operator: predicate.operator,
      values: [...predicate.values].map(String).sort(compareStrings),
    }))
    .sort(
      (a, b) =>
        compareStrings(a.dimension, b.dimension) ||
        compareStrings(a.operator, b.operator) ||
        compareStrings(a.values.join(","), b.values.join(","))
    )
    .map(serializeFilterPredicate)
    .join("&");
}
