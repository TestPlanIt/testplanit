import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "~/server/auth";
import { getElasticsearchClient } from "~/services/elasticsearchService";
import { getIndicesForEntityTypes } from "~/services/unifiedElasticsearchService";
import {
  SearchOptions,
  UnifiedSearchResult,
  SearchableEntityType,
  CustomFieldFilter,
  SearchHit,
} from "~/types/search";

/**
 * POST /api/search
 * Unified search endpoint for all entity types
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchOptions: SearchOptions = await request.json();
    const {
      filters,
      sort,
      pagination,
      highlight = true,
      facets,
    } = searchOptions;

    const client = getElasticsearchClient();
    if (!client) {
      return NextResponse.json(
        { error: "Search service unavailable" },
        { status: 503 }
      );
    }

    // Get indices to search based on entity types
    const indices = getIndicesForEntityTypes(filters.entityTypes);

    // Build the Elasticsearch query
    const esQuery = await buildElasticsearchQuery(filters, session.user);


    // Build aggregations for facets
    const aggs = facets
      ? buildSearchAggregations(facets, filters.entityTypes)
      : undefined;

    // Execute search
    let searchResponse;
    const existingIndices: string[] = [];

    try {
      // Check which indices actually exist
      for (const index of indices) {
        try {
          const exists = await client.indices.exists({ index });
          if (exists) {
            existingIndices.push(index);
          }
        } catch (e) {
          console.error(`Index ${index} does not exist`);
        }
      }

      // console.log("Existing indices:", existingIndices);

      // If no indices exist, return empty result
      if (existingIndices.length === 0) {
        return NextResponse.json({
          total: 0,
          hits: [],
          facets: {},
          took: 0,
          entityTypeCounts: {},
        });
      }

      searchResponse = await client.search({
        index: existingIndices,
        query: esQuery,
        ...(aggs && { aggs }),
        ...(sort && { sort: buildSort(sort) }),
        ...(pagination && {
          from: (pagination.page - 1) * pagination.size,
          size: pagination.size,
        }),
        ...(highlight && {
          highlight: {
            fields: {
              name: { number_of_fragments: 1 },
              searchableContent: { number_of_fragments: 3 },
              "steps.step": { number_of_fragments: 2 },
              "steps.expectedResult": { number_of_fragments: 2 },
              "items.step": { number_of_fragments: 2 },
              "items.expectedResult": { number_of_fragments: 2 },
              note: { number_of_fragments: 2 },
              mission: { number_of_fragments: 2 },
              docs: { number_of_fragments: 2 },
            },
            pre_tags: ['<mark class="search-highlight">'],
            post_tags: ["</mark>"],
          },
        }),
      });
    } catch (searchError: any) {
      console.error("Elasticsearch search error:", searchError);
      console.error("Error details:", searchError.meta?.body?.error);

      // Return empty result instead of throwing
      return NextResponse.json({
        total: 0,
        hits: [],
        facets: {},
        took: 0,
        entityTypeCounts: {},
        error: "Search failed",
      });
    }

    // Process results
    const hits: SearchHit[] = searchResponse.hits.hits.map((hit: any) => ({
      id: hit._source.id,
      entityType: getEntityTypeFromIndex(hit._index),
      score: hit._score,
      source: hit._source,
      highlights: hit.highlight,
    }));

    // Get entity type counts
    const entityTypeCounts =
      existingIndices.length > 1
        ? await getEntityTypeCounts(client, existingIndices, esQuery)
        : undefined;

    // Process facets
    const processedFacets = processFacets(searchResponse.aggregations, facets);

    const result: UnifiedSearchResult = {
      total:
        typeof searchResponse.hits.total === "object"
          ? searchResponse.hits.total.value
          : searchResponse.hits.total || 0,
      hits,
      facets: processedFacets,
      took: searchResponse.took,
      entityTypeCounts,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}

/**
 * Build Elasticsearch query from unified filters
 */
async function buildElasticsearchQuery(filters: any, user: any): Promise<any> {
  const must: any[] = [];
  const filter: any[] = [];

  // Add query string search
  if (filters.query) {
    must.push({
      multi_match: {
        query: filters.query,
        fields: [
          "name^3",
          "title^2",
          "description",
          "searchableContent",
          "className",
          "steps.step",
          "steps.expectedResult",
          "items.step",
          "items.expectedResult",
          "note",
          "mission",
          "docs",
          "customFields.value",
          "externalId",
        ],
        type: "best_fields",
        operator: "or",
        fuzziness: "AUTO",
      },
    });
  }

  // Add entity type filters
  if (filters.entityTypes && filters.entityTypes.length > 0) {
    // Entity type filtering is handled by index selection
  }

  // Add entity-specific filters
  if (filters.repositoryCase) {
    addRepositoryCaseFilters(filter, filters.repositoryCase);
  }
  if (filters.testRun) {
    addTestRunFilters(filter, filters.testRun);
  }
  if (filters.session) {
    addSessionFilters(filter, filters.session);
  }
  if (filters.sharedStep) {
    addSharedStepFilters(filter, filters.sharedStep);
  }
  if (filters.project) {
    addProjectFilters(filter, filters.project);
  }
  if (filters.issue) {
    addIssueFilters(filter, filters.issue);
  }
  if (filters.milestone) {
    addMilestoneFilters(filter, filters.milestone);
  }

  // Add user access control
  if (user.access !== "ADMIN") {
    // Get user's assigned project IDs
    const { db } = await import("~/server/db");
    const userProjectAssignments = await db.projectAssignment.findMany({
      where: { userId: user.id },
      select: { projectId: true },
    });
    const userProjectIds = userProjectAssignments.map((pa) => pa.projectId);

    // If user has no project assignments, they should see no results
    if (userProjectIds.length === 0) {
      filter.push({ terms: { projectId: [-1] } }); // Non-existent project ID
    } else {
      // Restrict search to only user's assigned projects
      filter.push({ terms: { projectId: userProjectIds } });
    }
  }

  // Filter deleted items unless admin has explicitly requested them
  if (!filters.includeDeleted || user.access !== "ADMIN") {
    filter.push({ term: { isDeleted: false } });
  }

  // Filter out entities without a valid projectId (orphaned entities)
  // This is a safety check in case any get indexed
  filter.push({ exists: { field: "projectId" } });

  return {
    bool: {
      must,
      filter,
    },
  };
}

/**
 * Add repository case specific filters
 */
function addRepositoryCaseFilters(filter: any[], rcFilters: any) {
  if (rcFilters.projectIds && rcFilters.projectIds.length > 0) {
    filter.push({ terms: { projectId: rcFilters.projectIds } });
  }
  if (rcFilters.repositoryIds && rcFilters.repositoryIds.length > 0) {
    filter.push({ terms: { repositoryId: rcFilters.repositoryIds } });
  }
  if (rcFilters.folderIds && rcFilters.folderIds.length > 0) {
    filter.push({ terms: { folderId: rcFilters.folderIds } });
  }
  if (rcFilters.templateIds && rcFilters.templateIds.length > 0) {
    filter.push({ terms: { templateId: rcFilters.templateIds } });
  }
  if (rcFilters.stateIds && rcFilters.stateIds.length > 0) {
    filter.push({ terms: { stateId: rcFilters.stateIds } });
  }
  if (rcFilters.creatorIds && rcFilters.creatorIds.length > 0) {
    filter.push({ terms: { createdById: rcFilters.creatorIds } });
  }
  if (typeof rcFilters.automated === "boolean") {
    filter.push({ term: { automated: rcFilters.automated } });
  }
  if (typeof rcFilters.isArchived === "boolean") {
    filter.push({ term: { isArchived: rcFilters.isArchived } });
  }
  if (rcFilters.tagIds && rcFilters.tagIds.length > 0) {
    filter.push({
      nested: {
        path: "tags",
        query: {
          terms: { "tags.id": rcFilters.tagIds },
        },
      },
    });
  }
  if (rcFilters.customFields) {
    addCustomFieldFilters(filter, rcFilters.customFields);
  }
  if (rcFilters.dateRange) {
    addDateRangeFilter(filter, rcFilters.dateRange);
  }
}

/**
 * Add custom field filters
 */
function addCustomFieldFilters(
  filter: any[],
  customFields: CustomFieldFilter[]
) {
  customFields.forEach((cf) => {
    const fieldQuery = buildCustomFieldQuery(cf);
    if (fieldQuery) {
      filter.push({
        nested: {
          path: "customFields",
          query: {
            bool: {
              must: [
                { term: { "customFields.fieldId": cf.fieldId } },
                fieldQuery,
              ],
            },
          },
        },
      });
    }
  });
}

/**
 * Build query for a single custom field filter
 */
function buildCustomFieldQuery(cf: CustomFieldFilter): any {
  switch (cf.fieldType) {
    case "Checkbox":
      return { term: { "customFields.valueBoolean": cf.value } };

    case "Date":
      switch (cf.operator) {
        case "equals":
          return { term: { "customFields.valueDate": cf.value } };
        case "gt":
          return { range: { "customFields.valueDate": { gt: cf.value } } };
        case "lt":
          return { range: { "customFields.valueDate": { lt: cf.value } } };
        case "between":
          return {
            range: {
              "customFields.valueDate": {
                gte: cf.value,
                lte: cf.value2,
              },
            },
          };
        default:
          return null;
      }

    case "Number":
      switch (cf.operator) {
        case "equals":
          return { term: { "customFields.valueNumeric": cf.value } };
        case "gt":
          return { range: { "customFields.valueNumeric": { gt: cf.value } } };
        case "lt":
          return { range: { "customFields.valueNumeric": { lt: cf.value } } };
        case "gte":
          return { range: { "customFields.valueNumeric": { gte: cf.value } } };
        case "lte":
          return { range: { "customFields.valueNumeric": { lte: cf.value } } };
        case "between":
          return {
            range: {
              "customFields.valueNumeric": {
                gte: cf.value,
                lte: cf.value2,
              },
            },
          };
        default:
          return null;
      }

    case "Multi-Select":
      if (cf.operator === "in" && Array.isArray(cf.value)) {
        return { terms: { "customFields.valueArray": cf.value } };
      }
      return null;

    case "Select":
      return { term: { "customFields.valueKeyword": cf.value } };

    case "Text String":
    case "Link":
      if (cf.operator === "contains") {
        return { match: { "customFields.value": cf.value } };
      } else {
        return { term: { "customFields.valueKeyword": cf.value } };
      }

    case "Text Long":
    case "Steps":
      return { match: { "customFields.value": cf.value } };

    default:
      return { match: { "customFields.value": cf.value } };
  }
}

/**
 * Add date range filter
 */
function addDateRangeFilter(filter: any[], dateRange: any) {
  const rangeQuery: any = {};
  if (dateRange.from) {
    rangeQuery.gte = dateRange.from;
  }
  if (dateRange.to) {
    rangeQuery.lte = dateRange.to;
  }

  if (Object.keys(rangeQuery).length > 0) {
    filter.push({
      range: {
        [dateRange.field]: rangeQuery,
      },
    });
  }
}

/**
 * Add test run filters
 */
function addTestRunFilters(filter: any[], trFilters: any) {
  if (trFilters.projectIds && trFilters.projectIds.length > 0) {
    filter.push({ terms: { projectId: trFilters.projectIds } });
  }
  if (trFilters.stateIds && trFilters.stateIds.length > 0) {
    filter.push({ terms: { stateId: trFilters.stateIds } });
  }
  if (trFilters.configurationIds && trFilters.configurationIds.length > 0) {
    filter.push({ terms: { configId: trFilters.configurationIds } });
  }
  if (trFilters.milestoneIds && trFilters.milestoneIds.length > 0) {
    filter.push({ terms: { milestoneId: trFilters.milestoneIds } });
  }
  if (typeof trFilters.isCompleted === "boolean") {
    filter.push({ term: { isCompleted: trFilters.isCompleted } });
  }
  if (trFilters.testRunType) {
    filter.push({ term: { testRunType: trFilters.testRunType } });
  }
  if (trFilters.customFields) {
    addCustomFieldFilters(filter, trFilters.customFields);
  }
  if (trFilters.dateRange) {
    addDateRangeFilter(filter, trFilters.dateRange);
  }
}

/**
 * Add session filters
 */
function addSessionFilters(filter: any[], sFilters: any) {
  if (sFilters.projectIds && sFilters.projectIds.length > 0) {
    filter.push({ terms: { projectId: sFilters.projectIds } });
  }
  if (sFilters.templateIds && sFilters.templateIds.length > 0) {
    filter.push({ terms: { templateId: sFilters.templateIds } });
  }
  if (sFilters.stateIds && sFilters.stateIds.length > 0) {
    filter.push({ terms: { stateId: sFilters.stateIds } });
  }
  if (sFilters.assignedToIds && sFilters.assignedToIds.length > 0) {
    filter.push({ terms: { assignedToId: sFilters.assignedToIds } });
  }
  if (sFilters.configurationIds && sFilters.configurationIds.length > 0) {
    filter.push({ terms: { configId: sFilters.configurationIds } });
  }
  if (sFilters.milestoneIds && sFilters.milestoneIds.length > 0) {
    filter.push({ terms: { milestoneId: sFilters.milestoneIds } });
  }
  if (typeof sFilters.isCompleted === "boolean") {
    filter.push({ term: { isCompleted: sFilters.isCompleted } });
  }
  if (sFilters.customFields) {
    addCustomFieldFilters(filter, sFilters.customFields);
  }
  if (sFilters.dateRange) {
    addDateRangeFilter(filter, sFilters.dateRange);
  }
}

/**
 * Add shared step filters
 */
function addSharedStepFilters(filter: any[], ssFilters: any) {
  if (ssFilters.projectIds && ssFilters.projectIds.length > 0) {
    filter.push({ terms: { projectId: ssFilters.projectIds } });
  }
  if (ssFilters.creatorIds) {
    filter.push({ terms: { createdById: ssFilters.creatorIds } });
  }
}

/**
 * Add project filters
 */
function addProjectFilters(filter: any[], pFilters: any) {
  if (pFilters.creatorIds && pFilters.creatorIds.length > 0) {
    filter.push({ terms: { createdById: pFilters.creatorIds } });
  }
  if (typeof pFilters.isDeleted === "boolean") {
    filter.push({ term: { isDeleted: pFilters.isDeleted } });
  }
  if (pFilters.dateRange) {
    addDateRangeFilter(filter, pFilters.dateRange);
  }
}

/**
 * Add issue filters
 */
function addIssueFilters(filter: any[], iFilters: any) {
  if (iFilters.projectIds && iFilters.projectIds.length > 0) {
    filter.push({ terms: { projectId: iFilters.projectIds } });
  }
  if (iFilters.externalIds && iFilters.externalIds.length > 0) {
    filter.push({ terms: { externalId: iFilters.externalIds } });
  }
  if (iFilters.creatorIds) {
    filter.push({ terms: { createdById: iFilters.creatorIds } });
  }
}

/**
 * Add milestone filters
 */
function addMilestoneFilters(filter: any[], mFilters: any) {
  if (mFilters.projectIds && mFilters.projectIds.length > 0) {
    filter.push({ terms: { projectId: mFilters.projectIds } });
  }
  if (mFilters.milestoneTypeIds && mFilters.milestoneTypeIds.length > 0) {
    filter.push({ terms: { milestoneTypeId: mFilters.milestoneTypeIds } });
  }
  if (mFilters.parentIds && mFilters.parentIds.length > 0) {
    filter.push({ terms: { parentId: mFilters.parentIds } });
  }
  if (typeof mFilters.isCompleted === "boolean") {
    filter.push({ term: { isCompleted: mFilters.isCompleted } });
  }
}

/**
 * Build sort configuration
 */
function buildSort(sort: any[]) {
  return sort.map((s) => ({
    [s.field]: { order: s.order },
  }));
}

/**
 * Build aggregations for facets
 */
function buildSearchAggregations(
  facets: string[],
  entityTypes?: SearchableEntityType[]
) {
  const aggs: any = {};

  // Standard facets available for all entities
  const standardFacets = ["projectId", "createdById", "stateId"];

  // Entity-specific facets
  const entityFacets: Record<string, string[]> = {
    [SearchableEntityType.REPOSITORY_CASE]: ["templateId", "automated", "tags"],
    [SearchableEntityType.TEST_RUN]: ["testRunType", "isCompleted", "configId"],
    [SearchableEntityType.SESSION]: [
      "templateId",
      "assignedToId",
      "isCompleted",
    ],
    // Add more as needed
  };

  facets.forEach((facet) => {
    if (facet === "tags") {
      aggs.tags = {
        nested: { path: "tags" },
        aggs: {
          tag_ids: {
            terms: {
              field: "tags.id",
              size: 50,
            },
          },
        },
      };
    } else {
      aggs[facet] = {
        terms: {
          field: facet,
          size: 50,
        },
      };
    }
  });

  return aggs;
}

/**
 * Process aggregation results into facets
 */
function processFacets(aggregations: any, requestedFacets?: string[]): any {
  if (!aggregations || !requestedFacets) return undefined;

  const facets: any = {};

  requestedFacets.forEach((facet) => {
    if (facet === "tags" && aggregations.tags) {
      facets.tags = {
        field: "tags",
        buckets: aggregations.tags.tag_ids.buckets.map((b: any) => ({
          key: b.key,
          count: b.doc_count,
        })),
      };
    } else if (aggregations[facet]) {
      facets[facet] = {
        field: facet,
        buckets: aggregations[facet].buckets.map((b: any) => ({
          key: b.key,
          count: b.doc_count,
        })),
      };
    }
  });

  return facets;
}

/**
 * Get entity type from index name
 */
function getEntityTypeFromIndex(indexName: string): SearchableEntityType {
  const indexToType: Record<string, SearchableEntityType> = {
    "testplanit-repository-cases": SearchableEntityType.REPOSITORY_CASE,
    "testplanit-shared-steps": SearchableEntityType.SHARED_STEP,
    "testplanit-test-runs": SearchableEntityType.TEST_RUN,
    "testplanit-sessions": SearchableEntityType.SESSION,
    "testplanit-projects": SearchableEntityType.PROJECT,
    "testplanit-issues": SearchableEntityType.ISSUE,
    "testplanit-milestones": SearchableEntityType.MILESTONE,
  };

  return indexToType[indexName] || SearchableEntityType.REPOSITORY_CASE;
}

/**
 * Get counts for each entity type
 */
async function getEntityTypeCounts(
  client: any,
  indices: string[],
  query: any
): Promise<Record<SearchableEntityType, number>> {
  const counts: any = {};

  // Run a search for each index to get counts
  const countPromises = indices.map(async (index) => {
    try {
      const result = await client.count({
        index,
        query,
      });
      const entityType = getEntityTypeFromIndex(index);
      counts[entityType] = result.count;
    } catch (error) {
      console.error(`Error counting ${index}:`, error);
    }
  });

  await Promise.all(countPromises);
  return counts;
}
