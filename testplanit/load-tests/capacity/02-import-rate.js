/**
 * Capacity Test 02: Test Case Import Rate
 *
 * Answers: "How many test cases per second can we create before
 * the server falls behind or errors spike?"
 *
 * Ramps request rate, each iteration creates a single test case.
 * Uses constant-arrival-rate executor to control requests/sec
 * independently of response latency.
 *
 * Run: k6 run --env BASE_URL=... --env API_TOKEN=... --env TIER=medium capacity/02-import-rate.js
 */

import { check } from "k6";
import { Trend } from "k6/metrics";
import { findMany, create } from "../helpers/api.js";
import { testCaseName } from "../helpers/data.js";
import { PROJECT_ID } from "../config.js";
import { makeSummaryWriter } from "./helpers/summary.js";

const TIER = __ENV.TIER || "medium";
const TEST_ID = "02-import-rate";

const createLatency = new Trend("case_create_latency_ms");

export const options = {
  scenarios: {
    ramp: {
      executor: "ramping-arrival-rate",
      startRate: 10,
      timeUnit: "1s",
      preAllocatedVUs: 50,
      maxVUs: 500,
      stages: [
        { duration: "1m", target: 20 }, // 20 creates/s
        { duration: "2m", target: 50 }, // 50 creates/s
        { duration: "2m", target: 100 }, // 100 creates/s
        { duration: "2m", target: 200 }, // 200 creates/s
        { duration: "2m", target: 400 }, // 400 creates/s (stress)
        { duration: "2m", target: 800 }, // 800 creates/s (break)
        { duration: "1m", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    case_create_latency_ms: ["p(95)<3000"],
  },
};

// Shared setup — grab a folder, template, workflow, repo ID once
export function setup() {
  const opts = {};
  const folders = findMany(
    "repositoryFolders",
    {
      where: { projectId: PROJECT_ID, isDeleted: false },
      select: { id: true },
      take: 10,
    },
    opts
  );
  const repos = findMany(
    "repositories",
    {
      where: { projectId: PROJECT_ID, isDeleted: false },
      select: { id: true },
      take: 1,
    },
    opts
  );
  const templates = findMany(
    "templates",
    { where: { isDefault: true }, select: { id: true }, take: 1 },
    opts
  );
  const workflows = findMany(
    "workflows",
    {
      where: { isDeleted: false, isDefault: true, scope: "CASES" },
      select: { id: true },
      take: 1,
    },
    opts
  );

  return {
    folderIds: folders?.data?.map((f) => f.id) || [],
    repoId: repos?.data?.[0]?.id,
    templateId: templates?.data?.[0]?.id,
    stateId: workflows?.data?.[0]?.id,
  };
}

export default function importRate(ctx) {
  if (!ctx.folderIds.length || !ctx.repoId || !ctx.templateId || !ctx.stateId) {
    return;
  }

  const folderId =
    ctx.folderIds[Math.floor(Math.random() * ctx.folderIds.length)];

  const start = Date.now();
  const res = create(
    "repositoryCases",
    {
      name: testCaseName(),
      automated: false,
      isDeleted: false,
      project: { connect: { id: PROJECT_ID } },
      folder: { connect: { id: folderId } },
      repository: { connect: { id: ctx.repoId } },
      template: { connect: { id: ctx.templateId } },
      state: { connect: { id: ctx.stateId } },
    },
    { scenarioTag: "import" }
  );
  createLatency.add(Date.now() - start);

  check(res, {
    "case created": (r) => r?.data?.id != null,
  });
}

export const handleSummary = makeSummaryWriter(TEST_ID, TIER);
