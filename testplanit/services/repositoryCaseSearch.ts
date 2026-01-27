import {
  getElasticsearchClient,
  getRepositoryCaseIndexName,
} from "./elasticsearchService";

export interface SearchFilters {
  projectIds?: number[];
  repositoryIds?: number[];
  folderIds?: number[];
  templateIds?: number[];
  stateIds?: number[];
  tagIds?: number[];
  creatorIds?: string[];
  automated?: boolean;
  isArchived?: boolean;
  dateRange?: {
    field: "createdAt";
    from?: Date;
    to?: Date;
  };
  customFields?: Array<{
    fieldId: number;
    value: any;
  }>;
}

export interface SearchOptions {
  query?: string;
  filters?: SearchFilters;
  sort?: {
    field: string;
    order: "asc" | "desc";
  }[];
  pagination?: {
    page: number;
    size: number;
  };
  highlight?: boolean;
  facets?: string[];
}

export interface SearchFacet {
  field: string;
  buckets: Array<{
    key: any;
    count: number;
  }>;
}

export interface SearchResult {
  total: number;
  hits: Array<{
    id: number;
    score: number;
    source: any;
    highlights?: Record<string, string[]>;
  }>;
  facets?: Record<string, SearchFacet>;
  took: number;
}

/**
 * Build Elasticsearch query from search options
 */
function buildQuery(options: SearchOptions): any {
  const must: any[] = [];
  const filter: any[] = [];

  // Full-text search query
  if (options.query && options.query.trim()) {
    must.push({
      multi_match: {
        query: options.query,
        fields: [
          "name^3", // Boost name field
          "searchableContent^2",
          "className",
          "folderPath",
          "templateName",
          "stateName",
          "creatorName",
          "tags.name^2",
          "customFields.value",
          "steps.step",
          "steps.expectedResult",
        ],
        type: "best_fields",
        operator: "or",
        fuzziness: "AUTO",
      },
    });
  }

  // Apply filters
  if (options.filters) {
    const { filters } = options;

    if (filters.projectIds?.length) {
      filter.push({ terms: { projectId: filters.projectIds } });
    }

    if (filters.repositoryIds?.length) {
      filter.push({ terms: { repositoryId: filters.repositoryIds } });
    }

    if (filters.folderIds?.length) {
      filter.push({ terms: { folderId: filters.folderIds } });
    }

    if (filters.templateIds?.length) {
      filter.push({ terms: { templateId: filters.templateIds } });
    }

    if (filters.stateIds?.length) {
      filter.push({ terms: { stateId: filters.stateIds } });
    }

    if (filters.creatorIds?.length) {
      filter.push({ terms: { creatorId: filters.creatorIds } });
    }

    if (filters.automated !== undefined) {
      filter.push({ term: { automated: filters.automated } });
    }

    if (filters.isArchived !== undefined) {
      filter.push({ term: { isArchived: filters.isArchived } });
    }

    // Tag filtering (nested query)
    if (filters.tagIds?.length) {
      filter.push({
        nested: {
          path: "tags",
          query: {
            terms: { "tags.id": filters.tagIds },
          },
        },
      });
    }

    // Date range filtering
    if (filters.dateRange) {
      const range: any = {};
      if (filters.dateRange.from) {
        range.gte = filters.dateRange.from.toISOString();
      }
      if (filters.dateRange.to) {
        range.lte = filters.dateRange.to.toISOString();
      }
      filter.push({
        range: { [filters.dateRange.field]: range },
      });
    }

    // Custom field filtering (nested query)
    if (filters.customFields?.length) {
      filters.customFields.forEach((cf) => {
        filter.push({
          nested: {
            path: "customFields",
            query: {
              bool: {
                must: [
                  { term: { "customFields.fieldId": cf.fieldId } },
                  { match: { "customFields.value": cf.value } },
                ],
              },
            },
          },
        });
      });
    }
  }

  // Always exclude soft-deleted cases from search results
  // (unless explicitly requested via filters)
  filter.push({ term: { isDeleted: false } });

  // Build final query
  const query = {
    bool: {
      must: must.length > 0 ? must : [{ match_all: {} }],
      filter,
    },
  };

  return query;
}

/**
 * Build aggregations for faceted search
 */
function buildAggregations(facets?: string[]) {
  if (!facets || facets.length === 0) return undefined;

  const aggs: Record<string, any> = {};

  facets.forEach((facet) => {
    switch (facet) {
      case "projects":
        aggs.projects = {
          terms: { field: "projectName.keyword", size: 50 },
        };
        break;
      case "templates":
        aggs.templates = {
          terms: { field: "templateName.keyword", size: 20 },
        };
        break;
      case "states":
        aggs.states = {
          terms: { field: "stateName.keyword", size: 20 },
        };
        break;
      case "creators":
        aggs.creators = {
          terms: { field: "creatorName.keyword", size: 50 },
        };
        break;
      case "tags":
        aggs.tags = {
          nested: { path: "tags" },
          aggs: {
            tag_names: {
              terms: { field: "tags.name", size: 100 },
            },
          },
        };
        break;
      case "automation":
        aggs.automation = {
          terms: { field: "automated", size: 2 },
        };
        break;
      case "folders":
        aggs.folders = {
          terms: { field: "folderPath.keyword", size: 100 },
        };
        break;
    }
  });

  return aggs;
}

/**
 * Search repository cases with full-text search, filtering, and facets
 * @param options - Search options including query, filters, pagination, etc.
 * @param tenantId - Optional tenant ID for multi-tenant mode
 */
export async function searchRepositoryCases(
  options: SearchOptions,
  tenantId?: string
): Promise<SearchResult | null> {
  const client = getElasticsearchClient();
  if (!client) return null;

  const indexName = getRepositoryCaseIndexName(tenantId);

  try {
    const query = buildQuery(options);
    const aggs = buildAggregations(options.facets);

    // Default pagination
    const page = options.pagination?.page || 1;
    const size = options.pagination?.size || 20;
    const from = (page - 1) * size;

    // Build sort
    const sort: any[] = [];
    if (options.sort?.length) {
      options.sort.forEach((s) => {
        sort.push({ [s.field]: { order: s.order } });
      });
    } else {
      // Default sort by relevance score, then by creation date
      sort.push("_score");
      sort.push({ createdAt: { order: "desc" } });
    }

    // Build highlight configuration
    const highlight = options.highlight
      ? {
          fields: {
            name: { number_of_fragments: 1 },
            searchableContent: { number_of_fragments: 3 },
            "steps.step": { number_of_fragments: 2 },
            "steps.expectedResult": { number_of_fragments: 2 },
            className: { number_of_fragments: 1 },
          },
          pre_tags: ["<mark>"],
          post_tags: ["</mark>"],
          fragment_size: 150,
        }
      : undefined;

    // Execute search
    const response = await client.search({
      index: indexName,
      query,
      aggs,
      sort,
      from,
      size,
      highlight,
      track_total_hits: true,
    });

    // Parse results
    const hits = response.hits.hits.map((hit) => ({
      id: parseInt(hit._id!),
      score: hit._score || 0,
      source: hit._source,
      highlights: hit.highlight,
    }));

    // Parse facets
    const facets: Record<string, SearchFacet> = {};
    if (response.aggregations) {
      Object.keys(response.aggregations).forEach((key) => {
        const agg = response.aggregations![key] as any;

        if (key === "tags" && agg.tag_names) {
          // Handle nested aggregation for tags
          facets[key] = {
            field: key,
            buckets: agg.tag_names.buckets.map((b: any) => ({
              key: b.key,
              count: b.doc_count,
            })),
          };
        } else if (agg.buckets) {
          // Handle regular aggregations
          facets[key] = {
            field: key,
            buckets: agg.buckets.map((b: any) => ({
              key: b.key,
              count: b.doc_count,
            })),
          };
        }
      });
    }

    return {
      total: (response.hits.total as any).value || 0,
      hits,
      facets: Object.keys(facets).length > 0 ? facets : undefined,
      took: response.took,
    };
  } catch (error) {
    console.error("Error searching repository cases:", error);
    return null;
  }
}

/**
 * Get search suggestions for autocomplete
 * @param prefix - The search prefix for autocomplete
 * @param field - The field to search (name or tags)
 * @param size - Number of suggestions to return
 * @param tenantId - Optional tenant ID for multi-tenant mode
 */
export async function getSearchSuggestions(
  prefix: string,
  field: "name" | "tags" = "name",
  size: number = 10,
  tenantId?: string
): Promise<string[]> {
  const client = getElasticsearchClient();
  if (!client || !prefix.trim()) return [];

  const indexName = getRepositoryCaseIndexName(tenantId);

  try {
    const response = await client.search({
      index: indexName,
      suggest: {
        suggestions: {
          prefix,
          completion: {
            field: field === "name" ? "name.suggest" : "tags.name",
            size,
            skip_duplicates: true,
          },
        },
      },
      _source: false,
    });

    const suggestions: string[] = [];
    if (response.suggest?.suggestions) {
      const suggestionResults = response.suggest.suggestions as any;
      suggestionResults.forEach((suggestion: any) => {
        suggestion.options?.forEach((option: any) => {
          suggestions.push(option.text);
        });
      });
    }

    return suggestions;
  } catch (error) {
    console.error("Error getting search suggestions:", error);
    return [];
  }
}

/**
 * Get a single repository case by ID from Elasticsearch
 * @param id - The repository case ID
 * @param tenantId - Optional tenant ID for multi-tenant mode
 */
export async function getRepositoryCaseById(
  id: number,
  tenantId?: string
): Promise<any | null> {
  const client = getElasticsearchClient();
  if (!client) return null;

  const indexName = getRepositoryCaseIndexName(tenantId);

  try {
    const response = await client.get({
      index: indexName,
      id: id.toString(),
    });

    return response._source;
  } catch (error) {
    if ((error as any).statusCode === 404) {
      return null;
    }
    console.error(`Error getting repository case ${id}:`, error);
    return null;
  }
}

/**
 * Count repository cases matching the search criteria
 * @param options - Search options
 * @param tenantId - Optional tenant ID for multi-tenant mode
 */
export async function countRepositoryCases(
  options: Omit<SearchOptions, "pagination" | "sort" | "highlight" | "facets">,
  tenantId?: string
): Promise<number> {
  const client = getElasticsearchClient();
  if (!client) return 0;

  const indexName = getRepositoryCaseIndexName(tenantId);

  try {
    const query = buildQuery(options);

    const response = await client.count({
      index: indexName,
      query,
    });

    return response.count;
  } catch (error) {
    console.error("Error counting repository cases:", error);
    return 0;
  }
}
