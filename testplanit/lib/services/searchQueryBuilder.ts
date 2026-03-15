import {
  CustomFieldFilter, SearchableEntityType
} from "~/types/search";

/**
 * Build Elasticsearch query from unified filters
 */
export async function buildElasticsearchQuery(filters: any, user: any): Promise<any> {
  const must: any[] = [];
  const filter: any[] = [];

  // Add query string search with support for operators
  if (filters.query) {
    // Determine which entity types are being searched
    const entityTypes = filters.entityTypes || [];
    const hasRepositoryCases = entityTypes.length === 0 || entityTypes.includes(SearchableEntityType.REPOSITORY_CASE);
    const hasSharedSteps = entityTypes.length === 0 || entityTypes.includes(SearchableEntityType.SHARED_STEP);
    const hasTestRuns = entityTypes.length === 0 || entityTypes.includes(SearchableEntityType.TEST_RUN);
    const hasSessions = entityTypes.length === 0 || entityTypes.includes(SearchableEntityType.SESSION);

    // Use bool query with should clauses to search both regular and nested fields
    const searchQueries: any[] = [];

    // Search regular (non-nested) fields
    searchQueries.push({
      query_string: {
        query: filters.query,
        fields: [
          "name^3",
          "title^2",
          "description",
          "searchableContent",
          "className",
          "note",
          "mission",
          "docs",
          "externalId",
        ],
        default_operator: "or",
        fuzzy_transpositions: true,
        fuzzy_max_expansions: 50,
        lenient: true,
        analyze_wildcard: true,
      },
    });

    // Search nested steps fields (for repository cases)
    if (hasRepositoryCases) {
      searchQueries.push({
        nested: {
          path: "steps",
          ignore_unmapped: true,
          query: {
            query_string: {
              query: filters.query,
              fields: ["steps.step", "steps.expectedResult"],
              default_operator: "or",
              lenient: true,
              analyze_wildcard: true,
            },
          },
          inner_hits: {
            size: 100,
            highlight: {
              type: "plain",
              fields: {
                "steps.step": {
                  number_of_fragments: 0,
                  fragment_size: 0,
                },
                "steps.expectedResult": {
                  number_of_fragments: 0,
                  fragment_size: 0,
                },
              },
              pre_tags: ['<mark class="search-highlight">'],
              post_tags: ["</mark>"],
              require_field_match: false,
              highlight_query: {
                query_string: {
                  query: filters.query,
                  fields: ["steps.step", "steps.expectedResult"],
                  default_operator: "or",
                  lenient: true,
                  analyze_wildcard: true,
                },
              },
            },
          },
        },
      });
    }

    // Search nested items fields (for shared steps only)
    if (hasSharedSteps) {
      searchQueries.push({
        nested: {
          path: "items",
          ignore_unmapped: true,
          query: {
            query_string: {
              query: filters.query,
              fields: ["items.step", "items.expectedResult"],
              default_operator: "or",
              lenient: true,
              analyze_wildcard: true,
            },
          },
          inner_hits: {
            size: 100,
            highlight: {
              type: "plain",
              fields: {
                "items.step": {
                  number_of_fragments: 0,
                  fragment_size: 0,
                },
                "items.expectedResult": {
                  number_of_fragments: 0,
                  fragment_size: 0,
                },
              },
              pre_tags: ['<mark class="search-highlight">'],
              post_tags: ["</mark>"],
              require_field_match: false,
              highlight_query: {
                query_string: {
                  query: filters.query,
                  fields: ["items.step", "items.expectedResult"],
                  default_operator: "or",
                  lenient: true,
                  analyze_wildcard: true,
                },
              },
            },
          },
        },
      });
    }

    // Search nested custom fields (for repository cases, test runs, sessions)
    if (hasRepositoryCases || hasTestRuns || hasSessions) {
      searchQueries.push({
        nested: {
          path: "customFields",
          ignore_unmapped: true,
          query: {
            query_string: {
              query: filters.query,
              fields: ["customFields.value"],
              default_operator: "or",
              lenient: true,
              analyze_wildcard: true,
            },
          },
        },
      });
    }

    // Combine all queries with should (OR)
    must.push({
      bool: {
        should: searchQueries,
        minimum_should_match: 1,
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
export function addRepositoryCaseFilters(filter: any[], rcFilters: any) {
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
        ignore_unmapped: true,
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
export function addCustomFieldFilters(
  filter: any[],
  customFields: CustomFieldFilter[]
) {
  customFields.forEach((cf) => {
    const fieldQuery = buildCustomFieldQuery(cf);
    if (fieldQuery) {
      filter.push({
        nested: {
          path: "customFields",
          ignore_unmapped: true,
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
export function buildCustomFieldQuery(cf: CustomFieldFilter): any {
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
export function addDateRangeFilter(filter: any[], dateRange: any) {
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
export function addTestRunFilters(filter: any[], trFilters: any) {
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
export function addSessionFilters(filter: any[], sFilters: any) {
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
export function addSharedStepFilters(filter: any[], ssFilters: any) {
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
export function addProjectFilters(filter: any[], pFilters: any) {
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
export function addIssueFilters(filter: any[], iFilters: any) {
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
export function addMilestoneFilters(filter: any[], mFilters: any) {
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
export function buildSort(sort: any[]) {
  return sort.map((s) => ({
    [s.field]: { order: s.order },
  }));
}

/**
 * Build aggregations for facets
 */
export function buildSearchAggregations(
  facets: string[],
  entityTypes?: SearchableEntityType[]
) {
  const aggs: any = {};

  const hasTagsMapping =
    !entityTypes ||
    entityTypes.length === 0 ||
    entityTypes.includes(SearchableEntityType.REPOSITORY_CASE) ||
    entityTypes.includes(SearchableEntityType.TEST_RUN) ||
    entityTypes.includes(SearchableEntityType.SESSION);

  facets.forEach((facet) => {
    if (facet === "tags") {
      // Tags nested aggregation only works on indices with a "tags" nested mapping
      if (hasTagsMapping) {
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
      }
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
export function processFacets(aggregations: any, requestedFacets?: string[]): any {
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
 * Get entity type from index name.
 * Handles both single-tenant (testplanit-{entity}) and multi-tenant (testplanit-{tenantId}-{entity}) index names.
 */
export function getEntityTypeFromIndex(indexName: string): SearchableEntityType {
  const suffixToType: Record<string, SearchableEntityType> = {
    "repository-cases": SearchableEntityType.REPOSITORY_CASE,
    "shared-steps": SearchableEntityType.SHARED_STEP,
    "test-runs": SearchableEntityType.TEST_RUN,
    "sessions": SearchableEntityType.SESSION,
    "projects": SearchableEntityType.PROJECT,
    "issues": SearchableEntityType.ISSUE,
    "milestones": SearchableEntityType.MILESTONE,
  };

  for (const [suffix, type] of Object.entries(suffixToType)) {
    if (indexName.endsWith(suffix)) {
      return type;
    }
  }

  return SearchableEntityType.REPOSITORY_CASE;
}

/**
 * Strip nested clauses from a query so it can be used for per-index counts.
 * Nested queries (steps, items, customFields) are entity-specific and fail
 * when run against indices that don't have those nested mappings.
 */
export function stripNestedClauses(query: any): any {
  if (!query?.bool) return query;

  const stripped = { ...query, bool: { ...query.bool } };

  // Strip nested clauses from must → bool → should
  if (stripped.bool.must) {
    stripped.bool.must = stripped.bool.must.map((clause: any) => {
      if (clause.bool?.should) {
        const filteredShould = clause.bool.should.filter(
          (s: any) => !s.nested
        );
        if (filteredShould.length === 0) return null;
        return {
          bool: {
            ...clause.bool,
            should: filteredShould,
          },
        };
      }
      return clause;
    }).filter(Boolean);
  }

  // Strip nested clauses from filter
  if (stripped.bool.filter) {
    stripped.bool.filter = stripped.bool.filter.filter(
      (f: any) => !f.nested
    );
  }

  return stripped;
}

/**
 * Get counts for each entity type
 */
export async function getEntityTypeCounts(
  client: any,
  indices: string[],
  query: any
): Promise<Record<SearchableEntityType, number>> {
  const counts: any = {};
  const countQuery = stripNestedClauses(query);

  // Run a search for each index to get counts
  const countPromises = indices.map(async (index) => {
    try {
      const result = await client.count({
        index,
        query: countQuery,
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
