/**
 * Capacity Test 04: Report Generation Time
 *
 * Answers: "How long does each type of report take to generate?"
 *
 * Single VU runs each report type sequentially to measure clean
 * latency per report without concurrency effects. Captures p50/p95/max
 * per report type so we can answer "this report takes X seconds."
 *
 * Run: k6 run --env BASE_URL=... --env API_TOKEN=... --env TIER=medium capacity/04-report-generation.js
 */

import { sleep, check } from "k6";
import { Trend } from "k6/metrics";
import { postApi } from "../helpers/api.js";
import { PROJECT_ID } from "../config.js";
import { makeSummaryWriter } from "./helpers/summary.js";

const TIER = __ENV.TIER || "medium";
const TEST_ID = "04-report-generation";

// One Trend per report type so we get per-report latency stats
const reports = [
  {
    name: "test-execution",
    path: "/api/report-builder/test-execution",
    body: {
      reportType: "test-execution",
      projectId: PROJECT_ID,
      dimensions: ["status"],
      metrics: ["testResults"],
    },
  },
  {
    name: "test-case-health",
    path: "/api/report-builder/test-case-health",
    body: {
      reportType: "test-case-health",
      projectId: PROJECT_ID,
      dimensions: [],
      metrics: [],
    },
  },
  {
    name: "automation-trends",
    path: "/api/report-builder/automation-trends",
    body: {
      reportType: "automation-trends",
      projectId: PROJECT_ID,
      dimensions: [],
      metrics: [],
    },
  },
  {
    name: "flaky-tests",
    path: "/api/report-builder/flaky-tests",
    body: {
      reportType: "flaky-tests",
      projectId: PROJECT_ID,
      dimensions: [],
      metrics: [],
    },
  },
  {
    name: "cross-test-execution",
    path: "/api/report-builder/cross-project-test-execution",
    body: {
      reportType: "cross-project-test-execution",
      dimensions: ["project", "status"],
      metrics: ["testResults"],
    },
  },
  {
    name: "cross-test-case-health",
    path: "/api/report-builder/cross-project-test-case-health",
    body: {
      reportType: "cross-project-test-case-health",
      dimensions: [],
      metrics: [],
    },
  },
  {
    name: "cross-flaky-tests",
    path: "/api/report-builder/cross-project-flaky-tests",
    body: {
      reportType: "cross-project-flaky-tests",
      dimensions: [],
      metrics: [],
    },
  },
  {
    name: "cross-user-engagement",
    path: "/api/report-builder/cross-project-user-engagement",
    body: {
      reportType: "cross-project-user-engagement",
      dimensions: ["user"],
      metrics: ["executionCount"],
    },
  },
  // Custom/user-defined reports with multiple dimensions (more complex query)
  {
    name: "custom-multi-dim",
    path: "/api/report-builder/test-execution",
    body: {
      reportType: "test-execution",
      projectId: PROJECT_ID,
      dimensions: ["status", "user", "testCase"],
      metrics: ["testResults", "avgElapsedTime"],
    },
  },
];

const trends = {};
for (const r of reports)
  trends[r.name] = new Trend(`report_${r.name.replace(/-/g, "_")}_ms`);

export const options = {
  // Fixed 1 VU, 50 iterations — each run hits every report once
  scenarios: {
    report_latency: {
      executor: "per-vu-iterations",
      vus: 1,
      iterations: 50,
      maxDuration: "30m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
  },
};

export default function reportGeneration() {
  for (const report of reports) {
    const start = Date.now();
    const { res } = postApi(report.path, report.body, {
      scenarioTag: "reporting",
    });
    const duration = Date.now() - start;
    trends[report.name].add(duration);
    check(res, {
      [`${report.name} status 200`]: (r) => r.status === 200,
    });
    sleep(0.2); // brief pause between reports
  }
  sleep(1);
}

export const handleSummary = makeSummaryWriter(TEST_ID, TIER);
