/**
 * Capacity Test 01: Concurrent Users (Ramp)
 *
 * Answers: "How many concurrent users can log in and use the system
 * with acceptable latency and low error rates?"
 *
 * Ramps VUs 10 → 500, each VU simulating a typical user session
 * (browse + occasional CRUD/search). Captures the breaking point
 * where p95 latency exceeds thresholds or error rate spikes.
 *
 * Run: k6 run --env BASE_URL=... --env API_TOKEN=... --env TIER=medium capacity/01-concurrent-users.js
 */

import { sleep } from "k6";
import { findMany, create, postApi } from "../helpers/api.js";
import { testCaseName } from "../helpers/data.js";
import { PROJECT_ID } from "../config.js";
import { makeSummaryWriter } from "./helpers/summary.js";

const TIER = __ENV.TIER || "medium";
const TEST_ID = "01-concurrent-users";

export const options = {
  stages: [
    { duration: "1m", target: 10 }, // warm up
    { duration: "2m", target: 50 }, // light load
    { duration: "2m", target: 100 }, // normal load
    { duration: "2m", target: 200 }, // heavy load
    { duration: "2m", target: 350 }, // stress
    { duration: "2m", target: 500 }, // breaking
    { duration: "1m", target: 0 }, // ramp down
  ],
  thresholds: {
    http_req_failed: ["rate<0.05"], // fail at >5% errors
    "http_req_duration{scenario:browse}": ["p(95)<1000"],
    "http_req_duration{scenario:crud}": ["p(95)<2000"],
    "http_req_duration{scenario:search}": ["p(95)<1000"],
  },
};

export default function concurrentUsers() {
  // 70% browse / 15% search / 10% CRUD / 5% small test run
  const r = Math.random();
  if (r < 0.7) browseSession();
  else if (r < 0.85) searchSession();
  else if (r < 0.95) crudSession();
  else testRunSession();
}

function browseSession() {
  const TAG = "browse";
  findMany("projects", { select: { id: true, name: true }, take: 50 }, { scenarioTag: TAG });
  sleep(0.5 + Math.random());
  findMany(
    "repositoryFolders",
    { where: { projectId: PROJECT_ID, isDeleted: false }, take: 50 },
    { scenarioTag: TAG }
  );
  sleep(0.3 + Math.random());
  findMany(
    "repositoryCases",
    {
      where: { projectId: PROJECT_ID, isDeleted: false },
      take: 25,
      skip: Math.floor(Math.random() * 5) * 25,
      orderBy: { name: "asc" },
    },
    { scenarioTag: TAG }
  );
  sleep(1 + Math.random() * 2);
}

function searchSession() {
  const TAG = "search";
  const queries = ["login", "payment", "api", "error", "test", "validate"];
  const q = queries[Math.floor(Math.random() * queries.length)];

  postApi(
    "/api/repository-cases/search",
    { query: q, filters: { projectIds: [PROJECT_ID] }, pagination: { page: 1, size: 25 } },
    { scenarioTag: TAG }
  );
  sleep(0.5 + Math.random());
  postApi(
    "/api/repository-cases/search",
    { query: q, filters: { projectIds: [PROJECT_ID] }, pagination: { page: 2, size: 25 } },
    { scenarioTag: TAG }
  );
  sleep(1 + Math.random());
}

function crudSession() {
  const TAG = "crud";
  const folders = findMany(
    "repositoryFolders",
    { where: { projectId: PROJECT_ID, isDeleted: false }, select: { id: true }, take: 5 },
    { scenarioTag: TAG }
  );
  const folderId = folders?.data?.[0]?.id;
  if (!folderId) return;

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
  if (!repoId || !templateId || !stateId) return;

  create(
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
  sleep(1 + Math.random());
}

function testRunSession() {
  const TAG = "test_run";
  postApi(
    "/api/report-builder/test-execution",
    {
      reportType: "test-execution",
      projectId: PROJECT_ID,
      dimensions: ["status"],
      metrics: ["testResults"],
    },
    { scenarioTag: TAG }
  );
  sleep(2 + Math.random() * 2);
}

export const handleSummary = makeSummaryWriter(TEST_ID, TIER);
