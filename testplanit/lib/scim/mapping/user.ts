/**
 * Pure, DB-free, log-free bidirectional SCIM ↔ Prisma User mapper.
 *
 * This module is the single source of truth for translating between SCIM JSON
 * resources (per RFC 7643 §4) and the Prisma `User` row shape. Service layers
 * compose these primitives; routes never inline mapping logic.
 *
 * Purity discipline (mirrors `lib/scim/responses.ts` and `lib/scim/errors.ts`):
 *   - No imports from `~/lib/db` or any runtime DB client.
 *   - No stdout/stderr writes, no logger imports.
 *   - No module-level mutable state.
 *   - No side effects on inputs (returns fresh objects).
 *
 * Anti-pattern guards (enforced by tests and grep):
 *   - The SAML/OAuth `User.externalId` column is NEVER read or written here.
 *     Only `scimExternalId` is touched by this mapper.
 *   - The `password` attribute is silently dropped from every translation; it
 *     never lands in `scimExtensions` and never appears in the create payload.
 *   - Top-level `__proto__` keys are filtered when partitioning URN buckets.
 */

import { SCIM_SCHEMAS } from "../constants";
import { scimLocation } from "../responses";

export interface ScimEmail {
  value: string;
  primary?: boolean;
  type?: string;
  display?: string;
}

export interface ScimUserName {
  formatted?: string;
  givenName?: string;
  familyName?: string;
  middleName?: string;
  honorificPrefix?: string;
  honorificSuffix?: string;
}

export interface ScimUserBody {
  schemas?: string[];
  userName: string;
  externalId?: string;
  name?: ScimUserName;
  emails?: ScimEmail[];
  active?: boolean;
  displayName?: string;
  locale?: string;
  title?: string;
  timezone?: string;
  profileUrl?: string;
  roles?: unknown[];
  groups?: unknown[];
  password?: string;
  [urn: string]: unknown;
}

export interface ScimMeta {
  resourceType: "User";
  location: string;
  version: string;
  lastModified: string;
}

export interface ScimUserResource {
  schemas: string[];
  id: string;
  userName?: string;
  externalId?: string;
  name?: ScimUserName;
  emails?: ScimEmail[];
  active?: boolean;
  groups?: Array<{ value: string; display: string }>;
  meta: ScimMeta;
  [urn: string]: unknown;
}

export interface DbUserForScim {
  id: string;
  email: string;
  name: string;
  scimUserName: string | null;
  scimExternalId: string | null;
  scimGivenName: string | null;
  scimFamilyName: string | null;
  scimExtensions: unknown;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date | null;
  groups?: Array<{ group: { id: number; name: string } }>;
}

export interface ScimUserCreatePayload {
  scimUserName: string | null;
  scimExternalId: string | null;
  scimGivenName: string | null;
  scimFamilyName: string | null;
  name: string;
  email: string | undefined;
  isActive: boolean;
  scimExtensions: Record<string, unknown> | null;
}

export interface ScimUserUpdatePayload {
  scimUserName?: string;
  scimExternalId?: string;
  scimGivenName?: string;
  scimFamilyName?: string;
  name?: string;
  email?: string;
  isActive?: boolean;
  scimExtensions?: Record<string, unknown> | null;
}

/**
 * Non-writable core User attributes that the IdP commonly sends in POST/PUT
 * bodies. Each gets bucketed under the core User URN inside `scimExtensions`
 * so a subsequent SCIM GET round-trips the IdP's original payload faithfully.
 */
const NON_WRITABLE_CORE_KEYS = new Set([
  "displayName",
  "locale",
  "title",
  "timezone",
  "profileUrl",
  "preferredLanguage",
  "userType",
  "nickName",
  "roles",
  "groups",
  "addresses",
  "phoneNumbers",
  "ims",
  "photos",
  "entitlements",
  "x509Certificates",
]);

/** Filters out hostile keys before treating an object as a URN bucket. */
function isSafeKey(key: string): boolean {
  return key !== "__proto__" && key !== "constructor" && key !== "prototype";
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    Object.prototype.toString.call(v) === "[object Object]"
  );
}

/**
 * Find the email value the IdP wants stored as the canonical `User.email`.
 * Priority: the first entry with `primary === true`, else the first entry in
 * array order. Returns `undefined` for an empty or missing array.
 */
export function extractPrimaryEmail(
  emails: ScimEmail[] | undefined
): string | undefined {
  if (!emails || emails.length === 0) return undefined;
  const primary = emails.find((e) => e?.primary === true);
  return primary?.value ?? emails[0]?.value;
}

/**
 * Compute `User.name` from a SCIM body. Resolution order:
 *   1. `name.formatted` if non-empty
 *   2. `${givenName} ${familyName}`.trim() if either part non-empty
 *   3. `userName` as the final fallback
 *
 * Used by both create (POST/PUT) and update-diff (PATCH) flows so the same
 * write rule applies whether the IdP sent a `formatted` string or only parts.
 */
export function deriveDisplayName(body: ScimUserBody): string {
  const formatted = body.name?.formatted?.trim();
  if (formatted) return formatted;
  const given = body.name?.givenName?.trim() ?? "";
  const family = body.name?.familyName?.trim() ?? "";
  const joined = `${given} ${family}`.trim();
  if (joined) return joined;
  return body.userName;
}

/**
 * Partition every non-writable attribute of a SCIM body into URN-keyed
 * buckets. The result is exactly the JSON blob persisted to
 * `User.scimExtensions` so a subsequent GET can re-emit the IdP's original
 * payload verbatim.
 *
 * Rules:
 *   - The core User URN bucket holds known non-writable core attributes
 *     (displayName, locale, title, timezone, profileUrl, roles, groups, etc.)
 *     plus any preserved fragment of `name` outside the writable surface
 *     (e.g. `name.middleName` is recorded as `name.middleName`).
 *   - Any top-level body key starting with `urn:` is copied verbatim into its
 *     own bucket.
 *   - `password` is excluded outright. Hostile keys (`__proto__`,
 *     `constructor`, `prototype`) are filtered before bucketing.
 */
export function extractNonWritableUrns(
  body: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const coreBucket: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(body)) {
    if (!isSafeKey(key)) continue;

    if (key.startsWith("urn:")) {
      if (isPlainObject(value)) {
        result[key] = { ...value };
      } else {
        result[key] = value;
      }
      continue;
    }

    if (NON_WRITABLE_CORE_KEYS.has(key)) {
      coreBucket[key] = value;
      continue;
    }
  }

  // Capture `name` sub-attrs outside the writable surface (middleName,
  // honorificPrefix, honorificSuffix) under the core URN bucket as flat,
  // dotted keys so PATCH path resolution can find them later.
  const name = body.name;
  if (isPlainObject(name)) {
    for (const subKey of ["middleName", "honorificPrefix", "honorificSuffix"]) {
      if (subKey in name && name[subKey] !== undefined) {
        coreBucket[`name.${subKey}`] = name[subKey];
      }
    }
  }

  // Capture the full emails[] array (including non-primary entries' type,
  // display, primary flags) so GET returns the IdP's original wire shape.
  if (Array.isArray(body.emails) && body.emails.length > 0) {
    coreBucket.emails = body.emails;
  }

  if (Object.keys(coreBucket).length > 0) {
    result[SCIM_SCHEMAS.CORE_USER] = coreBucket;
  }

  // If the body's `schemas` array advertised an extension URN with no
  // payload attributes (the entra-post fixture is the canonical example),
  // ensure the URN still surfaces as an empty bucket so the read-side
  // re-emits the original `schemas` array.
  if (Array.isArray(body.schemas)) {
    for (const schema of body.schemas) {
      if (
        typeof schema === "string" &&
        schema.startsWith("urn:") &&
        schema !== SCIM_SCHEMAS.CORE_USER &&
        !(schema in result)
      ) {
        result[schema] = {};
      }
    }
  }

  return result;
}

/**
 * URN-level merge for `scimExtensions`. The incoming object's URN keys
 * overwrite the current object's same URN keys; URNs present in current but
 * absent in incoming are preserved. The merge is shallow at the URN
 * boundary — each URN's payload is replaced as a single unit, NOT deep-merged.
 *
 * This guards against the read-modify-write trap where writing one URN to
 * `User.scimExtensions` would otherwise drop every other URN previously
 * stored. Service layers SELECT the current blob, call this function with the
 * incoming URN deltas, then write the merged result back in the same tx.
 */
export function mergeExtensions(
  current: unknown,
  incoming: Record<string, unknown>
): Record<string, unknown> | null {
  const safeIncoming: Record<string, unknown> = {};
  if (incoming && typeof incoming === "object") {
    for (const [k, v] of Object.entries(incoming)) {
      if (isSafeKey(k)) safeIncoming[k] = v;
    }
  }

  if (current === null || current === undefined) {
    return Object.keys(safeIncoming).length > 0 ? { ...safeIncoming } : null;
  }
  if (!isPlainObject(current)) {
    return Object.keys(safeIncoming).length > 0 ? { ...safeIncoming } : null;
  }

  if (Object.keys(safeIncoming).length === 0) {
    return { ...current };
  }

  return { ...current, ...safeIncoming };
}

/**
 * Translate a SCIM POST/PUT body into a Prisma create payload covering only
 * the writable SCIM surface. The service layer is responsible for supplying
 * the immune attributes — roleId, access, authMethod, password — which never
 * surface here.
 *
 * Storage rules:
 *   - `scimUserName` is case-folded on write (filter operators are
 *     case-insensitive at compare time; we lowercase once at the write).
 *   - `scimExternalId` is stored verbatim (IdPs treat it as an opaque token).
 *   - `email` is derived from the primary entry of `emails[]`.
 *   - `name` is derived per the formatted-or-join-or-userName chain.
 *   - `scimExtensions` captures every non-writable attribute partitioned by
 *     URN so reads round-trip the IdP's original wire shape.
 */
export function scimToUserCreate(body: ScimUserBody): ScimUserCreatePayload {
  const extensions = extractNonWritableUrns(
    body as unknown as Record<string, unknown>
  );

  return {
    scimUserName: body.userName ? body.userName.toLowerCase() : null,
    scimExternalId: body.externalId ?? null,
    scimGivenName: body.name?.givenName ?? null,
    scimFamilyName: body.name?.familyName ?? null,
    name: deriveDisplayName(body),
    email: extractPrimaryEmail(body.emails),
    isActive: body.active ?? true,
    scimExtensions: Object.keys(extensions).length > 0 ? extensions : null,
  };
}

/**
 * Translate a Prisma User row into a SCIM User resource ready for serialization
 * by the route handler. The `schemas` array always begins with the core User
 * URN and is then extended with every URN key present in `scimExtensions`.
 *
 * The read-side mirrors the write-side: `User.name` surfaces as
 * `name.formatted`, the primary email surfaces as a single-entry `emails[]`
 * with `primary: true`, and every persisted URN bucket spreads back onto the
 * top-level resource object.
 */
export function userToScim(user: DbUserForScim): ScimUserResource {
  const extensions = isPlainObject(user.scimExtensions)
    ? user.scimExtensions
    : undefined;

  const extraUrns = extensions
    ? Object.keys(extensions).filter(
        (k) => k.startsWith("urn:") && k !== SCIM_SCHEMAS.CORE_USER
      )
    : [];

  const schemas = [SCIM_SCHEMAS.CORE_USER, ...extraUrns];

  const versionDate =
    user.updatedAt?.toISOString() ?? user.createdAt.toISOString();

  const resource: ScimUserResource = {
    schemas,
    id: user.id,
    userName: user.scimUserName ?? undefined,
    externalId: user.scimExternalId ?? undefined,
    name: {
      givenName: user.scimGivenName ?? undefined,
      familyName: user.scimFamilyName ?? undefined,
      formatted: user.name ?? undefined,
    },
    emails: user.email ? [{ value: user.email, primary: true }] : [],
    active: user.isActive,
    meta: {
      resourceType: "User",
      location: scimLocation("Users", user.id),
      version: versionDate,
      lastModified: versionDate,
    },
  };

  if (extensions) {
    for (const urn of extraUrns) {
      const bucket = extensions[urn];
      if (isSafeKey(urn)) {
        resource[urn] = bucket;
      }
    }
  }

  if (user.groups && user.groups.length > 0) {
    resource.groups = user.groups.map((g) => ({
      value: String(g.group.id),
      display: g.group.name,
    }));
  }

  return resource;
}

/**
 * Pure diff between the current SCIM view of a user and the post-PATCH draft
 * SCIM view. Returns a payload containing only the writable columns that
 * actually changed. Immune attributes (`roleId`, `access`, `authMethod`,
 * `password`) are never written.
 *
 * Name and email columns are re-derived from the draft so that a single-field
 * PATCH (e.g. only `name.givenName`) still produces a consistent `User.name`
 * + part-column triplet — matches the same write rule used by create.
 */
export function computeUserUpdatesFromScim(
  currentScim: ScimUserResource,
  draftScim: ScimUserResource
): ScimUserUpdatePayload {
  const updates: ScimUserUpdatePayload = {};

  // Tracked scalar columns — straightforward equality.
  if (
    typeof draftScim.userName === "string" &&
    draftScim.userName !== currentScim.userName
  ) {
    updates.scimUserName = draftScim.userName.toLowerCase();
  }
  if (
    typeof draftScim.externalId === "string" &&
    draftScim.externalId !== currentScim.externalId
  ) {
    updates.scimExternalId = draftScim.externalId;
  }
  if (
    typeof draftScim.active === "boolean" &&
    draftScim.active !== currentScim.active
  ) {
    updates.isActive = draftScim.active;
  }

  // Name parts. Re-derive `User.name` whenever any name attr changed.
  const currentGiven = currentScim.name?.givenName;
  const currentFamily = currentScim.name?.familyName;
  const draftGiven = draftScim.name?.givenName;
  const draftFamily = draftScim.name?.familyName;
  const currentFormatted = currentScim.name?.formatted;
  const draftFormatted = draftScim.name?.formatted;

  const givenChanged = draftGiven !== undefined && draftGiven !== currentGiven;
  const familyChanged =
    draftFamily !== undefined && draftFamily !== currentFamily;
  const formattedChanged =
    draftFormatted !== undefined && draftFormatted !== currentFormatted;
  const nameTouched = givenChanged || familyChanged || formattedChanged;

  if (givenChanged) {
    updates.scimGivenName = draftGiven;
  }
  if (familyChanged) {
    updates.scimFamilyName = draftFamily;
  }
  if (nameTouched) {
    // When a name part changes but the IdP did not send a fresh
    // `formatted`, the current `formatted` is stale — re-derive from the
    // resulting parts instead of preserving the now-inconsistent string.
    const effectiveFormatted = formattedChanged ? draftFormatted : undefined;
    const synthBody = {
      userName: draftScim.userName ?? currentScim.userName ?? "",
      name: {
        formatted: effectiveFormatted,
        givenName: draftGiven ?? currentGiven,
        familyName: draftFamily ?? currentFamily,
      },
    } as ScimUserBody;
    updates.name = deriveDisplayName(synthBody);
  }

  // Email — re-derive from the draft emails[] array per the same primary-or-
  // first rule used by create. We only emit if the resulting value differs
  // from the current canonical email.
  if (Array.isArray(draftScim.emails)) {
    const next = extractPrimaryEmail(draftScim.emails);
    const prev = extractPrimaryEmail(currentScim.emails);
    if (next !== undefined && next !== prev) {
      updates.email = next;
    }
  }

  // scimExtensions — collect every URN bucket present at the top level of
  // either resource, prefer the draft's bucket on collision, and emit the
  // merged blob only when something actually changed at the URN level.
  const currentExt = collectUrnBuckets(currentScim);
  const draftExt = collectUrnBuckets(draftScim);
  if (
    JSON.stringify(currentExt) !== JSON.stringify(draftExt) &&
    Object.keys(draftExt).length > 0
  ) {
    updates.scimExtensions = draftExt;
  }

  return updates;
}

/**
 * Pluck every URN bucket from a SCIM resource (including the core User URN
 * if its payload is non-empty). Used internally by the diff function to
 * decide whether the `scimExtensions` column needs a rewrite.
 */
function collectUrnBuckets(
  resource: ScimUserResource
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(resource)) {
    if (!isSafeKey(key)) continue;
    if (!key.startsWith("urn:")) continue;
    if (
      key === SCIM_SCHEMAS.CORE_USER &&
      (!isPlainObject(value) || Object.keys(value).length === 0)
    ) {
      continue;
    }
    result[key] = value;
  }
  return result;
}
