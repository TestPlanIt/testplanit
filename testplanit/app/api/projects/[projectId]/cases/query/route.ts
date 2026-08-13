import { getEnhancedDb } from "@/lib/auth/utils";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { paginatedFindManyWithRelations } from "~/lib/paginatedFindMany";
import { reviveWhereFromTransport } from "~/lib/repository/whereTransport";
import { sanitizeSearchCaseIds } from "~/lib/repositoryCaseSearchIds";
import { authOptions } from "~/server/auth";

// One POST read path for the case table in BOTH of its modes: the client-built
// predicate `where` (which carries folder scoping) and the Elasticsearch id set
// compose here. POST rather than GET because a folder-subtree predicate or a
// 10,000-id search set serialized into a query string blows past the HTTP 414
// URI limit (the same reason fetch-many and by-folder-descendants exist).
//
// REPOSITORY MODE (no `testRunIds`) reads RepositoryCases; row id = case id.
// RUN MODE (`testRunIds` present) reads TestRunCases with the repository
// predicate nested under `repositoryCase`; row id = testRunCase id, and a
// multi-config run legitimately yields one row per (run x case) — those rows are
// never deduped by case.
//
// The two modes share one route because they share every guarantee that matters
// here: the same project membership gate, the same non-widening AND composition,
// the same page ceiling, the same sanitized Elasticsearch id set and the same
// relevance-order reconstruction. Only three things differ — the model, which
// column carries the CASE id, and the scope operands — so they are parameters,
// not a second implementation. A sibling route would have had to copy the
// bounded-hydration and scope-forcing code that these guarantees live in, which
// is exactly the code that must not drift.
const requestSchema = z.object({
  where: z.record(z.string(), z.any()).optional(),
  /**
   * Presence switches the route to run mode. An explicit empty array means
   * "no runs" and matches nothing — it never widens to the whole project.
   */
  testRunIds: z.array(z.number()).max(500).optional(),
  /** Run mode only: the repository predicate, nested under `repositoryCase`. */
  repositoryCaseWhere: z.record(z.string(), z.any()).optional(),
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

interface FindManyModel {
  // loose on purpose: the select is dynamic and ZenStack's overloaded findMany
  // signature isn't worth threading through here.
  findMany: (args: any) => Promise<any[]>;
}

// The one model this request reads — RepositoryCases or TestRunCases. The two
// delegates have incompatible overload sets, so they are narrowed to the two
// operations this route actually calls.
interface QueryModel extends FindManyModel {
  count: (args: any) => Promise<number>;
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

// Attachment `size` is a BigInt column and JSON.stringify throws on BigInt. In
// run mode the attachments hang off the nested `repositoryCase` instead of the
// row itself, so both positions are converted.
function serializeAttachments(attachments: Array<Record<string, unknown>>) {
  return attachments.map((a) => ({
    ...a,
    size: typeof a.size === "bigint" ? a.size.toString() : a.size,
  }));
}

function serializeCases(cases: Array<Record<string, unknown>> | null) {
  if (!cases) return null;
  return cases.map((c) => {
    const row = c as {
      attachments?: Array<Record<string, unknown>>;
      repositoryCase?: { attachments?: Array<Record<string, unknown>> } | null;
    };
    let serialized = c;
    if (row.attachments) {
      serialized = {
        ...serialized,
        attachments: serializeAttachments(row.attachments),
      };
    }
    if (row.repositoryCase?.attachments) {
      serialized = {
        ...serialized,
        repositoryCase: {
          ...row.repositoryCase,
          attachments: serializeAttachments(row.repositoryCase.attachments),
        },
      };
    }
    return serialized;
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
    const {
      where: transportWhere,
      testRunIds,
      repositoryCaseWhere: transportRepositoryCaseWhere,
      orderBy,
      select,
      skip,
      take,
      searchCaseIds,
      idsOnly,
    } = requestSchema.parse(body);

    // JSON carries ZenStack's Json-null sentinels as their plain brand form.
    // Left as-is the ORM reads them as ordinary Json records and compiles
    // "value is not null" into a comparison against that object — always true —
    // so the value-not-null fragments silently matched the wrong rows.
    const where = reviveWhereFromTransport(transportWhere);
    const repositoryCaseWhere = reviveWhereFromTransport(
      transportRepositoryCaseWhere
    );

    const runMode = testRunIds !== undefined;

    // A nested repository predicate has no meaning against RepositoryCases —
    // accepting it silently would drop the filter and return a wider set than
    // the caller asked for.
    if (!runMode && repositoryCaseWhere !== undefined) {
      return NextResponse.json(
        { error: "repositoryCaseWhere requires testRunIds" },
        { status: 400 }
      );
    }

    const pageSize = resolveTake(take);

    // Same normalization as the search id set: safe positive ints, deduped.
    const runIds = testRunIds ? sanitizeSearchCaseIds(testRunIds) : undefined;

    const searchIds =
      searchCaseIds === undefined
        ? undefined
        : sanitizeSearchCaseIds(searchCaseIds);

    // Run mode reads TestRunCases; the CASE id (what Elasticsearch returns and
    // what the repository predicate is about) lives in `repositoryCaseId`, while
    // `id` stays the per-(run x case) row identity used for paging and
    // hydration. Repository mode collapses both onto `id`.
    const model = (runMode
      ? db.testRunCases
      : db.repositoryCases) as unknown as QueryModel;
    const caseIdKey = runMode ? "repositoryCaseId" : "id";
    // Phase-1 (id-only) projection. Run mode needs the case id alongside the row
    // id to rank rows by Elasticsearch relevance.
    const idSelect = runMode
      ? { id: true, repositoryCaseId: true }
      : { id: true };
    const rowCaseId = (row: Record<string, unknown>) =>
      row[caseIdKey] as number;

    // Both hydration paths key rows by `id`, so it must be selected.
    const effectiveSelect = select ? { ...select, id: true } : undefined;

    const emptyResult = () =>
      NextResponse.json(
        idsOnly
          ? runMode
            ? { ids: [], caseIds: [], totalCount: 0 }
            : { ids: [], totalCount: 0 }
          : { cases: select ? [] : null, totalCount: 0 }
      );

    // A search that resolved to nothing (or to nothing usable) matches nothing —
    // it must not degrade into "no search filter at all". The same rule applies
    // to an empty run scope: "no runs" is zero rows, never "every run in the
    // project".
    if (searchIds !== undefined && searchIds.length === 0) return emptyResult();
    if (runIds !== undefined && runIds.length === 0) return emptyResult();

    // SERVER-FORCED SCOPE, INTERSECTED (never spread-merged): the client `where`
    // and each server constraint are separate AND operands, so a client key can
    // only ever narrow the result set. Two properties fall out of this shape:
    //   - projectId, the run scope and the search id set cannot be widened by a
    //     client key of the same name (an AND sibling can contradict, never
    //     replace);
    //   - a client's own `id` filter is preserved and intersected instead of
    //     being silently dropped by the search ids (page-by-id requests work).
    // Folder scoping is NOT server-forced here — the client sends it inside
    // `where`, where it is subject to the same intersection as any other
    // predicate. Client operands come first, server operands last.
    const enforcedWhere: Record<string, any> = runMode
      ? {
          AND: [
            where ?? {},
            ...(repositoryCaseWhere
              ? [{ repositoryCase: repositoryCaseWhere }]
              : []),
            { testRunId: { in: runIds } },
            // Both ends are pinned to this project: the run the row belongs to
            // and the case it points at. Either alone would be enough today;
            // together they hold even if one relation is ever re-parented.
            { testRun: { projectId, isDeleted: false } },
            { repositoryCase: { projectId } },
            ...(searchIds ? [{ repositoryCaseId: { in: searchIds } }] : []),
          ],
        }
      : {
          AND: [
            where ?? {},
            { projectId },
            ...(searchIds ? [{ id: { in: searchIds } }] : []),
          ],
        };

    // RELEVANCE PATH (spec §9): no explicit sort + an active search means the
    // Elasticsearch `_score` order wins. That order lives only in the position
    // of searchCaseIds, so the page is cut from the ranked row list and
    // re-imposed on the hydrated rows. In run mode a case id can map to several
    // rows (one per configuration); they share a rank and are ordered by row id
    // between themselves, and they are NOT collapsed into one row.
    if (!orderBy && searchIds) {
      const matchedRows = (await model.findMany({
        where: enforcedWhere,
        select: idSelect,
      })) as Array<Record<string, unknown>>;

      const rankByCaseId = new Map(searchIds.map((id, index) => [id, index]));
      const rankedRows = matchedRows
        .filter((row) => rankByCaseId.has(rowCaseId(row)))
        .sort((a, b) => {
          const rank =
            rankByCaseId.get(rowCaseId(a))! - rankByCaseId.get(rowCaseId(b))!;
          return rank !== 0 ? rank : (a.id as number) - (b.id as number);
        });

      const orderedIds = rankedRows.map((row) => row.id as number);
      const totalCount = orderedIds.length;

      if (idsOnly) {
        return NextResponse.json(
          runMode
            ? {
                ids: orderedIds,
                caseIds: rankedRows.map(rowCaseId),
                totalCount,
              }
            : { ids: orderedIds, totalCount }
        );
      }

      const start = skip ?? 0;
      const pageIds = orderedIds.slice(start, start + pageSize);

      if (!effectiveSelect || pageIds.length === 0) {
        return NextResponse.json({
          cases: select ? [] : null,
          totalCount,
        });
      }

      const rows = await hydrateByIds(
        model,
        enforcedWhere,
        pageIds,
        effectiveSelect
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
      const rows = (await model.findMany({
        where: enforcedWhere,
        orderBy,
        select: idSelect,
      })) as Array<Record<string, unknown>>;
      const ids = rows.map((r) => r.id as number);
      return NextResponse.json(
        runMode
          ? { ids, caseIds: rows.map(rowCaseId), totalCount: ids.length }
          : { ids, totalCount: ids.length }
      );
    }

    // Sorted/unsearched path: the DB owns both page composition and row order.
    // paginatedFindManyWithRelations keeps relation hydration O(page) instead of
    // O(all matching rows).
    const [totalCount, cases] = await Promise.all([
      model.count({ where: enforcedWhere }),
      effectiveSelect
        ? paginatedFindManyWithRelations(model, {
            where: enforcedWhere,
            orderBy,
            select: effectiveSelect,
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

    console.error("Error querying cases:", error);
    return NextResponse.json(
      { error: "Failed to fetch cases" },
      { status: 500 }
    );
  }
}
