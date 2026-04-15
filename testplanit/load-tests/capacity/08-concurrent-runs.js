/**
 * Capacity Test 08: Concurrent Test Run Execution by Multiple Teams
 *
 * Answers: "Can N QA teams execute test runs simultaneously without
 * contention?"
 *
 * Different from 'concurrent users' — this specifically tests
 * concurrent WRITES to TestRunResults, TestRunCases, which hit
 * row-level locks, audit queue backlog, and forecast recalculation.
 *
 * Each VU simulates one team's QA engineer:
 *   1. Creates a test run of 50 cases
 *   2. Executes each case (submits result) with small pauses
 *   3. Completes the run
 *
 * We ramp team count 1 → 50 teams and measure whether the system
 * holds up under concurrent write load.
 *
 * Run: k6 run --env BASE_URL=... --env API_TOKEN=... --env TIER=medium capacity/08-concurrent-runs.js
 */

import { sleep } from "k6";
import { Trend } from "k6/metrics";
import { findMany, create, update, postApi } from "../helpers/api.js";
import { uniqueId } from "../helpers/data.js";
import { PROJECT_ID } from "../config.js";
import { makeSummaryWriter } from "./helpers/summary.js";

const TIER = __ENV.TIER || "medium";
const TEST_ID = "08-concurrent-runs";

const runCreationLatency = new Trend("run_creation_ms");
const runExecutionLatency = new Trend("run_execution_ms");
const runCompletionLatency = new Trend("run_completion_ms");
const totalTeamRun = new Trend("team_run_total_ms");

const CASES_PER_RUN = 50;

export const options = {
  scenarios: {
    teams: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "2m", target: 5 }, // 5 teams
        { duration: "3m", target: 15 }, // 15 teams
        { duration: "3m", target: 30 }, // 30 teams
        { duration: "3m", target: 50 }, // 50 teams (stress)
        { duration: "1m", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    run_creation_ms: ["p(95)<5000"],
    run_execution_ms: ["p(95)<30000"], // 50-case run should execute reasonably fast
  },
};

export function setup() {
  const cases = findMany(
    "repositoryCases",
    { where: { projectId: PROJECT_ID, isDeleted: false }, select: { id: true }, take: 500 },
    {}
  );
  const statuses = findMany(
    "status",
    { where: { isDeleted: false, isEnabled: true }, select: { id: true, isSuccess: true, isFailure: true } },
    {}
  );
  const workflows = findMany(
    "workflows",
    { where: { isDeleted: false, isDefault: true, scope: "RUNS" }, select: { id: true }, take: 1 },
    {}
  );

  const defaultStatus = statuses?.data?.find((s) => !s.isSuccess && !s.isFailure) || statuses?.data?.[0];
  const passedStatus = statuses?.data?.find((s) => s.isSuccess) || defaultStatus;
  const failedStatus = statuses?.data?.find((s) => s.isFailure) || defaultStatus;
  const runStateId = workflows?.data?.[0]?.id;

  if (!cases?.data?.length || !defaultStatus || !runStateId) {
    throw new Error("Missing seed data for concurrent runs test");
  }

  return {
    caseIds: cases.data.map((c) => c.id),
    defaultStatusId: defaultStatus.id,
    passedStatusId: passedStatus.id,
    failedStatusId: failedStatus.id,
    runStateId,
  };
}

export default function concurrentRuns(ctx) {
  const teamRunStart = Date.now();

  // 1. Create test run
  const createStart = Date.now();
  const testRun = create(
    "testRuns",
    {
      name: `Team Run ${__VU}-${uniqueId()}`,
      isCompleted: false,
      isDeleted: false,
      testRunType: "REGULAR",
      project: { connect: { id: PROJECT_ID } },
      state: { connect: { id: ctx.runStateId } },
    },
    { scenarioTag: "concurrent_run" }
  );
  const testRunId = testRun?.data?.id;
  if (!testRunId) {
    sleep(2);
    return;
  }

  // 2. Attach cases
  const shuffled = [...ctx.caseIds].sort(() => Math.random() - 0.5);
  const selectedCases = shuffled.slice(0, Math.min(CASES_PER_RUN, ctx.caseIds.length));
  const testRunCaseIds = [];

  for (let i = 0; i < selectedCases.length; i++) {
    const trc = create(
      "testRunCases",
      {
        order: i + 1,
        isCompleted: false,
        testRun: { connect: { id: testRunId } },
        repositoryCase: { connect: { id: selectedCases[i] } },
        status: { connect: { id: ctx.defaultStatusId } },
      },
      { scenarioTag: "concurrent_run" }
    );
    if (trc?.data?.id) {
      testRunCaseIds.push({ id: trc.data.id, version: trc.data.version || 1 });
    }
  }
  runCreationLatency.add(Date.now() - createStart);

  // 3. Execute the run — submit results one by one
  const execStart = Date.now();
  for (let i = 0; i < testRunCaseIds.length; i++) {
    const trc = testRunCaseIds[i];
    const rand = Math.random();
    // 80% pass, 15% fail, 5% skip
    if (rand < 0.05) continue;
    const statusId = rand < 0.80 ? ctx.passedStatusId : ctx.failedStatusId;

    postApi(
      "/api/test-runs/submit-result",
      {
        testRunId,
        testRunCaseId: trc.id,
        statusId,
        elapsed: Math.floor(500 + Math.random() * 10000),
        attempt: 1,
        testRunCaseVersion: trc.version,
      },
      { scenarioTag: "concurrent_run" }
    );

    // Realistic cadence — QA engineers don't submit results instantaneously
    sleep(0.1 + Math.random() * 0.3);
  }
  runExecutionLatency.add(Date.now() - execStart);

  // 4. Mark run complete
  const completeStart = Date.now();
  update(
    "testRuns",
    testRunId,
    { isCompleted: true, completedAt: new Date().toISOString() },
    { scenarioTag: "concurrent_run" }
  );
  runCompletionLatency.add(Date.now() - completeStart);

  totalTeamRun.add(Date.now() - teamRunStart);

  // Gap between runs — a QA team doesn't immediately start another run
  sleep(5 + Math.random() * 10);
}

export const handleSummary = makeSummaryWriter(TEST_ID, TIER);
