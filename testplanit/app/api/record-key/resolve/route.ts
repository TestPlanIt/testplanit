import { NextRequest, NextResponse } from "next/server";

import { getEnhancedDb } from "~/lib/auth/utils";
import {
  parseRecordKey,
  RECORD_TYPES,
  recordTypeForToken,
  type RecordType,
} from "~/lib/recordKey";
import { readRecordKeyTypeTokens } from "~/lib/services/recordKeyConfig";
import { getServerAuthSession } from "~/server/auth";
import { SearchableEntityType, type SearchHit } from "~/types/search";

type EnhancedDb = Awaited<ReturnType<typeof getEnhancedDb>>;

/**
 * Record types that map to a searchable entity, so a resolved key can be shown
 * as a normal search result card. (Tags / data sets have no search entity, so
 * they aren't offered as a search jump — their URLs still redirect.)
 */
const TYPE_TO_ENTITY: Partial<Record<RecordType, SearchableEntityType>> = {
  [RECORD_TYPES.TEST_CASE]: SearchableEntityType.REPOSITORY_CASE,
  [RECORD_TYPES.TEST_RUN]: SearchableEntityType.TEST_RUN,
  [RECORD_TYPES.SESSION]: SearchableEntityType.SESSION,
  [RECORD_TYPES.MILESTONE]: SearchableEntityType.MILESTONE,
};

const RECORD_SELECT = {
  select: {
    name: true,
    projectId: true,
    isDeleted: true,
    project: { select: { name: true, iconUrl: true } },
  },
} as const;

/**
 * Resolve a routed record type + numeric id into a `SearchHit` (or `null` when
 * the record doesn't exist / isn't visible to the caller). The enhanced
 * (policy-aware) client scopes visibility, so a user can never resolve a key
 * into a record they can't see.
 */
async function resolveHit(
  db: EnhancedDb,
  type: RecordType,
  id: number
): Promise<SearchHit | null> {
  const entityType = TYPE_TO_ENTITY[type];
  if (!entityType) return null;

  let record: {
    name: string | null;
    projectId: number;
    isDeleted: boolean;
    project: { name: string; iconUrl: string | null } | null;
  } | null = null;

  switch (type) {
    case RECORD_TYPES.TEST_CASE:
      record = await db.repositoryCases.findUnique({
        where: { id },
        ...RECORD_SELECT,
      });
      break;
    case RECORD_TYPES.TEST_RUN:
      record = await db.testRuns.findUnique({
        where: { id },
        ...RECORD_SELECT,
      });
      break;
    case RECORD_TYPES.SESSION:
      record = await db.sessions.findUnique({
        where: { id },
        ...RECORD_SELECT,
      });
      break;
    case RECORD_TYPES.MILESTONE:
      record = await db.milestones.findUnique({
        where: { id },
        ...RECORD_SELECT,
      });
      break;
    default:
      return null;
  }

  if (!record) return null;

  return {
    id,
    entityType,
    score: 0,
    source: {
      name: record.name,
      projectId: record.projectId,
      projectName: record.project?.name ?? null,
      projectIconUrl: record.project?.iconUrl ?? null,
      isDeleted: record.isDeleted,
    },
  };
}

/**
 * Resolve either a bare id (`1234`) or a cosmetic key (`WEB-TC-1234`) to the
 * matching record(s), returned as search hits so the global search box can
 * render them as normal result cards. When a type token is present exactly one
 * type is looked up; a bare id is type-ambiguous, so every searchable type is
 * checked and all matches are returned (ids are unique per type, so at most one
 * per type).
 */
export async function GET(request: NextRequest) {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = request.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing key" }, { status: 400 });
  }

  const db = await getEnhancedDb(session);
  const tokens = await readRecordKeyTypeTokens(db);

  const parsed = parseRecordKey(key, Object.values(tokens));
  if (!parsed) {
    return NextResponse.json({ hits: [] });
  }

  // A recognized type token pins the lookup to one type; otherwise (bare id or
  // project-prefixed-only) check every searchable type.
  const tokenType = recordTypeForToken(parsed.token, tokens);
  const types = tokenType
    ? [tokenType]
    : (Object.keys(TYPE_TO_ENTITY) as RecordType[]);

  const resolved = await Promise.all(
    types.map((t) => resolveHit(db, t, parsed.id))
  );
  const hits = resolved.filter((h): h is SearchHit => h !== null);

  return NextResponse.json({ hits });
}
