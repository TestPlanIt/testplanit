import { expect, test } from "../../fixtures";

/**
 * Dependency gating (#645) — the user-facing half.
 *
 * The API-level rules live in dependency-gating.spec.ts. This spec proves
 * what a tester sees: the Blocked badge in the run table, the blocked notice
 * and disabled result entry in the execution panel, both clearing once the
 * prerequisite passes; the Depends on / Blocks labels on the Linked Cases
 * panel; the Blocks option in the Add Link dialog; and the project toggle.
 */
const sameOrigin = { "sec-fetch-site": "same-origin" };

test("blocked badge, panel notice and link direction labels", async ({
  api,
  request,
  baseURL,
  page,
}) => {
  const ts = Date.now();
  let projectId!: number;
  let runId!: number;
  let caseA!: number;
  let caseB!: number;
  let caseC!: number;
  let caseD!: number;
  let trcA!: number;
  let linkId!: number;
  let passedId!: number;

  await test.step("Seed a run where B depends on A, with enforcement on", async () => {
    projectId = await api.createProject(`E2E DepGateUI ${ts}`);
    const folderId = await api.createFolder(projectId, `DGU Folder ${ts}`);
    caseA = await api.createTestCase(projectId, folderId, `DGU A order ${ts}`);
    caseB = await api.createTestCase(
      projectId,
      folderId,
      `DGU B provisioning ${ts}`
    );
    caseC = await api.createTestCase(projectId, folderId, `DGU C ${ts}`);
    caseD = await api.createTestCase(projectId, folderId, `DGU D ${ts}`);
    const userId = await api.getCurrentUserId();
    const created = await request.post(
      `${baseURL}/api/model/repositoryCaseLink/create`,
      {
        headers: sameOrigin,
        data: {
          data: {
            caseA: { connect: { id: caseB } },
            caseB: { connect: { id: caseA } },
            type: "DEPENDS_ON",
            createdBy: { connect: { id: userId } },
          },
        },
      }
    );
    expect(created.ok(), await created.text()).toBe(true);
    linkId = (await created.json()).data.id;

    runId = await api.createTestRun(projectId, `DGU Run ${ts}`);
    trcA = await api.addTestCaseToTestRun(runId, caseA);
    await api.addTestCaseToTestRun(runId, caseB);
    passedId = await api.getStatusId("passed");

    const patched = await request.patch(
      `${baseURL}/api/model/projects/update`,
      {
        headers: sameOrigin,
        data: {
          where: { id: projectId },
          data: { enforceCaseDependencies: true },
        },
      }
    );
    expect(patched.ok(), await patched.text()).toBe(true);
  });

  await test.step("The project toggle reflects the setting", async () => {
    await page.goto(`/en-US/projects/settings/${projectId}/advanced`);
    await page.waitForLoadState("load");
    await expect(page.getByTestId("case-dependencies-toggle")).toHaveAttribute(
      "data-state",
      "checked",
      { timeout: 15000 }
    );
  });

  await test.step("The run table badges B as blocked and leaves A alone", async () => {
    await page.goto(`/en-US/projects/runs/${projectId}/${runId}`);
    await page.waitForLoadState("load");
    await expect(
      page.getByTestId(`testrun-status-cell-blocked-${caseB}`)
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByTestId(`testrun-status-cell-blocked-${caseA}`)
    ).toHaveCount(0);
  });

  await test.step("The execution panel for B shows the notice and disables Add Result", async () => {
    await page.goto(
      `/en-US/projects/runs/${projectId}/${runId}?selectedCase=${caseB}`
    );
    await page.waitForLoadState("load");
    const sheet = page.locator(".test-run-details-sheet");
    await expect(sheet).toBeVisible({ timeout: 15000 });
    const notice = page.getByTestId("run-case-dependency-notice");
    await expect(notice).toBeVisible({ timeout: 15000 });
    await expect(notice).toContainText(`DGU A order ${ts}`);
    await expect(
      sheet.getByRole("button", { name: /add result/i }).first()
    ).toBeDisabled();
  });

  await test.step("Once A passes, the badge and the notice are gone", async () => {
    const ok = await request.post(`${baseURL}/api/test-runs/submit-result`, {
      headers: sameOrigin,
      data: {
        testRunId: runId,
        testRunCaseId: trcA,
        statusId: passedId,
        attempt: 1,
        testRunCaseVersion: 1,
      },
    });
    expect(ok.status(), await ok.text()).toBe(200);

    await page.goto(
      `/en-US/projects/runs/${projectId}/${runId}?selectedCase=${caseB}`
    );
    await page.waitForLoadState("load");
    const sheet = page.locator(".test-run-details-sheet");
    await expect(sheet).toBeVisible({ timeout: 15000 });
    await expect(
      sheet.getByRole("button", { name: /add result/i }).first()
    ).toBeEnabled({ timeout: 15000 });
    await expect(page.getByTestId("run-case-dependency-notice")).toHaveCount(0);
    await expect(
      page.getByTestId(`testrun-status-cell-blocked-${caseB}`)
    ).toHaveCount(0);
  });

  await test.step("The Linked Cases panel labels the direction from each side", async () => {
    await page.goto(`/en-US/projects/repository/${projectId}/${caseB}`);
    await page.waitForLoadState("load");
    await expect(page.getByTestId(`linked-case-type-${linkId}`)).toHaveText(
      /depends on/i,
      { timeout: 15000 }
    );

    await page.goto(`/en-US/projects/repository/${projectId}/${caseA}`);
    await page.waitForLoadState("load");
    await expect(page.getByTestId(`linked-case-type-${linkId}`)).toHaveText(
      /blocks/i,
      { timeout: 15000 }
    );
  });

  await test.step("Choosing Blocks in the Add Link dialog records the dependency from the other side", async () => {
    // On C's page, link D with "Blocks": D must end up depending on C.
    await page.goto(`/en-US/projects/repository/${projectId}/${caseC}`);
    await page.waitForLoadState("load");
    await page
      .getByRole("button", { name: /add link/i })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByRole("combobox").first().click();
    await page.keyboard.type(`DGU D ${ts}`);
    await page
      .getByRole("option", { name: new RegExp(`DGU D ${ts}`) })
      .first()
      .click();

    await dialog.getByTestId("linked-case-type-select").click();
    await page.getByRole("option", { name: /^blocks/i }).click();
    await dialog.getByRole("button", { name: /add link/i }).click();

    await expect
      .poll(
        async () => {
          const q = encodeURIComponent(
            JSON.stringify({
              where: { caseAId: caseD, caseBId: caseC, type: "DEPENDS_ON" },
              select: { id: true },
            })
          );
          // A transient connection reset is just "not yet": let the poll
          // ask again instead of failing the step on it.
          try {
            const res = await request.get(
              `${baseURL}/api/model/repositoryCaseLink/findMany?q=${q}`
            );
            const json = await res.json();
            return Array.isArray(json.data) ? json.data.length : -1;
          } catch {
            return -1;
          }
        },
        { timeout: 15000 }
      )
      .toBe(1);
  });
});
