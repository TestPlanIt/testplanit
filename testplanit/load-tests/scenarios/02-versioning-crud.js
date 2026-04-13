/**
 * Scenario 2: Lifecycle Management — Versioning & Reusability
 *
 * BBVA Use Case: "Managing large-scale test libraries and maintaining
 * version control across multiple releases, ensuring efficient test
 * case reuse and history tracking."
 *
 * Simulates:
 * 1. Create a new test case with steps
 * 2. Read it back (confirm creation)
 * 3. Update the test case (edit title, add step)
 * 4. Read version history
 * 5. Create a copy in another folder (reuse)
 * 6. List test cases with includes (template, tags, custom fields)
 *
 * Run:
 *   k6 run --env BASE_URL=http://... --env API_TOKEN=tpi_... scenarios/02-versioning-crud.js
 */

import { sleep, check } from "k6";
import { findMany, findFirst, create, update, postApi } from "../helpers/api.js";
import { testCaseName, testSteps, uniqueId } from "../helpers/data.js";
import { getProfile, thresholds, PROJECT_ID } from "../config.js";

const TAG = "crud";

export const options = {
  ...getProfile(),
  thresholds,
};

export default function () {
  // 1. Get a folder to put test cases in
  const folders = findMany(
    "repositoryFolders",
    {
      where: { projectId: PROJECT_ID, isDeleted: false },
      select: { id: true },
      take: 5,
    },
    { scenarioTag: TAG }
  );

  const folderId =
    folders?.data?.length > 0
      ? folders.data[Math.floor(Math.random() * folders.data.length)].id
      : null;

  if (!folderId) {
    console.warn("No folders found — skipping CRUD iteration");
    sleep(2);
    return;
  }

  // Get repository, template, and default workflow state
  const repos = findMany(
    "repositories",
    { where: { projectId: PROJECT_ID, isDeleted: false }, select: { id: true }, take: 1 },
    { scenarioTag: TAG }
  );
  const templates = findMany(
    "templates",
    { where: { isDefault: true }, select: { id: true }, take: 1 },
    { scenarioTag: TAG }
  );
  const workflows = findMany(
    "workflows",
    { where: { isDeleted: false, isDefault: true, scope: "CASES" }, select: { id: true }, take: 1 },
    { scenarioTag: TAG }
  );

  const repoId = repos?.data?.[0]?.id;
  const templateId = templates?.data?.[0]?.id;
  const stateId = workflows?.data?.[0]?.id;

  if (!repoId || !templateId || !stateId) {
    console.warn("Missing repo, template, or workflow state — skipping CRUD iteration");
    sleep(2);
    return;
  }

  sleep(0.5);

  // 2. Create a new test case
  const caseName = testCaseName();
  const created = create(
    "repositoryCases",
    {
      name: caseName,
      automated: false,
      isDeleted: false,
      project: { connect: { id: PROJECT_ID } },
      folder: { connect: { id: folderId } },
      repository: { connect: { id: repoId } },
      template: { connect: { id: templateId } },
      state: { connect: { id: stateId } },
    },
    { scenarioTag: TAG }
  );

  const caseId = created?.data?.id;
  if (!caseId) {
    console.warn("Failed to create test case — skipping rest of iteration");
    sleep(2);
    return;
  }

  sleep(0.5);

  // 3. Read it back with full details
  findFirst(
    "repositoryCases",
    {
      where: { id: caseId },
      include: {
        template: true,
        folder: true,
        steps: true,
      },
    },
    { scenarioTag: TAG }
  );

  sleep(1);

  // 4. Update the test case — simulate editing
  update(
    "repositoryCases",
    caseId,
    {
      name: `${caseName} [UPDATED]`,
      automated: true,
    },
    { scenarioTag: TAG }
  );

  sleep(0.5);

  // 5. Create steps for the test case
  const steps = testSteps(3);
  for (let i = 0; i < steps.length; i++) {
    create(
      "steps",
      {
        order: steps[i].order,
        testCase: { connect: { id: caseId } },
      },
      { scenarioTag: TAG }
    );
  }

  sleep(0.5);

  // 6. List test cases with rich includes (simulates loading the case list page)
  findMany(
    "repositoryCases",
    {
      where: { projectId: PROJECT_ID, folderId, isDeleted: false },
      include: {
        template: { select: { id: true, templateName: true } },
      },
      take: 25,
      orderBy: { createdAt: "desc" },
    },
    { scenarioTag: TAG }
  );

  sleep(randomThinkTime());
}

function randomThinkTime() {
  return 1 + Math.random() * 3;
}
