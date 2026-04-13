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
 * queries aggregate across all accessible projects with cartesian
 * dimension × metric products.
 *
 * Run:
 *   k6 run --env BASE_URL=http://... --env API_TOKEN=tpi_... scenarios/05-reporting.js
 */

import { sleep, check } from "k6";
import { postApi, findMany } from "../helpers/api.js";
import { getProfile, thresholds, PROJECT_ID } from "../config.js";

const TAG = "reporting";

export const options = {
  ...getProfile(),
  thresholds,
};

export default function () {
  // 1. Get accessible projects for cross-project reports
  const projects = findMany(
    "projects",
    {
      where: { isDeleted: false },
      select: { id: true },
      take: 50,
    },
    { scenarioTag: TAG }
  );

  const projectIds = projects?.data?.map((p) => p.id) || [PROJECT_ID];

  sleep(0.5);

  // 2. Single-project: Test execution report
  const { res: execRes } = postApi(
    "/api/report-builder/test-execution",
    {
      projectId: PROJECT_ID,
      dimensions: [{ id: "status" }],
      metrics: [{ id: "executionCount", aggregation: "sum" }],
      filters: {},
      limit: 100,
    },
    { scenarioTag: TAG }
  );
  check(execRes, {
    "test-execution report 200": (r) => r.status === 200,
  });

  sleep(0.5);

  // 3. Single-project: Test case health
  const { res: healthRes } = postApi(
    "/api/report-builder/test-case-health",
    {
      projectId: PROJECT_ID,
      dimensions: [{ id: "template" }],
      metrics: [{ id: "caseCount", aggregation: "sum" }],
      filters: {},
      limit: 100,
    },
    { scenarioTag: TAG }
  );
  check(healthRes, {
    "test-case-health report 200": (r) => r.status === 200,
  });

  sleep(0.5);

  // 4. Single-project: Automation trends
  const { res: autoRes } = postApi(
    "/api/report-builder/automation-trends",
    {
      projectId: PROJECT_ID,
      dimensions: [{ id: "month" }],
      metrics: [
        { id: "automatedCount", aggregation: "sum" },
        { id: "manualCount", aggregation: "sum" },
      ],
      filters: {},
      limit: 100,
    },
    { scenarioTag: TAG }
  );
  check(autoRes, {
    "automation-trends report 200": (r) => r.status === 200,
  });

  sleep(1);

  // 5. Cross-project: Test execution across all projects (HEAVY)
  const { res: crossExecRes } = postApi(
    "/api/report-builder/cross-project-test-execution",
    {
      projectIds,
      dimensions: [{ id: "project" }, { id: "status" }],
      metrics: [{ id: "executionCount", aggregation: "sum" }],
      filters: {},
      limit: 500,
    },
    { scenarioTag: TAG }
  );
  check(crossExecRes, {
    "cross-project execution 200": (r) => r.status === 200,
  });

  sleep(0.5);

  // 6. Cross-project: Repository stats (case counts, automation %)
  const { res: crossRepoRes } = postApi(
    "/api/report-builder/cross-project-repository-stats",
    {
      projectIds,
      dimensions: [{ id: "project" }],
      metrics: [
        { id: "totalCases", aggregation: "sum" },
        { id: "automatedPercentage", aggregation: "avg" },
      ],
      filters: {},
      limit: 500,
    },
    { scenarioTag: TAG }
  );
  check(crossRepoRes, {
    "cross-project repo stats 200": (r) => r.status === 200,
  });

  sleep(0.5);

  // 7. Cross-project: Flaky tests (complex join)
  const { res: flakyRes } = postApi(
    "/api/report-builder/cross-project-flaky-tests",
    {
      projectIds,
      dimensions: [{ id: "project" }],
      metrics: [{ id: "flakyCount", aggregation: "sum" }],
      filters: {},
      limit: 500,
    },
    { scenarioTag: TAG }
  );
  check(flakyRes, {
    "cross-project flaky tests 200": (r) => r.status === 200,
  });

  sleep(0.5);

  // 8. Cross-project: User engagement
  const { res: engageRes } = postApi(
    "/api/report-builder/cross-project-user-engagement",
    {
      projectIds,
      dimensions: [{ id: "user" }],
      metrics: [{ id: "executionCount", aggregation: "sum" }],
      filters: {},
      limit: 100,
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
