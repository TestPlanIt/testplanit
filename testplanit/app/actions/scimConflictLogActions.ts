"use server";

/**
 * SCIM external-id conflict log server actions.
 *
 * Two admin-gated entry points the /admin/scim conflict-log UI calls:
 *
 *   - `listScimConflictsAction` -- paginated read over AuditLog filtered to
 *     SCIM-source rows that carry at least one conflict / system-action
 *     discriminator on `metadata`. Read-only; never writes an audit row.
 *   - `reEmitScimMemberEventAction` -- repair workflow for the
 *     `scimSkippedMemberIds` conflict type: read the original audit row,
 *     re-validate the skipped user ids against the current User table, emit
 *     `scim.group.member_added` for the now-valid subset, and write a fresh
 *     audit row chained to the original via `referencedAuditLogId`.
 *
 * Both actions open with `getServerAuthSession()` + `access === "ADMIN"`;
 * non-admin and unauthenticated callers receive `{success:false,
 * error:"Unauthorized"}` without touching the database.
 *
 * Audit invariant: the re-emit action hand-stamps `metadata.source: "scim"`
 * on the new audit row so the conflict log surfaces the admin-driven
 * repair next to the original conflict event. The new emission's payload
 * carries the now-valid members array, so its `payloadDigest` diverges
 * from the original outbox row and `WebhookEventDedup` does not block it.
 *
 * Error strings stay in English -- server-action errors deliberately do
 * not flow through next-intl. Caller error responses NEVER leak raw
 * exception messages (info disclosure defense).
 */

import { sql } from "kysely";

import { runWithAuditContext } from "~/lib/auditContext";
import { prisma } from "~/lib/prisma";
import { SYSTEM_PROJECT_ID } from "~/lib/scim/constants";
import {
  emitScimGroupMemberAdded,
  type ScimGroupSnapshot,
} from "~/lib/webhooks/event-emitters/groupEvents";
import { getServerAuthSession } from "~/server/auth";

export interface ConflictLogRow {
  id: string;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  changes: unknown;
  metadata: Record<string, unknown> | null;
  timestamp: Date;
  projectId: number | null;
}

export interface ListScimConflictsInput {
  startIndex?: number;
  count?: number;
  cursor?: { timestamp: string; id: string };
}

export interface ListScimConflictsResult {
  success: boolean;
  items?: ConflictLogRow[];
  hasMore?: boolean;
  error?: string;
}

export interface ReEmitScimMemberEventResult {
  success: boolean;
  newAuditLogId?: string;
  emittedMembers?: string[];
  error?: string;
}

const DEFAULT_PAGE_SIZE = 50;

export async function listScimConflictsAction(
  input: ListScimConflictsInput
): Promise<ListScimConflictsResult> {
  const session = await getServerAuthSession();
  if (!session?.user?.id || session.user.access !== "ADMIN") {
    return { success: false, error: "Unauthorized" };
  }

  const count =
    typeof input.count === "number" && input.count > 0
      ? Math.min(input.count, 200)
      : DEFAULT_PAGE_SIZE;
  const startIndex =
    typeof input.startIndex === "number" && input.startIndex >= 0
      ? input.startIndex
      : 0;
  const limit = count + 1;

  const cursorFragment =
    input.cursor && input.cursor.timestamp && input.cursor.id
      ? sql`AND ("timestamp", "id") < (${new Date(
          input.cursor.timestamp
        )}, ${input.cursor.id})`
      : sql``;

  try {
    const result = await sql<ConflictLogRow>`
      SELECT
        "id",
        "userId",
        "userEmail",
        "userName",
        "action"::text AS "action",
        "entityType",
        "entityId",
        "entityName",
        "changes",
        "metadata",
        "timestamp",
        "projectId"
      FROM "AuditLog"
      WHERE metadata->>'source' = 'scim'
        AND (
          metadata ? 'scimLinked'
          OR metadata ? 'scimResurrected'
          OR metadata ? 'scimSkippedMemberIds'
          OR metadata ? 'scimDisplayNameOverwrote'
          OR metadata ? 'scimConflict'
          OR metadata ? 'scimReEmittedBy'
        )
        AND "timestamp" > NOW() - INTERVAL '90 days'
        ${cursorFragment}
      ORDER BY "timestamp" DESC, "id" DESC
      LIMIT ${limit}
      OFFSET ${startIndex}
    `.execute(prisma.$qb);
    const rows = result.rows;

    const hasMore = rows.length > count;
    const items = hasMore ? rows.slice(0, count) : rows;
    return { success: true, items, hasMore };
  } catch (err) {
    console.error("[scim/conflict-log] list failed", err);
    return { success: false, error: "Failed to load conflict log" };
  }
}

export async function reEmitScimMemberEventAction(
  auditLogId: string
): Promise<ReEmitScimMemberEventResult> {
  const session = await getServerAuthSession();
  if (!session?.user?.id || session.user.access !== "ADMIN") {
    return { success: false, error: "Unauthorized" };
  }

  return runWithAuditContext({ userId: session.user.id }, async () => {
    try {
      const original = await prisma.auditLog.findUnique({
        where: { id: auditLogId },
      });
      if (!original) {
        return { success: false, error: "Audit row not found" };
      }

      const metadata =
        original.metadata && typeof original.metadata === "object"
          ? (original.metadata as Record<string, unknown>)
          : null;
      const skippedRaw = metadata?.scimSkippedMemberIds;
      const skippedIds = Array.isArray(skippedRaw)
        ? skippedRaw.filter((v): v is string => typeof v === "string")
        : [];

      if (
        original.entityType !== "Groups" ||
        !metadata ||
        skippedIds.length === 0
      ) {
        return {
          success: false,
          error: "No skipped members to re-emit",
        };
      }

      const groupId = Number.parseInt(original.entityId, 10);
      if (!Number.isFinite(groupId)) {
        return { success: false, error: "Group not found" };
      }

      const group = await prisma.groups.findUnique({
        where: { id: groupId },
      });
      if (!group || group.isDeleted) {
        return { success: false, error: "Group not found" };
      }

      const validUsers = await prisma.user.findMany({
        where: { id: { in: skippedIds }, isDeleted: false },
        select: { id: true },
      });
      const emittedMembers = validUsers.map((u) => u.id);
      const stillSkipped = skippedIds.filter(
        (id) => !emittedMembers.includes(id)
      );

      const groupSnapshot: ScimGroupSnapshot = {
        id: group.id,
        name: group.name,
        externalId: group.externalId,
        scimDisplayName: group.scimDisplayName,
      };

      const newAuditLogId = await prisma.$transaction(async (tx) => {
        await emitScimGroupMemberAdded(groupSnapshot, emittedMembers, tx, {
          projectId: SYSTEM_PROJECT_ID,
          actorUserId: session.user.id,
        });

        const newRow = await tx.auditLog.create({
          data: {
            userId: session.user.id,
            userEmail: session.user.email ?? null,
            userName: session.user.name ?? null,
            action: "UPDATE",
            entityType: "Groups",
            entityId: String(group.id),
            entityName: group.name,
            metadata: {
              source: "scim",
              scimReEmittedBy: session.user.id,
              referencedAuditLogId: original.id,
              scimReEmittedMembers: emittedMembers,
              scimSkippedMemberIds: stillSkipped,
            },
          },
        });

        return newRow.id;
      });

      return {
        success: true,
        newAuditLogId,
        emittedMembers,
      };
    } catch (err) {
      console.error("[scim/conflict-log] re-emit failed", err);
      return { success: false, error: "Re-emit failed" };
    }
  }); // end runWithAuditContext
}
