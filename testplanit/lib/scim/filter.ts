/**
 * SCIM 2.0 filter translator — wraps `scim2-parse-filter` with a closed-set
 * whitelist gate and emits Prisma WHERE objects suitable for the User model.
 *
 * Two architectural guarantees over the bare library:
 *
 *   1. **Closed attribute whitelist.** Only six attributes — `userName`,
 *      `externalId`, `active`, `emails.value`, `name.givenName`,
 *      `name.familyName` — are filterable. Every other attrPath (including
 *      URN-prefixed enterprise-extension paths) is rejected with
 *      `InvalidFilterError` BEFORE any Prisma WHERE shape is constructed.
 *
 *   2. **Closed operator whitelist.** Only `eq`, `pr`, and `and` are supported.
 *      `ne` / `co` / `sw` / `ew` / `gt` / `lt` / `ge` / `le` / `or` / `not` /
 *      `[]` (valuePath) all throw `InvalidFilterError`. The translator only
 *      emits `UserWhereInput` literal objects and never template-
 *      strings user input into a SQL fragment — adversarial compValue lands
 *      as a literal string inside a Prisma WHERE that Prisma's parameterized
 *      query layer handles.
 *
 * The translator is a pure function: no DB access, no logger, no module-level
 * side effects. The route layer catches `InvalidFilterError` and maps it onto
 * the existing `scimError(400, "invalidFilter", message)` envelope.
 *
 * Case-folding rules (locked at the planning layer):
 *   - `userName` compValue is lowercased on the way in to match the
 *     `User.scimUserName @unique` column that the mapper writes lowercased.
 *   - `externalId` compValue is preserved verbatim (IdP-opaque GUID).
 *   - `emails.value` uses Prisma's `mode: "insensitive"` (User.email is
 *     `@email`-shaped; case differences are not semantically meaningful).
 *   - `name.givenName` and `name.familyName` compValue is preserved verbatim
 *     (display strings; IdP source-of-truth).
 *
 * Presence (`pr`) semantics:
 *   - Nullable columns (`scimUserName`, `scimExternalId`, `scimGivenName`,
 *     `scimFamilyName`) emit `{ not: null }`.
 *   - NOT NULL columns (`isActive`, `User.email`) emit the vacuous `{}` —
 *     every row matches, which is the correct semantic for "the attribute
 *     is present" on a non-nullable column.
 */

import { parse } from "scim2-parse-filter";

import type { GroupsWhereInput, UserWhereInput } from "~/zenstack/input";
import type { AndExp, Compare, Filter, Suffix } from "scim2-parse-filter";

/**
 * Thrown for every RFC-compliant rejection: unsupported operator,
 * non-whitelisted attribute, type mismatch, or upstream parse failure.
 * The message is the English `detail` string the route layer feeds to
 * `scimError(400, "invalidFilter", message)`.
 */
export class InvalidFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFilterError";
  }
}

/**
 * Closed set of filterable attribute paths. Membership is checked on the
 * literal attrPath string the parser yields, so URN-prefixed paths
 * (`urn:ietf:params:scim:...:employeeNumber`) miss the check by design.
 */
const FILTERABLE_ATTRS: ReadonlySet<string> = new Set([
  "userName",
  "externalId",
  "active",
  "emails.value",
  "name.givenName",
  "name.familyName",
]);

/**
 * Closed set of filterable Group attribute paths. Parallel to
 * `FILTERABLE_ATTRS` for the Groups SCIM resource; only `displayName` and
 * `externalId` are filterable (the locked Group whitelist).
 *
 * `members.value` is intentionally not included here — the membership-based
 * filter requires a different Prisma shape (a relation query against
 * `GroupAssignment` rather than a column predicate) and is unlocked
 * separately if and when a real IdP needs it.
 */
const FILTERABLE_GROUP_ATTRS: ReadonlySet<string> = new Set([
  "displayName",
  "externalId",
]);

/**
 * Parse a SCIM filter string and translate the AST into a
 * `UserWhereInput`. Throws {@link InvalidFilterError} for any
 * unsupported operator, non-whitelisted attribute, type mismatch, or
 * upstream parse error.
 */
export function scimFilterToPrismaWhere(raw: string): UserWhereInput {
  let ast: Filter;
  try {
    ast = parse(raw);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new InvalidFilterError(`Filter could not be parsed: ${detail}`);
  }
  return translate(ast);
}

function translate(node: Filter): UserWhereInput {
  switch (node.op) {
    case "eq":
      return translateEq(node as Compare);
    case "pr":
      return translatePr(node as Suffix);
    case "and":
      return { AND: (node as AndExp).filters.map(translate) };
    default:
      throw new InvalidFilterError(`Operator "${node.op}" not supported`);
  }
}

function translateEq(node: Compare): UserWhereInput {
  const attr = node.attrPath;
  assertFilterable(attr);

  switch (attr) {
    case "userName":
      return {
        scimUserName: {
          equals: requireString(attr, node.compValue).toLowerCase(),
        },
      };
    case "externalId":
      return {
        scimExternalId: { equals: requireString(attr, node.compValue) },
      };
    case "active":
      return { isActive: requireBoolean(attr, node.compValue) };
    case "emails.value":
      return {
        email: {
          equals: requireString(attr, node.compValue),
          mode: "insensitive",
        },
      };
    case "name.givenName":
      return { scimGivenName: { equals: requireString(attr, node.compValue) } };
    case "name.familyName":
      return {
        scimFamilyName: { equals: requireString(attr, node.compValue) },
      };
    /* istanbul ignore next — assertFilterable narrows the set */
    default:
      throw new InvalidFilterError(`Attribute "${attr}" not filterable`);
  }
}

function translatePr(node: Suffix): UserWhereInput {
  const attr = node.attrPath;
  assertFilterable(attr);

  switch (attr) {
    case "userName":
      return { scimUserName: { not: null } };
    case "externalId":
      return { scimExternalId: { not: null } };
    case "active":
      // isActive is NOT NULL — the presence check is vacuously true on every
      // row, so an empty WHERE is the correct Prisma translation.
      return {};
    case "emails.value":
      // User.email is NOT NULL — same vacuous-match rationale as `active`.
      return {};
    case "name.givenName":
      return { scimGivenName: { not: null } };
    case "name.familyName":
      return { scimFamilyName: { not: null } };
    /* istanbul ignore next — assertFilterable narrows the set */
    default:
      throw new InvalidFilterError(`Attribute "${attr}" not filterable`);
  }
}

function assertFilterable(attr: string): void {
  if (!FILTERABLE_ATTRS.has(attr)) {
    throw new InvalidFilterError(`Attribute "${attr}" not filterable`);
  }
}

function requireString(attr: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new InvalidFilterError(`Value for "${attr}" must be string`);
  }
  return value;
}

function requireBoolean(attr: string, value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new InvalidFilterError(`Value for "${attr}" must be boolean`);
  }
  return value;
}

/**
 * Parse a SCIM filter string in the Group context and translate the AST into
 * a `GroupsWhereInput`. Throws {@link InvalidFilterError} for any
 * unsupported operator, non-whitelisted attribute, type mismatch, or upstream
 * parse error.
 *
 * The Group whitelist is `{displayName, externalId}` and the operator set is
 * the same `{eq, pr, and}` as the User translator. `displayName` translates
 * to `scimDisplayName` with the compValue lowercased to match the
 * mapper-side case-folding convention; `externalId` is preserved verbatim
 * because it is an IdP-opaque identifier.
 */
export function scimFilterToPrismaGroupWhere(
  raw: string
): GroupsWhereInput {
  let ast: Filter;
  try {
    ast = parse(raw);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new InvalidFilterError(`Filter could not be parsed: ${detail}`);
  }
  return translateGroup(ast);
}

function translateGroup(node: Filter): GroupsWhereInput {
  switch (node.op) {
    case "eq":
      return translateGroupEq(node as Compare);
    case "pr":
      return translateGroupPr(node as Suffix);
    case "and":
      return { AND: (node as AndExp).filters.map(translateGroup) };
    default:
      throw new InvalidFilterError(`Operator "${node.op}" not supported`);
  }
}

function translateGroupEq(node: Compare): GroupsWhereInput {
  const attr = node.attrPath;
  assertGroupFilterable(attr);

  switch (attr) {
    case "displayName":
      return {
        scimDisplayName: {
          equals: requireString(attr, node.compValue).toLowerCase(),
        },
      };
    case "externalId":
      return { externalId: { equals: requireString(attr, node.compValue) } };
    /* istanbul ignore next — assertGroupFilterable narrows the set */
    default:
      throw new InvalidFilterError(`Attribute "${attr}" not filterable`);
  }
}

function translateGroupPr(node: Suffix): GroupsWhereInput {
  const attr = node.attrPath;
  assertGroupFilterable(attr);

  switch (attr) {
    case "displayName":
      return { scimDisplayName: { not: null } };
    case "externalId":
      return { externalId: { not: null } };
    /* istanbul ignore next — assertGroupFilterable narrows the set */
    default:
      throw new InvalidFilterError(`Attribute "${attr}" not filterable`);
  }
}

function assertGroupFilterable(attr: string): void {
  if (!FILTERABLE_GROUP_ATTRS.has(attr)) {
    throw new InvalidFilterError(`Attribute "${attr}" not filterable`);
  }
}
