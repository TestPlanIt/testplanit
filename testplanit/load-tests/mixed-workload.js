/**
 * Mixed Workload — Realistic Production Traffic Simulation
 *
 * Combines all scenarios with weighted distribution to simulate
 * what actual production traffic looks like:
 *
 *   60% — Browsing (read-heavy: listing projects, folders, cases)
 *   15% — Test execution (creating runs, submitting results)
 *   10% — Search (full-text, filtered, typeahead)
 *    5% — CRUD (creating/editing test cases)
 *    5% — Reporting (single + cross-project)
 *    5% — CI/CD ingestion (JUnit uploads)
 *
 * This is the primary script to run for capacity planning.
 *
 * Run:
 *   k6 run --env BASE_URL=http://... --env API_TOKEN=tpi_... \
 *          --env PROFILE=load --env PROJECT_ID=1 mixed-workload.js
 */

import { sleep, check } from "k6";
import http from "k6/http";
import { findMany, create, update, postApi, getApi } from "./helpers/api.js";
import { testCaseName, junitXml, uniqueId } from "./helpers/data.js";
import {
  getProfile,
  thresholds,
  PROJECT_ID,
  BASE_URL,
  headers,
} from "./config.js";

export const options = {
  ...getProfile(),
  thresholds,
};

// ---------------------------------------------------------------------------
// Scenario weights — adjust these to model different traffic patterns
// ---------------------------------------------------------------------------

const SCENARIOS = [
  { name: "browse", weight: 60, fn: browseScenario },
  { name: "test_run", weight: 15, fn: testRunScenario },
  { name: "search", weight: 10, fn: searchScenario },
  { name: "crud", weight: 5, fn: crudScenario },
  { name: "reporting", weight: 5, fn: reportingScenario },
  { name: "cicd", weight: 5, fn: cicdScenario },
];

// Build cumulative weights for random selection
const totalWeight = SCENARIOS.reduce((sum, s) => sum + s.weight, 0);
const cumulative = [];
let running = 0;
for (const s of SCENARIOS) {
  running += s.weight;
  cumulative.push({ ...s, threshold: running / totalWeight });
}

export default function mixedWorkload() {
  const rand = Math.random();
  const scenario = cumulative.find((s) => rand <= s.threshold);
  scenario.fn();
}

// ---------------------------------------------------------------------------
// Scenario implementations (simplified versions of the standalone scripts)
// ---------------------------------------------------------------------------

function browseScenario() {
  const TAG = "browse";

  // List projects
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
  sleep(0.5);

  const projectId =
    projects?.data?.length > 0
      ? projects.data[Math.floor(Math.random() * projects.data.length)].id
      : PROJECT_ID;

  // Load folders
  findMany(
    "repositoryFolders",
    {
      where: { projectId, isDeleted: false },
      select: { id: true, name: true, parentId: true },
      orderBy: { order: "asc" },
    },
    { scenarioTag: TAG }
  );
  sleep(0.3);

  // Folder stats
  getApi(`/api/projects/${projectId}/folders/stats`, { scenarioTag: TAG });
  sleep(0.3);

  // Browse cases (paginated)
  findMany(
    "repositoryCases",
    {
      where: { projectId, isDeleted: false },
      include: {
        template: { select: { id: true, templateName: true } },
      },
      take: 25,
      skip: Math.floor(Math.random() * 5) * 25, // random page
      orderBy: { name: "asc" },
    },
    { scenarioTag: TAG }
  );

  sleep(1 + Math.random() * 3);
}

function testRunScenario() {
  const TAG = "test_run";

  // Get cases and statuses
  const cases = findMany(
    "repositoryCases",
    {
      where: { projectId: PROJECT_ID, isDeleted: false },
      select: { id: true },
      take: 15,
      orderBy: { createdAt: "desc" },
    },
    { scenarioTag: TAG }
  );

  const statuses = findMany(
    "status",
    {
      where: { isDeleted: false, isEnabled: true },
      select: { id: true, name: true, isSuccess: true, isFailure: true },
    },
    { scenarioTag: TAG }
  );

  if (!cases?.data?.length || !statuses?.data?.length) {
    sleep(2);
    return;
  }

  const defaultStatus =
    statuses.data.find((s) => !s.isSuccess && !s.isFailure) || statuses.data[0];
  const passedStatus =
    statuses.data.find((s) => s.isSuccess) || statuses.data[0];

  // Get run workflow state
  const runWorkflows = findMany(
    "workflows",
    {
      where: { isDeleted: false, isDefault: true, scope: "RUNS" },
      select: { id: true },
      take: 1,
    },
    { scenarioTag: TAG }
  );
  const runStateId = runWorkflows?.data?.[0]?.id;
  if (!runStateId) {
    sleep(1);
    return;
  }

  // Create run
  const testRun = create(
    "testRuns",
    {
      name: `Mixed Load Run ${uniqueId()}`,
      isCompleted: false,
      isDeleted: false,
      testRunType: "REGULAR",
      project: { connect: { id: PROJECT_ID } },
      state: { connect: { id: runStateId } },
    },
    { scenarioTag: TAG }
  );

  const testRunId = testRun?.data?.id;
  if (!testRunId) {
    sleep(1);
    return;
  }

  // Add 5-10 cases
  const casesToAdd = cases.data.slice(0, 5 + Math.floor(Math.random() * 6));
  const trcIds = [];

  for (let i = 0; i < casesToAdd.length; i++) {
    const trc = create(
      "testRunCases",
      {
        order: i + 1,
        isCompleted: false,
        testRun: { connect: { id: testRunId } },
        repositoryCase: { connect: { id: casesToAdd[i].id } },
        status: { connect: { id: defaultStatus.id } },
      },
      { scenarioTag: TAG }
    );
    if (trc?.data?.id)
      trcIds.push({ id: trc.data.id, version: trc.data.version || 1 });
  }

  sleep(0.5);

  // Submit results
  for (const trc of trcIds) {
    postApi(
      "/api/test-runs/submit-result",
      {
        testRunId,
        testRunCaseId: trc.id,
        statusId: passedStatus.id,
        elapsed: Math.floor(500 + Math.random() * 10000),
        attempt: 1,
        testRunCaseVersion: trc.version,
      },
      { scenarioTag: TAG }
    );
    sleep(0.1 + Math.random() * 0.3);
  }

  // Complete
  update(
    "testRuns",
    testRunId,
    { isCompleted: true, completedAt: new Date().toISOString() },
    { scenarioTag: TAG }
  );
  sleep(1 + Math.random() * 2);
}

function searchScenario() {
  const TAG = "search";
  const queries = [
    "login",
    "payment",
    "API",
    "security",
    "validation",
    "error",
    "mobile",
  ];
  const query = queries[Math.floor(Math.random() * queries.length)];

  const { res } = postApi(
    "/api/repository-cases/search",
    {
      query,
      filters: { projectIds: [PROJECT_ID] },
      pagination: { page: 1, size: 25 },
      highlight: true,
    },
    { scenarioTag: TAG }
  );
  check(res, { "search 200": (r) => r.status === 200 });

  sleep(0.5);

  // Page 2
  postApi(
    "/api/repository-cases/search",
    {
      query,
      filters: { projectIds: [PROJECT_ID] },
      pagination: { page: 2, size: 25 },
    },
    { scenarioTag: TAG }
  );

  sleep(1 + Math.random() * 2);
}

function crudScenario() {
  const TAG = "crud";

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
    sleep(2);
    return;
  }

  // Get repo, template, and workflow state for creating cases
  const repos = findMany(
    "repositories",
    {
      where: { projectId: PROJECT_ID, isDeleted: false },
      select: { id: true },
      take: 1,
    },
    { scenarioTag: TAG }
  );
  const templates = findMany(
    "templates",
    { where: { isDefault: true }, select: { id: true }, take: 1 },
    { scenarioTag: TAG }
  );
  const workflows = findMany(
    "workflows",
    {
      where: { isDeleted: false, isDefault: true, scope: "CASES" },
      select: { id: true },
      take: 1,
    },
    { scenarioTag: TAG }
  );
  const repoId = repos?.data?.[0]?.id;
  const templateId = templates?.data?.[0]?.id;
  const stateId = workflows?.data?.[0]?.id;
  if (!repoId || !templateId || !stateId) {
    sleep(2);
    return;
  }

  // Create
  const created = create(
    "repositoryCases",
    {
      name: testCaseName(),
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

  if (created?.data?.id) {
    sleep(0.5);
    // Update
    update(
      "repositoryCases",
      created.data.id,
      { name: `${created.data.name} [EDITED]` },
      { scenarioTag: TAG }
    );
  }

  sleep(1 + Math.random() * 2);
}

function reportingScenario() {
  const TAG = "reporting";

  // Single-project report
  const { res: execRes } = postApi(
    "/api/report-builder/test-execution",
    {
      reportType: "test-execution",
      projectId: PROJECT_ID,
      dimensions: ["status"],
      metrics: ["testResults"],
    },
    { scenarioTag: TAG }
  );
  check(execRes, { "report 200": (r) => r.status === 200 });

  sleep(0.5);

  // Cross-project report
  const { res: crossRes } = postApi(
    "/api/report-builder/cross-project-test-execution",
    {
      reportType: "cross-project-test-execution",
      dimensions: ["project"],
      metrics: ["testResults"],
    },
    { scenarioTag: TAG }
  );
  check(crossRes, { "cross-project report 200": (r) => r.status === 200 });

  sleep(2 + Math.random() * 4);
}

function cicdScenario() {
  const TAG = "cicd";

  const xml = junitXml(2, 15);

  const res = http.post(
    `${BASE_URL}/api/test-results/import`,
    {
      file: http.file(xml, `ci-${uniqueId()}.xml`, "application/xml"),
      format: "junit",
      projectId: String(PROJECT_ID),
      name: `CI Pipeline ${uniqueId()}`,
    },
    {
      headers: { Authorization: headers.Authorization },
      tags: { scenario: TAG },
      timeout: "60s",
    }
  );
  check(res, { "import 200": (r) => r.status === 200 });

  sleep(0.5 + Math.random() * 2);
}
