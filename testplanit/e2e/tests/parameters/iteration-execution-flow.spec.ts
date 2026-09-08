import { materializeIterations } from "~/lib/services/iterationFanOut";
import { createRawDbClient } from "~/lib/rawDbClient";
import { expect, test } from "../../fixtures/index";

/**
 * Full parameterized-run execution loop, driven through the UI.
 *
 * The iteration data model, fan-out, per-iteration submission, override dialog,
 * and bulk-skip dialog each have unit/integration coverage, and INT-04 covers
 * the outbound-webhook round-trip — but nothing drives a real user through the
 * run *execution surface* end to end. This spec closes that gap and, in doing
 * so, guards the fix that made it possible: the result panel now refreshes
 * consumers in the background instead of blocking the Pass button on a
 * page-wide refetch, so recording iterations back-to-back no longer stalls.
 *
 *   1. Seed a parameterized case (1 param `env`) + a 3-row inline dataset + a
 *      run, and materialize its iterations exactly as the fan-out worker would
 *      (raw db — the policy layer rejects iteration writes from the admin
 *      session for an in-flight project; same rationale as INT-04).
 *   2. Open the run's execution sheet and, per iteration:
 *        - Iteration 1 (env=qa)      → record a Pass.
 *        - Iteration 2 (env=staging) → OVERRIDE the value, then record a Pass.
 *        - Iteration 3 (env=prod)    → SKIP (bulk-confirm dialog, one row).
 *   3. Assert each iteration's persisted result (status + override value) and
 *      that the parameter rolls up into the Iteration Matrix CSV export.
 *
 * Each step gates on the DB reaching the expected state before the next UI
 * action rather than trusting transient UI, and navigation retries the sidebar
 * click until the values strip reflects the target iteration.
 *
 * Required env: E2E_PROD=on. Exercised by the full
 * `pnpm build && E2E_PROD=on pnpm test:e2e` chain, not per-task unit runs.
 */

const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Parameterized run — UI execution loop (record / override / skip)", () => {
  let projectId: number;
  let db: ReturnType<typeof createRawDbClient>;
  let repositoryCaseId: number;
  let testRunId: number;
  let testRunCaseId: number;
  let skipStatusId: number;

  test.beforeAll(async ({ api }) => {
    test.setTimeout(120_000);
    projectId = await api.createProject(`E2E Iter-Exec ${uniqueId}`);
    db = createRawDbClient();

    // The execution panel's Pass button is gated on the project having a
    // Test-Run *success* status, and the bulk-skip dialog needs a *non-success*
    // one. createProject assigns the default statuses to the project, but that
    // link can lag the create response — poll (with the exact scoping both
    // surfaces query) until both exist before seeding the run, so the page
    // isn't opened before its statuses do. Winning or losing this race is what
    // otherwise makes the panel flaky.
    const successStatusFor = () =>
      db.status.findFirst({
        where: {
          isSuccess: true,
          isEnabled: true,
          isDeleted: false,
          projects: { some: { projectId } },
          scope: { some: { scope: { name: "Test Run" } } },
        },
        select: { id: true },
      });
    // "Skipped" specifically — a terminal non-success outcome the bulk-skip
    // dialog accepts. (An "untested"/not-run status is not a valid skip
    // target, so the generic "first non-success status" won't do.)
    const skippedStatusFor = () =>
      db.status.findFirst({
        where: {
          systemName: "skipped",
          isEnabled: true,
          isDeleted: false,
          projects: { some: { projectId } },
          scope: { some: { scope: { name: "Test Run" } } },
        },
        select: { id: true },
      });
    await expect
      .poll(
        async () => {
          const [success, skipped] = await Promise.all([
            successStatusFor(),
            skippedStatusFor(),
          ]);
          if (skipped) skipStatusId = skipped.id;
          return success != null && skipped != null;
        },
        { timeout: 30_000, intervals: [500] }
      )
      .toBe(true);

    const project = await db.projects.findUniqueOrThrow({
      where: { id: projectId },
      select: {
        id: true,
        createdBy: true,
        repositories: { select: { id: true }, take: 1 },
      },
    });
    const repo = project.repositories[0];
    if (!repo) throw new Error("seed: project missing repository");

    const folder = await db.repositoryFolders.create({
      data: {
        name: `iter-exec-${uniqueId}`,
        repositoryId: repo.id,
        projectId,
        creatorId: project.createdBy,
      },
      select: { id: true },
    });
    const template = await db.templates.findFirstOrThrow({
      select: { id: true },
    });
    const state = await db.workflows.findFirstOrThrow({ select: { id: true } });

    const testCase = await db.repositoryCases.create({
      data: {
        projectId,
        repositoryId: repo.id,
        folderId: folder.id,
        templateId: template.id,
        name: `Iter-Exec case ${uniqueId}`,
        stateId: state.id,
        creatorId: project.createdBy,
        hasParameters: true,
        currentVersion: 1,
      },
      select: { id: true },
    });
    repositoryCaseId = testCase.id;

    await db.testCaseParameter.createMany({
      data: [
        {
          testCaseId: testCase.id,
          name: "env",
          type: "STRING",
          sensitive: false,
          required: true,
          order: 0,
        },
      ],
    });
    const dataset = await db.dataSet.create({
      data: {
        name: `iter-exec-ds-${uniqueId}`,
        ownerCaseId: testCase.id,
        projectId,
        createdById: project.createdBy,
      },
      select: { id: true },
    });
    await db.dataSetRow.createMany({
      data: [
        {
          dataSetId: dataset.id,
          rowIndex: 0,
          label: "qa",
          valuesJson: { env: "qa" },
        },
        {
          dataSetId: dataset.id,
          rowIndex: 1,
          label: "staging",
          valuesJson: { env: "staging" },
        },
        {
          dataSetId: dataset.id,
          rowIndex: 2,
          label: "prod",
          valuesJson: { env: "prod" },
        },
      ],
    });

    const testRun = await db.testRuns.create({
      data: {
        name: `iter-exec-run-${uniqueId}`,
        projectId,
        stateId: state.id,
        createdById: project.createdBy,
        testRunType: "REGULAR",
      },
      select: { id: true },
    });
    testRunId = testRun.id;
    const testRunCase = await db.testRunCases.create({
      data: { testRunId: testRun.id, repositoryCaseId: testCase.id, order: 0 },
      select: { id: true },
    });
    testRunCaseId = testRunCase.id;

    await materializeIterations(testRunId, db);

    const iters = await db.testRunCaseIteration.findMany({
      where: { testRunCaseId },
      orderBy: { rowIndex: "asc" },
      select: { id: true },
    });
    expect(iters).toHaveLength(3);
  });

  test.afterAll(async () => {
    if (db) await db.$disconnect();
  });

  test("pass iteration 1, override + pass iteration 2, skip iteration 3 — all persist and roll up into the matrix", async ({
    page,
    baseURL,
    request,
  }) => {
    test.setTimeout(180_000);
    const strip = page.getByTestId("iteration-values-strip");
    const passButton = page.getByTestId("iteration-pass-and-next-button");

    const iterationRow = (rowIndex: number) =>
      db.testRunCaseIteration.findFirst({
        where: { testRunCaseId, rowIndex },
        select: {
          isCompleted: true,
          valuesJson: true,
          status: { select: { isSuccess: true } },
        },
      });
    const pollRow = (
      rowIndex: number,
      predicate: (r: Awaited<ReturnType<typeof iterationRow>>) => boolean
    ) =>
      expect
        .poll(async () => predicate(await iterationRow(rowIndex)), {
          timeout: 20_000,
          intervals: [750],
        })
        .toBe(true);

    const recordPass = async () => {
      await expect(passButton).toBeEnabled({ timeout: 30_000 });
      await passButton.click();
    };
    // Activating a row is a URL-param switch that an in-flight refetch can
    // revert — retry the click until the values strip reflects the target.
    const activateIteration = async (rowIndex: number, expectValue: string) => {
      await expect(async () => {
        await page.getByTestId(`iteration-row-${rowIndex}`).click();
        await expect(strip).toContainText(expectValue, { timeout: 3_000 });
      }).toPass({ timeout: 30_000 });
    };

    await test.step("Open the run's execution sheet on the parameterized case", async () => {
      await page.goto(
        `${baseURL}/en-US/projects/runs/${projectId}/${testRunId}?selectedCase=${repositoryCaseId}`
      );
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("iteration-sidebar")).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        page
          .getByTestId("iteration-sidebar-list")
          .getByTestId("iteration-status-pip")
      ).toHaveCount(3);
    });

    await test.step("Iteration 1 (qa) — record a Pass", async () => {
      await expect(strip).toContainText("qa", { timeout: 20_000 });
      await recordPass();
      await pollRow(
        0,
        (r) => r?.isCompleted === true && r?.status?.isSuccess === true
      );
    });

    await test.step("Iteration 2 (staging) — override the value, then record a Pass", async () => {
      await activateIteration(1, "staging");
      await page.getByTestId("iteration-header-menu-trigger").click();
      await page.getByTestId("iteration-header-menu-override-values").click();
      await expect(page.getByTestId("override-values-dialog")).toBeVisible();
      await page.getByTestId("override-field-env").fill("staging-override");
      await page.getByTestId("override-values-save").click();
      await expect(page.getByTestId("override-values-dialog")).toBeHidden();
      await pollRow(
        1,
        (r) =>
          (r?.valuesJson as { env?: string } | null)?.env === "staging-override"
      );

      await recordPass();
      await pollRow(
        1,
        (r) => r?.isCompleted === true && r?.status?.isSuccess === true
      );
    });

    await test.step("Iteration 3 (prod) — skip via the bulk-confirm dialog", async () => {
      await activateIteration(2, "prod");
      await page.getByTestId("iteration-header-menu-trigger").click();
      await page.getByTestId("iteration-header-menu-skip").click();
      await expect(
        page.getByTestId("iteration-bulk-confirm-dialog")
      ).toBeVisible();
      // Confirm is disabled until a status is chosen (bulk-skip records a
      // non-success status against the iteration).
      await page.getByTestId("iteration-bulk-status-trigger").click();
      await page.getByTestId(`iteration-bulk-status-${skipStatusId}`).click();
      await page.getByTestId("iteration-bulk-confirm").click();
      await expect(
        page.getByTestId("iteration-bulk-confirm-dialog")
      ).toBeHidden();
      await pollRow(
        2,
        (r) => r?.isCompleted === true && r?.status?.isSuccess === false
      );
    });

    await test.step("Assert the final persisted state of all three iterations", async () => {
      const rows = await db.testRunCaseIteration.findMany({
        where: { testRunCaseId },
        orderBy: { rowIndex: "asc" },
        select: {
          rowIndex: true,
          valuesJson: true,
          isCompleted: true,
          status: { select: { isSuccess: true } },
        },
      });
      expect(
        rows.map((r) => ({
          rowIndex: r.rowIndex,
          completed: r.isCompleted,
          success: r.status?.isSuccess ?? null,
          env: (r.valuesJson as { env?: string } | null)?.env ?? null,
        }))
      ).toEqual([
        { rowIndex: 0, completed: true, success: true, env: "qa" },
        {
          rowIndex: 1,
          completed: true,
          success: true,
          env: "staging-override",
        },
        { rowIndex: 2, completed: true, success: false, env: "prod" },
      ]);
    });

    await test.step("Assert the parameter rolls up into the Iteration Matrix CSV export", async () => {
      const exportRes = await request.get(
        `${baseURL}/api/projects/${projectId}/matrix/export`
      );
      expect(exportRes.status()).toBe(200);
      expect(exportRes.headers()["content-type"]).toBe(
        "text/csv; charset=utf-8"
      );
      const csv = await exportRes.text();
      expect(csv).toContain("env");
    });
  });
});
