import {
  getElasticsearchClient,
  getEntityIndexName,
} from "./unifiedElasticsearchService";
import { SearchableEntityType } from "~/types/search";
import type { TestRuns, Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "~/lib/prismaBase";
import { extractTextFromNode } from "~/utils/extractTextFromJson";

/**
 * Type for test run with all required relations for indexing
 */
type TestRunForIndexing = TestRuns & {
  project: { name: string };
  createdBy: { name: string };
  state: { name: string };
  configuration?: { name: string } | null;
  milestone?: { name: string } | null;
  tags: Array<{ id: number; name: string }>;
};

/**
 * Index a single test run to Elasticsearch
 * @param testRun - The test run to index
 * @param tenantId - Optional tenant ID for multi-tenant mode
 */
export async function indexTestRun(
  testRun: TestRunForIndexing,
  tenantId?: string
): Promise<void> {
  const client = getElasticsearchClient();
  if (!client) {
    throw new Error("Elasticsearch client not available");
  }

  const indexName = getEntityIndexName(SearchableEntityType.TEST_RUN, tenantId);

  // Extract text from TipTap JSON for note and docs fields
  const noteText = testRun.note ? extractTextFromNode(testRun.note) : "";
  const docsText = testRun.docs ? extractTextFromNode(testRun.docs) : "";

  const searchableContent = [
    testRun.name,
    noteText,
    docsText,
    testRun.tags.map((t) => t.name).join(" "),
  ].join(" ");

  const document = {
    id: testRun.id,
    projectId: testRun.projectId,
    projectName: testRun.project.name,
    name: testRun.name,
    note: noteText,
    docs: docsText,
    configId: testRun.configId,
    configurationName: testRun.configuration?.name,
    milestoneId: testRun.milestoneId,
    milestoneName: testRun.milestone?.name,
    stateId: testRun.stateId,
    stateName: testRun.state.name,
    forecastManual: testRun.forecastManual,
    forecastAutomated: testRun.forecastAutomated,
    elapsed: testRun.elapsed,
    isCompleted: testRun.isCompleted,
    isDeleted: testRun.isDeleted,
    completedAt: testRun.completedAt,
    testRunType: testRun.testRunType,
    createdAt: testRun.createdAt,
    createdById: testRun.createdById,
    createdByName: testRun.createdBy.name,
    tags: testRun.tags.map((tag) => ({ id: tag.id, name: tag.name })),
    searchableContent,
  };

  await client.index({
    index: indexName,
    id: testRun.id.toString(),
    document,
    refresh: true,
  });
}

/**
 * Delete a test run from Elasticsearch
 * @param testRunId - The ID of the test run to delete
 * @param tenantId - Optional tenant ID for multi-tenant mode
 */
export async function deleteTestRunFromIndex(
  testRunId: number,
  tenantId?: string
): Promise<void> {
  const client = getElasticsearchClient();
  if (!client) {
    console.warn("Elasticsearch client not available");
    return;
  }

  const indexName = getEntityIndexName(SearchableEntityType.TEST_RUN, tenantId);

  try {
    await client.delete({
      index: indexName,
      id: testRunId.toString(),
      refresh: true,
    });
  } catch (error: any) {
    if (error.meta?.statusCode !== 404) {
      console.error("Failed to delete test run from index:", error);
    }
  }
}

/**
 * Sync a single test run to Elasticsearch
 * @param testRunId - The ID of the test run to sync
 * @param tenantId - Optional tenant ID for multi-tenant mode
 */
export async function syncTestRunToElasticsearch(
  testRunId: number,
  tenantId?: string
): Promise<boolean> {
  const client = getElasticsearchClient();
  if (!client) {
    console.warn("Elasticsearch client not available");
    return false;
  }

  try {
    const testRun = await defaultPrisma.testRuns.findUnique({
      where: { id: testRunId },
      include: {
        project: true,
        createdBy: true,
        state: true,
        configuration: true,
        milestone: true,
        tags: true,
      },
    });

    if (!testRun) {
      console.warn(`Test run ${testRunId} not found`);
      return false;
    }

    // Index test run including deleted ones (filtering happens at search time based on admin permissions)

    // Index the test run
    await indexTestRun(testRun as TestRunForIndexing, tenantId);
    return true;
  } catch (error) {
    console.error(`Failed to sync test run ${testRunId}:`, error);
    return false;
  }
}

/**
 * Bulk index test runs for a project
 * @param projectId - The project ID to sync test runs for
 * @param db - Prisma client instance
 * @param tenantId - Optional tenant ID for multi-tenant mode
 */
export async function syncProjectTestRunsToElasticsearch(
  projectId: number,
  db: any,
  tenantId?: string
): Promise<void> {
  const client = getElasticsearchClient();
  if (!client) {
    console.warn("Elasticsearch client not available");
    return;
  }

  const indexName = getEntityIndexName(SearchableEntityType.TEST_RUN, tenantId);

  console.log(`Starting test run sync for project ${projectId}${tenantId ? ` (tenant: ${tenantId})` : ""}`);

  const testRuns = await db.testRuns.findMany({
    where: {
      projectId: projectId,
      // Include deleted items (filtering happens at search time based on admin permissions)
    },
    include: {
      project: true,
      createdBy: true,
      state: true,
      configuration: true,
      milestone: true,
      tags: true,
    },
  });

  if (testRuns.length === 0) {
    console.log("No test runs to index");
    return;
  }

  const bulkBody = [];
  for (const testRun of testRuns) {
    // Extract text from TipTap JSON for note and docs fields
    const noteText = testRun.note ? extractTextFromNode(testRun.note) : "";
    const docsText = testRun.docs ? extractTextFromNode(testRun.docs) : "";

    const searchableContent = [
      testRun.name,
      noteText,
      docsText,
      testRun.tags.map((t: any) => t.name).join(" "),
    ].join(" ");

    bulkBody.push({
      index: {
        _index: indexName,
        _id: testRun.id.toString(),
      },
    });

    bulkBody.push({
      id: testRun.id,
      projectId: testRun.projectId,
      projectName: testRun.project.name,
      name: testRun.name,
      note: noteText,
      docs: docsText,
      configId: testRun.configId,
      configurationName: testRun.configuration?.name,
      milestoneId: testRun.milestoneId,
      milestoneName: testRun.milestone?.name,
      stateId: testRun.stateId,
      stateName: testRun.state.name,
      forecastManual: testRun.forecastManual,
      forecastAutomated: testRun.forecastAutomated,
      elapsed: testRun.elapsed,
      isCompleted: testRun.isCompleted,
      isDeleted: testRun.isDeleted,
      completedAt: testRun.completedAt,
      testRunType: testRun.testRunType,
      createdAt: testRun.createdAt,
      createdById: testRun.createdById,
      createdByName: testRun.createdBy.name,
      tags: testRun.tags.map((tag: any) => ({ id: tag.id, name: tag.name })),
      searchableContent,
    });
  }

  try {
    const bulkResponse = await client.bulk({ body: bulkBody, refresh: true });

    if (bulkResponse.errors) {
      const errorItems = bulkResponse.items.filter(
        (item: any) => item.index?.error
      );
      console.error(`Bulk indexing errors: ${errorItems.length} failed documents`);
      // Log detailed error information
      errorItems.slice(0, 10).forEach((item: any) => {
        if (item.index?.error) {
          console.error(`  Failed to index document ${item.index._id}:`);
          console.error(`    Error type: ${item.index.error.type}`);
          console.error(`    Error reason: ${item.index.error.reason}`);
          if (item.index.error.caused_by) {
            console.error(`    Caused by: ${JSON.stringify(item.index.error.caused_by)}`);
          }
        }
      });
      if (errorItems.length > 10) {
        console.error(`  ... and ${errorItems.length - 10} more errors`);
      }
    } else {
      console.log(`Successfully indexed ${testRuns.length} test runs`);
    }
  } catch (error) {
    console.error("Failed to bulk index test runs:", error);
    throw error;
  }
}

/**
 * Search for test runs
 * @param params - Search parameters
 * @param tenantId - Optional tenant ID for multi-tenant mode
 */
export async function searchTestRuns(
  params: {
    query?: string;
    projectIds?: number[];
    stateIds?: number[];
    configurationIds?: number[];
    milestoneIds?: number[];
    isCompleted?: boolean;
    testRunType?: string;
    customFields?: Array<{
      fieldId: number;
      fieldType: string;
      operator: string;
      value: any;
      value2?: any;
    }>;
    from?: number;
    size?: number;
    sort?: Array<{ field: string; order: "asc" | "desc" }>;
  },
  tenantId?: string
): Promise<{
  hits: any[];
  total: number;
  took: number;
}> {
  const client = getElasticsearchClient();
  if (!client) {
    return { hits: [], total: 0, took: 0 };
  }

  const indexName = getEntityIndexName(SearchableEntityType.TEST_RUN, tenantId);

  const must: any[] = [];
  const filter: any[] = [];

  // Add query
  if (params.query) {
    must.push({
      multi_match: {
        query: params.query,
        fields: [
          "name^3",
          "searchableContent",
          "note",
          "docs",
          "customFields.value",
        ],
        type: "best_fields",
        operator: "or",
        fuzziness: "AUTO",
      },
    });
  }

  // Add filters
  if (params.projectIds && params.projectIds.length > 0) {
    filter.push({ terms: { projectId: params.projectIds } });
  }
  if (params.stateIds && params.stateIds.length > 0) {
    filter.push({ terms: { stateId: params.stateIds } });
  }
  if (params.configurationIds && params.configurationIds.length > 0) {
    filter.push({ terms: { configId: params.configurationIds } });
  }
  if (params.milestoneIds && params.milestoneIds.length > 0) {
    filter.push({ terms: { milestoneId: params.milestoneIds } });
  }
  if (typeof params.isCompleted === "boolean") {
    filter.push({ term: { isCompleted: params.isCompleted } });
  }
  if (params.testRunType) {
    filter.push({ term: { testRunType: params.testRunType } });
  }

  // Add custom field filters
  if (params.customFields) {
    // Implementation would be similar to repository case custom field filters
  }

  const searchBody: any = {
    index: indexName,
    from: params.from || 0,
    size: params.size || 20,
    query: {
      bool: {
        must,
        filter,
      },
    },
    highlight: {
      fields: {
        name: { number_of_fragments: 1 },
        searchableContent: { number_of_fragments: 3 },
        note: { number_of_fragments: 2 },
        docs: { number_of_fragments: 2 },
      },
      pre_tags: ['<mark class="search-highlight">'],
      post_tags: ["</mark>"],
    },
  };

  // Add sorting
  if (params.sort && params.sort.length > 0) {
    searchBody.sort = params.sort.map((s) => ({
      [s.field]: { order: s.order },
    }));
  }

  try {
    const response = await client.search(searchBody);
    return {
      hits: response.hits.hits,
      total:
        typeof response.hits.total === "object"
          ? response.hits.total.value
          : response.hits.total || 0,
      took: response.took,
    };
  } catch (error) {
    console.error("Test run search error:", error);
    return { hits: [], total: 0, took: 0 };
  }
}
