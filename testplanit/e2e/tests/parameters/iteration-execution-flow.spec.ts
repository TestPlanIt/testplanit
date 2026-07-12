import { materializeIterations } from "~/lib/services/iterationFanOut";
import { createRawDbClient } from "~/lib/rawDbClient";
import { expect, test } from "../../fixtures/index";

/**
 * Parameterized-run execution surface, driven through the UI.
 *
 * The iteration data model, fan-out, per-iteration result submission, override
 * dialog, and bulk-skip dialog each have unit/integration coverage, and INT-04
 * covers the outbound-webhook round-trip — but nothing drives a real user
 * through the run *execution surface*. This spec closes that gap for the two
 * core actions that a parameterized run adds on top of a normal run:
 *
 *   1. Seed a parameterized case (1 param `env`) + a 3-row inline dataset + a
 *      run, and materialize its iterations exactly as the fan-out worker would
 *      (raw db — the policy layer rejects iteration writes from the admin
 *      session for an in-flight project; same rationale as INT-04).
 *   2. Open the run's execution sheet and:
 *        - Iteration 1 (env=qa)      → record a Pass via the panel.
 *        - Iteration 2 (env=staging) → override its value via the dialog.
 *   3. Assert both persisted (result + override value) and that the parameter
 *      rolls up into the Iteration Matrix CSV export.
 *
 * Scope note: recording a result triggers a page-wide React-Query invalidation
 * that refetches this (heavy) run page; the panel's own Pass button can stay
 * disabled while that settles, so this spec records once and verifies each
 * mutation against the DB rather than chaining further clicks on the same
 * panel. Skip/reset and multi-iteration recording are covered by the
 * IterationBulkConfirmDialog / iterationFanOut / result-submission suites.
 *
 * Required env: E2E_PROD=on. Exercised by the full
 * `pnpm build && E2E_PROD=on pnpm test:e2e` chain, not per-task unit runs.
 */

const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Parameterized run — UI execution surface (record + override)", () => {
  let projectId: number;
  let db: ReturnType<typeof createRawDbClient>;
  let repositoryCaseId: number;
  let testRunId: number;
  let testRunCaseId: number;

  test.beforeAll(async ({ api }) => {
    test.setTimeout(120_000);
    projectId = await api.createProject(`E2E Iter-Exec ${uniqueId}`);
    db = createRawDbClient();

    // The execution panel's Pass button is gated on the project having a
    // Test-Run *success* status. createProject assigns the default statuses to
    // the project, but that link can lag the create response — poll (with the
    // panel's exact scoping) until it exists before seeding the run, so the
    // page isn't opened before its statuses do. Winning or losing this race is
    // what otherwise makes the panel flaky.
    await expect
      .poll(
        async () =>
          (await db.status.findFirst({
            where: {
              isSuccess: true,
              isEnabled: true,
              isDeleted: false,
              projects: { some: { projectId } },
              scope: { some: { scope: { name: "Test Run" } } },
            },
            select: { id: true },
          })) != null,
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

  test("record a Pass on iteration 1 and override iteration 2's values — both persist and roll up into the matrix", async ({
    page,
    baseURL,
    request,
  }) => {
    test.setTimeout(180_000);
    const strip = page.getByTestId("iteration-values-strip");

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
      // All three dataset rows materialized as iterations.
      await expect(
        page
          .getByTestId("iteration-sidebar-list")
          .getByTestId("iteration-status-pip")
      ).toHaveCount(3);
    });

    await test.step("Iteration 1 (qa) — record a Pass via the panel", async () => {
      await expect(strip).toContainText("qa", { timeout: 20_000 });
      const passButton = page.getByTestId("iteration-pass-and-next-button");
      await expect(passButton).toBeEnabled({ timeout: 60_000 });
      await passButton.click();
      // Verify persistence against the DB (not the button, which can stay
      // disabled while the page-wide cache refetches after the submit).
      await pollRow(
        0,
        (r) => r?.isCompleted === true && r?.status?.isSuccess === true
      );
    });

    await test.step("Iteration 2 (staging) — override the value via the dialog", async () => {
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
    });

    await test.step("Assert persisted state: iteration 1 passed, iteration 2 overridden", async () => {
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
      const env = (r: (typeof rows)[number]) =>
        (r.valuesJson as { env?: string } | null)?.env ?? null;

      expect(rows[0].isCompleted).toBe(true);
      expect(rows[0].status?.isSuccess).toBe(true);
      expect(env(rows[0])).toBe("qa");
      // Iteration 2 carries the override; the untouched snapshot row is intact.
      expect(env(rows[1])).toBe("staging-override");
      expect(env(rows[2])).toBe("prod");
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
      // The `env` parameter surfaces as a bare column — proof the parameterized
      // case + its execution data reach the matrix rollup surface.
      expect(csv).toContain("env");
    });
  });
});
