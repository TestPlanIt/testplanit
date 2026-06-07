/**
 * SCIM Users service layer.
 *
 * Owns every SCIM user mutation's `prisma.$transaction` boundary and composes
 * the SCIM mapper, filter translator, PATCH applier, and webhook emitters
 * into six entry points the SCIM route layer calls:
 *
 *   - createScimUser  (POST   /scim/v2/Users)
 *   - getScimUserById (GET    /scim/v2/Users/{id})
 *   - listScimUsers   (GET    /scim/v2/Users?filter=...)
 *   - putScimUser     (PUT    /scim/v2/Users/{id})
 *   - patchScimUser   (PATCH  /scim/v2/Users/{id})
 *   - deleteScimUser  (DELETE /scim/v2/Users/{id})
 *
 * Discipline:
 *   - Uses the raw `~/lib/prisma` client. The SCIM bearer is the auth
 *     boundary; ZenStack access policies do NOT apply to SCIM mutations.
 *   - Every mutation opens its own `prisma.$transaction(async tx => ...)`.
 *     Webhook emission and audit-row writes happen INSIDE the tx so the
 *     outbox row commits or rolls back together with the entity write.
 *   - Prisma errors (P2002, P2025, foreign-key) are NEVER swallowed; the
 *     route layer maps them to the SCIM error envelope.
 *   - All webhook emits go through the named emitter helpers in
 *     `~/lib/webhooks/event-emitters/userEvents`; this service never calls
 *     the outbox emit primitive inline.
 *
 * Discriminator audit conventions (mirrored by Phase 8's conflict-log query):
 *   - metadata.scimLinked:            POST hit an existing JIT row (HTTP 200)
 *   - metadata.scimResurrected:       POST hit a tombstoned row, same external id
 *   - metadata.scimPasswordDropped:   POST/PUT body included a `password` field
 *   - metadata.scimNoOp:              PUT/PATCH produced an empty column diff
 */

import { hash } from "bcrypt";
import crypto from "crypto";

import { Prisma } from "@prisma/client";
import { prisma } from "~/lib/prisma";
import { captureAuditEvent } from "~/lib/services/auditLog";
import {
  emitScimUserCreated,
  emitScimUserDeleted,
  emitScimUserUpdated,
} from "~/lib/webhooks/event-emitters/userEvents";

import {
  SCIM_SCHEMAS,
  SCIM_SYSTEM_USER_ID,
  SYSTEM_PROJECT_ID,
} from "../constants";
import { scimError } from "../errors";
import { scimFilterToPrismaWhere } from "../filter";
import {
  computeUserUpdatesFromScim,
  deriveDisplayName,
  extractNonWritableUrns,
  extractPrimaryEmail,
  mergeExtensions,
  userToScim,
} from "../mapping/user";
import { applyScimPatch, ScimPatchApplyError } from "../patch";
import { touchLastSync } from "../token-telemetry";

import type { NextResponse } from "next/server";
import type { ScimPatch } from "scim-patch";

import type { ScimAuthContext } from "~/lib/scim/auth";
import type {
  PrismaUserForScim,
  ScimUserBody,
  ScimUserResource,
  ScimUserUpdatePayload,
} from "../mapping/user";

/**
 * Carrier for an existing row that the IdP collided with: case-insensitive
 * email match yields a row that may already be SCIM-managed, may be a
 * JIT-link candidate, or may be a tombstoned row eligible for resurrection.
 */
type ExistingUser = NonNullable<Awaited<ReturnType<typeof findUserByEmail>>>;

/**
 * Bytes of entropy used to generate the unused-but-stored password hash on a
 * brand-new SCIM-provisioned user. The hash satisfies legacy password-history
 * expectations without ever being a valid sign-in credential (SCIM users sign
 * in via SSO; the JIT-bind path flips authMethod once they do).
 */
const RANDOM_PASSWORD_BYTES = 32;

const DEFAULT_LIST_COUNT = 100;
const MAX_LIST_COUNT = 200;

/**
 * Writable column surface — the union of Prisma columns this service writes
 * for SCIM-driven mutations. The `computeUserUpdatesFromScim` mapper already
 * filters its output to this set; the service additionally inspects every
 * update payload as defense-in-depth so an unknown attribute leak surfaces
 * as a `mutability` 400 instead of a silent column write.
 */
const WRITABLE_KEYS: ReadonlySet<keyof ScimUserUpdatePayload> = new Set([
  "scimUserName",
  "scimExternalId",
  "scimGivenName",
  "scimFamilyName",
  "name",
  "email",
  "isActive",
  "scimExtensions",
]);

/* -------------------------------------------------------------------------- */
/* Error types                                                                */
/* -------------------------------------------------------------------------- */

/** Thrown when a SCIM uniqueness invariant is violated (route maps to 409). */
export class ScimUniquenessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScimUniquenessError";
  }
}

/** Thrown when the requested row does not exist or is tombstoned (route → 404). */
export class ScimNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScimNotFoundError";
  }
}

/**
 * Thrown when the body fails a SCIM-layer validation invariant that has no
 * dedicated mapper. Carries a pre-built `NextResponse` so the route handler
 * can return it verbatim, matching the `ScimPatchApplyError` discipline.
 */
export class ScimValidationError extends Error {
  constructor(public readonly response: NextResponse) {
    super("SCIM validation failed");
    this.name = "ScimValidationError";
  }
}

/* -------------------------------------------------------------------------- */
/* Result types                                                               */
/* -------------------------------------------------------------------------- */

export interface CreateScimUserResult {
  resource: ScimUserResource;
  /**
   * `true` when the POST bound to an existing JIT row (no scimExternalId
   * previously) — the route returns HTTP 200 to honestly signal
   * "found-and-updated". `false` for every other path (brand-new insert OR
   * tombstone resurrection); the route returns HTTP 201.
   */
  linked: boolean;
}

export interface PutScimUserResult {
  resource: ScimUserResource;
  status: 200;
}

export interface PatchScimUserResult {
  resource: ScimUserResource;
}

export interface DeleteScimUserResult {
  status: 204;
}

export interface ListScimUsersInput {
  filter?: string;
  startIndex?: number;
  count?: number;
}

export interface ListScimUsersResult {
  resources: ScimUserResource[];
  totalResults: number;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const SCIM_USER_INCLUDE = {
  groups: { include: { group: true } },
} as const;

const DEFAULT_EMIT_OPTS = {
  projectId: SYSTEM_PROJECT_ID,
  actorUserId: SCIM_SYSTEM_USER_ID,
} as const;

function findUserByEmail(tx: Prisma.TransactionClient, email: string) {
  return tx.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    include: SCIM_USER_INCLUDE,
  });
}

function resolveMatchEmail(body: ScimUserBody): string {
  const primary = extractPrimaryEmail(body.emails);
  if (primary && primary.length > 0) return primary;
  // Okta's default-app pattern sends userName = email; the second branch
  // covers IdPs that omit `emails` entirely on a minimal POST.
  return body.userName;
}

function assertWritableOnly(updates: ScimUserUpdatePayload): void {
  for (const key of Object.keys(updates) as Array<
    keyof ScimUserUpdatePayload
  >) {
    if (!WRITABLE_KEYS.has(key)) {
      throw new ScimPatchApplyError(
        scimError(
          400,
          "mutability",
          "Attribute is not user-modifiable via SCIM"
        )
      );
    }
  }
}

/**
 * Coerce a `Record<string, unknown> | null | undefined` blob into the Prisma
 * input type for a nullable Json column. Plain JS `null` is ambiguous to
 * Prisma; the explicit `Prisma.DbNull` sentinel signals "set the column to
 * SQL NULL" without colliding with `Prisma.JsonNull` (the JSON `null` value).
 */
function toJsonInput(
  value: Record<string, unknown> | null | undefined
): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.DbNull;
  return value as Prisma.InputJsonValue;
}

function asScimSnapshot(row: PrismaUserForScim & { isActive: boolean }) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    scimUserName: row.scimUserName,
    scimExternalId: row.scimExternalId,
    isActive: row.isActive,
    createdAt: row.createdAt,
    scimExtensions: row.scimExtensions,
  };
}

/* -------------------------------------------------------------------------- */
/* createScimUser — POST /scim/v2/Users                                       */
/* -------------------------------------------------------------------------- */

export async function createScimUser(
  body: ScimUserBody,
  ctx: ScimAuthContext
): Promise<CreateScimUserResult> {
  const result = await prisma.$transaction(async (tx) => {
    const matchEmail = resolveMatchEmail(body);
    const existing = await findUserByEmail(tx, matchEmail);

    // Branch 1 — Resurrection: tombstoned row with the SAME scimExternalId.
    if (
      existing &&
      existing.isDeleted &&
      existing.scimExternalId &&
      body.externalId &&
      existing.scimExternalId === body.externalId
    ) {
      return resurrectTombstonedUser(tx, existing, body, ctx);
    }

    if (existing) {
      // Tombstoned row with a DIFFERENT external id — uniqueness conflict
      // (email is @unique; resurrecting under a different IdP identity would
      // silently overwrite a previously-distinct user).
      if (existing.isDeleted) {
        throw new ScimUniquenessError("userName already exists");
      }

      // Branch 2 — JIT bind: live row with no SCIM identity yet. UPDATE the
      // SCIM identity columns and return linked:true so the route returns 200.
      if (!existing.scimExternalId) {
        return jitBindExistingUser(tx, existing, body, ctx);
      }

      // Both rows live AND already SCIM-managed — true conflict.
      throw new ScimUniquenessError("userName already exists");
    }

    // Branch 3 — Brand-new insert.
    return insertNewScimUser(tx, body, ctx);
  });
  touchLastSync(ctx.tokenId);
  return result;
}

async function resurrectTombstonedUser(
  tx: Prisma.TransactionClient,
  existing: ExistingUser,
  body: ScimUserBody,
  ctx: ScimAuthContext
): Promise<CreateScimUserResult> {
  const extensions = mergeExtensions(
    existing.scimExtensions,
    extractNonWritableUrns(body as unknown as Record<string, unknown>)
  );

  const resurrected = await tx.user.update({
    where: { id: existing.id },
    data: {
      isDeleted: false,
      isActive: body.active ?? true,
      scimUserName: body.userName.toLowerCase(),
      scimExternalId: body.externalId ?? existing.scimExternalId,
      scimGivenName: body.name?.givenName ?? null,
      scimFamilyName: body.name?.familyName ?? null,
      name: deriveDisplayName(body),
      email: extractPrimaryEmail(body.emails) ?? existing.email,
      scimExtensions: toJsonInput(extensions),
    },
    include: SCIM_USER_INCLUDE,
  });

  await emitScimUserCreated(resurrected, tx, DEFAULT_EMIT_OPTS);
  await captureAuditEvent({
    action: "CREATE",
    entityType: "User",
    entityId: resurrected.id,
    metadata: { scimResurrected: true, scimTokenId: ctx.tokenId },
  });

  if (body.password !== undefined) {
    await captureAuditEvent({
      action: "UPDATE",
      entityType: "User",
      entityId: resurrected.id,
      metadata: { scimPasswordDropped: true, scimTokenId: ctx.tokenId },
    });
  }

  return { resource: userToScim(resurrected), linked: false };
}

async function jitBindExistingUser(
  tx: Prisma.TransactionClient,
  existing: ExistingUser,
  body: ScimUserBody,
  ctx: ScimAuthContext
): Promise<CreateScimUserResult> {
  const extensions = mergeExtensions(
    existing.scimExtensions,
    extractNonWritableUrns(body as unknown as Record<string, unknown>)
  );

  const before = asScimSnapshot(existing);
  const linked = await tx.user.update({
    where: { id: existing.id },
    data: {
      scimUserName: body.userName.toLowerCase(),
      scimExternalId: body.externalId ?? null,
      scimGivenName: body.name?.givenName ?? null,
      scimFamilyName: body.name?.familyName ?? null,
      scimExtensions: toJsonInput(extensions),
    },
    include: SCIM_USER_INCLUDE,
  });

  await emitScimUserUpdated(
    before,
    asScimSnapshot(linked),
    tx,
    DEFAULT_EMIT_OPTS
  );
  await captureAuditEvent({
    action: "UPDATE",
    entityType: "User",
    entityId: linked.id,
    metadata: { scimLinked: true, scimTokenId: ctx.tokenId },
  });

  if (body.password !== undefined) {
    await captureAuditEvent({
      action: "UPDATE",
      entityType: "User",
      entityId: linked.id,
      metadata: { scimPasswordDropped: true, scimTokenId: ctx.tokenId },
    });
  }

  return { resource: userToScim(linked), linked: true };
}

async function insertNewScimUser(
  tx: Prisma.TransactionClient,
  body: ScimUserBody,
  ctx: ScimAuthContext
): Promise<CreateScimUserResult> {
  const defaultRole = await tx.roles.findFirst({
    where: { isDefault: true, isDeleted: false },
  });
  if (!defaultRole) {
    throw new Error("No default role configured");
  }

  const extensions = extractNonWritableUrns(
    body as unknown as Record<string, unknown>
  );

  const randomPassword = await hash(
    crypto.randomBytes(RANDOM_PASSWORD_BYTES).toString("base64"),
    10
  );

  const created = await tx.user.create({
    data: {
      email: extractPrimaryEmail(body.emails) ?? body.userName,
      name: deriveDisplayName(body),
      scimUserName: body.userName.toLowerCase(),
      scimExternalId: body.externalId ?? null,
      scimGivenName: body.name?.givenName ?? null,
      scimFamilyName: body.name?.familyName ?? null,
      scimExtensions:
        Object.keys(extensions).length > 0
          ? (extensions as Prisma.InputJsonValue)
          : undefined,
      authMethod: "SCIM",
      access: "NONE",
      roleId: defaultRole.id,
      isActive: body.active ?? true,
      isDeleted: false,
      password: randomPassword,
    },
    include: SCIM_USER_INCLUDE,
  });

  await emitScimUserCreated(created, tx, DEFAULT_EMIT_OPTS);
  await captureAuditEvent({
    action: "CREATE",
    entityType: "User",
    entityId: created.id,
    metadata: { scimTokenId: ctx.tokenId },
  });

  if (body.password !== undefined) {
    await captureAuditEvent({
      action: "UPDATE",
      entityType: "User",
      entityId: created.id,
      metadata: { scimPasswordDropped: true, scimTokenId: ctx.tokenId },
    });
  }

  return { resource: userToScim(created), linked: false };
}

/* -------------------------------------------------------------------------- */
/* getScimUserById — GET /scim/v2/Users/{id}                                  */
/* -------------------------------------------------------------------------- */

export async function getScimUserById(
  id: string,
  _ctx: ScimAuthContext
): Promise<ScimUserResource> {
  const row = await prisma.user.findUnique({
    where: { id },
    include: SCIM_USER_INCLUDE,
  });
  if (!row || row.isDeleted) {
    throw new ScimNotFoundError(`User ${id} not found`);
  }
  return userToScim(row);
}

/* -------------------------------------------------------------------------- */
/* listScimUsers — GET /scim/v2/Users                                         */
/* -------------------------------------------------------------------------- */

export async function listScimUsers(
  { filter, startIndex, count }: ListScimUsersInput,
  _ctx: ScimAuthContext
): Promise<ListScimUsersResult> {
  const resolvedCount =
    count === undefined
      ? DEFAULT_LIST_COUNT
      : Math.min(Math.max(1, count), MAX_LIST_COUNT);
  const resolvedSkip = Math.max(0, (startIndex ?? 1) - 1);

  const filterWhere: Prisma.UserWhereInput = filter
    ? scimFilterToPrismaWhere(filter)
    : {};

  const finalWhere: Prisma.UserWhereInput = {
    AND: [filterWhere, { isDeleted: false }],
  };

  const [rows, totalResults] = await Promise.all([
    prisma.user.findMany({
      where: finalWhere,
      include: SCIM_USER_INCLUDE,
      skip: resolvedSkip,
      take: resolvedCount,
      orderBy: { id: "asc" },
    }),
    prisma.user.count({ where: finalWhere }),
  ]);

  return {
    resources: rows.map((r) => userToScim(r)),
    totalResults,
  };
}

/* -------------------------------------------------------------------------- */
/* putScimUser — PUT /scim/v2/Users/{id}                                      */
/* -------------------------------------------------------------------------- */

export async function putScimUser(
  id: string,
  body: ScimUserBody,
  ctx: ScimAuthContext
): Promise<PutScimUserResult> {
  const result: PutScimUserResult = await prisma.$transaction(async (tx) => {
    const current = await tx.user.findUnique({
      where: { id },
      include: SCIM_USER_INCLUDE,
    });
    if (!current || current.isDeleted) {
      throw new ScimNotFoundError(`User ${id} not found`);
    }

    const updates: Prisma.UserUpdateInput = {};

    // userName (always present in a PUT per RFC 7643)
    if (typeof body.userName === "string") {
      const next = body.userName.toLowerCase();
      if (next !== current.scimUserName) {
        updates.scimUserName = next;
      }
    }

    // externalId: explicit null clears; omitted leaves alone.
    if ("externalId" in body) {
      const next = body.externalId ?? null;
      if (next !== current.scimExternalId) {
        updates.scimExternalId = next;
      }
    }

    // name.givenName / name.familyName / formatted
    if ("name" in body && body.name !== undefined) {
      const n = body.name as {
        givenName?: string | null;
        familyName?: string | null;
        formatted?: string | null;
      };
      if ("givenName" in n) {
        const next = n.givenName ?? null;
        if (next !== current.scimGivenName) {
          updates.scimGivenName = next;
        }
      }
      if ("familyName" in n) {
        const next = n.familyName ?? null;
        if (next !== current.scimFamilyName) {
          updates.scimFamilyName = next;
        }
      }
      const derived = deriveDisplayName(body);
      if (derived !== current.name) {
        updates.name = derived;
      }
    }

    // emails — primary email maps to User.email (NOT NULL).
    if ("emails" in body) {
      const nextEmail = extractPrimaryEmail(body.emails);
      if (nextEmail === undefined) {
        throw new ScimValidationError(
          scimError(400, "invalidValue", "email is required")
        );
      }
      if (nextEmail !== current.email) {
        updates.email = nextEmail;
      }
    }

    // active
    if (typeof body.active === "boolean" && body.active !== current.isActive) {
      updates.isActive = body.active;
    }

    // scimExtensions: SELECT-then-merge with the incoming non-writable URN
    // partition; preserves URN buckets the IdP did not touch.
    const incomingExtensions = extractNonWritableUrns(
      body as unknown as Record<string, unknown>
    );
    if (Object.keys(incomingExtensions).length > 0) {
      const merged = mergeExtensions(
        current.scimExtensions,
        incomingExtensions
      );
      if (JSON.stringify(merged) !== JSON.stringify(current.scimExtensions)) {
        const json = toJsonInput(merged);
        if (json !== undefined) {
          updates.scimExtensions = json;
        }
      }
    }

    // password warning — fired regardless of whether updates are otherwise
    // empty; the audit row carries the diagnostic.
    if (body.password !== undefined) {
      await captureAuditEvent({
        action: "UPDATE",
        entityType: "User",
        entityId: current.id,
        metadata: { scimPasswordDropped: true, scimTokenId: ctx.tokenId },
      });
    }

    // No-op suppression: skip emit, write scimNoOp:true audit, return current.
    if (Object.keys(updates).length === 0) {
      await captureAuditEvent({
        action: "UPDATE",
        entityType: "User",
        entityId: current.id,
        metadata: { scimNoOp: true, scimTokenId: ctx.tokenId },
      });
      return { resource: userToScim(current), status: 200 };
    }

    const before = asScimSnapshot(current);
    const updated = await tx.user.update({
      where: { id: current.id },
      data: updates,
      include: SCIM_USER_INCLUDE,
    });

    await emitScimUserUpdated(
      before,
      asScimSnapshot(updated),
      tx,
      DEFAULT_EMIT_OPTS
    );
    await captureAuditEvent({
      action: "UPDATE",
      entityType: "User",
      entityId: updated.id,
      metadata: { scimTokenId: ctx.tokenId },
    });

    return { resource: userToScim(updated), status: 200 };
  });
  touchLastSync(ctx.tokenId);
  return result;
}

/* -------------------------------------------------------------------------- */
/* patchScimUser — PATCH /scim/v2/Users/{id}                                  */
/* -------------------------------------------------------------------------- */

export async function patchScimUser(
  id: string,
  body: ScimPatch,
  ctx: ScimAuthContext
): Promise<PatchScimUserResult> {
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.user.findUnique({
      where: { id },
      include: SCIM_USER_INCLUDE,
    });
    if (!current || current.isDeleted) {
      throw new ScimNotFoundError(`User ${id} not found`);
    }

    const currentScim = userToScim(current);
    const draftScim = applyScimPatch(currentScim, body);
    const updates = computeUserUpdatesFromScim(currentScim, draftScim);

    assertWritableOnly(updates);

    // scimExtensions PATCH preserves untouched URN buckets even when the
    // draft only carried a subset of URNs (the mapper already returns the
    // draft's complete URN bucket; we merge with current to be safe).
    if ("scimExtensions" in updates && updates.scimExtensions !== undefined) {
      const merged = mergeExtensions(
        current.scimExtensions,
        updates.scimExtensions ?? {}
      );
      updates.scimExtensions = merged;
    }

    if (Object.keys(updates).length === 0) {
      await captureAuditEvent({
        action: "UPDATE",
        entityType: "User",
        entityId: current.id,
        metadata: { scimNoOp: true, scimTokenId: ctx.tokenId },
      });
      return { resource: userToScim(current) };
    }

    const before = asScimSnapshot(current);
    const updated = await tx.user.update({
      where: { id: current.id },
      data: updates as Prisma.UserUpdateInput,
      include: SCIM_USER_INCLUDE,
    });

    // Mid-session deactivation: delete the user's Account rows so the next
    // login attempt forces re-authentication through the IdP.
    if (updates.isActive === false) {
      await tx.account.deleteMany({ where: { userId: current.id } });
    }

    await emitScimUserUpdated(
      before,
      asScimSnapshot(updated),
      tx,
      DEFAULT_EMIT_OPTS
    );
    await captureAuditEvent({
      action: "UPDATE",
      entityType: "User",
      entityId: updated.id,
      metadata: { scimTokenId: ctx.tokenId },
    });

    return { resource: userToScim(updated) };
  });
  touchLastSync(ctx.tokenId);
  return result;
}

/* -------------------------------------------------------------------------- */
/* deleteScimUser — DELETE /scim/v2/Users/{id}                                */
/* -------------------------------------------------------------------------- */

export async function deleteScimUser(
  id: string,
  ctx: ScimAuthContext
): Promise<DeleteScimUserResult> {
  const result: DeleteScimUserResult = await prisma.$transaction(async (tx) => {
    const current = await tx.user.findUnique({
      where: { id },
      include: SCIM_USER_INCLUDE,
    });
    if (!current) {
      throw new ScimNotFoundError(`User ${id} not found`);
    }
    if (current.isDeleted) {
      // Idempotent — already tombstoned; no second webhook, no audit.
      return { status: 204 };
    }

    const tombstoned = await tx.user.update({
      where: { id: current.id },
      data: { isActive: false, isDeleted: true },
      include: SCIM_USER_INCLUDE,
    });

    await emitScimUserDeleted(tombstoned, tx, DEFAULT_EMIT_OPTS);
    await captureAuditEvent({
      action: "DELETE",
      entityType: "User",
      entityId: tombstoned.id,
      metadata: { scimTokenId: ctx.tokenId },
    });

    // Account-row cleanup runs inside the same tx so a tombstoned user
    // cannot re-establish a session via a stale Account row.
    await tx.account.deleteMany({ where: { userId: tombstoned.id } });

    // ctx referenced to keep the parameter intentional for future actor-
    // attribution overrides; the audit row carries scimTokenId via the ALS
    // frame the bearer middleware sets, with the metadata above as fallback.
    void ctx;

    return { status: 204 };
  });
  touchLastSync(ctx.tokenId);
  return result;
}

export { ScimPatchApplyError };
