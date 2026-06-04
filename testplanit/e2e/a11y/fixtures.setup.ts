import { test as setup, type APIRequestContext } from "@playwright/test";
import fs from "fs";
import path from "path";
import { ApiHelper } from "../fixtures/api.fixture";
import type { A11yFixtures } from "./routes";

/**
 * Seeds a single richly-populated project so the scan hits real list/detail
 * views instead of empty tables (empty tables hide most a11y issues). Resolved
 * IDs are written to .a11y-fixtures.json, which routes.ts path builders read.
 *
 * Runs in the Playwright "setup" project; the "a11y" scan project depends on
 * it. Uses the authenticated `request` context (admin storageState). We
 * instantiate ApiHelper directly and never call cleanup() — this data must
 * outlive the setup step so the scan can navigate to it.
 */

const FIXTURES_FILE = path.join(__dirname, ".a11y-fixtures.json");
const RESULTS_DIR = path.join(__dirname, "results");

setup("seed a11y fixture data", async ({ request, baseURL }) => {
  setup.setTimeout(180_000);
  const base = baseURL || "http://localhost:3002";
  const api = new ApiHelper(request, base);

  const userId = await api.getCurrentUserId();
  const stamp = Date.now();

  // Project + folders
  const projectId = await api.createProject(`A11y Audit ${stamp}`);
  const rootFolderId = await api.getRootFolderId(projectId);
  const folderId = await api.createFolder(
    projectId,
    "Authentication",
    rootFolderId
  );
  await api.createFolder(projectId, "Dashboard", rootFolderId);

  // Enough cases that the grid has real rows to render
  const caseNames = Array.from(
    { length: 14 },
    (_, i) => `A11y sample case ${i + 1}`
  );
  const caseIds = await api.createTestCasesBatch(
    projectId,
    folderId,
    caseNames
  );
  const caseId = caseIds[0];
  const caseId2 = caseIds[1];

  // Tag + link to a case so tag views are populated
  let tagId = 0;
  try {
    tagId = await api.createTag(`a11y-tag-${stamp}`);
    await api.addTagToTestCase(caseId, tagId);
  } catch {
    /* tagging is non-critical */
  }

  // Test run with cases + mixed statuses/results
  const runId = await api.createTestRun(projectId, `A11y sample run ${stamp}`);
  const trcIds = await api.addTestCasesToTestRun(runId, caseIds.slice(0, 8));
  const statusIds: number[] = [];
  for (const t of ["passed", "failed", "blocked"] as const) {
    try {
      statusIds.push(await api.getStatusId(t));
    } catch {
      /* status type may not be seeded */
    }
  }
  if (statusIds.length > 0) {
    for (let i = 0; i < trcIds.length; i++) {
      const statusId = statusIds[i % statusIds.length];
      await api.setTestRunCaseStatus(trcIds[i], statusId).catch(() => {});
      await api
        .createTestResult(runId, trcIds[i], statusId, {
          notes: `Result ${i + 1}`,
        })
        .catch(() => {});
    }
  }

  // Milestone + session
  let milestoneId = 0;
  let sessionId = 0;
  try {
    milestoneId = await api.createMilestone(
      projectId,
      `A11y milestone ${stamp}`,
      { isStarted: true }
    );
  } catch {
    /* non-critical */
  }
  try {
    sessionId = await api.createSession(
      projectId,
      `A11y session ${stamp}`,
      milestoneId ? { milestoneId } : undefined
    );
  } catch {
    /* non-critical */
  }

  // Dataset (drives the settings/datasets/[dataSetId] detail route).
  let datasetId: number | undefined;
  try {
    const resp = await request.post(`${base}/api/model/dataSet/create`, {
      data: {
        data: {
          name: `A11y dataset ${stamp}`,
          isShared: true,
          project: { connect: { id: projectId } },
          createdBy: { connect: { id: userId } },
        },
      },
    });
    if (resp.ok()) {
      datasetId = (await resp.json()).data.id;
    } else {
      console.warn(
        `[a11y] dataset create failed (${resp.status()}): ${await resp.text()}`
      );
    }
  } catch (e) {
    console.warn(`[a11y] dataset create threw: ${String(e)}`);
  }

  // Public share link for the case (best effort — drives /share/[shareKey])
  let shareKey: string | undefined = randomShareKey();
  try {
    const resp = await request.post(`${base}/api/model/shareLink/create`, {
      data: {
        data: {
          shareKey,
          entityType: "TEST_CASE",
          entityId: String(caseId),
          mode: "PUBLIC",
          isRevoked: false,
          isDeleted: false,
          createdBy: { connect: { id: userId } },
          project: { connect: { id: projectId } },
        },
      },
    });
    if (!resp.ok()) {
      console.warn(
        `[a11y] share link create failed (${resp.status()}): ${await resp.text()}`
      );
      shareKey = undefined;
    }
  } catch (e) {
    console.warn(`[a11y] share link create threw: ${String(e)}`);
    shareKey = undefined;
  }

  const fixtures: A11yFixtures = {
    projectId,
    caseId,
    caseId2,
    version: 1,
    runId,
    sessionId,
    milestoneId,
    folderId,
    tagId,
    userId,
    shareKey,
    datasetId,
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(FIXTURES_FILE, JSON.stringify(fixtures, null, 2));
  console.log(`[a11y] fixtures written: ${JSON.stringify(fixtures)}`);

  // Populate Elasticsearch so search-driven UI has results. Best effort: the
  // grids render from Postgres regardless, so a slow/absent ES never blocks.
  await reindexAndWait(request, base);
});

function randomShareKey(): string {
  // 40 hex chars — within ShareLink's @length(32, 64) constraint.
  const chars = "0123456789abcdef";
  let key = "";
  for (let i = 0; i < 40; i++)
    key += chars[Math.floor(Math.random() * chars.length)];
  return key;
}

async function reindexAndWait(
  request: APIRequestContext,
  base: string
): Promise<void> {
  try {
    const enqueue = await request.post(
      `${base}/api/admin/elasticsearch/reindex`,
      {
        data: { entityType: "all" },
      }
    );
    console.log(`[a11y] reindex enqueue: ${enqueue.status()}`);
    if (!enqueue.ok()) return;

    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const status = await request.get(
        `${base}/api/admin/elasticsearch/reindex`
      );
      if (status.ok()) {
        const json = await status.json();
        const cases = (json.indices || []).find((i: { name: string }) =>
          /repository-cases/.test(i.name)
        );
        if (cases && cases.docs > 0) {
          console.log(
            `[a11y] ES reindex populated repository-cases (${cases.docs} docs)`
          );
          return;
        }
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    console.log(
      "[a11y] ES reindex did not confirm doc count within timeout — continuing"
    );
  } catch (e) {
    console.warn(`[a11y] reindex step skipped: ${String(e)}`);
  }
}
