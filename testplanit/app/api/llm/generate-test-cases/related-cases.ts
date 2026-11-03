import type { DbClient } from "~/lib/zenstack";
import {
  getElasticsearchClient,
  getRepositoryCaseIndexName,
} from "~/services/elasticsearchService";

/** What the generator is about, used to find related cases by content. */
export interface RelatedCasesQuery {
  projectId: number;
  /** Issue title, document title, or page title. */
  title: string;
  description?: string;
  /** The user's extra guidance — usually names the feature under test. */
  notes?: string;
  /** Cases on this template are ranked ahead of otherwise equal matches. */
  templateId?: number;
  excludeCaseIds?: Set<number>;
  tenantId?: string;
  limit?: number;
}

/** Cap on how much issue text feeds the similarity query. */
const LIKE_TEXT_MAX_CHARS = 4000;

/**
 * Rank the project's test cases by content similarity to the issue, best
 * match first. Returns `null` when Elasticsearch is not configured or the
 * query fails, so the caller can fall back to a database sample instead of
 * treating the project as empty.
 */
export async function findRelatedCaseIds(
  query: RelatedCasesQuery
): Promise<number[] | null> {
  const client = getElasticsearchClient();
  if (!client) return null;

  const like = [query.title, query.description, query.notes]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part.length > 0)
    .map((part) => part.slice(0, LIKE_TEXT_MAX_CHARS));
  if (like.length === 0) return null;

  const filter: Record<string, unknown>[] = [
    { term: { projectId: query.projectId } },
    { term: { isDeleted: false } },
    { term: { isArchived: false } },
  ];
  const mustNot: Record<string, unknown>[] = [];
  if (query.excludeCaseIds && query.excludeCaseIds.size > 0) {
    mustNot.push({ ids: { values: [...query.excludeCaseIds].map(String) } });
  }

  try {
    const response = await client.search({
      index: getRepositoryCaseIndexName(query.tenantId),
      size: query.limit ?? 20,
      _source: false,
      query: {
        bool: {
          must: [
            {
              more_like_this: {
                fields: ["name", "searchableContent"],
                like,
                min_term_freq: 1,
                min_doc_freq: 1,
                max_query_terms: 40,
                minimum_should_match: "1",
              },
            },
          ],
          should:
            query.templateId != null
              ? [
                  {
                    term: { templateId: { value: query.templateId, boost: 2 } },
                  },
                ]
              : [],
          filter,
          must_not: mustNot,
        },
      },
    });

    const ids: number[] = [];
    for (const hit of response.hits?.hits ?? []) {
      const id = Number(hit._id);
      if (Number.isFinite(id)) ids.push(id);
    }
    return ids;
  } catch (error) {
    console.error("Related test case lookup failed:", error);
    return null;
  }
}

/**
 * Database stand-in for installs without Elasticsearch: the newest cases on
 * the same template anywhere in the project. Not related by topic, but still
 * a faithful sample of how the team writes cases.
 */
export async function findRecentTemplateCaseIds(
  db: DbClient,
  query: Pick<
    RelatedCasesQuery,
    "projectId" | "templateId" | "excludeCaseIds" | "limit"
  >
): Promise<number[]> {
  const exclude = query.excludeCaseIds ? [...query.excludeCaseIds] : [];
  const rows: Array<{ id: number }> = await db.repositoryCases.findMany({
    where: {
      projectId: query.projectId,
      isDeleted: false,
      isArchived: false,
      ...(query.templateId != null ? { templateId: query.templateId } : {}),
      ...(exclude.length > 0 ? { id: { notIn: exclude } } : {}),
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
    take: query.limit ?? 10,
  });
  return rows.map((r) => r.id);
}
