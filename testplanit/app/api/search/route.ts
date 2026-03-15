import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantId } from "~/lib/multiTenantPrisma";
import {
  buildElasticsearchQuery,
  buildSearchAggregations,
  buildSort, getEntityTypeCounts, getEntityTypeFromIndex, processFacets
} from "~/lib/services/searchQueryBuilder";
import { authOptions } from "~/server/auth";
import { getElasticsearchClient } from "~/services/elasticsearchService";
import { getIndicesForEntityTypes } from "~/services/unifiedElasticsearchService";
import {
  SearchHit, SearchOptions,
  UnifiedSearchResult
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

    // Get indices to search based on entity types (tenant-aware for multi-tenant deployments)
    const tenantId = getCurrentTenantId();
    const indices = getIndicesForEntityTypes(filters.entityTypes, tenantId);

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
            type: "plain",
            fields: {
              name: { number_of_fragments: 1 },
              searchableContent: { number_of_fragments: 3 },
              note: { number_of_fragments: 2 },
              mission: { number_of_fragments: 2 },
              docs: { number_of_fragments: 2 },
            },
            pre_tags: ['<mark class="search-highlight">'],
            post_tags: ["</mark>"],
            require_field_match: false,
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
    const hits: SearchHit[] = searchResponse.hits.hits.map((hit: any) => {
      const highlights: any = { ...hit.highlight };

      // Merge nested field highlights from inner_hits
      if (hit.inner_hits) {
        // Extract highlights from nested steps - collect from ALL matching nested docs
        if (hit.inner_hits.steps?.hits?.hits?.length > 0) {
          const allStepHighlights: string[] = [];
          const allExpectedResultHighlights: string[] = [];

          hit.inner_hits.steps.hits.hits.forEach((nestedHit: any) => {
            if (nestedHit.highlight) {
              if (nestedHit.highlight["steps.step"]) {
                allStepHighlights.push(...nestedHit.highlight["steps.step"]);
              }
              if (nestedHit.highlight["steps.expectedResult"]) {
                allExpectedResultHighlights.push(...nestedHit.highlight["steps.expectedResult"]);
              }
            }
          });

          if (allStepHighlights.length > 0) {
            highlights["steps.step"] = allStepHighlights;
          }
          if (allExpectedResultHighlights.length > 0) {
            highlights["steps.expectedResult"] = allExpectedResultHighlights;
          }
        }

        // Extract highlights from nested items - collect from ALL matching nested docs
        if (hit.inner_hits.items?.hits?.hits?.length > 0) {
          const allItemStepHighlights: string[] = [];
          const allItemExpectedResultHighlights: string[] = [];

          hit.inner_hits.items.hits.hits.forEach((nestedHit: any) => {
            if (nestedHit.highlight) {
              if (nestedHit.highlight["items.step"]) {
                allItemStepHighlights.push(...nestedHit.highlight["items.step"]);
              }
              if (nestedHit.highlight["items.expectedResult"]) {
                allItemExpectedResultHighlights.push(...nestedHit.highlight["items.expectedResult"]);
              }
            }
          });

          if (allItemStepHighlights.length > 0) {
            highlights["items.step"] = allItemStepHighlights;
          }
          if (allItemExpectedResultHighlights.length > 0) {
            highlights["items.expectedResult"] = allItemExpectedResultHighlights;
          }
        }
      }

      return {
        id: hit._source.id,
        entityType: getEntityTypeFromIndex(hit._index),
        score: hit._score,
        source: hit._source,
        highlights,
      };
    });

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
