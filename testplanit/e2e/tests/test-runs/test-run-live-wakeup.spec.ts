import type { Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import type { ApiHelper } from "../../fixtures/api.fixture";

/**
 * Runs-list live wake-up E2E.
 *
 * Covers the chain nothing else does: a result lands → the emitter publishes
 * a wake-up → Valkey → the project SSE stream → the list page invalidates →
 * the tile refetches. Unit tests cover the pieces (the coalescing window in
 * hooks/useCoalescedWakeUp.test.ts, the query-key layout in
 * wakeUpInvalidation.test.ts); only this proves they are wired together.
 *
 * Two properties, and they pull against each other — which is why they are
 * asserted together:
 *
 *   1. The run that changed DOES refetch. A predicate that matches nothing
 *      would leave every tile silently stale with all unit tests green.
 *   2. The runs that didn't change DON'T. The list holds one TestRunCases
 *      query per mounted tile, so a bare-prefix invalidation turned one
 *      result into a refetch per tile.
 *
 * Both are read off the network rather than the DOM: the tile's contributor
 * list is the only thing the narrowed query feeds, and it renders inside a
 * hover tooltip. Request volume is the behaviour under test anyway.
 *
 * NOTE: the shared `page` fixture stubs every SSE stream with 204 so
 * `networkidle` can settle (see fixtures/index.ts). This suite is about the
 * stream, so it puts the project run stream back — deliberately, and only
 * that one; the notification stream stays stubbed.
 */

/** Must match the pattern fixtures/index.ts registers, or unroute won't
 *  find the handler to remove. */
const PROJECT_RUN_STREAM = /\/api\/projects\/[^/]+\/test-runs\/stream/;

interface RunsFixture {
  projectId: number;
  runAId: number;
  runBId: number;
  caseAId: number;
  caseBId: number;
}

/**
 * Two in-progress runs in a dedicated project — dedicated because the
 * assertion counts requests, and seeded runs from other specs would add
 * tiles (and noise) to the same page. Both runs must be incomplete: the
 * stream is gated on `incompleteTestRuns.length > 0`.
 */
async function seedTwoRuns(
  api: ApiHelper,
  label: string
): Promise<RunsFixture> {
  const projectId = await api.createProject(`Wake-up ${label}`);
  const folderId = await api.getRootFolderId(projectId);

  const [repoCaseA, repoCaseB] = await Promise.all([
    api.createTestCase(projectId, folderId, `Wake-up case A ${label}`),
    api.createTestCase(projectId, folderId, `Wake-up case B ${label}`),
  ]);

  const [runAId, runBId] = await Promise.all([
    api.createTestRun(projectId, `Wake-up run A ${label}`),
    api.createTestRun(projectId, `Wake-up run B ${label}`),
  ]);

  const [caseAId, caseBId] = await Promise.all([
    api.addTestCaseToTestRun(runAId, repoCaseA),
    api.addTestCaseToTestRun(runBId, repoCaseB),
  ]);

  return { projectId, runAId, runBId, caseAId, caseBId };
}

/**
 * Record the run id behind every tile refetch.
 *
 * @zenstackhq/tanstack-query encodes the query args as `?q=<json>`, so the
 * run each request belongs to is read out exactly rather than sniffed from
 * the URL text.
 */
function trackTileFetches(page: Page): number[] {
  const runIds: number[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!url.includes("/api/model/testRunCases/findMany")) return;
    const q = new URL(url).searchParams.get("q");
    if (!q) return;
    try {
      const args = JSON.parse(q) as { where?: { testRunId?: unknown } };
      const runId = args.where?.testRunId;
      if (typeof runId === "number") runIds.push(runId);
    } catch {
      // A shape we can't attribute isn't evidence either way — the
      // assertions below count only what they can positively identify.
    }
  });
  return runIds;
}

/** Resolve once no new tile fetch has arrived for `quietMs`. Used to let the
 *  page's initial load settle before counting, and to let a wake-up's
 *  refetches finish arriving before asserting on the total. */
async function waitForFetchesToSettle(
  page: Page,
  fetches: number[],
  { quietMs = 1500, timeout = 20000 } = {}
): Promise<void> {
  const deadline = Date.now() + timeout;
  let lastCount = -1;
  let quietSince = Date.now();

  while (Date.now() < deadline) {
    if (fetches.length !== lastCount) {
      lastCount = fetches.length;
      quietSince = Date.now();
    } else if (Date.now() - quietSince >= quietMs) {
      return;
    }
    await page.waitForTimeout(100);
  }
}

/** Open the list page with the real project stream attached, and wait until
 *  the EventSource has actually connected — it's deferred to browser idle, so
 *  a result fired too early would publish into a stream nobody is on yet. */
async function openRunsList(page: Page, fixture: RunsFixture): Promise<void> {
  await page.unroute(PROJECT_RUN_STREAM);

  const streamConnected = page.waitForRequest(
    (request) => PROJECT_RUN_STREAM.test(request.url()),
    { timeout: 30000 }
  );
  await page.goto(`/en-US/projects/runs/${fixture.projectId}`);

  await expect(
    page.getByText(`Wake-up run A`, { exact: false }).first()
  ).toBeVisible({ timeout: 30000 });
  await streamConnected;
}

test.describe("Test run list live wake-up", () => {
  test("a result refetches the run it names, and leaves the other tiles alone", async ({
    page,
    api,
  }) => {
    const fixture = await seedTwoRuns(api, `narrow-${Date.now()}`);
    const passedStatusId = await api.getStatusId("passed");
    const fetches = trackTileFetches(page);

    await test.step("Open the runs list and let the initial tile loads settle", async () => {
      await openRunsList(page, fixture);
      await waitForFetchesToSettle(page, fetches);
      expect(
        fetches.length,
        "both tiles should have loaded before the wake-up"
      ).toBeGreaterThan(0);
      fetches.length = 0;
    });

    await test.step("Add a result to run A only", async () => {
      await api.createTestResult(
        fixture.runAId,
        fixture.caseAId,
        passedStatusId
      );
    });

    await test.step("Run A's tile refetches", async () => {
      await expect
        .poll(() => fetches.filter((id) => id === fixture.runAId).length, {
          message:
            "no refetch for the changed run — the wake-up never reached the tile",
          timeout: 25000,
        })
        .toBeGreaterThan(0);
    });

    await test.step("Run B's tile does not", async () => {
      // Settle first: asserting immediately would pass even if B's refetch
      // were merely a beat behind A's.
      await waitForFetchesToSettle(page, fetches);
      expect(
        fetches.filter((id) => id === fixture.runBId),
        "an unchanged run refetched — the invalidation is not narrowed"
      ).toHaveLength(0);
    });
  });

  test("a burst of results collapses into fewer refetches than results", async ({
    page,
    api,
  }) => {
    const fixture = await seedTwoRuns(api, `burst-${Date.now()}`);
    const passedStatusId = await api.getStatusId("passed");
    const fetches = trackTileFetches(page);
    // Results publish one wake-up each (sideEffectsPlugin emits per row), so
    // this is the reporter-streaming-a-suite shape in miniature.
    const BURST = 8;

    await test.step("Open the runs list and let the initial tile loads settle", async () => {
      await openRunsList(page, fixture);
      await waitForFetchesToSettle(page, fetches);
      fetches.length = 0;
    });

    await test.step(`Land ${BURST} results on run A at once`, async () => {
      await Promise.all(
        Array.from({ length: BURST }, () =>
          api.createTestResult(fixture.runAId, fixture.caseAId, passedStatusId)
        )
      );
    });

    await test.step("The tile refetches at least once, but not once per result", async () => {
      await expect
        .poll(() => fetches.filter((id) => id === fixture.runAId).length, {
          message: "the burst produced no refetch at all",
          timeout: 25000,
        })
        .toBeGreaterThan(0);
      await waitForFetchesToSettle(page, fetches);

      expect(
        fetches.filter((id) => id === fixture.runAId).length,
        `${BURST} results should not cost ${BURST} refetch rounds`
      ).toBeLessThan(BURST);
    });
  });
});
