/**
 * Scenario 3: End-to-End Test Lifecycle Evolution
 *
 * BBVA Use Case: "Demonstration of the full lifecycle: starting from
 * initial manual test creation and its subsequent transition into an
 * automated asset. Includes local QA execution, seamless CI/CD
 * integration, and final automated result ingestion."
 *
 * Simulates the full lifecycle:
 * 1. Create a test run
 * 2. Add test cases to the run
 * 3. Execute test cases (submit results one by one)
 * 4. Complete the test run
 * 5. View test run summary
 *
 * Run:
 *   k6 run --env BASE_URL=http://... --env API_TOKEN=tpi_... scenarios/03-test-lifecycle.js
 */

import { sleep, check } from "k6";
import {
  findMany,
  findFirst,
  create,
  update,
  postApi,
} from "../helpers/api.js";
import { uniqueId } from "../helpers/data.js";
import { getProfile, thresholds, PROJECT_ID } from "../config.js";

const TAG = "test_run";

export const options = {
  ...getProfile(),
  thresholds,
};

export default function testLifecycle() {
  // 1. Get available test cases and statuses for this project
  const cases = findMany(
    "repositoryCases",
    {
      where: { projectId: PROJECT_ID, isDeleted: false },
      select: { id: true, name: true },
      take: 20, // pick up to 20 cases for this run
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
    console.warn("No cases or statuses found — skipping test run iteration");
    sleep(2);
    return;
  }

  // Find untested, passed, and failed statuses
  const defaultStatus =
    statuses.data.find((s) => !s.isSuccess && !s.isFailure) || statuses.data[0];
  const passedStatus =
    statuses.data.find((s) => s.isSuccess) || statuses.data[0];
  const failedStatus = statuses.data.find((s) => s.isFailure) || defaultStatus;

  // Get default run workflow state
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
    console.warn("No run workflow state");
    sleep(2);
    return;
  }

  sleep(0.5);

  // 2. Create a test run
  const runName = `Load Test Run ${uniqueId()}`;
  const testRun = create(
    "testRuns",
    {
      name: runName,
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
    console.warn("Failed to create test run");
    sleep(2);
    return;
  }

  sleep(0.5);

  // 3. Add test cases to the run
  const casesToAdd = cases.data.slice(
    0,
    Math.min(cases.data.length, 10 + Math.floor(Math.random() * 10))
  );
  const testRunCaseIds = [];

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
    if (trc?.data?.id) {
      testRunCaseIds.push({
        id: trc.data.id,
        version: trc.data.version || 1,
      });
    }
  }

  sleep(1); // simulate user reviewing the run before executing

  // 4. Execute test cases — submit results
  for (let i = 0; i < testRunCaseIds.length; i++) {
    const trc = testRunCaseIds[i];
    // 80% pass, 15% fail, 5% skip (no result submission)
    const rand = Math.random();
    if (rand < 0.05) continue; // skip

    const statusId = rand < 0.8 ? passedStatus.id : failedStatus.id;
    const elapsed = Math.floor(500 + Math.random() * 30000); // 0.5s to 30s

    const body = {
      testRunId,
      testRunCaseId: trc.id,
      statusId,
      elapsed,
      attempt: 1,
      testRunCaseVersion: trc.version,
    };

    const { res } = postApi("/api/test-runs/submit-result", body, {
      scenarioTag: TAG,
    });

    check(res, {
      "submit-result status 200": (r) => r.status === 200,
    });

    // Brief pause between submissions (realistic human pace)
    sleep(0.2 + Math.random() * 0.5);
  }

  sleep(0.5);

  // 5. Complete the test run
  update(
    "testRuns",
    testRunId,
    {
      isCompleted: true,
      completedAt: new Date().toISOString(),
    },
    { scenarioTag: TAG }
  );

  sleep(0.5);

  // 6. View completed test run summary
  findFirst(
    "testRuns",
    {
      where: { id: testRunId },
      include: {
        testCases: {
          select: {
            id: true,
            status: { select: { id: true, name: true } },
            repositoryCase: { select: { id: true, name: true } },
          },
        },
      },
    },
    { scenarioTag: TAG }
  );

  sleep(randomThinkTime());
}

function randomThinkTime() {
  return 1 + Math.random() * 3;
}
