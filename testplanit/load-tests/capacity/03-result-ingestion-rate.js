/**
 * Capacity Test 03: API Test Result Ingestion Rate (CLI path)
 *
 * Answers: "How many test results per second can CI/CD pipelines
 * submit via the API before ingestion falls behind?"
 *
 * This is the most BBVA-critical test — customers running thousands
 * of automated tests per pipeline will hammer this endpoint.
 *
 * Two scenarios tested:
 *   A) Individual result submissions via /api/test-runs/submit-result
 *   B) Bulk JUnit XML imports via /api/test-results/import
 *
 * Run: k6 run --env BASE_URL=... --env API_TOKEN=... --env TIER=medium capacity/03-result-ingestion-rate.js
 */

import { check } from "k6";
import http from "k6/http";
import { Trend } from "k6/metrics";
import { findMany, create, postApi } from "../helpers/api.js";
import { junitXml, uniqueId } from "../helpers/data.js";
import { BASE_URL, headers, PROJECT_ID } from "../config.js";
import { makeSummaryWriter } from "./helpers/summary.js";

const TIER = __ENV.TIER || "medium";
const TEST_ID = "03-result-ingestion-rate";

const submitLatency = new Trend("submit_result_latency_ms");
const importLatency = new Trend("import_latency_ms");
const importedResults = new Trend("junit_results_per_import");

export const options = {
  scenarios: {
    individual_submits: {
      executor: "ramping-arrival-rate",
      startRate: 20,
      timeUnit: "1s",
      preAllocatedVUs: 50,
      maxVUs: 300,
      stages: [
        { duration: "1m", target: 50 },
        { duration: "2m", target: 100 },
        { duration: "2m", target: 250 },
        { duration: "2m", target: 500 },
        { duration: "2m", target: 1000 },
        { duration: "1m", target: 0 },
      ],
      exec: "submitIndividual",
    },
    ci_pipelines: {
      executor: "ramping-arrival-rate",
      startRate: 1,
      timeUnit: "1s",
      preAllocatedVUs: 20,
      maxVUs: 100,
      stages: [
        { duration: "1m", target: 2 },
        { duration: "2m", target: 5 },
        { duration: "2m", target: 10 },
        { duration: "2m", target: 20 },
        { duration: "2m", target: 40 },
        { duration: "1m", target: 0 },
      ],
      exec: "runCIPipeline",
      startTime: "0s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    submit_result_latency_ms: ["p(95)<2000"],
    import_latency_ms: ["p(95)<30000"], // larger imports take longer
  },
};

export function setup() {
  // Need an existing test run with cases to submit results against
  const cases = findMany(
    "repositoryCases",
    { where: { projectId: PROJECT_ID, isDeleted: false }, select: { id: true }, take: 100 },
    {}
  );
  const statuses = findMany(
    "status",
    { where: { isDeleted: false, isEnabled: true }, select: { id: true, isSuccess: true } },
    {}
  );
  const workflows = findMany(
    "workflows",
    { where: { isDeleted: false, isDefault: true, scope: "RUNS" }, select: { id: true }, take: 1 },
    {}
  );

  const defaultStatus = statuses?.data?.find((s) => !s.isSuccess) || statuses?.data?.[0];
  const passedStatus = statuses?.data?.find((s) => s.isSuccess) || defaultStatus;
  const runStateId = workflows?.data?.[0]?.id;

  if (!cases?.data?.length || !defaultStatus || !runStateId) {
    throw new Error("Missing required seed data for ingestion test");
  }

  // Create a test run with cases to post results against
  const testRun = create("testRuns", {
    name: `Ingestion Test Run ${uniqueId()}`,
    isCompleted: false,
    isDeleted: false,
    testRunType: "REGULAR",
    project: { connect: { id: PROJECT_ID } },
    state: { connect: { id: runStateId } },
  });

  const testRunId = testRun?.data?.id;
  if (!testRunId) throw new Error("Failed to create setup test run");

  // Attach first 50 cases to it
  const testRunCaseIds = [];
  const casesToAdd = cases.data.slice(0, 50);
  for (let i = 0; i < casesToAdd.length; i++) {
    const trc = create("testRunCases", {
      order: i + 1,
      isCompleted: false,
      testRun: { connect: { id: testRunId } },
      repositoryCase: { connect: { id: casesToAdd[i].id } },
      status: { connect: { id: defaultStatus.id } },
    });
    if (trc?.data?.id) testRunCaseIds.push({ id: trc.data.id, version: trc.data.version || 1 });
  }

  return {
    testRunId,
    testRunCaseIds,
    passedStatusId: passedStatus.id,
  };
}

export function submitIndividual(ctx) {
  if (!ctx.testRunCaseIds.length) return;
  const trc = ctx.testRunCaseIds[Math.floor(Math.random() * ctx.testRunCaseIds.length)];

  const start = Date.now();
  const { res } = postApi(
    "/api/test-runs/submit-result",
    {
      testRunId: ctx.testRunId,
      testRunCaseId: trc.id,
      statusId: ctx.passedStatusId,
      elapsed: Math.floor(500 + Math.random() * 5000),
      attempt: 1,
      testRunCaseVersion: trc.version,
    },
    { scenarioTag: "ingest_single" }
  );
  submitLatency.add(Date.now() - start);
  check(res, { "submit 200": (r) => r.status === 200 });
}

export function runCIPipeline(_ctx) {
  // Simulate a CI run reporting a batch of 50 test results as JUnit XML
  const suiteCount = 2 + Math.floor(Math.random() * 3);
  const casesPerSuite = 15 + Math.floor(Math.random() * 10);
  const xml = junitXml(suiteCount, casesPerSuite);
  importedResults.add(suiteCount * casesPerSuite);

  const start = Date.now();
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
      tags: { scenario: "ingest_ci" },
      timeout: "120s",
    }
  );
  importLatency.add(Date.now() - start);
  check(res, { "import 200": (r) => r.status === 200 });
}

export const handleSummary = makeSummaryWriter(TEST_ID, TIER);
