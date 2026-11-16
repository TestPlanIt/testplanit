import { type RawBuilder, sql } from "kysely";
import { z } from "zod";
import { storageKeyForSrc } from "~/lib/storageKeys";
import { db } from "~/server/db";

import {
  ATTACHMENT_PARENT_TYPES,
  ATTACHMENT_STATUSES,
  LINK_MIME_TYPE,
  MAX_ACTION_ATTACHMENTS,
  NO_MIME_TYPE,
  type AttachmentParentType,
  type AttachmentStatus,
} from "./adminAttachmentRules";

export {
  ATTACHMENT_PARENT_TYPES,
  ATTACHMENT_STATUSES,
  LINK_MIME_TYPE,
  type AttachmentParentType,
  type AttachmentStatus,
};

const SORTABLE = ["createdAt", "name", "size", "mimeType"] as const;

/** A comma-separated list of values, each one of `allowed`. */
function commaList<const T extends readonly [string, ...string[]]>(allowed: T) {
  return z
    .string()
    .max(400)
    .optional()
    .transform((value) =>
      value
        ? value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : []
    )
    .pipe(z.array(z.enum(allowed)));
}

export const adminAttachmentQuerySchema = z.object({
  /** Keep attachments on any of these parent types. */
  parentTypes: commaList(ATTACHMENT_PARENT_TYPES),
  /** Keep attachments in any of these states. */
  statuses: commaList(ATTACHMENT_STATUSES),
  /** Keep attachments whose parent is in any of these projects. */
  projectIds: z
    .string()
    .max(4000)
    .optional()
    .transform((value) =>
      value
        ? value
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean)
        : []
    )
    .pipe(z.array(z.coerce.number<string>().int().positive())),
  /** Keep attachments created by any of these users (ids hold no comma). */
  createdByIds: z
    .string()
    .max(4000)
    .optional()
    .transform((value) =>
      value
        ? value
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean)
        : []
    ),
  /** Types to keep, comma separated (a mime type holds no comma). */
  mimeTypes: z
    .string()
    .max(4000)
    .optional()
    .transform((value) =>
      value
        ? value
            .split(",")
            .map((type) => type.trim())
            .filter(Boolean)
        : []
    ),
  /** Only the attachments stored as the same file as this attachment. */
  sameFileAs: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(200).optional(),
  sortBy: z.enum(SORTABLE).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().min(1).max(200).default(25),
});
export type AdminAttachmentQuery = z.infer<typeof adminAttachmentQuerySchema>;

/** The foreign key each parent type is attached through. */
const PARENT_KEYS = {
  case: "testCaseId",
  session: "sessionId",
  sessionResult: "sessionResultsId",
  testRun: "testRunsId",
  testRunResult: "testRunResultsId",
  testRunStepResult: "testRunStepResultId",
  junitTestResult: "junitTestResultId",
  issue: "issueId",
} as const;

/**
 * Each parent and the record it belongs to, joined on their primary keys.
 * Only added for the filters that look past the attachment row: as joins they
 * run in a fraction of a second where the same test written as nested
 * relation filters took several.
 */
const PARENT_JOINS = sql`
  LEFT JOIN "RepositoryCases" c ON c.id = a."testCaseId"
  LEFT JOIN "Sessions" s ON s.id = a."sessionId"
  LEFT JOIN "SessionResults" sr ON sr.id = a."sessionResultsId"
  LEFT JOIN "Sessions" srs ON srs.id = sr."sessionId"
  LEFT JOIN "TestRuns" tr ON tr.id = a."testRunsId"
  LEFT JOIN "TestRunResults" trr ON trr.id = a."testRunResultsId"
  LEFT JOIN "TestRuns" trrr ON trrr.id = trr."testRunId"
  LEFT JOIN "TestRunStepResults" tsr ON tsr.id = a."testRunStepResultId"
  LEFT JOIN "TestRunResults" tsrr ON tsrr.id = tsr."testRunResultId"
  LEFT JOIN "TestRuns" tsrrr ON tsrrr.id = tsrr."testRunId"
  LEFT JOIN "JUnitTestResult" j ON j.id = a."junitTestResultId"
  LEFT JOIN "JUnitTestSuite" js ON js.id = j."testSuiteId"
  LEFT JOIN "TestRuns" jr ON jr.id = js."testRunId"
  LEFT JOIN "Issue" i ON i.id = a."issueId"
`;

/** The parent, or the record that parent belongs to, is in the trash. */
const PARENT_DELETED = sql`(
  c."isDeleted" OR s."isDeleted" OR sr."isDeleted" OR srs."isDeleted"
  OR tr."isDeleted" OR trr."isDeleted" OR trrr."isDeleted"
  OR tsr."isDeleted" OR tsrr."isDeleted" OR tsrrr."isDeleted"
  OR jr."isDeleted" OR i."isDeleted"
)`;

const NO_PARENT = sql`COALESCE(
  a."testCaseId", a."sessionId", a."sessionResultsId", a."testRunsId",
  a."testRunResultsId", a."testRunStepResultId", a."junitTestResultId",
  a."issueId"
) IS NULL`;

const STATUS_CONDITIONS: Record<AttachmentStatus, RawBuilder<unknown>> = {
  live: sql`a."isDeleted" = false`,
  softDeleted: sql`a."isDeleted" = true`,
  noParent: NO_PARENT,
  parentDeleted: PARENT_DELETED,
};

function anyOf(conditions: RawBuilder<unknown>[]): RawBuilder<unknown> {
  return conditions.length === 1
    ? conditions[0]!
    : sql`(${sql.join(conditions, sql` OR `)})`;
}

/** `%`, `_` and `\` in a search term are text to find, not wildcards. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** The WHERE conditions for a query, and whether they need the parent joins. */
export function buildAttachmentFilter(query: AdminAttachmentQuery): {
  conditions: RawBuilder<unknown>[];
  needsParents: boolean;
} {
  const conditions: RawBuilder<unknown>[] = [];

  if (query.parentTypes.length > 0) {
    conditions.push(
      anyOf(
        query.parentTypes.map((type) =>
          type === "none"
            ? NO_PARENT
            : sql`a.${sql.ref(PARENT_KEYS[type])} IS NOT NULL`
        )
      )
    );
  }
  if (query.statuses.length > 0) {
    conditions.push(
      anyOf(query.statuses.map((status) => STATUS_CONDITIONS[status]))
    );
  }

  if (query.projectIds.length > 0) {
    // An attachment has one parent, so at most one of these is set.
    conditions.push(sql`COALESCE(
      c."projectId", s."projectId", srs."projectId", tr."projectId",
      trrr."projectId", tsrrr."projectId", jr."projectId", i."projectId"
    ) IN (${sql.join(query.projectIds)})`);
  }
  if (query.createdByIds.length > 0) {
    conditions.push(sql`a."createdById" IN (${sql.join(query.createdByIds)})`);
  }
  if (query.mimeTypes.length > 0) {
    conditions.push(
      sql`a."mimeType" IN (${sql.join(
        query.mimeTypes.map((type) => (type === NO_MIME_TYPE ? "" : type))
      )})`
    );
  }
  if (query.sameFileAs) {
    conditions.push(sql`a."url" = (
      SELECT same."url" FROM "Attachments" same WHERE same.id = ${query.sameFileAs}
    )`);
  }
  if (query.q) {
    const pattern = likePattern(query.q);
    conditions.push(
      sql`(a."name" ILIKE ${pattern} OR a."note" ILIKE ${pattern})`
    );
  }

  return {
    conditions,
    needsParents:
      query.statuses.includes("parentDeleted") || query.projectIds.length > 0,
  };
}

const RUN = {
  select: { id: true, name: true, projectId: true, isDeleted: true },
};
const SESSION = RUN;
const RESULT = { select: { id: true, isDeleted: true, testRun: RUN } };

const PARENT_INCLUDE = {
  createdBy: { select: { id: true, name: true } },
  testCase: RUN,
  session: SESSION,
  sessionResults: { select: { id: true, isDeleted: true, session: SESSION } },
  testRuns: RUN,
  testRunResults: RESULT,
  testRunStepResult: {
    select: { id: true, isDeleted: true, testRunResult: RESULT },
  },
  junitTestResult: {
    select: {
      id: true,
      testSuite: { select: { testRun: RUN } },
    },
  },
  issue: {
    select: {
      id: true,
      name: true,
      title: true,
      projectId: true,
      isDeleted: true,
    },
  },
} as const;

export interface AttachmentParent {
  type: Exclude<AttachmentParentType, "none">;
  /** Id of the record the attachment hangs off (a result, for result types). */
  id: number;
  /** The record a person would recognize it by: the case, run, session or issue. */
  entity: "case" | "testRun" | "session" | "issue";
  entityId: number;
  name: string;
  /** An issue's title; its `name` is the key. */
  title: string | null;
  projectId: number | null;
  projectName: string | null;
  /** The parent, or the record it belongs to, is in the trash. */
  isDeleted: boolean;
}

export interface AdminAttachment {
  id: number;
  name: string;
  note: string | null;
  url: string;
  mimeType: string;
  size: number;
  kind: "file" | "link";
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  isDeleted: boolean;
  deletedAt: string | null;
  /** Object key in this instance's bucket; null for links and foreign URLs. */
  storageKey: string | null;
  /**
   * How many other attachments are stored as this same file. Copying a case
   * copies its attachment rows, not the files behind them.
   */
  sharedWith: number;
  parent: AttachmentParent | null;
}

type Named = {
  id: number;
  name: string;
  projectId: number | null;
  isDeleted: boolean;
};

function resolveParent(row: any): Omit<AttachmentParent, "projectName"> | null {
  const from = (
    type: AttachmentParent["type"],
    id: number,
    entity: AttachmentParent["entity"],
    owner: Named | null | undefined,
    alsoDeleted = false
  ) => ({
    type,
    id,
    entity,
    entityId: owner?.id ?? id,
    name: owner?.name ?? "",
    title: null,
    projectId: owner?.projectId ?? null,
    isDeleted: alsoDeleted || owner?.isDeleted === true,
  });

  if (row.testCase) {
    return from("case", row.testCase.id, "case", row.testCase);
  }
  if (row.session) {
    return from("session", row.session.id, "session", row.session);
  }
  if (row.sessionResults) {
    const { id, isDeleted, session } = row.sessionResults;
    return from("sessionResult", id, "session", session, isDeleted);
  }
  if (row.testRuns) {
    return from("testRun", row.testRuns.id, "testRun", row.testRuns);
  }
  if (row.testRunResults) {
    const { id, isDeleted, testRun } = row.testRunResults;
    return from("testRunResult", id, "testRun", testRun, isDeleted);
  }
  if (row.testRunStepResult) {
    const { id, isDeleted, testRunResult } = row.testRunStepResult;
    return from(
      "testRunStepResult",
      id,
      "testRun",
      testRunResult?.testRun,
      isDeleted || testRunResult?.isDeleted === true
    );
  }
  if (row.junitTestResult) {
    return from(
      "junitTestResult",
      row.junitTestResult.id,
      "testRun",
      row.junitTestResult.testSuite?.testRun
    );
  }
  if (row.issue) {
    return {
      ...from("issue", row.issue.id, "issue", row.issue),
      title: row.issue.title ?? null,
    };
  }
  return null;
}

export async function listAdminAttachments(
  query: AdminAttachmentQuery
): Promise<{ items: AdminAttachment[]; totalCount: number }> {
  const { conditions, needsParents } = buildAttachmentFilter(query);
  const direction = query.sortDir === "asc" ? sql`ASC` : sql`DESC`;

  // One statement finds the page, the total and how many other attachments
  // share each file; the rows are then read by id.
  const order = sql`a.${sql.ref(query.sortBy)} ${direction}, a.id DESC`;
  const { rows: page } = await sql<{
    id: number;
    total: bigint;
    sharedWith: bigint;
  }>`
    WITH page AS (
      SELECT
        a.id,
        a."url",
        COUNT(*) OVER () AS total,
        ROW_NUMBER() OVER (ORDER BY ${order}) AS pos
      FROM "Attachments" a
      ${needsParents ? PARENT_JOINS : sql``}
      ${conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``}
      ORDER BY ${order}
      LIMIT ${query.take} OFFSET ${query.skip}
    )
    SELECT page.id, page.total, COALESCE(uses.n, 1) - 1 AS "sharedWith"
    FROM page
    LEFT JOIN (
      SELECT o."url", COUNT(*) AS n
      FROM "Attachments" o
      WHERE o."mimeType" <> ${LINK_MIME_TYPE}
        AND o."url" IN (SELECT "url" FROM page)
      GROUP BY o."url"
    ) uses ON uses."url" = page."url"
    ORDER BY page.pos
  `.execute(db.$qb);

  const ids = page.map((row) => row.id);
  const totalCount = Number(page[0]?.total ?? 0);
  const sharedWith = new Map(
    page.map((row) => [row.id, Number(row.sharedWith ?? 0)])
  );
  const found = ids.length
    ? await db.attachments.findMany({
        where: { id: { in: ids } },
        include: PARENT_INCLUDE as any,
      })
    : [];
  const byId = new Map((found as any[]).map((row) => [row.id, row]));
  const rows = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)] : []));

  const parents = (rows as any[]).map(resolveParent);
  const projectIds = [
    ...new Set(
      parents.flatMap((parent) => (parent?.projectId ? [parent.projectId] : []))
    ),
  ];
  const projects = projectIds.length
    ? await db.projects.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, name: true },
      })
    : [];
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));

  const items = (rows as any[]).map((row, index): AdminAttachment => {
    const parent = parents[index];
    const kind = row.mimeType === LINK_MIME_TYPE ? "link" : "file";
    return {
      id: row.id,
      name: row.name,
      note: row.note,
      url: row.url,
      mimeType: row.mimeType,
      size: Number(row.size),
      kind,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy
        ? { id: row.createdBy.id, name: row.createdBy.name }
        : null,
      isDeleted: row.isDeleted,
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
      storageKey: kind === "file" ? storageKeyForSrc(row.url) : null,
      sharedWith: kind === "file" ? (sharedWith.get(row.id) ?? 0) : 0,
      parent: parent
        ? {
            ...parent,
            projectName: parent.projectId
              ? (projectNames.get(parent.projectId) ?? null)
              : null,
          }
        : null,
    };
  });

  return { items, totalCount };
}

/**
 * The ids of every attachment a query matches, for selecting all of them
 * without paging them in. Stops at the most one action takes.
 */
export async function listAdminAttachmentIds(
  query: AdminAttachmentQuery
): Promise<number[]> {
  const { conditions, needsParents } = buildAttachmentFilter(query);
  const { rows } = await sql<{ id: number }>`
    SELECT a.id
    FROM "Attachments" a
    ${needsParents ? PARENT_JOINS : sql``}
    ${conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``}
    ORDER BY a.id DESC
    LIMIT ${MAX_ACTION_ATTACHMENTS}
  `.execute(db.$qb);
  return rows.map((row) => row.id);
}

export interface AttachmentMimeType {
  /** Empty for files that were uploaded with no type. */
  mimeType: string;
  /** Files of this type, in the trash or not. */
  count: number;
}

/** Every file type in use, most common first. */
export async function listAttachmentMimeTypes(): Promise<AttachmentMimeType[]> {
  const rows = await db.$queryRaw<Array<{ mimeType: string; count: bigint }>>`
    SELECT "mimeType", COUNT(*) AS "count"
    FROM "Attachments"
    GROUP BY "mimeType"
    ORDER BY COUNT(*) DESC, "mimeType" ASC
  `;
  return rows.map((row) => ({
    mimeType: row.mimeType,
    count: Number(row.count),
  }));
}
