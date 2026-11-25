import { sql } from "kysely";
import { buildGucPayload, withAuditGuc } from "~/lib/audit/gucContext";
import { SYSTEM_AUTOMATION_USER_ID } from "~/lib/automationUser";
import {
  DELETED_USER_EMAIL,
  DELETED_USER_ID,
  DELETED_USER_NAME,
} from "~/lib/deletedUser";
import { SCIM_SYSTEM_USER_ID } from "~/lib/scim/constants";
import type { DbClient, TxClient } from "~/lib/zenstack";
import {
  getElasticsearchClient,
  getEntityIndexName,
} from "~/services/unifiedElasticsearchService";
import { SearchableEntityType } from "~/types/search";
import { schema } from "~/zenstack/schema";

export interface UserReference {
  model: string;
  column: string;
}

interface ModelDef {
  name: string;
  fields: Record<
    string,
    {
      type: string;
      optional?: boolean;
      relation?: { fields?: readonly string[]; onDelete?: string };
    }
  >;
}

const referenceKey = (ref: UserReference) => `${ref.model}.${ref.column}`;

// The user's own membership rows, not something they authored.
const MEMBERSHIP_REFERENCES = new Set(["ProjectAssignment.userId"]);

// Only the SCIM Provisioner belongs in this column. Any other user found
// there blocks the purge rather than handing SCIM tokens to "Deleted User".
const UNTOUCHED_REFERENCES = new Set(["ScimToken.systemUserId"]);

// Foreign keys to User that block its delete. With no onDelete rule a
// required relation restricts and an optional one sets null.
export const restrictingUserReferences: UserReference[] = Object.values(
  schema.models as unknown as Record<string, ModelDef>
)
  .flatMap((model) =>
    Object.values(model.fields).flatMap((field): UserReference[] => {
      if (field.type !== "User" || !field.relation?.fields) return [];
      const onDelete = field.relation.onDelete;
      const restricts =
        onDelete === "Restrict" ||
        onDelete === "NoAction" ||
        (onDelete === undefined && !field.optional);
      if (!restricts) return [];
      return field.relation.fields.map((column) => ({
        model: model.name,
        column,
      }));
    })
  )
  .sort((a, b) => referenceKey(a).localeCompare(referenceKey(b)));

export const userPurgePlan = {
  // Authored content, handed to the "Deleted User" row.
  reassign: restrictingUserReferences.filter(
    (ref) =>
      !MEMBERSHIP_REFERENCES.has(referenceKey(ref)) &&
      !UNTOUCHED_REFERENCES.has(referenceKey(ref))
  ),
  // Deleted with the user.
  remove: restrictingUserReferences.filter((ref) =>
    MEMBERSHIP_REFERENCES.has(referenceKey(ref))
  ),
};

// Seeded rows that other records point at by design.
export const PROTECTED_USER_IDS: ReadonlySet<string> = new Set([
  DELETED_USER_ID,
  SCIM_SYSTEM_USER_ID,
  SYSTEM_AUTOMATION_USER_ID,
]);

export class UserPurgeError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404
  ) {
    super(message);
    this.name = "UserPurgeError";
  }
}

export interface PurgedUser {
  id: string;
  name: string;
  email: string;
}

export interface UserPurgeResult {
  user: PurgedUser;
  // Rows handed to the "Deleted User" row, by model. Models with none are
  // left out.
  reassigned: Record<string, number>;
}

async function ensureDeletedUser(tx: TxClient): Promise<void> {
  // Raw SQL because the sentinel address fails @email validation. roleId is
  // required, so the row takes the default role; it has no access.
  await sql`
    INSERT INTO "User"
      ("id", "name", "email", "roleId", "access", "isActive", "isDeleted", "updatedAt", "scimRoles")
    SELECT
      ${DELETED_USER_ID}::text, ${DELETED_USER_NAME}::text, ${DELETED_USER_EMAIL}::text,
      r."id", 'NONE'::"Access", false, true, now(), ARRAY[]::text[]
    FROM "Roles" r
    ORDER BY r."isDefault" DESC, r."id" ASC
    LIMIT 1
    ON CONFLICT ("id") DO NOTHING
  `.execute(tx.$qb);
}

/**
 * Hard-deletes a soft-deleted user. Content the user created is kept and handed
 * to the "Deleted User" row; their project memberships go with them. One
 * transaction, so a failure leaves the user and their content untouched.
 */
export async function purgeUser(
  client: DbClient,
  userId: string
): Promise<UserPurgeResult> {
  if (PROTECTED_USER_IDS.has(userId)) {
    throw new UserPurgeError(
      "This is a system user that other records depend on. It cannot be purged.",
      400
    );
  }

  return withAuditGuc(client, buildGucPayload(), async (tx) => {
    // Locked so a concurrent restore cannot land between the check and the
    // delete.
    const { rows } = await sql<PurgedUser & { isDeleted: boolean }>`
      SELECT "id", "name", "email", "isDeleted"
      FROM "User"
      WHERE "id" = ${userId}
      FOR UPDATE
    `.execute(tx.$qb);
    const target = rows[0];

    if (!target) {
      throw new UserPurgeError(`User with ID ${userId} not found.`, 404);
    }
    if (!target.isDeleted) {
      throw new UserPurgeError(
        `User with ID ${userId} is not marked as deleted. Purge operation aborted.`,
        400
      );
    }

    await ensureDeletedUser(tx);

    const reassigned: Record<string, number> = {};
    for (const { model, column } of userPurgePlan.reassign) {
      const result = await sql`
        UPDATE ${sql.table(model)}
        SET ${sql.ref(column)} = ${DELETED_USER_ID}
        WHERE ${sql.ref(column)} = ${userId}
      `.execute(tx.$qb);
      const count = Number(result.numAffectedRows ?? 0);
      if (count > 0) reassigned[model] = (reassigned[model] ?? 0) + count;
    }

    for (const { model, column } of userPurgePlan.remove) {
      await sql`
        DELETE FROM ${sql.table(model)} WHERE ${sql.ref(column)} = ${userId}
      `.execute(tx.$qb);
    }

    await sql`DELETE FROM "User" WHERE "id" = ${userId}`.execute(tx.$qb);

    return {
      user: { id: target.id, name: target.name, email: target.email },
      reassigned,
    };
  });
}

// Search documents store their creator's id, name and avatar; sessions also
// store their assignee's.
const REWRITE_SEARCH_DOCUMENT = `
  if (ctx._source.createdById == params.from) {
    ctx._source.createdById = params.to;
    ctx._source.createdByName = params.name;
    ctx._source.remove('createdByImage');
  }
  if (ctx._source.creatorId == params.from) {
    ctx._source.creatorId = params.to;
    ctx._source.creatorName = params.name;
    ctx._source.remove('creatorImage');
  }
  if (ctx._source.assignedToId == params.from) {
    ctx._source.remove('assignedToId');
    ctx._source.remove('assignedToName');
    ctx._source.remove('assignedToImage');
  }
`;

/**
 * Points the purged user's search documents at the "Deleted User" row, matching
 * what purgeUser did in the database. Starts the rewrite and returns; a user
 * with many documents would outlast the request. Does nothing when search is
 * not configured.
 */
export async function reassignPurgedUserInSearch(
  userId: string,
  tenantId?: string
): Promise<void> {
  const client = getElasticsearchClient();
  if (!client) return;

  await client.updateByQuery({
    index: Object.values(SearchableEntityType).map((entityType) =>
      getEntityIndexName(entityType, tenantId)
    ),
    ignore_unavailable: true,
    allow_no_indices: true,
    conflicts: "proceed",
    refresh: true,
    wait_for_completion: false,
    query: {
      bool: {
        should: [
          { term: { createdById: userId } },
          { term: { creatorId: userId } },
          { term: { assignedToId: userId } },
        ],
        minimum_should_match: 1,
      },
    },
    script: {
      lang: "painless",
      source: REWRITE_SEARCH_DOCUMENT,
      params: { from: userId, to: DELETED_USER_ID, name: DELETED_USER_NAME },
    },
  });
}
