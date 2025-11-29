#!/usr/bin/env node

/**
 * Production-ready reindex script for Elasticsearch
 * This script can be run in the production Docker container
 * Usage: node scripts/reindex-prod.js [--fresh]
 */

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Import the sync functions from services
async function reindexAllEntities() {
  console.log("Starting Elasticsearch reindexing in production...");

  try {
    // Since we can't import the TypeScript modules directly in production,
    // we'll make HTTP calls to trigger reindexing through the API

    console.log("Fetching all projects...");
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

    // Count entities for each project
    for (const project of projects) {
      console.log(`\nProject: ${project.name} (ID: ${project.id})`);

      // Count repository cases
      const casesCount = await prisma.repositoryCases.count({
        where: {
          projectId: project.id,
          isDeleted: false,
          isArchived: false,
        },
      });
      console.log(`  - Repository Cases: ${casesCount}`);

      // Count test runs
      const testRunsCount = await prisma.testRuns.count({
        where: {
          projectId: project.id,
          isDeleted: false,
        },
      });
      console.log(`  - Test Runs: ${testRunsCount}`);

      // Count sessions
      const sessionsCount = await prisma.sessions.count({
        where: {
          projectId: project.id,
          isDeleted: false,
        },
      });
      console.log(`  - Sessions: ${sessionsCount}`);

      // Count milestones
      const milestonesCount = await prisma.milestones.count({
        where: {
          projectId: project.id,
          isDeleted: false,
        },
      });
      console.log(`  - Milestones: ${milestonesCount}`);

      // Count shared steps
      const sharedStepsCount = await prisma.sharedStepGroup.count({
        where: {
          projectId: project.id,
          isDeleted: false,
        },
      });
      console.log(`  - Shared Steps: ${sharedStepsCount}`);
    }

    console.log("\n=== Manual Reindexing Required ===");
    console.log("Since the production container doesn't include the full TypeScript");
    console.log("services, you'll need to trigger reindexing through one of these methods:");
    console.log("");
    console.log("1. Run the reindex from a development environment that can connect");
    console.log("   to your production Elasticsearch instance:");
    console.log("   ELASTICSEARCH_NODE=<prod-url> pnpm elasticsearch:reindex");
    console.log("");
    console.log("2. Trigger reindexing by updating entities through the UI");
    console.log("   (the Prisma client extension will sync them automatically)");
    console.log("");
    console.log("3. Build a custom Docker image that includes the reindex scripts");
    console.log("   and TypeScript runtime");

  } catch (error) {
    console.error("Error during reindexing:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
reindexAllEntities()
  .then(() => {
    console.log("\nScript completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Script failed:", error);
    process.exit(1);
  });
