#!/usr/bin/env tsx

import { PrismaClient } from "@prisma/client";
import {
  getElasticsearchClient,
  REPOSITORY_CASE_INDEX,
  createRepositoryCaseIndex,
} from "../services/elasticsearchService";
import {
  syncProjectCasesToElasticsearch,
  initializeElasticsearchIndexes,
} from "../services/repositoryCaseSync";

const prisma = new PrismaClient();

async function deleteExistingIndex(): Promise<void> {
  const client = getElasticsearchClient();
  if (!client) {
    console.error("Elasticsearch client not available");
    return;
  }

  try {
    const indexExists = await client.indices.exists({
      index: REPOSITORY_CASE_INDEX,
    });

    if (indexExists) {
      console.log(`Deleting existing index: ${REPOSITORY_CASE_INDEX}`);
      await client.indices.delete({ index: REPOSITORY_CASE_INDEX });
      console.log("Index deleted successfully");
    }
  } catch (error) {
    console.error("Error deleting index:", error);
  }
}

async function reindexAllCases() {
  console.log("Starting Elasticsearch reindexing process...");

  const client = getElasticsearchClient();
  if (!client) {
    console.error(
      "Elasticsearch client not available. Check your ELASTICSEARCH_NODE environment variable."
    );
    process.exit(1);
  }

  try {
    // Step 1: Delete existing index (optional)
    if (process.argv.includes("--fresh")) {
      await deleteExistingIndex();
    }

    // Step 2: Initialize indexes (creates if not exists)
    console.log("Initializing Elasticsearch indexes...");
    await initializeElasticsearchIndexes();

    // Step 3: Get all projects
    const projects = await prisma.projects.findMany({
      where: {
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
      },
    });

    console.log(`Found ${projects.length} projects to reindex`);

    // Step 4: Reindex each project
    let totalIndexed = 0;
    const failedProjects: number[] = [];

    for (const project of projects) {
      console.log(`\nReindexing project: ${project.name} (ID: ${project.id})`);

      try {
        const success = await syncProjectCasesToElasticsearch(project.id);

        if (success) {
          const count = await prisma.repositoryCases.count({
            where: {
              projectId: project.id,
              isDeleted: false,
              isArchived: false,
            },
          });
          totalIndexed += count;
        } else {
          failedProjects.push(project.id);
        }
      } catch (error) {
        console.error(`Failed to reindex project ${project.id}:`, error);
        failedProjects.push(project.id);
      }
    }

    // Step 5: Summary
    console.log("\n=== Reindexing Complete ===");
    console.log(`Total cases indexed: ${totalIndexed}`);

    if (failedProjects.length > 0) {
      console.log(`Failed projects: ${failedProjects.join(", ")}`);
    }

    // Step 6: Verify index
    const indexStats = await client.indices.stats({
      index: REPOSITORY_CASE_INDEX,
    });

    const docCount =
      indexStats.indices?.[REPOSITORY_CASE_INDEX]?.primaries?.docs?.count || 0;
    console.log(`\nElasticsearch index contains ${docCount} documents`);

    // Test search
    console.log("\nTesting search functionality...");
    const testSearch = await client.search({
      index: REPOSITORY_CASE_INDEX,
      size: 1,
      query: {
        match_all: {},
      },
    });

    const totalHits =
      typeof testSearch.hits.total === "object"
        ? testSearch.hits.total.value
        : testSearch.hits.total;

    if (totalHits && totalHits > 0) {
      console.log("✓ Search is working correctly");
    } else {
      console.log("⚠ Search test returned no results");
    }
  } catch (error) {
    console.error("Reindexing failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the reindexing
reindexAllCases()
  .then(() => {
    console.log("\nReindexing script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Reindexing script failed:", error);
    process.exit(1);
  });
