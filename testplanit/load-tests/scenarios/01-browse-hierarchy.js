/**
 * Scenario 1: Enterprise-Grade Organization & Hierarchy
 *
 * BBVA Use Case: "Structured management of the testing ecosystem,
 * demonstrating how to organize assets by Project, Application,
 * and hierarchical folders to ensure multi-level visibility."
 *
 * Simulates a user browsing the project hierarchy:
 * 1. List all accessible projects
 * 2. Pick a project and load its repositories
 * 3. Load folder tree for the repository
 * 4. Browse test cases in folders (paginated)
 * 5. Load folder statistics (case counts)
 *
 * Run:
 *   k6 run --env BASE_URL=http://... --env API_TOKEN=tpi_... scenarios/01-browse-hierarchy.js
 */

import { sleep } from "k6";
import { findMany, count } from "../helpers/api.js";
import { getProfile, thresholds, PROJECT_ID } from "../config.js";

const TAG = "browse";

export const options = {
  ...getProfile(),
  thresholds,
};

export default function () {
  // 1. List projects the user can access
  const projects = findMany(
    "projects",
    {
      where: { isDeleted: false },
      select: { id: true, name: true },
      take: 50,
      orderBy: { name: "asc" },
    },
    { scenarioTag: TAG }
  );

  sleep(1); // simulate user reading project list

  // 2. Load repositories for the target project
  const projectId =
    projects?.data?.length > 0 ? projects.data[0].id : PROJECT_ID;

  findMany(
    "repositories",
    {
      where: { projectId, isDeleted: false },
      select: { id: true, isActive: true },
      take: 10,
    },
    { scenarioTag: TAG }
  );

  sleep(0.5);

  // 3. Load folder tree for the project
  const folders = findMany(
    "repositoryFolders",
    {
      where: { projectId, isDeleted: false },
      select: { id: true, name: true, parentId: true, order: true },
      orderBy: { order: "asc" },
    },
    { scenarioTag: TAG }
  );

  sleep(0.5);

  // 4. Browse test cases in the first folder (paginated)
  const folderId = folders?.data?.length > 0 ? folders.data[0].id : null;
  if (folderId) {
    // Page 1 — use include (not select) to get related data
    findMany(
      "repositoryCases",
      {
        where: { projectId, folderId, isDeleted: false },
        include: {
          template: { select: { id: true, templateName: true } },
        },
        take: 25,
        skip: 0,
        orderBy: { name: "asc" },
      },
      { scenarioTag: TAG }
    );

    sleep(1);

    // Page 2
    findMany(
      "repositoryCases",
      {
        where: { projectId, folderId, isDeleted: false },
        select: {
          id: true,
          name: true,
          automated: true,
          createdAt: true,
        },
        take: 25,
        skip: 25,
        orderBy: { name: "asc" },
      },
      { scenarioTag: TAG }
    );
  }

  // 6. Count total cases in the project (for dashboard)
  count(
    "repositoryCases",
    {
      where: { projectId, isDeleted: false },
    },
    { scenarioTag: TAG }
  );

  sleep(randomThinkTime());
}

function randomThinkTime() {
  return 1 + Math.random() * 3; // 1-4 seconds
}
