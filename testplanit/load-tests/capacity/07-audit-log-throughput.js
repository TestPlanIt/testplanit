/**
 * Capacity Test 07: Audit Log Write Throughput Under Activity
 *
 * Answers: "Does the audit log become a bottleneck under heavy
 * activity?"
 *
 * DORA compliance means every mutation produces an audit entry.
 * At scale, audit log writes can exhaust the BullMQ queue or slow
 * down mutations. This test drives sustained mutation traffic
 * (creates/updates) and checks that audit processing keeps up.
 *
 * Metrics:
 *   - Mutation latency (does it degrade as audit queue grows?)
 *   - Audit log row count growth rate vs mutation rate
 *
 * Note: audit queue size isn't exposed via a public endpoint, so we
 * approximate by checking the rate of new auditLog rows written.
 *
 * Run: k6 run --env BASE_URL=... --env API_TOKEN=... --env TIER=medium capacity/07-audit-log-throughput.js
 */

import { sleep, check } from "k6";
import { Trend, Counter } from "k6/metrics";
import { findMany, create, update } from "../helpers/api.js";
import { testCaseName } from "../helpers/data.js";
import { PROJECT_ID } from "../config.js";
import { makeSummaryWriter } from "./helpers/summary.js";

const TIER = __ENV.TIER || "medium";
const TEST_ID = "07-audit-log-throughput";

const mutationLatency = new Trend("mutation_latency_ms");
const auditLogCount = new Trend("audit_log_total_rows");
const mutations = new Counter("mutations_submitted");

export const options = {
  scenarios: {
    mutations: {
      // Sustained high mutation rate
      executor: "constant-arrival-rate",
      rate: 100, // 100 mutations/second
      timeUnit: "1s",
      duration: "5m",
      preAllocatedVUs: 50,
      maxVUs: 200,
      exec: "doMutation",
    },
    audit_polling: {
      // Separately poll audit log size every 10 seconds
      executor: "constant-vus",
      vus: 1,
      duration: "5m",
      exec: "pollAuditLog",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    mutation_latency_ms: [
      "p(95)<2000", // mutations should stay fast even under sustained load
    ],
  },
};

export function setup() {
  const folders = findMany(
    "repositoryFolders",
    { where: { projectId: PROJECT_ID, isDeleted: false }, select: { id: true }, take: 10 },
    {}
  );
  const cases = findMany(
    "repositoryCases",
    { where: { projectId: PROJECT_ID, isDeleted: false }, select: { id: true }, take: 500 },
    {}
  );
  const repos = findMany(
    "repositories",
    { where: { projectId: PROJECT_ID, isDeleted: false }, select: { id: true }, take: 1 },
    {}
  );
  const templates = findMany(
    "templates",
    { where: { isDefault: true }, select: { id: true }, take: 1 },
    {}
  );
  const workflows = findMany(
    "workflows",
    { where: { isDeleted: false, isDefault: true, scope: "CASES" }, select: { id: true }, take: 1 },
    {}
  );

  return {
    folderIds: folders?.data?.map((f) => f.id) || [],
    existingCaseIds: cases?.data?.map((c) => c.id) || [],
    repoId: repos?.data?.[0]?.id,
    templateId: templates?.data?.[0]?.id,
    stateId: workflows?.data?.[0]?.id,
  };
}

export function doMutation(ctx) {
  if (!ctx.folderIds.length) return;

  const rand = Math.random();
  const start = Date.now();

  if (rand < 0.6 || ctx.existingCaseIds.length === 0) {
    // CREATE
    const folderId = ctx.folderIds[Math.floor(Math.random() * ctx.folderIds.length)];
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
      { scenarioTag: "audit_mutation" }
    );
    check(res, { "create ok": (r) => r?.data?.id != null });
  } else {
    // UPDATE
    const caseId = ctx.existingCaseIds[Math.floor(Math.random() * ctx.existingCaseIds.length)];
    const res = update(
      "repositoryCases",
      caseId,
      { name: `${testCaseName()} [AUDIT-TEST]` },
      { scenarioTag: "audit_mutation" }
    );
    check(res, { "update ok": (r) => r?.data?.id != null });
  }

  mutations.add(1);
  mutationLatency.add(Date.now() - start);
}

export function pollAuditLog() {
  // Count rows in auditLog to track throughput. Poll every 10s to watch the
  // queue fill up as mutations accumulate.
  const countRes = findMany(
    "auditLog",
    { where: { projectId: PROJECT_ID }, select: { id: true } },
    { scenarioTag: "audit_poll" }
  );
  const total = countRes?.data?.length ?? 0;
  auditLogCount.add(total);
  sleep(10);
}

export const handleSummary = makeSummaryWriter(TEST_ID, TIER);
