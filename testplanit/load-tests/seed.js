/**
 * Data Seeding Script for Load Testing
 *
 * Creates a realistic data volume before running load tests.
 * Run this once per test environment setup, NOT as a load test.
 *
 * What it creates:
 * - Multiple projects
 * - Folder hierarchy per project
 * - Test cases with steps (bulk)
 * - Templates and tags
 * - Historical test runs with results
 *
 * Run:
 *   k6 run --env BASE_URL=http://... --env API_TOKEN=tpi_... \
 *          --env SEED_PROJECTS=10 --env SEED_CASES_PER_PROJECT=1000 \
 *          seed.js
 *
 * Environment variables:
 *   SEED_PROJECTS           — Number of projects to create (default: 10)
 *   SEED_CASES_PER_PROJECT  — Test cases per project (default: 500)
 *   SEED_FOLDERS_PER_PROJECT — Folders per project (default: 20)
 *   SEED_RUNS_PER_PROJECT   — Test runs per project (default: 10)
 */

import { sleep } from "k6";
import { create, findMany } from "./helpers/api.js";
import {
  projectName,
  folderName,
  testCaseName,
  uniqueId,
} from "./helpers/data.js";
import { BASE_URL } from "./config.js";

const SEED_PROJECTS = parseInt(__ENV.SEED_PROJECTS || "10");
const SEED_CASES_PER_PROJECT = parseInt(__ENV.SEED_CASES_PER_PROJECT || "500");
const SEED_FOLDERS_PER_PROJECT = parseInt(__ENV.SEED_FOLDERS_PER_PROJECT || "20");
const SEED_RUNS_PER_PROJECT = parseInt(__ENV.SEED_RUNS_PER_PROJECT || "10");

// Seeding runs as a single VU with one iteration
export const options = {
  vus: 1,
  iterations: 1,
  // No time limit — seeding can take a while
  duration: undefined,
  // Disable thresholds for seeding
  thresholds: {},
};

export default function seed() {
  console.log(`\n=== TestPlanIt Load Test Data Seeding ===`);
  console.log(`Projects: ${SEED_PROJECTS}`);
  console.log(`Cases per project: ${SEED_CASES_PER_PROJECT}`);
  console.log(`Folders per project: ${SEED_FOLDERS_PER_PROJECT}`);
  console.log(`Runs per project: ${SEED_RUNS_PER_PROJECT}`);
  console.log(`Target: ${BASE_URL}\n`);

  for (let p = 0; p < SEED_PROJECTS; p++) {
    const projectNum = p + 1;
    console.log(`\n--- Creating project ${projectNum}/${SEED_PROJECTS} ---`);

    // 1. Create project
    const project = create("projects", {
      name: projectName(),
      isDeleted: false,
    });

    const projectId = project?.data?.id;
    if (!projectId) {
      console.error(`Failed to create project ${projectNum} — skipping`);
      continue;
    }
    console.log(`  Project created: id=${projectId}`);

    // 2. Get statuses, repo, template, and workflow state
    sleep(1); // give the system a moment to create defaults

    const statuses = findMany("status", {
      where: { isDeleted: false, isEnabled: true },
      select: { id: true, name: true, isSuccess: true, isFailure: true },
    });

    const defaultStatus = statuses?.data?.find((s) => !s.isSuccess && !s.isFailure) || statuses?.data?.[0];
    const passedStatus = statuses?.data?.find((s) => s.isSuccess) || defaultStatus;
    const failedStatus = statuses?.data?.find((s) => s.isFailure) || defaultStatus;

    // Get repo (created automatically with project)
    const repos = findMany("repositories", {
      where: { projectId, isDeleted: false }, select: { id: true }, take: 1,
    });
    const repoId = repos?.data?.[0]?.id;

    // Get default template and workflow state
    const templates = findMany("templates", { where: { isDefault: true }, select: { id: true }, take: 1 });
    const templateId = templates?.data?.[0]?.id;

    const workflows = findMany("workflows", { where: { isDeleted: false, isDefault: true, scope: "CASES" }, select: { id: true }, take: 1 });
    const stateId = workflows?.data?.[0]?.id;

    if (!defaultStatus) {
      console.warn(`  No statuses found — skipping runs`);
    }
    if (!repoId || !templateId || !stateId) {
      console.warn(`  Missing repo(${repoId}), template(${templateId}), or state(${stateId}) — cases will fail`);
    }

    // 3. Create folder hierarchy
    const folderIds = [];
    const topLevelCount = Math.min(SEED_FOLDERS_PER_PROJECT, 8);
    const subFolderCount = SEED_FOLDERS_PER_PROJECT - topLevelCount;

    // Top-level folders
    for (let f = 0; f < topLevelCount; f++) {
      const folder = create("repositoryFolders", {
        name: folderName(),
        order: f + 1,
        project: { connect: { id: projectId } },
        isDeleted: false,
      });
      if (folder?.data?.id) folderIds.push(folder.data.id);
    }

    // Sub-folders (nested under random top-level folders)
    for (let f = 0; f < subFolderCount && folderIds.length > 0; f++) {
      const parentId = folderIds[Math.floor(Math.random() * Math.min(folderIds.length, topLevelCount))];
      const folder = create("repositoryFolders", {
        name: folderName(),
        order: f + 1,
        project: { connect: { id: projectId } },
        parent: { connect: { id: parentId } },
        isDeleted: false,
      });
      if (folder?.data?.id) folderIds.push(folder.data.id);
    }

    console.log(`  Folders created: ${folderIds.length}`);

    // 4. Create test cases spread across folders
    const caseIds = [];
    const batchSize = 50;
    const totalCases = SEED_CASES_PER_PROJECT;

    for (let c = 0; c < totalCases; c++) {
      const folderId = folderIds.length > 0
        ? folderIds[Math.floor(Math.random() * folderIds.length)]
        : null;

      const caseData = {
        name: testCaseName(),
        automated: Math.random() < 0.3, // 30% automated
        isDeleted: false,
        project: { connect: { id: projectId } },
        repository: { connect: { id: repoId } },
        template: { connect: { id: templateId } },
        state: { connect: { id: stateId } },
      };
      if (folderId) caseData.folder = { connect: { id: folderId } };

      const tc = create("repositoryCases", caseData);
      if (tc?.data?.id) caseIds.push(tc.data.id);

      // Progress logging
      if ((c + 1) % batchSize === 0) {
        console.log(`  Cases: ${c + 1}/${totalCases}`);
        sleep(0.1); // brief pause to avoid overwhelming the server
      }
    }

    console.log(`  Test cases created: ${caseIds.length}`);

    // Get default run workflow state
    const runWorkflows = findMany("workflows", { where: { isDeleted: false, isDefault: true, scope: "RUNS" }, select: { id: true }, take: 1 });
    const runStateId = runWorkflows?.data?.[0]?.id;

    // 5. Create test runs with results
    if (defaultStatus && caseIds.length > 0 && runStateId) {
      for (let r = 0; r < SEED_RUNS_PER_PROJECT; r++) {
        const testRun = create("testRuns", {
          name: `Seed Run ${r + 1} [${uniqueId()}]`,
          isCompleted: true,
          isDeleted: false,
          testRunType: "REGULAR",
          completedAt: new Date(
            Date.now() - (SEED_RUNS_PER_PROJECT - r) * 24 * 60 * 60 * 1000
          ).toISOString(), // spread across days
          project: { connect: { id: projectId } },
          state: { connect: { id: runStateId } },
        });

        const runId = testRun?.data?.id;
        if (!runId) continue;

        // Add a subset of cases to each run (20-50 cases)
        const runCaseCount = Math.min(
          caseIds.length,
          20 + Math.floor(Math.random() * 31)
        );
        const shuffled = [...caseIds].sort(() => Math.random() - 0.5);
        const runCases = shuffled.slice(0, runCaseCount);

        for (let i = 0; i < runCases.length; i++) {
          // Pick a status — 70% pass, 20% fail, 10% untested
          const rand = Math.random();
          const statusId =
            rand < 0.7 ? passedStatus?.id : rand < 0.9 ? failedStatus?.id : defaultStatus?.id;

          create("testRunCases", {
            order: i + 1,
            isCompleted: rand < 0.9, // 90% completed
            testRun: { connect: { id: runId } },
            repositoryCase: { connect: { id: runCases[i] } },
            status: { connect: { id: statusId || defaultStatus.id } },
          });

          if ((i + 1) % 20 === 0) sleep(0.05);
        }

        console.log(`  Run ${r + 1}/${SEED_RUNS_PER_PROJECT}: ${runCaseCount} cases`);
      }
    }

    console.log(`  Project ${projectNum} complete`);
  }

  console.log(`\n=== Seeding complete ===\n`);
  console.log(`Total projects: ${SEED_PROJECTS}`);
  console.log(
    `Approximate total cases: ${SEED_PROJECTS * SEED_CASES_PER_PROJECT}`
  );
  console.log(
    `Approximate total runs: ${SEED_PROJECTS * SEED_RUNS_PER_PROJECT}`
  );
}
