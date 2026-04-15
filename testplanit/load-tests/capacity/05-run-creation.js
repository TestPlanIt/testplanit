/**
 * Capacity Test 05: Test Run Creation with Many Cases
 *
 * Answers: "How long does it take to create a test run containing
 * N test cases?"
 *
 * For each run size (10, 50, 100, 500, 1000, 5000), creates a test
 * run and attaches that many cases, measuring total elapsed time.
 * Reports scaling behavior — is it linear? Does it hit a cliff?
 *
 * Run: k6 run --env BASE_URL=... --env API_TOKEN=... --env TIER=medium capacity/05-run-creation.js
 */

import { sleep, check } from "k6";
import { Trend } from "k6/metrics";
import { findMany, create } from "../helpers/api.js";
import { uniqueId } from "../helpers/data.js";
import { PROJECT_ID } from "../config.js";
import { makeSummaryWriter } from "./helpers/summary.js";

const TIER = __ENV.TIER || "medium";
const TEST_ID = "05-run-creation";

const RUN_SIZES = [10, 50, 100, 500, 1000];
// Large size (5000) only for 'large' tier to keep small/medium runs fast
if (TIER === "large") RUN_SIZES.push(5000);

// One trend per run size for clean per-size latency stats
const trends = {};
for (const size of RUN_SIZES) {
  trends[size] = new Trend(`run_creation_${size}_cases_ms`);
}

export const options = {
  scenarios: {
    run_creation: {
      executor: "per-vu-iterations",
      vus: 1,
      iterations: 5, // 5 repetitions of the full size matrix
      maxDuration: "60m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
  },
};

export function setup() {
  const cases = findMany(
    "repositoryCases",
    {
      where: { projectId: PROJECT_ID, isDeleted: false },
      select: { id: true },
      take: 10000,
    },
    {}
  );
  const statuses = findMany(
    "status",
    {
      where: { isDeleted: false, isEnabled: true },
      select: { id: true, isSuccess: true },
    },
    {}
  );
  const workflows = findMany(
    "workflows",
    {
      where: { isDeleted: false, isDefault: true, scope: "RUNS" },
      select: { id: true },
      take: 1,
    },
    {}
  );

  const defaultStatus =
    statuses?.data?.find((s) => !s.isSuccess) || statuses?.data?.[0];
  const runStateId = workflows?.data?.[0]?.id;

  if (!cases?.data?.length || !defaultStatus || !runStateId) {
    throw new Error("Missing seed data for run creation test");
  }

  return {
    caseIds: cases.data.map((c) => c.id),
    defaultStatusId: defaultStatus.id,
    runStateId,
  };
}

export default function runCreation(ctx) {
  for (const size of RUN_SIZES) {
    if (size > ctx.caseIds.length) {
      console.warn(
        `Skipping size=${size}: only ${ctx.caseIds.length} cases available`
      );
      continue;
    }

    const start = Date.now();

    // 1. Create the test run
    const testRun = create(
      "testRuns",
      {
        name: `Capacity Run ${size} cases ${uniqueId()}`,
        isCompleted: false,
        isDeleted: false,
        testRunType: "REGULAR",
        project: { connect: { id: PROJECT_ID } },
        state: { connect: { id: ctx.runStateId } },
      },
      { scenarioTag: "run_create" }
    );
    const testRunId = testRun?.data?.id;
    if (!testRunId) {
      console.error(`Failed to create run for size=${size}`);
      continue;
    }

    // 2. Attach N cases
    const shuffled = [...ctx.caseIds].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, size);
    let attached = 0;

    for (let i = 0; i < selected.length; i++) {
      const trc = create(
        "testRunCases",
        {
          order: i + 1,
          isCompleted: false,
          testRun: { connect: { id: testRunId } },
          repositoryCase: { connect: { id: selected[i] } },
          status: { connect: { id: ctx.defaultStatusId } },
        },
        { scenarioTag: "run_create" }
      );
      if (trc?.data?.id) attached++;

      // Brief pause every 50 cases to avoid local queue buildup
      if (i > 0 && i % 50 === 0) sleep(0.05);
    }

    const duration = Date.now() - start;
    trends[size].add(duration);
    check(null, {
      [`run_creation_${size}_attached_all`]: () => attached === size,
    });
    console.log(
      `size=${size}: ${duration}ms total (${attached}/${size} attached)`
    );

    sleep(1); // gap between sizes
  }
}

export const handleSummary = makeSummaryWriter(TEST_ID, TIER);
