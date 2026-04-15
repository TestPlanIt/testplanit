/**
 * Tiered data seeding for capacity tests.
 *
 * Run with TIER=small|medium|large to populate the database with
 * realistic volumes appropriate for that test tier.
 *
 *   small:  5 projects,  500 cases/proj,  20 runs/proj  (~  2500 cases,   100 runs)
 *   medium: 20 projects, 2000 cases/proj, 50 runs/proj  (~ 40000 cases,  1000 runs)
 *   large:  50 projects, 10000 cases/proj, 100 runs/proj (~500000 cases, 5000 runs)
 *
 * Each run contains 20-50 cases with mixed pass/fail results.
 *
 * Run: k6 run --env BASE_URL=... --env API_TOKEN=... --env TIER=medium capacity/seed-tier.js
 */

import { sleep } from "k6";
import { create, findMany } from "../helpers/api.js";
import { projectName, folderName, testCaseName } from "../helpers/data.js";

const TIERS = {
  small: {
    projects: 5,
    casesPerProject: 500,
    foldersPerProject: 10,
    runsPerProject: 20,
  },
  medium: {
    projects: 20,
    casesPerProject: 2000,
    foldersPerProject: 30,
    runsPerProject: 50,
  },
  large: {
    projects: 50,
    casesPerProject: 10000,
    foldersPerProject: 50,
    runsPerProject: 100,
  },
};

const TIER = __ENV.TIER || "medium";
const config = TIERS[TIER];
if (!config) {
  throw new Error(
    `Unknown TIER: ${TIER}. Valid: ${Object.keys(TIERS).join(", ")}`
  );
}

export const options = {
  vus: 1,
  iterations: 1,
  duration: undefined,
  thresholds: {},
};

export default function seedTier() {
  console.log(`\n=== Seeding capacity tier: ${TIER} ===`);
  console.log(`  Projects: ${config.projects}`);
  console.log(`  Cases/project: ${config.casesPerProject}`);
  console.log(`  Runs/project: ${config.runsPerProject}`);
  console.log(
    `  Target total: ${config.projects * config.casesPerProject} cases`
  );
  console.log("");

  // Look up the admin user (needed for project creator)
  const adminEmail = __ENV.ADMIN_EMAIL || "admin@loadtest.testplanit.com";
  const adminUsers = findMany("user", {
    where: { email: adminEmail, access: "ADMIN" },
    select: { id: true },
    take: 1,
  });
  const adminUserId = adminUsers?.data?.[0]?.id;
  if (!adminUserId) {
    throw new Error(`Could not find admin user with email ${adminEmail}`);
  }
  console.log(`  Admin user: ${adminUserId}`);

  // Look up lookup data once (same for every project)
  const templates = findMany("templates", {
    where: { isDefault: true },
    select: { id: true },
    take: 1,
  });
  const caseWorkflows = findMany("workflows", {
    where: { isDeleted: false, isDefault: true, scope: "CASES" },
    select: { id: true },
    take: 1,
  });
  const runWorkflows = findMany("workflows", {
    where: { isDeleted: false, isDefault: true, scope: "RUNS" },
    select: { id: true },
    take: 1,
  });
  const statuses = findMany("status", {
    where: { isDeleted: false, isEnabled: true },
    select: { id: true, isSuccess: true, isFailure: true },
  });

  const templateId = templates?.data?.[0]?.id;
  const caseStateId = caseWorkflows?.data?.[0]?.id;
  const runStateId = runWorkflows?.data?.[0]?.id;
  const defaultStatus =
    statuses?.data?.find((s) => !s.isSuccess && !s.isFailure) ||
    statuses?.data?.[0];
  const passedStatus =
    statuses?.data?.find((s) => s.isSuccess) || defaultStatus;
  const failedStatus =
    statuses?.data?.find((s) => s.isFailure) || defaultStatus;

  if (!templateId || !caseStateId || !runStateId || !defaultStatus) {
    throw new Error("Missing core seed data (template/workflow/status)");
  }

  for (let p = 0; p < config.projects; p++) {
    const projectNum = p + 1;
    console.log(`\n--- Project ${projectNum}/${config.projects} ---`);

    // Create project
    const project = create("projects", {
      name: `${projectName()} [${TIER}]`,
      isDeleted: false,
      creator: { connect: { id: adminUserId } },
    });
    const projectId = project?.data?.id;
    if (!projectId) {
      console.error(`  Failed to create project ${projectNum}`);
      continue;
    }

    // Create the default repository for this project explicitly
    const repo = create("repositories", {
      isActive: true,
      isArchived: false,
      isDeleted: false,
      project: { connect: { id: projectId } },
    });
    const repoId = repo?.data?.id;
    if (!repoId) {
      console.warn(
        `  Failed to create repo for project ${projectId}, skipping`
      );
      continue;
    }

    // Create folders
    const folderIds = [];
    for (let f = 0; f < config.foldersPerProject; f++) {
      const folder = create("repositoryFolders", {
        name: folderName(),
        order: f + 1,
        project: { connect: { id: projectId } },
        repository: { connect: { id: repoId } },
        isDeleted: false,
      });
      if (folder?.data?.id) folderIds.push(folder.data.id);
    }
    console.log(`  Folders: ${folderIds.length}`);

    // Create test cases (in batches of 100 with small pauses to avoid saturating)
    const caseIds = [];
    for (let c = 0; c < config.casesPerProject; c++) {
      const folderId = folderIds[Math.floor(Math.random() * folderIds.length)];
      const tc = create("repositoryCases", {
        name: testCaseName(),
        automated: Math.random() < 0.3,
        isDeleted: false,
        project: { connect: { id: projectId } },
        folder: { connect: { id: folderId } },
        repository: { connect: { id: repoId } },
        template: { connect: { id: templateId } },
        state: { connect: { id: caseStateId } },
      });
      if (tc?.data?.id) caseIds.push(tc.data.id);

      if ((c + 1) % 100 === 0) {
        console.log(`  Cases: ${c + 1}/${config.casesPerProject}`);
        sleep(0.05);
      }
    }
    console.log(`  Cases created: ${caseIds.length}`);

    // Create historical test runs
    for (let r = 0; r < config.runsPerProject; r++) {
      const tr = create("testRuns", {
        name: `Seed Run ${r + 1}`,
        isCompleted: true,
        isDeleted: false,
        testRunType: "REGULAR",
        completedAt: new Date(
          Date.now() - (config.runsPerProject - r) * 24 * 60 * 60 * 1000
        ).toISOString(),
        project: { connect: { id: projectId } },
        state: { connect: { id: runStateId } },
      });
      const runId = tr?.data?.id;
      if (!runId) continue;

      // 20-50 cases per run
      const runSize = 20 + Math.floor(Math.random() * 31);
      const shuffled = [...caseIds]
        .sort(() => Math.random() - 0.5)
        .slice(0, runSize);

      for (let i = 0; i < shuffled.length; i++) {
        const rand = Math.random();
        const statusId =
          rand < 0.7
            ? passedStatus.id
            : rand < 0.9
              ? failedStatus.id
              : defaultStatus.id;

        create("testRunCases", {
          order: i + 1,
          isCompleted: rand < 0.9,
          testRun: { connect: { id: runId } },
          repositoryCase: { connect: { id: shuffled[i] } },
          status: { connect: { id: statusId } },
        });
        if ((i + 1) % 20 === 0) sleep(0.05);
      }
    }
    console.log(`  Runs: ${config.runsPerProject}`);
  }

  console.log(`\n=== Tier "${TIER}" seeding complete ===`);
}
