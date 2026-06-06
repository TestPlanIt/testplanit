import type { Prisma } from "@prisma/client";

import { SCIM_SYSTEM_USER_ID, SYSTEM_PROJECT_ID } from "~/lib/scim/constants";
import { computeObjectDiff } from "~/lib/webhooks/diff";
import { webhookEvents } from "~/lib/webhooks/events";

/**
 * Emit per-mutation outbound webhook events for SCIM-provisioned Group
 * lifecycle changes.
 *
 * Catalog: scim.group.created / scim.group.updated / scim.group.member_added /
 * scim.group.member_removed / scim.group.deleted.
 *
 * Payload contracts:
 *   - scim.group.created carries the projected snapshot (id, externalId,
 *     displayName, members, createdAt) so the receiver can render a
 *     self-contained card without a refetch.
 *   - scim.group.updated carries the post-update snapshot plus a generic
 *     diff. No-op updates (empty changedFields) skip emission so PUT
 *     idempotency does not spam destinations.
 *   - scim.group.member_added / scim.group.member_removed ALWAYS emit when
 *     called, including with an empty members array — an empty applied set
 *     is a meaningful forensic signal (the IdP told us to add/remove
 *     nothing, and downstream consumers want to see that signal).
 *   - scim.group.deleted carries id, projectId and externalId only; the row
 *     is tombstoned and the receiver should not expect attribute detail.
 *
 * Defaults: SYSTEM_PROJECT_ID + SCIM_SYSTEM_USER_ID. Both can be overridden
 * via opts when the caller has a tighter project scope or a real actor id
 * (e.g., admin-triggered PATCH via the UI rather than IdP-driven).
 *
 * Groups have no isActive column, so this module ships no activated /
 * deactivated discriminator — that is a User-only flavor.
 */

export interface ScimGroupSnapshot {
  id: number;
  name: string;
  externalId: string | null;
  scimDisplayName: string | null;
  scimExtensions?: unknown;
  updatedAt?: Date | null;
  isDeleted?: boolean;
}

export interface ScimGroupMemberRef {
  value: string;
}

export interface EmitOptions {
  projectId?: number;
  actorUserId?: string | null;
}

interface ResolvedEmitOpts {
  tx: Prisma.TransactionClient;
  projectId: number;
  actorUserId: string | null;
}

function defaultEmitOpts(
  tx: Prisma.TransactionClient,
  opts: EmitOptions
): ResolvedEmitOpts {
  return {
    tx,
    projectId: opts.projectId ?? SYSTEM_PROJECT_ID,
    actorUserId: opts.actorUserId ?? SCIM_SYSTEM_USER_ID,
  };
}

function toMemberRefs(memberIds: string[]): ScimGroupMemberRef[] {
  return memberIds.map((value) => ({ value }));
}

export async function emitScimGroupCreated(
  row: ScimGroupSnapshot,
  members: ScimGroupMemberRef[],
  tx: Prisma.TransactionClient,
  opts: EmitOptions = {}
): Promise<void> {
  const resolved = defaultEmitOpts(tx, opts);
  await webhookEvents.emit(
    "scim.group.created",
    {
      id: row.id,
      projectId: resolved.projectId,
      externalId: row.externalId,
      displayName: row.name,
      members,
      createdAt: new Date(),
    },
    resolved
  );
}

export async function emitScimGroupUpdated(
  oldRow: ScimGroupSnapshot | null | undefined,
  newRow: ScimGroupSnapshot,
  tx: Prisma.TransactionClient,
  opts: EmitOptions = {}
): Promise<void> {
  if (!oldRow) return;

  const diff = computeObjectDiff(
    oldRow as unknown as Record<string, unknown>,
    newRow as unknown as Record<string, unknown>
  );
  if (diff.changedFields.length === 0) return;

  const resolved = defaultEmitOpts(tx, opts);
  await webhookEvents.emit(
    "scim.group.updated",
    {
      id: newRow.id,
      projectId: resolved.projectId,
      externalId: newRow.externalId,
      displayName: newRow.name,
      after: newRow,
      diff,
    },
    resolved
  );
}

export async function emitScimGroupMemberAdded(
  row: ScimGroupSnapshot,
  addedMemberIds: string[],
  tx: Prisma.TransactionClient,
  opts: EmitOptions = {}
): Promise<void> {
  const resolved = defaultEmitOpts(tx, opts);
  await webhookEvents.emit(
    "scim.group.member_added",
    {
      id: row.id,
      projectId: resolved.projectId,
      externalId: row.externalId,
      displayName: row.name,
      members: toMemberRefs(addedMemberIds),
    },
    resolved
  );
}

export async function emitScimGroupMemberRemoved(
  row: ScimGroupSnapshot,
  removedMemberIds: string[],
  tx: Prisma.TransactionClient,
  opts: EmitOptions = {}
): Promise<void> {
  const resolved = defaultEmitOpts(tx, opts);
  await webhookEvents.emit(
    "scim.group.member_removed",
    {
      id: row.id,
      projectId: resolved.projectId,
      externalId: row.externalId,
      displayName: row.name,
      members: toMemberRefs(removedMemberIds),
    },
    resolved
  );
}

export async function emitScimGroupDeleted(
  row: ScimGroupSnapshot,
  tx: Prisma.TransactionClient,
  opts: EmitOptions = {}
): Promise<void> {
  const resolved = defaultEmitOpts(tx, opts);
  await webhookEvents.emit(
    "scim.group.deleted",
    {
      id: row.id,
      projectId: resolved.projectId,
      externalId: row.externalId,
    },
    resolved
  );
}
