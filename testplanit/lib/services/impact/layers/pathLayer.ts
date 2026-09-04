import type { ImpactConfig } from "../config";
import { pathScoreFor } from "../scoring";
import type { LayerResult, PathReason, SearchMode } from "../types";

export interface PathDbClient {
  repositoryCases: { findMany: (args: any) => Promise<any[]> };
  repositoryCaseTag: { findMany: (args: any) => Promise<any[]> };
  repositoryFolders: { findMany: (args: any) => Promise<any[]> };
}
export interface EsClientLike {
  search: (args: any) => Promise<any>;
  count?: (args: any) => Promise<any>;
}

export interface PathTermsInput {
  symbolTerms: string[];
  pathTerms: string[];
  exactSegments: string[];
}

export interface PathLayerInput {
  projectId: number;
  indexName: string;
  terms: PathTermsInput;
  cfg: Pick<
    ImpactConfig,
    "minSearchScore" | "maxSearchResults" | "bm25Saturation"
  >;
  /** Extra where-clause for the DB paths (e.g. the draft-state filter). */
  caseFilter?: Record<string, unknown>;
}

export interface PathLayerOutput {
  layer: LayerResult;
  /** Where the text hits came from, not which searches were attempted. */
  searchMode: SearchMode;
  /** The project has nothing in the search index, so text matching is blind. */
  indexEmpty?: boolean;
  /** The index was unavailable or errored; the database answered instead. */
  searchFailed?: boolean;
}

const MAX_FOLDER_CASES = 200;
const DB_FALLBACK_TERMS = 15;

function fieldFor(
  matchedQueries: string[] | undefined
): PathReason["matchedField"] {
  const names = matchedQueries ?? [];
  if (names.includes("symbol_name") || names.includes("path_name")) {
    return "es.name";
  }
  return "es.searchableContent";
}

function termFor(
  matchedQueries: string[] | undefined,
  terms: PathTermsInput
): string {
  const names = matchedQueries ?? [];
  const symbolHit = names.some((n) => n.startsWith("symbol_"));
  return (symbolHit ? terms.symbolTerms[0] : terms.pathTerms[0]) ?? "";
}

async function searchElasticsearch(
  es: EsClientLike,
  input: PathLayerInput
): Promise<Map<number, PathReason[]> & { maxRaw?: number }> {
  const { terms, cfg } = input;
  const should: Record<string, unknown>[] = [];
  const symbolQuery = terms.symbolTerms.join(" ");
  const pathQuery = terms.pathTerms.join(" ");
  if (symbolQuery) {
    should.push(
      {
        match: {
          name: {
            query: symbolQuery,
            operator: "or",
            boost: 10,
            _name: "symbol_name",
          },
        },
      },
      {
        match: {
          searchableContent: {
            query: symbolQuery,
            operator: "or",
            boost: 5,
            _name: "symbol_content",
          },
        },
      }
    );
  }
  if (pathQuery) {
    should.push(
      {
        match: {
          name: {
            query: pathQuery,
            operator: "or",
            boost: 4,
            _name: "path_name",
          },
        },
      },
      {
        match: {
          searchableContent: {
            query: pathQuery,
            operator: "or",
            boost: 1,
            _name: "path_content",
          },
        },
      }
    );
  }
  const out = new Map<number, PathReason[]>() as Map<number, PathReason[]> & {
    maxRaw?: number;
  };
  if (should.length === 0) return out;

  const response = await es.search({
    index: input.indexName,
    size: cfg.maxSearchResults,
    min_score: cfg.minSearchScore,
    _source: false,
    query: {
      bool: {
        filter: [
          { term: { projectId: input.projectId } },
          { term: { isArchived: false } },
          { term: { isDeleted: false } },
        ],
        must: [{ bool: { minimum_should_match: 1, should } }],
      },
    },
  });

  const hits: Array<{
    _id?: string;
    _score?: number;
    matched_queries?: string[];
  }> = response?.hits?.hits ?? [];
  let maxRaw = 0;
  for (const hit of hits) {
    if (hit._id === undefined) continue;
    const caseId = parseInt(hit._id, 10);
    if (!Number.isInteger(caseId)) continue;
    const raw = hit._score ?? 0;
    maxRaw = Math.max(maxRaw, raw);
    out.set(caseId, [
      {
        kind: "PATH",
        term: termFor(hit.matched_queries, terms),
        matchedField: fieldFor(hit.matched_queries),
        rawScore: raw,
      },
    ]);
  }
  out.maxRaw = maxRaw;
  return out;
}

async function searchDbByName(
  db: PathDbClient,
  input: PathLayerInput
): Promise<Map<number, PathReason[]>> {
  const out = new Map<number, PathReason[]>();
  const terms = [...input.terms.symbolTerms, ...input.terms.pathTerms]
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .slice(0, DB_FALLBACK_TERMS);
  if (terms.length === 0) return out;

  const rows = (await db.repositoryCases.findMany({
    where: {
      projectId: input.projectId,
      isDeleted: false,
      isArchived: false,
      ...(input.caseFilter ?? {}),
      OR: terms.map((term) => ({
        name: { contains: term, mode: "insensitive" },
      })),
    },
    select: { id: true, name: true },
    take: input.cfg.maxSearchResults,
  })) as Array<{ id: number; name: string }>;

  for (const row of rows) {
    const lower = row.name.toLowerCase();
    const matched = terms.filter((t) => lower.includes(t));
    out.set(
      row.id,
      matched.map((term) => ({ kind: "PATH", term, matchedField: "db.name" }))
    );
  }
  return out;
}

async function matchTagsAndFolders(
  db: PathDbClient,
  input: PathLayerInput
): Promise<Map<number, PathReason[]>> {
  const out = new Map<number, PathReason[]>();
  const segments = input.terms.exactSegments.filter(Boolean);
  if (segments.length === 0) return out;

  const add = (caseId: number, reason: PathReason) => {
    const list = out.get(caseId) ?? [];
    list.push(reason);
    out.set(caseId, list);
  };

  const tagRows = (await db.repositoryCaseTag.findMany({
    where: {
      tag: { name: { in: segments, mode: "insensitive" }, isDeleted: false },
      case: {
        projectId: input.projectId,
        isDeleted: false,
        isArchived: false,
        ...(input.caseFilter ?? {}),
      },
    },
    select: { caseId: true, tag: { select: { name: true } } },
  })) as Array<{ caseId: number; tag: { name: string } }>;
  for (const row of tagRows) {
    add(row.caseId, {
      kind: "PATH",
      term: row.tag.name.toLowerCase(),
      matchedField: "db.tag",
    });
  }

  const folders = (await db.repositoryFolders.findMany({
    where: {
      projectId: input.projectId,
      isDeleted: false,
      name: { in: segments, mode: "insensitive" },
    },
    select: { id: true, name: true },
  })) as Array<{ id: number; name: string }>;
  for (const folder of folders) {
    const cases = (await db.repositoryCases.findMany({
      where: {
        folderId: folder.id,
        isDeleted: false,
        isArchived: false,
        ...(input.caseFilter ?? {}),
      },
      select: { id: true },
      take: MAX_FOLDER_CASES,
    })) as Array<{ id: number }>;
    for (const c of cases) {
      add(c.id, {
        kind: "PATH",
        term: folder.name.toLowerCase(),
        matchedField: "db.folder",
      });
    }
  }
  return out;
}

/** Whether this project has anything indexed at all, ignoring the query. */
async function projectIsIndexed(
  es: EsClientLike,
  input: PathLayerInput
): Promise<boolean> {
  if (typeof es.count !== "function") return true;
  const response = await es.count({
    index: input.indexName,
    query: { bool: { filter: [{ term: { projectId: input.projectId } }] } },
  });
  const total =
    typeof response?.count === "number"
      ? response.count
      : response?.body?.count;
  return typeof total === "number" ? total > 0 : true;
}

/**
 * Layer 1: cases whose text, tags, or folder echo the changed paths and
 * symbols. Elasticsearch BM25 first; a DB name search when it is unavailable.
 *
 * An empty result is not the same as an empty index. A project nobody has
 * indexed answers every query with zero hits and no error, which would leave
 * this layer silently blind, so a zero-hit search is retried against the
 * database and reported.
 */
export async function runPathLayer(
  db: PathDbClient,
  es: EsClientLike | null,
  input: PathLayerInput
): Promise<PathLayerOutput> {
  let searchMode: SearchMode = "none";
  let textHits = new Map<number, PathReason[]>() as Map<
    number,
    PathReason[]
  > & {
    maxRaw?: number;
  };

  let indexEmpty = false;
  // No client at all counts as unavailable, the same as one that throws.
  let searchFailed = !es;

  if (es) {
    try {
      textHits = await searchElasticsearch(es, input);
      searchMode = "es";
      if (textHits.size === 0) {
        indexEmpty = !(await projectIsIndexed(es, input));
      }
    } catch (error) {
      searchFailed = true;
      console.warn(
        "[impact] Elasticsearch search failed, falling back to DB:",
        error instanceof Error ? error.message : error
      );
    }
  }
  // Nothing from the index means nothing to lose by asking the database, and
  // everything to gain when the index is stale, empty, or simply out of date.
  if (searchMode !== "es" || textHits.size === 0) {
    textHits = await searchDbByName(db, input);
    searchMode = "db";
  }

  const structural = await matchTagsAndFolders(db, input);

  const layer: LayerResult = new Map();
  const caseIds = new Set<number>([...textHits.keys(), ...structural.keys()]);
  const esContext = {
    maxInResult: textHits.maxRaw ?? 0,
    saturation: input.cfg.bm25Saturation,
  };
  for (const caseId of caseIds) {
    const reasons = [
      ...(textHits.get(caseId) ?? []),
      ...(structural.get(caseId) ?? []),
    ];
    const score = pathScoreFor(reasons, esContext);
    if (score <= 0) continue;
    layer.set(caseId, { caseId, score, reasons });
  }
  return {
    layer,
    searchMode,
    ...(indexEmpty ? { indexEmpty: true } : {}),
    ...(searchFailed ? { searchFailed: true } : {}),
  };
}
