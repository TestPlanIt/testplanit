import { getEnhancedDb } from "@/lib/auth/utils";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { paginatedFindManyWithRelations } from "~/lib/paginatedFindMany";
import { authOptions } from "~/server/auth";

// One POST read path for the repository table: the client-built predicate
// `where` (which carries folder scoping) and the Elasticsearch id set compose
// here. POST rather than GET because a folder-subtree predicate or a 10,000-id
// search set serialized into a query string blows past the HTTP 414 URI limit
// (the same reason fetch-many and by-folder-descendants exist).
const requestSchema = z.object({
  where: z.record(z.string(), z.any()).optional(),
  orderBy: z
    .union([
      z.record(z.string(), z.any()),
      z.array(z.record(z.string(), z.any())),
    ])
    .optional(),
  select: z.record(z.string(), z.any()).optional(),
  skip: z.number().int().nonnegative().optional(),
  take: z.number().int().nonnegative().optional(),
  searchCaseIds: z.array(z.number()).optional(),
  idsOnly: z.boolean().optional(),
});

// Elasticsearch's default `index.max_result_window`: the client can never
// resolve more than 10,000 ids, so anything beyond that is a malformed or
// hostile body rather than a real search snapshot.
const ES_MAX_RESULT_WINDOW = 10000;

// Hard ceiling on rows hydrated for one request. `take` is client-supplied, so
// without a ceiling a single body can ask for every matching row with the full
// relation select attached. Row COUNTS and `idsOnly` id lists are unaffected —
// only the hydrated page is bounded.
const MAX_PAGE_SIZE = 1000;

// Per-query hydration chunk: relation subqueries (and the PolicyPlugin's
// per-row access checks) are built for every row a findMany matches, so the
// page is hydrated in fixed-size id batches to keep that work bounded no matter
// how large the page is.
const HYDRATION_CHUNK_SIZE = 200;

// Bound and normalize the client's page size. Absent means "as many as the
// ceiling allows", never "unbounded".
function resolveTake(take: number | undefined): number {
  if (take === undefined) return MAX_PAGE_SIZE;
  return Math.min(take, MAX_PAGE_SIZE);
}

// Keep safe positive integers, drop everything else, preserve the relevance
// order the ids arrived in, and cap the set at the ES result window.
function sanitizeSearchCaseIds(ids: number[]): number[] {
  const seen = new Set<number>();
  const sanitized: number[] = [];
  for (const id of ids) {
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    sanitized.push(id);
    if (sanitized.length >= ES_MAX_RESULT_WINDOW) break;
  }
  return sanitized;
}

interface FindManyModel {
  // loose on purpose: the select is dynamic and ZenStack's overloaded findMany
  // signature isn't worth threading through here.
  findMany: (args: any) => Promise<any[]>;
}

// Hydrate an explicit id list in bounded batches. Each query matches at most
// HYDRATION_CHUNK_SIZE rows, so relation building stays flat regardless of page
// size. `where` still rides along so policy/scope constraints are re-applied.
async function hydrateByIds(
  model: FindManyModel,
  where: Record<string, any>,
  ids: number[],
  select: Record<string, unknown>
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < ids.length; i += HYDRATION_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + HYDRATION_CHUNK_SIZE);
    const chunkRows = (await model.findMany({
      where: { ...where, id: { in: chunk } },
      select,
    })) as Array<Record<string, unknown>>;
    rows.push(...chunkRows);
  }
  return rows;
}

function serializeCases(cases: Array<Record<string, unknown>> | null) {
  if (!cases) return null;
  return cases.map((c) => {
    const attachments = (c as { attachments?: Array<Record<string, unknown>> })
      .attachments;
    if (!attachments) return c;
    return {
      ...c,
      attachments: attachments.map((a) => ({
        ...a,
        size: typeof a.size === "bigint" ? a.size.toString() : a.size,
      })),
    };
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { projectId: projectIdParam } = await params;
    const projectId = parseInt(projectIdParam);
    if (isNaN(projectId)) {
      return NextResponse.json(
        { error: "Invalid project ID" },
        { status: 400 }
      );
    }

    // Enhanced client: RepositoryCases `@@allow('read')` is applied per row, so
    // rows the caller can't read are elided from both the page and the counts.
    const db = await getEnhancedDb(session);

    const project = await db.projects.findUnique({
      where: { id: projectId },
    });

    if (!project || project.isDeleted) {
      return NextResponse.json(
        { error: "Project not found or access denied" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { where, orderBy, select, skip, take, searchCaseIds, idsOnly } =
      requestSchema.parse(body);

    const pageSize = resolveTake(take);

    const searchIds =
      searchCaseIds === undefined
        ? undefined
        : sanitizeSearchCaseIds(searchCaseIds);

    // A search that resolved to nothing (or to nothing usable) matches nothing —
    // it must not degrade into "no search filter at all".
    if (searchIds !== undefined && searchIds.length === 0) {
      return NextResponse.json(
        idsOnly
          ? { ids: [], totalCount: 0 }
          : { cases: select ? [] : null, totalCount: 0 }
      );
    }

    // SERVER-FORCED SCOPE, INTERSECTED (never spread-merged): the client `where`
    // and each server constraint are separate AND operands, so a client key can
    // only ever narrow the result set. Two properties fall out of this shape:
    //   - projectId and the search id set cannot be widened by a client key of
    //     the same name (an AND sibling can contradict, never replace);
    //   - a client's own `id` filter is preserved and intersected instead of
    //     being silently dropped by the search ids (page-by-id requests work).
    // Folder scoping is NOT server-forced here — the client sends it inside
    // `where`, where it is subject to the same intersection as any other
    // predicate.
    const enforcedWhere: Record<string, any> = {
      AND: [
        where ?? {},
        { projectId },
        ...(searchIds ? [{ id: { in: searchIds } }] : []),
      ],
    };

    // RELEVANCE PATH (spec §9): no explicit sort + an active search means the
    // Elasticsearch `_score` order wins. That order lives only in the position
    // of searchCaseIds, so the page is cut from the id array and re-imposed on
    // the hydrated rows.
    if (!orderBy && searchIds) {
      const matchedRows = await db.repositoryCases.findMany({
        where: enforcedWhere,
        select: { id: true },
      });
      const matchedIds = new Set(
        (matchedRows as Array<{ id: number }>).map((r) => r.id)
      );
      const orderedIds = searchIds.filter((id) => matchedIds.has(id));
      const totalCount = orderedIds.length;

      if (idsOnly) {
        return NextResponse.json({ ids: orderedIds, totalCount });
      }

      const start = skip ?? 0;
      const pageIds = orderedIds.slice(start, start + pageSize);

      if (!select || pageIds.length === 0) {
        return NextResponse.json({
          cases: select ? [] : null,
          totalCount,
        });
      }

      const rows = await hydrateByIds(
        db.repositoryCases,
        enforcedWhere,
        pageIds,
        select
      );

      const byId = new Map(rows.map((r) => [r.id as number, r]));
      const orderedRows = pageIds
        .map((id) => byId.get(id))
        .filter((r): r is Record<string, unknown> => r !== undefined);

      return NextResponse.json({
        cases: serializeCases(orderedRows),
        totalCount,
      });
    }

    if (idsOnly) {
      const rows = (await db.repositoryCases.findMany({
        where: enforcedWhere,
        orderBy,
        select: { id: true },
      })) as Array<{ id: number }>;
      const ids = rows.map((r) => r.id);
      return NextResponse.json({ ids, totalCount: ids.length });
    }

    // Sorted/unsearched path: the DB owns both page composition and row order.
    // paginatedFindManyWithRelations keeps relation hydration O(page) instead of
    // O(all matching rows).
    const [totalCount, cases] = await Promise.all([
      db.repositoryCases.count({ where: enforcedWhere }),
      select
        ? paginatedFindManyWithRelations(db.repositoryCases, {
            where: enforcedWhere,
            orderBy,
            select,
            skip,
            take: pageSize,
          })
        : Promise.resolve(null),
    ]);

    return NextResponse.json({
      cases: serializeCases(cases as Array<Record<string, unknown>> | null),
      totalCount,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }

    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("Error querying repository cases:", error);
    return NextResponse.json(
      { error: "Failed to fetch cases" },
      { status: 500 }
    );
  }
}
