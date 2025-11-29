#!/usr/bin/env tsx

import { PrismaClient } from "@prisma/client";
import { syncProjectIssuesToElasticsearch } from "../services/issueSearch";

const prisma = new PrismaClient();

async function reindexIssues() {
  console.log("Reindexing all issues...");

  try {
    const projects = await prisma.projects.findMany({
      where: { isDeleted: false },
    });

    console.log(`Found ${projects.length} projects`);

    for (const project of projects) {
      console.log(`\nIndexing issues for project ${project.id} (${project.name})...`);
      await syncProjectIssuesToElasticsearch(project.id, prisma);
    }

    console.log("\n✅ Issues reindexing complete!");
  } catch (error) {
    console.error("Error reindexing issues:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

reindexIssues();
