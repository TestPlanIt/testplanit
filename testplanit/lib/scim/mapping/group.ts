/**
 * Pure, DB-free, log-free bidirectional SCIM ↔ Prisma Groups mapper.
 *
 * This module is the single source of truth for translating between SCIM JSON
 * Group resources (per RFC 7643 §4.2) and the Prisma `Groups` row shape.
 * Service layers compose these primitives; routes never inline mapping logic.
 *
 * Purity discipline (mirrors the User mapper in this same directory):
 *   - No imports from any runtime DB client.
 *   - No stdout/stderr writes, no log helpers.
 *   - No module-level mutable state.
 *   - No side effects on inputs (returns fresh objects).
 *
 * Storage rules encoded here:
 *   - `Groups.name` is the canonical, mixed-case display label rendered to
 *     admins; it is also what every SCIM GET emits as `displayName`.
 *   - `Groups.scimDisplayName` is the case-folded mirror written on every SCIM
 *     mutation. Filter operators (`displayName eq`) compare against it so
 *     RFC 7644 §3.4.2.2's case-insensitive equality is honored without runtime
 *     `LOWER(...)` on every read.
 *   - PATCH `displayName` re-derives `Groups.name` from the IdP's payload — the
 *     IdP wins on sync; the audit row carries the diagnostic discriminator.
 *
 * Anti-pattern guards (enforced by tests + grep):
 *   - The mapper NEVER reads or writes the existing SAML/OAuth `User.externalId`
 *     surface. The only externalId touched here is `Groups.externalId`.
 *   - Top-level `__proto__` / `constructor` / `prototype` keys are filtered
 *     before treating an object as a URN bucket (prototype-pollution guard).
 */

import { SCIM_SCHEMAS } from "../constants";
import { scimLocation } from "../responses";

export interface ScimGroupMember {
  /** User id (the canonical FK target on `GroupAssignment.userId`). */
  value: string;
  /** Informational display string supplied by the IdP. Service-side ignored. */
  display?: string;
  /** RFC 7643 §4.2 optional type discriminator (e.g. "User"). */
  type?: string;
  /** RFC 7643 §4.2 optional resource reference URI. */
  $ref?: string;
}

export interface ScimGroupBody {
  schemas?: string[];
  externalId?: string;
  displayName: string;
  members?: ScimGroupMember[];
  /** Top-level URN-keyed extension buckets are passed through verbatim. */
  [urn: string]: unknown;
}

export interface ScimGroupMeta {
  resourceType: "Group";
  location: string;
  version: string;
  lastModified: string;
}

export interface ScimGroupResource {
  schemas: string[];
  id: string;
  displayName: string;
  externalId?: string;
  members: ScimGroupMember[];
  meta: ScimGroupMeta;
  [urn: string]: unknown;
}

export interface DbGroupForScim {
  id: number;
  name: string;
  externalId: string | null;
  scimDisplayName: string | null;
  scimExtensions: unknown;
  updatedAt: Date | null;
  isDeleted: boolean;
  assignedUsers?: Array<{ user: { id: string; name: string } }>;
}

export interface ScimGroupCreatePayload {
  name: string;
  scimDisplayName: string;
  externalId: string | null;
  members: ScimGroupMember[];
  scimExtensions: Record<string, unknown> | null;
}

export interface ScimGroupUpdatePayload {
  name?: string;
  scimDisplayName?: string;
  externalId?: string;
  scimExtensions?: Record<string, unknown> | null;
}

export interface ComputeGroupUpdatesResult {
  updates: ScimGroupUpdatePayload;
  replacedUrns: string[];
}

/**
 * Top-level SCIM Group body keys that NEVER land in `scimExtensions` —
 * they're either core-writable surface, server-managed metadata, or
 * the schemas advertisement array.
 */
const NON_EXTENSION_BODY_KEYS = new Set([
  "schemas",
  "id",
  "displayName",
  "externalId",
  "members",
  "meta",
]);

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
 * Partition every top-level URN-keyed bucket from a SCIM Group body into a
 * fresh object. The result is exactly the JSON blob persisted to
 * `Groups.scimExtensions` so a subsequent SCIM GET re-emits the IdP's
 * extension payload verbatim.
 *
 * Rules:
 *   - Any top-level body key starting with `urn:` is copied verbatim.
 *   - Core writable keys (`displayName`, `externalId`, `members`, ...) are
 *     dropped — they live in dedicated columns, not in the extension blob.
 *   - `schemas`, `id`, and `meta` are dropped — server-managed.
 *   - Hostile keys (`__proto__`, `constructor`, `prototype`) are filtered.
 *   - If `schemas` advertises an extension URN that has no top-level payload
 *     attribute (the canonical entra-style empty-bucket case), the URN still
 *     surfaces as an empty bucket so the read-side re-emits the original
 *     `schemas` array.
 */
function extractNonWritableUrns(
  body: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(body)) {
    if (!isSafeKey(key)) continue;
    if (NON_EXTENSION_BODY_KEYS.has(key)) continue;

    if (key.startsWith("urn:")) {
      if (isPlainObject(value)) {
        result[key] = { ...value };
      } else {
        result[key] = value;
      }
    }
  }

  if (Array.isArray(body.schemas)) {
    for (const schema of body.schemas) {
      if (
        typeof schema === "string" &&
        schema.startsWith("urn:") &&
        schema !== SCIM_SCHEMAS.CORE_GROUP &&
        isSafeKey(schema) &&
        !(schema in result)
      ) {
        result[schema] = {};
      }
    }
  }

  return result;
}

/**
 * Pure projection of an inbound SCIM members array to the list of user ids
 * the service layer must validate against the `User` table. Entries without a
 * string-typed `value` are dropped defensively — malformed inbound payloads
 * should be skipped rather than blow up the surrounding tx.
 */
export function extractMemberIds(members: ScimGroupMember[]): string[] {
  if (!Array.isArray(members)) return [];
  const result: string[] = [];
  for (const m of members) {
    if (
      m &&
      typeof (m as ScimGroupMember).value === "string" &&
      (m as ScimGroupMember).value.length > 0
    ) {
      result.push((m as ScimGroupMember).value);
    }
  }
  return result;
}

/**
 * Compute the canonical, mixed-case `Groups.name` value implied by a SCIM
 * body delta. Returns `undefined` when the body does not touch displayName
 * so the caller can short-circuit the column write.
 */
export function deriveDisplayName(
  _current: DbGroupForScim,
  body: Partial<ScimGroupBody>
): string | undefined {
  if (typeof body.displayName !== "string") return undefined;
  return body.displayName;
}

/**
 * Translate a SCIM POST/PUT body into a Prisma create payload covering only
 * the writable SCIM surface on `Groups`.
 *
 * Storage rules:
 *   - `name` is the verbatim mixed-case label the IdP supplied (admins keep an
 *     editable copy; the IdP-wins-on-sync diff in
 *     `computeGroupUpdatesFromScim` re-derives it on every PATCH).
 *   - `scimDisplayName` is lowercased once at the write boundary so filter
 *     equality compares against a single canonical form.
 *   - `externalId` is stored verbatim; null when the IdP did not supply one.
 *   - `members` is forwarded as-is for the service layer to fan out into
 *     `GroupAssignment` rows inside its `db.$transaction`.
 *   - `scimExtensions` captures every top-level URN-keyed bucket partitioned
 *     by URN so reads round-trip the IdP's original extension payload.
 */
export function scimToGroupCreate(body: ScimGroupBody): ScimGroupCreatePayload {
  const extensions = extractNonWritableUrns(
    body as unknown as Record<string, unknown>
  );

  return {
    name: body.displayName,
    scimDisplayName: body.displayName.toLowerCase(),
    externalId: body.externalId ?? null,
    members: Array.isArray(body.members) ? body.members : [],
    scimExtensions: Object.keys(extensions).length > 0 ? extensions : null,
  };
}

/**
 * Translate a Prisma `Groups` row into a SCIM Group resource ready for
 * serialization by the route handler. The `schemas` array always begins with
 * the core Group URN and is then extended with every URN key present in
 * `scimExtensions`.
 *
 * Canonical display rule: the SCIM GET ALWAYS emits `Groups.name` as the
 * `displayName` attribute — never the lowercased `scimDisplayName`. This
 * lets admins use the platform's existing case-preserving group label in the
 * IdP's directory listing while still backing filter equality with a folded
 * form on the write boundary.
 */
export function groupToScim(group: DbGroupForScim): ScimGroupResource {
  const extensions = isPlainObject(group.scimExtensions)
    ? group.scimExtensions
    : undefined;

  const extraUrns = extensions
    ? Object.keys(extensions).filter(
        (k) => k.startsWith("urn:") && k !== SCIM_SCHEMAS.CORE_GROUP
      )
    : [];

  const schemas = [SCIM_SCHEMAS.CORE_GROUP, ...extraUrns];

  const versionDate =
    group.updatedAt?.toISOString() ?? new Date().toISOString();

  const members: ScimGroupMember[] = (group.assignedUsers ?? []).map((a) => ({
    value: a.user.id,
    display: a.user.name,
  }));

  const resource: ScimGroupResource = {
    schemas,
    id: String(group.id),
    displayName: group.name,
    externalId: group.externalId ?? undefined,
    members,
    meta: {
      resourceType: "Group",
      location: scimLocation("Groups", String(group.id)),
      version: versionDate,
      lastModified: versionDate,
    },
  };

  if (extensions) {
    for (const urn of extraUrns) {
      if (isSafeKey(urn)) {
        resource[urn] = extensions[urn];
      }
    }
  }

  return resource;
}

/**
 * Pure diff between the current Prisma Group state and an inbound SCIM body
 * delta. Returns only the writable columns that actually changed plus the
 * list of URN buckets the IdP replaced (so the service knows which buckets
 * to clear before the SELECT-then-merge write).
 *
 * Display name re-derivation:
 *   - When the IdP supplies a `displayName` that differs from the current
 *     `scimDisplayName` (case-insensitively), both `Groups.name` and
 *     `Groups.scimDisplayName` are written: the IdP wins on every sync.
 *   - When the IdP supplies the same `displayName` (case-insensitively),
 *     neither column is touched — even if an admin had renamed `Groups.name`
 *     since the last sync. The audit-row discriminator is stamped by the
 *     service layer, not here.
 *
 * scimExtensions merge:
 *   - URN buckets that appear in the body REPLACE the matching bucket in
 *     `current.scimExtensions` at the URN level (never deep-merged).
 *   - URN buckets present in `current.scimExtensions` but absent from the body
 *     are preserved.
 *   - The returned `replacedUrns` lists every URN the body replaced; the
 *     service layer can use it for audit-metadata or webhook payloads.
 */
export function computeGroupUpdatesFromScim(
  current: DbGroupForScim,
  body: Partial<ScimGroupBody>
): ComputeGroupUpdatesResult {
  const updates: ScimGroupUpdatePayload = {};
  const replacedUrns: string[] = [];

  if (typeof body.displayName === "string") {
    const incomingLowered = body.displayName.toLowerCase();
    const currentScim = current.scimDisplayName ?? "";
    if (incomingLowered !== currentScim.toLowerCase()) {
      updates.scimDisplayName = incomingLowered;
      updates.name = body.displayName;
    }
  }

  if (
    typeof body.externalId === "string" &&
    body.externalId !== current.externalId
  ) {
    updates.externalId = body.externalId;
  }

  const incomingUrns: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!isSafeKey(key)) continue;
    if (!key.startsWith("urn:")) continue;
    if (key === SCIM_SCHEMAS.CORE_GROUP) continue;
    incomingUrns[key] = value;
    replacedUrns.push(key);
  }

  if (replacedUrns.length > 0) {
    const currentExt = isPlainObject(current.scimExtensions)
      ? current.scimExtensions
      : {};
    const merged: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(currentExt)) {
      if (isSafeKey(k)) merged[k] = v;
    }
    for (const [k, v] of Object.entries(incomingUrns)) {
      merged[k] = v;
    }
    updates.scimExtensions = merged;
  }

  return { updates, replacedUrns };
}
