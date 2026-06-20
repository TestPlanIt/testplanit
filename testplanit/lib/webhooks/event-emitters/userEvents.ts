import type { User } from "~/zenstack/models";
import type { Prisma } from "@prisma/client";

import { SCIM_SYSTEM_USER_ID, SYSTEM_PROJECT_ID } from "~/lib/scim/constants";
import { computeObjectDiff } from "~/lib/webhooks/diff";
import { emitWithCoalescing } from "~/lib/webhooks/event-emitters/coalescing";
import { webhookEvents } from "~/lib/webhooks/events";

/**
 * Emit per-mutation outbound webhook events for SCIM-provisioned User
 * lifecycle changes.
 *
 * Catalog: scim.user.created / scim.user.updated / scim.user.activated /
 * scim.user.deactivated / scim.user.deleted.
 *
 * Payload contracts:
 *   - scim.user.created carries the projected snapshot (id, scimExternalId,
 *     userName, email, active, name, createdAt) so the receiver can render
 *     a self-contained card without a refetch.
 *   - scim.user.updated carries the post-update snapshot plus a generic
 *     diff. No-op updates (empty changedFields) skip emission so PUT
 *     idempotency does not spam destinations.
 *   - scim.user.activated / scim.user.deactivated swap in for .updated when
 *     the isActive column flips; the isActive payload diff is implied by the
 *     event name so the body stays minimal.
 *   - scim.user.deleted carries id and scimExternalId only; the row is
 *     tombstoned and the receiver should not expect attribute detail.
 *
 * Defaults: SYSTEM_PROJECT_ID + SCIM_SYSTEM_USER_ID. Both can be overridden
 * via opts when the caller has a tighter project scope or a real actor id
 * (e.g., admin-triggered PATCH via the UI rather than IdP-driven).
 *
 * This module uses raw Prisma exclusively (no ZenStack v3 hooks), so the
 * deeply nested alias-limit caveat that applies to caseEvents.ts is not
 * relevant here.
 */

export type ScimUserSnapshot = Pick<
  User,
  | "id"
  | "email"
  | "name"
  | "scimUserName"
  | "scimExternalId"
  | "isActive"
  | "createdAt"
> & {
  scimExtensions?: unknown;
};

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

export function determineScimUserUpdateEventName(
  oldRow: { isActive: boolean },
  newRow: { isActive: boolean }
): "scim.user.activated" | "scim.user.deactivated" | "scim.user.updated" {
  if (oldRow.isActive === false && newRow.isActive === true) {
    return "scim.user.activated";
  }
  if (oldRow.isActive === true && newRow.isActive === false) {
    return "scim.user.deactivated";
  }
  return "scim.user.updated";
}

export async function emitScimUserCreated(
  row: ScimUserSnapshot,
  tx: Prisma.TransactionClient,
  opts: EmitOptions = {}
): Promise<void> {
  const resolved = defaultEmitOpts(tx, opts);
  // First-sync floods (Okta bulk-assign of N users) coalesce into a single
  // scim.user.created.summary event per subscribed config per 5-min window
  // once the threshold is crossed; routine syncs stay 1:1.
  await emitWithCoalescing(
    "scim.user.created",
    {
      id: row.id,
      projectId: resolved.projectId,
      scimExternalId: row.scimExternalId,
      userName: row.scimUserName,
      email: row.email,
      active: row.isActive,
      name: row.name,
      createdAt: row.createdAt,
    },
    tx,
    { projectId: resolved.projectId, actorUserId: resolved.actorUserId }
  );
}

export async function emitScimUserUpdated(
  oldRow: ScimUserSnapshot | null | undefined,
  newRow: ScimUserSnapshot,
  tx: Prisma.TransactionClient,
  opts: EmitOptions = {}
): Promise<void> {
  if (!oldRow) return;

  const diff = computeObjectDiff(
    oldRow as unknown as Record<string, unknown>,
    newRow as unknown as Record<string, unknown>
  );
  if (diff.changedFields.length === 0) return;

  const name = determineScimUserUpdateEventName(oldRow, newRow);
  const resolved = defaultEmitOpts(tx, opts);
  await webhookEvents.emit(
    name,
    {
      id: newRow.id,
      projectId: resolved.projectId,
      scimExternalId: newRow.scimExternalId,
      userName: newRow.scimUserName,
      email: newRow.email,
      after: newRow,
      diff,
    },
    resolved
  );
}

export async function emitScimUserDeleted(
  row: ScimUserSnapshot,
  tx: Prisma.TransactionClient,
  opts: EmitOptions = {}
): Promise<void> {
  const resolved = defaultEmitOpts(tx, opts);
  await webhookEvents.emit(
    "scim.user.deleted",
    {
      id: row.id,
      scimExternalId: row.scimExternalId,
      projectId: resolved.projectId,
      name: row.name,
      email: row.email,
      userName: row.scimUserName,
    },
    resolved
  );
}
