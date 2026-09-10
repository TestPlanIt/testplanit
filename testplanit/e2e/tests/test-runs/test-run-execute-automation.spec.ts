import { expect, test } from "../../fixtures";
import {
  startStubServer,
  type StubServerHandle,
} from "../../fixtures/webhook-outbound-stub-server";

/**
 * Executing a run's automated cases from the run page.
 *
 * Seeds a project with one automated and one manual case in a run, creates a
 * generic-webhook target through the settings page (target writes go through
 * server actions, not the model API), then:
 *  - the Execute button is enabled and the dialog counts one automated case;
 *  - submitting records an execution and the chip shows it;
 *  - the plan endpoint lists only the automated case;
 *  - the run became HYBRID;
 *  - the stub receives the signed dispatch (once the worker has run it);
 *  - the history sheet lists the execution.
 *
 * The dispatch itself is done by the execution-dispatch worker, which
 * global-setup starts alongside the others; the chip is asserted to leave
 * PENDING within the poll window rather than at a fixed status, since the
 * worker's timing is not the page's.
 */

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const sameOrigin = { "sec-fetch-site": "same-origin" };

test.describe("Execute automated cases from a run", () => {
  let stub: StubServerHandle;

  test.beforeAll(async () => {
    stub = await startStubServer();
  });

  test.afterAll(async () => {
    await stub?.close();
  });

  test("dispatches the run's automated cases to a generic target", async ({
    page,
    api,
    request,
    baseURL,
  }) => {
    const ts = uid();
    const base = baseURL || "http://localhost:3000";
    const projectId = await api.createProject(`E2E Execute ${ts}`);
    const folderId = await api.createFolder(projectId, `Exec Folder ${ts}`);
    const automatedCaseId = await api.createTestCase(
      projectId,
      folderId,
      `Exec automated [${ts}]`
    );
    const manualCaseId = await api.createTestCase(
      projectId,
      folderId,
      `Exec manual ${ts}`
    );
    const runId = await api.createTestRun(projectId, `Exec Run ${ts}`);
    await api.addTestCaseToTestRun(runId, automatedCaseId);
    await api.addTestCaseToTestRun(runId, manualCaseId);

    await test.step("Mark one case automated", async () => {
      const res = await request.patch(
        `${base}/api/model/repositoryCases/update`,
        {
          headers: sameOrigin,
          data: { where: { id: automatedCaseId }, data: { automated: true } },
        }
      );
      expect(res.status(), await res.text()).toBeLessThan(300);
    });

    await test.step("Create a generic target through the settings page", async () => {
      await page.goto(`/en-US/projects/settings/${projectId}/automation`);
      await expect(page.getByTestId("automation-targets-section")).toBeVisible({
        timeout: 15000,
      });
      await page.getByTestId("automation-target-create-button").click();
      await page.getByTestId("automation-target-name-input").fill(`Stub ${ts}`);
      await page.getByTestId("automation-target-provider-select").click();
      await page.getByRole("option", { name: "Generic webhook" }).click();
      await page
        .getByTestId("automation-target-webhook-url-input")
        .fill(`${stub.url}/hooks/testplanit`);
      await page.getByTestId("automation-target-submit").click();
      await expect(
        page.getByTestId("automation-target-revealed-secret-box")
      ).toBeVisible({ timeout: 15000 });
      await page.getByTestId("automation-target-secret-done").click();
    });

    await test.step("The plan lists only the automated case", async () => {
      const res = await request.get(
        `${base}/api/test-runs/${runId}/automation-plan`,
        { headers: sameOrigin }
      );
      expect(res.status(), await res.text()).toBe(200);
      const plan = await res.json();
      expect(plan.totals.cases).toBe(1);
      expect(plan.cases[0].id).toBe(automatedCaseId);
      expect(plan.cases[0].selector.idTokens.brackets).toBe(
        `[${automatedCaseId}]`
      );
    });

    await test.step("Open the run and execute", async () => {
      await page.goto(`/en-US/projects/runs/${projectId}/${runId}`);
      const button = page.getByTestId("execute-automation-button");
      await expect(button).toBeVisible({ timeout: 15000 });
      await expect(button).toBeEnabled();
      await button.click();
      const dialog = page.getByTestId("execute-automation-dialog");
      await expect(dialog).toBeVisible();
      await expect(
        page.getByTestId("execute-automation-summary")
      ).toContainText("1 automated case");
      await page.getByTestId("execute-automation-submit").click();
      await expect(dialog).toBeHidden({ timeout: 15000 });
    });

    await test.step("The chip shows the execution and the run is now hybrid", async () => {
      const chip = page.getByTestId("automation-execution-chip");
      await expect(chip).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId("automation-execution-status")).toHaveText(
        /Pending|Dispatched|Running/
      );
      const res = await request.get(`${base}/api/model/testRuns/findFirst`, {
        headers: sameOrigin,
        params: {
          q: JSON.stringify({
            where: { id: runId },
            select: { testRunType: true },
          }),
        },
      });
      expect((await res.json()).data?.testRunType).toBe("HYBRID");
    });

    await test.step("The worker dispatches to the stub with a signed payload", async () => {
      const captures = await stub.waitForCapture(
        (all) => all.some((c) => c.url.includes("/hooks/testplanit")),
        60_000
      );
      const hit = captures.find((c) => c.url.includes("/hooks/testplanit"))!;
      expect(hit.headers["x-testplanit-event"]).toBe("test_run.execute");
      expect(String(hit.headers["x-testplanit-signature"])).toMatch(
        /^t=\d+,v1=[0-9a-f]{64}$/
      );
      const body = hit.parsedBody as {
        runId: number;
        inputs: Record<string, string>;
        planUrl: string;
      };
      expect(body.runId).toBe(runId);
      expect(body.inputs.TESTPLANIT_RUN_ID).toBe(String(runId));
      expect(body.planUrl).toContain(`/api/test-runs/${runId}/automation-plan`);
      await expect(page.getByTestId("automation-execution-status")).toHaveText(
        /Dispatched|Running/,
        { timeout: 30_000 }
      );
    });

    await test.step("The execute button is disabled while the execution is in flight", async () => {
      await expect(
        page.getByTestId("execute-automation-button")
      ).toBeDisabled();
    });

    await test.step("The history sheet lists the execution", async () => {
      await page.getByTestId("automation-execution-history").click();
      const sheet = page.getByTestId("automation-executions-sheet");
      await expect(sheet).toBeVisible();
      await expect(
        sheet.locator('[data-testid^="automation-execution-row-"]')
      ).toHaveCount(1);
      await page.keyboard.press("Escape");
    });

    await test.step("Cancelling the execution re-enables the button", async () => {
      await page.getByTestId("automation-execution-cancel").click();
      await page
        .getByTestId("automation-execution-cancel-dialog-confirm")
        .click();
      await expect(page.getByTestId("automation-execution-status")).toHaveText(
        /Cancelled/,
        { timeout: 15000 }
      );
      await expect(page.getByTestId("execute-automation-button")).toBeEnabled({
        timeout: 15000,
      });
    });
  });

  test("the plan endpoint refuses runs the caller cannot read", async ({
    request,
    baseURL,
  }) => {
    const base = baseURL || "http://localhost:3000";
    const res = await request.get(
      `${base}/api/test-runs/999999999/automation-plan`,
      { headers: sameOrigin }
    );
    expect(res.status()).toBe(404);
  });
});
