/**
 * Transport codec for a compiled case-filter `where`.
 *
 * The compiler emits ZenStack's Json-null sentinels (`JsonNull`, `DbNull`,
 * `AnyNull`) — see filterWhereCompiler's value-not-null fragments. Those are
 * CLASS INSTANCES, and the where they sit inside is built on the client and then
 * shipped to the server three different ways. Neither transport carries a class
 * instance intact:
 *
 *  - `fetch` + JSON.stringify (the POST /cases/query route) flattens the
 *    instance to its own properties, `{ "__brand": "JsonNull" }`, which ZenStack
 *    then validates as an ordinary Json record and compiles to "value is not
 *    equal to that object" — always true, silently. The filter still LOOKED
 *    right because the in-memory matchers re-filter text/link rows afterwards;
 *    the fragments with no post-fetch half (dropdown "any value", "no value",
 *    date "has a value") just quietly matched the wrong rows.
 *  - Server actions (export, the two id-resolved sorts) serialize with React
 *    Flight, which cannot encode a class instance at all: it arrives as an
 *    opaque temporary reference — a Proxy whose target is a function — and
 *    ZenStack rejects the whole findMany ("expected string, received function at
 *    where.…value.not"). That took out CSV/PDF export and the dropdown-column
 *    sort whenever a custom-field filter was active.
 *
 * So the sentinels travel as their own plain wire form and are rebuilt on
 * arrival. `serializeWhereForTransport` is called at every client→server
 * boundary that ships a where; `reviveWhereFromTransport` at every server entry
 * point that hands one to ZenStack. Server-side callers that compile their own
 * predicates (the facet-count route) never serialize and need neither.
 *
 * The wire form is exactly what JSON.stringify already produced for these
 * instances, so revive also repairs a body from a client that never serialized.
 * Both directions are idempotent and preserve everything else — including Date
 * instances, which date fragments rely on.
 */

import { AnyNull, DbNull, JsonNull } from "@zenstackhq/orm";

/** Own-property name every ZenStack null sentinel carries. */
const BRAND_KEY = "__brand";

const SENTINEL_BY_BRAND = {
  JsonNull,
  DbNull,
  AnyNull,
} as const;

type SentinelBrand = keyof typeof SENTINEL_BY_BRAND;

function isSentinelBrand(value: unknown): value is SentinelBrand {
  return typeof value === "string" && value in SENTINEL_BY_BRAND;
}

/**
 * A live sentinel. Identity (`value === JsonNull`) is deliberately NOT used: the
 * client bundle and the server can resolve @zenstackhq/orm to different module
 * instances, and a brand check holds either way.
 */
function isSentinelInstance(value: object): boolean {
  return (
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    isSentinelBrand((value as Record<string, unknown>)[BRAND_KEY])
  );
}

/** The wire form: an object whose ONLY key is a recognized brand. */
function sentinelBrandOf(value: object): SentinelBrand | null {
  if (Array.isArray(value) || value instanceof Date) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== BRAND_KEY) return null;
  const brand = (value as Record<string, unknown>)[BRAND_KEY];
  return isSentinelBrand(brand) ? brand : null;
}

/**
 * Deep-map every object node. A mapper returning `null` means "not a sentinel,
 * keep walking"; a `{ value }` box means "this node is replaced wholesale" —
 * including by an identical reference, which is why the box exists: a sentinel
 * that needs no change must still stop the walk, or it would be cloned into a
 * plain object and lose its class identity.
 */
function mapDeep(
  value: unknown,
  map: (node: object) => { value: unknown } | null
): unknown {
  if (value === null || typeof value !== "object") return value;
  // Dates are values here, not containers — cloning one field-by-field would
  // turn a date filter into an empty object.
  if (value instanceof Date) return value;

  const mapped = map(value);
  if (mapped) return mapped.value;

  if (Array.isArray(value)) {
    return value.map((item) => mapDeep(item, map));
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = mapDeep(item, map);
  }
  return result;
}

/**
 * Client → wire. Replaces live Json-null sentinels with their plain form so the
 * where survives JSON and React Flight alike.
 */
export function serializeWhereForTransport<T>(where: T): T {
  return mapDeep(where, (node) =>
    isSentinelInstance(node)
      ? { value: { [BRAND_KEY]: (node as Record<string, unknown>)[BRAND_KEY] } }
      : null
  ) as T;
}

/**
 * Wire → ZenStack. Rebuilds the live sentinels a compiled where needs before it
 * reaches the ORM.
 */
export function reviveWhereFromTransport<T>(where: T): T {
  return mapDeep(where, (node) => {
    const brand = sentinelBrandOf(node);
    return brand ? { value: SENTINEL_BY_BRAND[brand] } : null;
  }) as T;
}
