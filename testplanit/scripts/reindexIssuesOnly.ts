#!/usr/bin/env tsx


import { syncProjectIssuesToElasticsearch } from "../services/issueSearch";
import { createRawDbClient } from "~/lib/rawDbClient";

const db = createRawDbClient();

async function reindexIssues() {
  console.log("Reindexing all issues...");

  try {
    const projects = await db.projects.findMany({
      where: { isDeleted: false },
    });

    console.log(`Found ${projects.length} projects`);

    for (const project of projects) {
      console.log(
        `\nIndexing issues for project ${project.id} (${project.name})...`
      );
      await syncProjectIssuesToElasticsearch(project.id, db);
    }

    console.log("\n✅ Issues reindexing complete!");
  } catch (error) {
    console.error("Error reindexing issues:", error);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

void reindexIssues();
