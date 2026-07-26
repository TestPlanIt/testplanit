import type { APIRequestContext } from "@playwright/test";

import { expect, test } from "../../fixtures";
import { clickOverflowAction } from "../../utils/action-overflow";

/**
 * Keep-current rule for disabled workflow states
 * (TestCaseDetailsView workflowOptions / templateOptions).
 *
 * Disabled states are hidden from the state picker, EXCEPT the case's current
 * state: a case already sitting on a state that was later disabled must still
 * render that state as its selection — the failure mode is an empty Select
 * whose submitted payload then fails validation.
 */

async function createCasesWorkflow(
  request: APIRequestContext,
  baseURL: string,
  projectId: number,
  name: string
): Promise<number> {
  const refRes = await request.get(`${baseURL}/api/model/workflows/findFirst`, {
    params: {
      q: JSON.stringify({
        where: { scope: "CASES", isDeleted: false, isDefault: true },
        select: { iconId: true, colorId: true, order: true },
      }),
    },
  });
  const ref = (await refRes.json())?.data as {
    iconId: number;
    colorId: number;
    order: number;
  } | null;
  if (!ref)
    throw new Error("No CASES-scope reference workflow — seed missing?");

  const createRes = await request.post(
    `${baseURL}/api/model/workflows/create`,
    {
      data: {
        data: {
          name,
          order: ref.order + 1000,
          iconId: ref.iconId,
          colorId: ref.colorId,
          isEnabled: true,
          isDefault: false,
          scope: "CASES",
        },
      },
    }
  );
  if (!createRes.ok()) {
    throw new Error(`workflow create failed: ${await createRes.text()}`);
  }
  const workflowId = ((await createRes.json())?.data?.id as number) ?? 0;

  const assignRes = await request.post(
    `${baseURL}/api/model/projectWorkflowAssignment/create`,
    { data: { data: { workflowId, projectId } } }
  );
  if (!assignRes.ok()) {
    throw new Error(`workflow assign failed: ${await assignRes.text()}`);
  }
  return workflowId;
}

test.describe("Disabled workflow state — keep-current in case details", () => {
  test("a case on a since-disabled state still shows that state in the picker", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const ts = Date.now();
    const stateName = `E2E Sunset State ${ts}`;
    let projectId!: number;
    let caseId!: number;

    await test.step("Seed a case on a custom state, then disable the state", async () => {
      projectId = await api.createProject(`E2E KeepCurrent ${ts}`);
      const folderId = await api.createFolder(projectId, `KC Folder ${ts}`);
      caseId = await api.createTestCase(projectId, folderId, `KC Case ${ts}`);

      const workflowId = await createCasesWorkflow(
        request,
        baseURL!,
        projectId,
        stateName
      );

      const setState = await request.patch(
        `${baseURL}/api/model/repositoryCases/update`,
        { data: { where: { id: caseId }, data: { stateId: workflowId } } }
      );
      expect(setState.ok()).toBeTruthy();

      const disable = await request.patch(
        `${baseURL}/api/model/workflows/update`,
        { data: { where: { id: workflowId }, data: { isEnabled: false } } }
      );
      expect(disable.ok()).toBeTruthy();
    });

    await test.step("The case page renders the disabled state, not an empty selection", async () => {
      await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
      await page.waitForLoadState("networkidle");

      // View mode: the state name renders on the page.
      await expect(page.getByText(stateName).first()).toBeVisible({
        timeout: 15000,
      });
    });

    await test.step("Edit mode: the state select shows the current (disabled) state", async () => {
      await clickOverflowAction(
        page,
        "edit-test-case-button",
        "case-actions-menu"
      );

      // The state Select trigger renders the current selection's label.
      const stateValue = page.getByText(stateName).first();
      await expect(stateValue).toBeVisible({ timeout: 15000 });
    });
  });
});
