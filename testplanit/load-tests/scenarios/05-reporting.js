/**
 * Scenario 5: Data Strategy & Global Analytics
 *
 * BBVA Use Case: "Capabilities for cross-project data aggregation
 * to provide a unified global view. Includes real-time dashboarding
 * (coverage, trends) and raw data export to a DataLake."
 *
 * Simulates:
 * 1. Single-project report queries (test execution, health, automation)
 * 2. Cross-project aggregation (the heaviest queries)
 * 3. Dashboard loading (multiple report calls in parallel)
 *
 * These are expected to be the slowest endpoints — cross-project
 * queries aggregate across all accessible projects.
 *
 * Run:
 *   k6 run --env BASE_URL=http://... --env API_TOKEN=tpi_... scenarios/05-reporting.js
 */

import { sleep, check } from "k6";
import { postApi } from "../helpers/api.js";
import { getProfile, thresholds, PROJECT_ID } from "../config.js";

const TAG = "reporting";

export const options = {
  ...getProfile(),
  thresholds,
};

export default function reporting() {
  // 1. Single-project: Test execution report (status dimension, testResults metric)
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
  check(execRes, {
    "test-execution report 200": (r) => r.status === 200,
  });

  sleep(0.5);

  // 2. Single-project: Test case health (pre-built report, no dims/metrics required)
  const { res: healthRes } = postApi(
    "/api/report-builder/test-case-health",
    {
      reportType: "test-case-health",
      projectId: PROJECT_ID,
      dimensions: [],
      metrics: [],
    },
    { scenarioTag: TAG }
  );
  check(healthRes, {
    "test-case-health report 200": (r) => r.status === 200,
  });

  sleep(0.5);

  // 3. Single-project: Automation trends (pre-built)
  const { res: autoRes } = postApi(
    "/api/report-builder/automation-trends",
    {
      reportType: "automation-trends",
      projectId: PROJECT_ID,
      dimensions: [],
      metrics: [],
    },
    { scenarioTag: TAG }
  );
  check(autoRes, {
    "automation-trends report 200": (r) => r.status === 200,
  });

  sleep(1);

  // 4. Cross-project: Test execution (HEAVY — aggregates across projects)
  const { res: crossExecRes } = postApi(
    "/api/report-builder/cross-project-test-execution",
    {
      reportType: "cross-project-test-execution",
      dimensions: ["project", "status"],
      metrics: ["testResults"],
    },
    { scenarioTag: TAG }
  );
  check(crossExecRes, {
    "cross-project execution 200": (r) => r.status === 200,
  });

  sleep(0.5);

  // 5. Cross-project: Test case health (pre-built)
  const { res: crossHealthRes } = postApi(
    "/api/report-builder/cross-project-test-case-health",
    {
      reportType: "cross-project-test-case-health",
      dimensions: [],
      metrics: [],
    },
    { scenarioTag: TAG }
  );
  check(crossHealthRes, {
    "cross-project health 200": (r) => r.status === 200,
  });

  sleep(0.5);

  // 6. Cross-project: Flaky tests (pre-built)
  const { res: flakyRes } = postApi(
    "/api/report-builder/cross-project-flaky-tests",
    {
      reportType: "cross-project-flaky-tests",
      dimensions: [],
      metrics: [],
    },
    { scenarioTag: TAG }
  );
  check(flakyRes, {
    "cross-project flaky tests 200": (r) => r.status === 200,
  });

  sleep(0.5);

  // 7. Cross-project: User engagement (user dim, execution count metric)
  const { res: engageRes } = postApi(
    "/api/report-builder/cross-project-user-engagement",
    {
      reportType: "cross-project-user-engagement",
      dimensions: ["user"],
      metrics: ["executionCount"],
    },
    { scenarioTag: TAG }
  );
  check(engageRes, {
    "cross-project user engagement 200": (r) => r.status === 200,
  });

  sleep(randomThinkTime());
}

function randomThinkTime() {
  return 2 + Math.random() * 4; // longer think time — user analyzes reports
}
