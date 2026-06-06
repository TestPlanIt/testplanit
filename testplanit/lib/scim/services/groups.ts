/**
 * SCIM Groups service layer.
 *
 * Owns every SCIM Group mutation's `prisma.$transaction` boundary and composes
 * the SCIM Group mapper, filter translator, PATCH applier, and webhook
 * emitters into six entry points the SCIM route layer calls:
 *
 *   - createScimGroup  (POST   /scim/v2/Groups)
 *   - getScimGroupById (GET    /scim/v2/Groups/{id})
 *   - listScimGroups   (GET    /scim/v2/Groups?filter=...)
 *   - putScimGroup     (PUT    /scim/v2/Groups/{id})
 *   - patchScimGroup   (PATCH  /scim/v2/Groups/{id})
 *   - deleteScimGroup  (DELETE /scim/v2/Groups/{id})
 *
 * Discipline (mirrors the Users service layer):
 *   - Uses the raw prisma client. The SCIM bearer is the auth boundary;
 *     ZenStack access policies do NOT apply to SCIM mutations.
 *   - Every mutation opens its own `prisma.$transaction(async tx => ...)`.
 *     Webhook emission, audit-row writes, and GroupAssignment member-sync
 *     all happen INSIDE the tx so the outbox row, audit row, and assignment
 *     rows commit or roll back together with the entity write.
 *   - Member-validation pre-flight skips IDs that do not exist (or are
 *     tombstoned) — the audit row stamps the skipped set; the webhook
 *     event payload carries only the applied set. An empty applied set
 *     with a non-empty requested set is still emitted as a forensic signal.
 *   - PATCH on a tombstoned row throws `ScimNotFoundError` — tombstones
 *     are invisible to SCIM PATCH; resurrection only happens via POST with
 *     the same `externalId`.
 *
 * Discriminator audit conventions:
 *   - metadata.scimLinked:                POST hit an existing live row with
 *                                         no externalId; we JIT-bound
 *   - metadata.scimResurrected:           POST hit a tombstoned row, same
 *                                         externalId
 *   - metadata.scimNoOp:                  PUT/PATCH produced an empty column
 *                                         diff
 *   - metadata.scimSkippedMemberIds:      member IDs that did not resolve to
 *                                         live User rows on a create/PATCH
 *                                         add or PUT replace
 *   - metadata.scimDisplayNameOverwrote:  PATCH/PUT re-derived `Groups.name`
 *                                         from `scimDisplayName` while the
 *                                         pre-PATCH `name` and
 *                                         `scimDisplayName` had diverged
 *                                         (an admin had renamed)
 */

import { Prisma } from "@prisma/client";
import { prisma } from "~/lib/prisma";
import { captureAuditEvent } from "~/lib/services/auditLog";
import {
  emitScimGroupCreated,
  emitScimGroupDeleted,
  emitScimGroupMemberAdded,
  emitScimGroupMemberRemoved,
  emitScimGroupUpdated,
} from "~/lib/webhooks/event-emitters/groupEvents";

import { SCIM_SYSTEM_USER_ID, SYSTEM_PROJECT_ID } from "../constants";
import { scimFilterToPrismaGroupWhere } from "../filter";
import {
  computeGroupUpdatesFromScim,
  extractMemberIds,
  groupToScim,
  scimToGroupCreate,
} from "../mapping/group";
import { applyScimPatch, ScimPatchApplyError } from "../patch";
import {
  ScimNotFoundError,
  ScimUniquenessError,
  ScimValidationError,
} from "./users";

import type { NextResponse } from "next/server";
import type { ScimPatch } from "scim-patch";

import type { ScimAuthContext } from "../auth";
import type {
  PrismaGroupForScim,
  ScimGroupBody,
  ScimGroupMember,
  ScimGroupResource,
} from "../mapping/group";

/** Re-exports keep route imports consistent across Users + Groups. */
export { ScimNotFoundError, ScimUniquenessError, ScimValidationError };
export { ScimPatchApplyError };

const DEFAULT_LIST_COUNT = 100;
const MAX_LIST_COUNT = 200;

const SCIM_GROUP_INCLUDE = {
  assignedUsers: { include: { user: true } },
} as const;

const DEFAULT_EMIT_OPTS = {
  projectId: SYSTEM_PROJECT_ID,
  actorUserId: SCIM_SYSTEM_USER_ID,
} as const;

type PrismaGroupWithMembers = PrismaGroupForScim & {
  id: number;
  assignedUsers: Array<{ user: { id: string; name: string } }>;
};

/* -------------------------------------------------------------------------- */
/* Result types                                                               */
/* -------------------------------------------------------------------------- */

export interface CreateScimGroupResult {
  resource: ScimGroupResource;
  /**
   * `true` when the POST bound to an existing live Group that had no
   * externalId — the route returns HTTP 200. `false` for brand-new INSERT
   * or tombstone resurrection — the route returns HTTP 201.
   */
  linked: boolean;
}

export interface PutScimGroupResult {
  resource: ScimGroupResource;
  status: 200;
}

export interface PatchScimGroupResult {
  resource: ScimGroupResource;
}

export interface DeleteScimGroupResult {
  status: 204;
}

export interface ListScimGroupsInput {
  filter?: string;
  startIndex?: number;
  count?: number;
}

export interface ListScimGroupsResult {
  resources: ScimGroupResource[];
  totalResults: number;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function parseGroupId(id: string): number | null {
  if (!/^-?\d+$/.test(id)) return null;
  const n = parseInt(id, 10);
  return Number.isFinite(n) ? n : null;
}

function toJsonInput(
  value: Record<string, unknown> | null | undefined
): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.DbNull;
  return value as Prisma.InputJsonValue;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    Object.prototype.toString.call(v) === "[object Object]"
  );
}

/**
 * Split a list of requested member user IDs into the subset that exists as
 * live (non-tombstoned) User rows and the subset that does not. The audit
 * row carries the skipped set; the webhook payload carries the applied set.
 */
async function partitionMembers(
  tx: Prisma.TransactionClient,
  requestedIds: string[]
): Promise<{ applied: string[]; skipped: string[] }> {
  if (requestedIds.length === 0) return { applied: [], skipped: [] };
  const uniqueRequested = Array.from(new Set(requestedIds));
  const rows = await tx.user.findMany({
    where: { id: { in: uniqueRequested }, isDeleted: false },
    select: { id: true },
  });
  const validSet = new Set(rows.map((r) => r.id));
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const id of uniqueRequested) {
    if (validSet.has(id)) applied.push(id);
    else skipped.push(id);
  }
  return { applied, skipped };
}

async function emitMemberSkippedAudit(
  groupId: number,
  ctx: ScimAuthContext,
  skipped: string[]
): Promise<void> {
  if (skipped.length === 0) return;
  await captureAuditEvent({
    action: "UPDATE",
    entityType: "Groups",
    entityId: String(groupId),
    metadata: {
      scimSkippedMemberIds: skipped,
      scimTokenId: ctx.tokenId,
    },
  });
}

function snapshot(row: PrismaGroupWithMembers) {
  return row;
}

/**
 * Build the response SCIM resource from a freshly-mutated row + the list of
 * member IDs the service applied in the same tx. Avoids an extra `findUnique`
 * round-trip and stays compatible with both live-DB calls and mocked-Prisma
 * unit tests (where a second findUnique would yield null).
 */
async function buildResource(
  tx: Prisma.TransactionClient,
  row: PrismaGroupWithMembers,
  finalMemberIds: string[]
): Promise<ScimGroupResource> {
  if (finalMemberIds.length === 0) {
    return groupToScim({
      ...(row as PrismaGroupForScim),
      assignedUsers: [],
    });
  }
  const users = await tx.user.findMany({
    where: { id: { in: finalMemberIds } },
    select: { id: true, name: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));
  const assignedUsers = finalMemberIds
    .map((id) => userById.get(id))
    .filter((u): u is { id: string; name: string } => Boolean(u))
    .map((user) => ({ user }));
  return groupToScim({
    ...(row as PrismaGroupForScim),
    assignedUsers,
  });
}

/* -------------------------------------------------------------------------- */
/* createScimGroup — POST /scim/v2/Groups                                     */
/* -------------------------------------------------------------------------- */

export async function createScimGroup(
  body: ScimGroupBody,
  ctx: ScimAuthContext
): Promise<CreateScimGroupResult> {
  return prisma.$transaction(async (tx) => {
    const payload = scimToGroupCreate(body);
    const requestedMemberIds = extractMemberIds(payload.members);

    // Branch 1 — externalId-based lookup. POST with a previously-seen
    // externalId either resurrects a tombstone or rejects the duplicate.
    if (payload.externalId) {
      const existingByExternal = await tx.groups.findUnique({
        where: { externalId: payload.externalId },
        include: SCIM_GROUP_INCLUDE,
      });
      if (existingByExternal) {
        if (existingByExternal.isDeleted) {
          return resurrectTombstonedGroup(
            tx,
            existingByExternal as PrismaGroupWithMembers,
            body,
            payload,
            requestedMemberIds,
            ctx
          );
        }
        throw new ScimUniquenessError("externalId already exists");
      }
    }

    // Branch 2 — JIT bind: live row with the same Groups.name and no
    // externalId. The IdP is now binding a manually-created group via SCIM
    // for the first time.
    const existingByName = await tx.groups.findFirst({
      where: {
        name: payload.name,
        isDeleted: false,
        externalId: null,
      },
      include: SCIM_GROUP_INCLUDE,
    });
    if (existingByName) {
      return jitBindExistingGroup(
        tx,
        existingByName as PrismaGroupWithMembers,
        payload,
        requestedMemberIds,
        ctx
      );
    }

    // Branch 3 — Brand-new INSERT.
    return insertNewScimGroup(tx, payload, requestedMemberIds, ctx);
  });
}

async function insertNewScimGroup(
  tx: Prisma.TransactionClient,
  payload: ReturnType<typeof scimToGroupCreate>,
  requestedMemberIds: string[],
  ctx: ScimAuthContext
): Promise<CreateScimGroupResult> {
  const { applied, skipped } = await partitionMembers(tx, requestedMemberIds);

  const created = (await tx.groups.create({
    data: {
      name: payload.name,
      scimDisplayName: payload.scimDisplayName,
      externalId: payload.externalId,
      scimExtensions:
        payload.scimExtensions && Object.keys(payload.scimExtensions).length > 0
          ? (payload.scimExtensions as Prisma.InputJsonValue)
          : undefined,
      isDeleted: false,
    },
    include: SCIM_GROUP_INCLUDE,
  })) as unknown as PrismaGroupWithMembers;

  if (applied.length > 0) {
    await tx.groupAssignment.createMany({
      data: applied.map((userId) => ({ userId, groupId: created.id })),
      skipDuplicates: true,
    });
  }

  await emitScimGroupCreated(
    snapshot(created),
    applied.map((value) => ({ value })),
    tx,
    DEFAULT_EMIT_OPTS
  );

  await captureAuditEvent({
    action: "CREATE",
    entityType: "Groups",
    entityId: String(created.id),
    metadata: { scimTokenId: ctx.tokenId },
  });

  await emitMemberSkippedAudit(created.id, ctx, skipped);

  return {
    resource: await buildResource(tx, created, applied),
    linked: false,
  };
}

async function resurrectTombstonedGroup(
  tx: Prisma.TransactionClient,
  existing: PrismaGroupWithMembers,
  body: ScimGroupBody,
  payload: ReturnType<typeof scimToGroupCreate>,
  requestedMemberIds: string[],
  ctx: ScimAuthContext
): Promise<CreateScimGroupResult> {
  const { applied, skipped } = await partitionMembers(tx, requestedMemberIds);

  const mergedExtensions = mergeUrnBuckets(
    existing.scimExtensions,
    payload.scimExtensions
  );

  const resurrected = (await tx.groups.update({
    where: { id: existing.id },
    data: {
      isDeleted: false,
      name: payload.name,
      scimDisplayName: payload.scimDisplayName,
      scimExtensions: toJsonInput(mergedExtensions),
    },
    include: SCIM_GROUP_INCLUDE,
  })) as unknown as PrismaGroupWithMembers;

  // Resurrection clears prior member assignments and re-establishes the
  // requested set: the IdP-provided body is the new source of truth.
  await tx.groupAssignment.deleteMany({ where: { groupId: existing.id } });
  if (applied.length > 0) {
    await tx.groupAssignment.createMany({
      data: applied.map((userId) => ({ userId, groupId: existing.id })),
      skipDuplicates: true,
    });
  }

  await emitScimGroupCreated(
    snapshot(resurrected),
    applied.map((value) => ({ value })),
    tx,
    DEFAULT_EMIT_OPTS
  );

  await captureAuditEvent({
    action: "CREATE",
    entityType: "Groups",
    entityId: String(resurrected.id),
    metadata: {
      scimResurrected: true,
      scimTokenId: ctx.tokenId,
    },
  });

  await emitMemberSkippedAudit(resurrected.id, ctx, skipped);

  void body;

  return {
    resource: await buildResource(tx, resurrected, applied),
    linked: false,
  };
}

async function jitBindExistingGroup(
  tx: Prisma.TransactionClient,
  existing: PrismaGroupWithMembers,
  payload: ReturnType<typeof scimToGroupCreate>,
  requestedMemberIds: string[],
  ctx: ScimAuthContext
): Promise<CreateScimGroupResult> {
  const { applied, skipped } = await partitionMembers(tx, requestedMemberIds);

  const mergedExtensions = mergeUrnBuckets(
    existing.scimExtensions,
    payload.scimExtensions
  );

  const before = snapshot(existing);

  const linked = (await tx.groups.update({
    where: { id: existing.id },
    data: {
      externalId: payload.externalId,
      scimDisplayName: payload.scimDisplayName,
      scimExtensions: toJsonInput(mergedExtensions),
    },
    include: SCIM_GROUP_INCLUDE,
  })) as unknown as PrismaGroupWithMembers;

  // JIT bind reconciles the assignment set to the requested set.
  const currentMemberIds = (existing.assignedUsers ?? []).map((a) => a.user.id);
  const toAdd = applied.filter((id) => !currentMemberIds.includes(id));
  const toRemove = currentMemberIds.filter((id) => !applied.includes(id));

  if (toAdd.length > 0) {
    await tx.groupAssignment.createMany({
      data: toAdd.map((userId) => ({ userId, groupId: existing.id })),
      skipDuplicates: true,
    });
  }
  if (toRemove.length > 0) {
    await tx.groupAssignment.deleteMany({
      where: { groupId: existing.id, userId: { in: toRemove } },
    });
  }

  await emitScimGroupUpdated(before, snapshot(linked), tx, DEFAULT_EMIT_OPTS);

  await captureAuditEvent({
    action: "UPDATE",
    entityType: "Groups",
    entityId: String(linked.id),
    metadata: {
      scimLinked: true,
      scimTokenId: ctx.tokenId,
    },
  });

  await emitMemberSkippedAudit(linked.id, ctx, skipped);

  return {
    resource: await buildResource(tx, linked, applied),
    linked: true,
  };
}

/* -------------------------------------------------------------------------- */
/* getScimGroupById — GET /scim/v2/Groups/{id}                                */
/* -------------------------------------------------------------------------- */

export async function getScimGroupById(
  id: string,
  _ctx: ScimAuthContext
): Promise<ScimGroupResource> {
  const parsedId = parseGroupId(id);
  if (parsedId === null) {
    throw new ScimNotFoundError(`Group ${id} not found`);
  }
  const row = await prisma.groups.findUnique({
    where: { id: parsedId },
    include: SCIM_GROUP_INCLUDE,
  });
  if (!row || row.isDeleted) {
    throw new ScimNotFoundError(`Group ${id} not found`);
  }
  return groupToScim(row as PrismaGroupForScim);
}

/* -------------------------------------------------------------------------- */
/* listScimGroups — GET /scim/v2/Groups                                       */
/* -------------------------------------------------------------------------- */

export async function listScimGroups(
  { filter, startIndex, count }: ListScimGroupsInput,
  _ctx: ScimAuthContext
): Promise<ListScimGroupsResult> {
  const resolvedCount =
    count === undefined
      ? DEFAULT_LIST_COUNT
      : Math.min(Math.max(1, count), MAX_LIST_COUNT);
  const resolvedSkip = Math.max(0, (startIndex ?? 1) - 1);

  const filterWhere: Prisma.GroupsWhereInput = filter
    ? scimFilterToPrismaGroupWhere(filter)
    : {};

  const finalWhere: Prisma.GroupsWhereInput = {
    AND: [filterWhere, { isDeleted: false }],
  };

  const [rows, totalResults] = await Promise.all([
    prisma.groups.findMany({
      where: finalWhere,
      include: SCIM_GROUP_INCLUDE,
      skip: resolvedSkip,
      take: resolvedCount,
      orderBy: { id: "asc" },
    }),
    prisma.groups.count({ where: finalWhere }),
  ]);

  return {
    resources: rows.map((r) => groupToScim(r as PrismaGroupForScim)),
    totalResults,
  };
}

/* -------------------------------------------------------------------------- */
/* putScimGroup — PUT /scim/v2/Groups/{id}                                    */
/* -------------------------------------------------------------------------- */

export async function putScimGroup(
  id: string,
  body: ScimGroupBody,
  ctx: ScimAuthContext
): Promise<PutScimGroupResult> {
  const parsedId = parseGroupId(id);
  if (parsedId === null) {
    throw new ScimNotFoundError(`Group ${id} not found`);
  }

  return prisma.$transaction(async (tx) => {
    const current = (await tx.groups.findUnique({
      where: { id: parsedId },
      include: SCIM_GROUP_INCLUDE,
    })) as PrismaGroupWithMembers | null;
    if (!current || current.isDeleted) {
      throw new ScimNotFoundError(`Group ${id} not found`);
    }

    const { updates } = computeGroupUpdatesFromScim(
      current as PrismaGroupForScim,
      body
    );

    const overwroteAdminName =
      typeof body.displayName === "string" &&
      typeof updates.name === "string" &&
      current.name.toLowerCase() !==
        (current.scimDisplayName ?? "").toLowerCase();

    // Member reconciliation vs the requested members[] set.
    const requestedMemberIds = Array.isArray(body.members)
      ? extractMemberIds(body.members as ScimGroupMember[])
      : null;

    let added: string[] = [];
    let removed: string[] = [];
    let skipped: string[] = [];

    if (requestedMemberIds !== null) {
      const partitioned = await partitionMembers(tx, requestedMemberIds);
      skipped = partitioned.skipped;
      const applied = partitioned.applied;
      const currentMemberIds = (current.assignedUsers ?? []).map(
        (a) => a.user.id
      );
      added = applied.filter((u) => !currentMemberIds.includes(u));
      removed = currentMemberIds.filter((u) => !applied.includes(u));
    }

    const hasColumnUpdates = Object.keys(updates).length > 0;
    const hasMemberUpdates = added.length > 0 || removed.length > 0;

    if (!hasColumnUpdates && !hasMemberUpdates && skipped.length === 0) {
      await captureAuditEvent({
        action: "UPDATE",
        entityType: "Groups",
        entityId: String(current.id),
        metadata: { scimNoOp: true, scimTokenId: ctx.tokenId },
      });
      return {
        resource: groupToScim(current as PrismaGroupForScim),
        status: 200,
      };
    }

    const before = snapshot(current);

    let updatedRow: PrismaGroupWithMembers = current;
    if (hasColumnUpdates) {
      updatedRow = (await tx.groups.update({
        where: { id: current.id },
        data: {
          ...(updates.name !== undefined ? { name: updates.name } : {}),
          ...(updates.scimDisplayName !== undefined
            ? { scimDisplayName: updates.scimDisplayName }
            : {}),
          ...(updates.externalId !== undefined
            ? { externalId: updates.externalId }
            : {}),
          ...(updates.scimExtensions !== undefined
            ? { scimExtensions: toJsonInput(updates.scimExtensions) }
            : {}),
        },
        include: SCIM_GROUP_INCLUDE,
      })) as unknown as PrismaGroupWithMembers;
    }

    if (added.length > 0) {
      await tx.groupAssignment.createMany({
        data: added.map((userId) => ({ userId, groupId: current.id })),
        skipDuplicates: true,
      });
    }
    if (removed.length > 0) {
      await tx.groupAssignment.deleteMany({
        where: { groupId: current.id, userId: { in: removed } },
      });
    }

    if (hasColumnUpdates) {
      await emitScimGroupUpdated(
        before,
        snapshot(updatedRow),
        tx,
        DEFAULT_EMIT_OPTS
      );
    }
    if (added.length > 0) {
      await emitScimGroupMemberAdded(
        snapshot(updatedRow),
        added,
        tx,
        DEFAULT_EMIT_OPTS
      );
    }
    if (removed.length > 0) {
      await emitScimGroupMemberRemoved(
        snapshot(updatedRow),
        removed,
        tx,
        DEFAULT_EMIT_OPTS
      );
    }

    await captureAuditEvent({
      action: "UPDATE",
      entityType: "Groups",
      entityId: String(current.id),
      metadata: {
        scimTokenId: ctx.tokenId,
        ...(overwroteAdminName ? { scimDisplayNameOverwrote: true } : {}),
      },
    });

    await emitMemberSkippedAudit(current.id, ctx, skipped);

    const finalMemberIds =
      requestedMemberIds !== null
        ? requestedMemberIds.filter((u) => !skipped.includes(u))
        : (current.assignedUsers ?? []).map((a) => a.user.id);

    return {
      resource: await buildResource(tx, updatedRow, finalMemberIds),
      status: 200,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* patchScimGroup — PATCH /scim/v2/Groups/{id}                                */
/* -------------------------------------------------------------------------- */

export async function patchScimGroup(
  id: string,
  body: ScimPatch,
  ctx: ScimAuthContext
): Promise<PatchScimGroupResult> {
  const parsedId = parseGroupId(id);
  if (parsedId === null) {
    throw new ScimNotFoundError(`Group ${id} not found`);
  }

  return prisma.$transaction(async (tx) => {
    const current = (await tx.groups.findUnique({
      where: { id: parsedId },
      include: SCIM_GROUP_INCLUDE,
    })) as PrismaGroupWithMembers | null;
    if (!current || current.isDeleted) {
      throw new ScimNotFoundError(`Group ${id} not found`);
    }

    const currentScim = groupToScim(current as PrismaGroupForScim);
    const draftScim = applyScimPatch(currentScim, body);

    // Recover the column-level diff from the in-memory draft vs the current
    // row. Member diff is derived independently from the draft's members[].
    const draftBody: Partial<ScimGroupBody> = {
      displayName: draftScim.displayName,
      externalId: draftScim.externalId,
    };
    for (const key of Object.keys(draftScim)) {
      if (
        key.startsWith("urn:") &&
        key !== "urn:ietf:params:scim:schemas:core:2.0:Group"
      ) {
        (draftBody as Record<string, unknown>)[key] = (
          draftScim as Record<string, unknown>
        )[key];
      }
    }

    const { updates } = computeGroupUpdatesFromScim(
      current as PrismaGroupForScim,
      draftBody
    );

    const overwroteAdminName =
      typeof updates.name === "string" &&
      current.name.toLowerCase() !==
        (current.scimDisplayName ?? "").toLowerCase();

    // Member diff.
    const draftMemberIds = extractMemberIds(
      (draftScim.members ?? []) as ScimGroupMember[]
    );
    const currentMemberIds = (current.assignedUsers ?? []).map(
      (a) => a.user.id
    );

    const requestedToAdd = draftMemberIds.filter(
      (u) => !currentMemberIds.includes(u)
    );
    const removed = currentMemberIds.filter((u) => !draftMemberIds.includes(u));

    const partitioned = await partitionMembers(tx, requestedToAdd);
    const added = partitioned.applied;
    const skipped = partitioned.skipped;

    const hasColumnUpdates = Object.keys(updates).length > 0;
    const hasMemberAdds = requestedToAdd.length > 0;
    const hasMemberRemoves = removed.length > 0;

    if (
      !hasColumnUpdates &&
      !hasMemberAdds &&
      !hasMemberRemoves &&
      skipped.length === 0
    ) {
      await captureAuditEvent({
        action: "UPDATE",
        entityType: "Groups",
        entityId: String(current.id),
        metadata: { scimNoOp: true, scimTokenId: ctx.tokenId },
      });
      return {
        resource: groupToScim(current as PrismaGroupForScim),
      };
    }

    const before = snapshot(current);

    let updatedRow: PrismaGroupWithMembers = current;
    if (hasColumnUpdates) {
      updatedRow = (await tx.groups.update({
        where: { id: current.id },
        data: {
          ...(updates.name !== undefined ? { name: updates.name } : {}),
          ...(updates.scimDisplayName !== undefined
            ? { scimDisplayName: updates.scimDisplayName }
            : {}),
          ...(updates.externalId !== undefined
            ? { externalId: updates.externalId }
            : {}),
          ...(updates.scimExtensions !== undefined
            ? { scimExtensions: toJsonInput(updates.scimExtensions) }
            : {}),
        },
        include: SCIM_GROUP_INCLUDE,
      })) as unknown as PrismaGroupWithMembers;
    }

    if (added.length > 0) {
      await tx.groupAssignment.createMany({
        data: added.map((userId) => ({ userId, groupId: current.id })),
        skipDuplicates: true,
      });
    }
    if (removed.length > 0) {
      await tx.groupAssignment.deleteMany({
        where: { groupId: current.id, userId: { in: removed } },
      });
    }

    if (hasColumnUpdates) {
      await emitScimGroupUpdated(
        before,
        snapshot(updatedRow),
        tx,
        DEFAULT_EMIT_OPTS
      );
    }
    if (hasMemberAdds) {
      await emitScimGroupMemberAdded(
        snapshot(updatedRow),
        added,
        tx,
        DEFAULT_EMIT_OPTS
      );
    }
    if (hasMemberRemoves) {
      await emitScimGroupMemberRemoved(
        snapshot(updatedRow),
        removed,
        tx,
        DEFAULT_EMIT_OPTS
      );
    }

    if (hasColumnUpdates || hasMemberAdds || hasMemberRemoves) {
      await captureAuditEvent({
        action: "UPDATE",
        entityType: "Groups",
        entityId: String(current.id),
        metadata: {
          scimTokenId: ctx.tokenId,
          ...(overwroteAdminName ? { scimDisplayNameOverwrote: true } : {}),
        },
      });
    }

    await emitMemberSkippedAudit(current.id, ctx, skipped);

    const finalMemberIds = currentMemberIds
      .filter((u) => !removed.includes(u))
      .concat(added);

    return {
      resource: await buildResource(tx, updatedRow, finalMemberIds),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* deleteScimGroup — DELETE /scim/v2/Groups/{id}                              */
/* -------------------------------------------------------------------------- */

export async function deleteScimGroup(
  id: string,
  ctx: ScimAuthContext
): Promise<DeleteScimGroupResult> {
  const parsedId = parseGroupId(id);
  if (parsedId === null) {
    throw new ScimNotFoundError(`Group ${id} not found`);
  }

  return prisma.$transaction(async (tx) => {
    const current = (await tx.groups.findUnique({
      where: { id: parsedId },
      include: SCIM_GROUP_INCLUDE,
    })) as PrismaGroupWithMembers | null;
    if (!current || current.isDeleted) {
      throw new ScimNotFoundError(`Group ${id} not found`);
    }

    const tombstoned = (await tx.groups.update({
      where: { id: current.id },
      data: { isDeleted: true },
      include: SCIM_GROUP_INCLUDE,
    })) as unknown as PrismaGroupWithMembers;

    await emitScimGroupDeleted(snapshot(tombstoned), tx, DEFAULT_EMIT_OPTS);

    await captureAuditEvent({
      action: "DELETE",
      entityType: "Groups",
      entityId: String(tombstoned.id),
      metadata: { scimTokenId: ctx.tokenId },
    });

    return { status: 204 };
  });
}

/* -------------------------------------------------------------------------- */
/* Internal: URN-bucket shallow merge (preserves untouched buckets on write). */
/* -------------------------------------------------------------------------- */

function mergeUrnBuckets(
  current: unknown,
  incoming: Record<string, unknown> | null
): Record<string, unknown> | null {
  const base = isPlainObject(current) ? current : {};
  if (!incoming || Object.keys(incoming).length === 0) {
    return Object.keys(base).length > 0 ? base : null;
  }
  const merged: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(incoming)) {
    merged[k] = v;
  }
  return merged;
}

// Keep NextResponse import live for the re-exported ScimValidationError.
type _NextResponseAlive = NextResponse;
