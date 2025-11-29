#!/usr/bin/env tsx

import { PrismaClient } from "@prisma/client";
import {
  getElasticsearchClient,
  ENTITY_INDICES,
  createAllEntityIndices,
} from "../services/unifiedElasticsearchService";
import { SearchableEntityType } from "../types/search";
import {
  syncProjectCasesToElasticsearch,
  initializeElasticsearchIndexes,
} from "../services/repositoryCaseSync";
import { syncProjectSharedStepsToElasticsearch } from "../services/sharedStepSearch";
import { syncProjectTestRunsToElasticsearch } from "../services/testRunSearch";
import { syncProjectSessionsToElasticsearch } from "../services/sessionSearch";
import { syncProjectIssuesToElasticsearch } from "../services/issueSearch";
import { syncProjectMilestonesToElasticsearch } from "../services/milestoneSearch";
import { syncAllProjectsToElasticsearch } from "../services/projectSearch";

const prisma = new PrismaClient();


async function deleteAllIndices(): Promise<void> {
  const client = getElasticsearchClient();
  if (!client) {
    console.error("Elasticsearch client not available");
    return;
  }

  for (const [entityType, indexName] of Object.entries(ENTITY_INDICES)) {
    try {
      const indexExists = await client.indices.exists({ index: indexName });
      if (indexExists) {
        console.log(`Deleting index: ${indexName}`);
        await client.indices.delete({ index: indexName });
      }
    } catch (error) {
      console.error(`Error deleting index ${indexName}:`, error);
    }
  }
}






async function reindexAllEntities() {
  console.log("Starting comprehensive Elasticsearch reindexing...");

  const client = getElasticsearchClient();
  if (!client) {
    console.error(
      "Elasticsearch client not available. Check your ELASTICSEARCH_NODE environment variable."
    );
    process.exit(1);
  }

  try {
    // Step 1: Delete existing indices (optional)
    if (process.argv.includes("--fresh")) {
      console.log("\n=== Deleting all existing indices ===");
      await deleteAllIndices();
    }

    // Step 2: Create all indices
    console.log("\n=== Creating indices ===");
    await createAllEntityIndices();

    // Step 3: Index all entity types
    const results = {
      projects: 0,
      repositoryCases: 0,
      sharedSteps: 0,
      testRuns: 0,
      sessions: 0,
      issues: 0,
      milestones: 0,
    };

    // Index projects using new sync function
    console.log("\n=== Indexing Projects ===");
    await syncAllProjectsToElasticsearch();
    results.projects = await prisma.projects.count({ where: { isDeleted: false } });

    // Index repository cases (using existing function)
    console.log("\n=== Indexing Repository Cases ===");
    await initializeElasticsearchIndexes();
    const projects = await prisma.projects.findMany({
      where: { isDeleted: false },
    });

    for (const project of projects) {
      const count = await prisma.repositoryCases.count({
        where: {
          projectId: project.id,
          isDeleted: false,
          isArchived: false,
        },
      });
      if (count > 0) {
        console.log(`Indexing ${count} cases for project ${project.name}`);
        await syncProjectCasesToElasticsearch(project.id);
        results.repositoryCases += count;
      }
    }

    // Index shared steps
    console.log("\n=== Indexing Shared Steps ===");
    for (const project of projects) {
      const count = await prisma.sharedStepGroup.count({
        where: {
          projectId: project.id,
          isDeleted: false,
        },
      });
      if (count > 0) {
        console.log(
          `Indexing ${count} shared steps for project ${project.name}`
        );
        await syncProjectSharedStepsToElasticsearch(project.id);
        results.sharedSteps += count;
      }
    }

    // Index test runs using new sync functions
    console.log("\n=== Indexing Test Runs ===");
    for (const project of projects) {
      const count = await prisma.testRuns.count({
        where: {
          projectId: project.id,
          isDeleted: false,
        },
      });
      if (count > 0) {
        console.log(`Indexing ${count} test runs for project ${project.name}`);
        await syncProjectTestRunsToElasticsearch(project.id, prisma);
        results.testRuns += count;
      }
    }

    // Index sessions using new sync functions
    console.log("\n=== Indexing Sessions ===");
    for (const project of projects) {
      const count = await prisma.sessions.count({
        where: {
          projectId: project.id,
          isDeleted: false,
        },
      });
      if (count > 0) {
        console.log(`Indexing ${count} sessions for project ${project.name}`);
        await syncProjectSessionsToElasticsearch(project.id, prisma);
        results.sessions += count;
      }
    }

    // Index issues using new sync functions
    console.log("\n=== Indexing Issues ===");
    for (const project of projects) {
      // Issues don't have direct projectId, count through test runs
      const count = await prisma.issue.count({
        where: {
          isDeleted: false,
          testRuns: {
            some: {
              projectId: project.id,
            },
          },
        },
      });
      if (count > 0) {
        console.log(`Indexing ${count} issues for project ${project.name}`);
        await syncProjectIssuesToElasticsearch(project.id, prisma);
        results.issues += count;
      }
    }

    // Index milestones using new sync functions
    console.log("\n=== Indexing Milestones ===");
    for (const project of projects) {
      const count = await prisma.milestones.count({
        where: {
          projectId: project.id,
          isDeleted: false,
        },
      });
      if (count > 0) {
        console.log(`Indexing ${count} milestones for project ${project.name}`);
        await syncProjectMilestonesToElasticsearch(project.id, prisma);
        results.milestones += count;
      }
    }

    // Step 4: Summary
    console.log("\n=== Reindexing Complete ===");
    console.log("Documents indexed by type:");
    console.log(`  Projects: ${results.projects}`);
    console.log(`  Repository Cases: ${results.repositoryCases}`);
    console.log(`  Shared Steps: ${results.sharedSteps}`);
    console.log(`  Test Runs: ${results.testRuns}`);
    console.log(`  Sessions: ${results.sessions}`);
    console.log(`  Issues: ${results.issues}`);
    console.log(`  Milestones: ${results.milestones}`);
    console.log(
      `  Total: ${Object.values(results).reduce((a, b) => a + b, 0)}`
    );

    // Step 5: Verify indices
    console.log("\n=== Verifying indices ===");
    for (const [entityType, indexName] of Object.entries(ENTITY_INDICES)) {
      try {
        const stats = await client.indices.stats({ index: indexName });
        const docCount = stats._all?.primaries?.docs?.count || 0;
        console.log(`${indexName}: ${docCount} documents`);
      } catch (error) {
        console.log(`${indexName}: No stats available`);
      }
    }

    // Test search
    console.log("\n=== Testing search functionality ===");
    const testSearch = await client.search({
      index: Object.values(ENTITY_INDICES),
      size: 1,
      query: { match_all: {} },
    });

    const totalHits =
      typeof testSearch.hits.total === "object"
        ? testSearch.hits.total.value
        : testSearch.hits.total;

    if (totalHits && totalHits > 0) {
      console.log("✓ Multi-index search is working correctly");
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
reindexAllEntities()
  .then(() => {
    console.log("\nReindexing script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Reindexing script failed:", error);
    process.exit(1);
  });
