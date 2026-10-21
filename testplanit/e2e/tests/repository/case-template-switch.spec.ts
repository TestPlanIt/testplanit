import type { Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import type { ApiHelper } from "../../fixtures/api.fixture";
import { clickOverflowAction } from "../../utils/action-overflow";
import { RepositoryPage } from "../../page-objects/repository/repository.page";

/**
 * Switching a case to another template while editing it (issue #708). The
 * values the next template has a place for carry over, steps included; a
 * switch that would discard something entered asks first; and on an existing
 * case the new template's fields show as soon as it is picked, not after a
 * save.
 *
 * Both templates share a Text String field and the seeded Steps field, and
 * each has one field of its own.
 */

interface SwitchSetup {
  projectId: number;
  folderId: number;
  sourceTemplateId: number;
  targetTemplateId: number;
  sourceName: string;
  targetName: string;
  shared: { id: number; systemName: string };
  sourceOnly: { id: number; systemName: string; displayName: string };
  targetOnly: { id: number; systemName: string };
}

async function setupTemplates(api: ApiHelper): Promise<SwitchSetup> {
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const projectId = await api.createProject(`E2E Template Switch ${stamp}`);
  const folderId = await api.createFolder(projectId, `Folder ${stamp}`);
  const stepsFieldId = await api.getCaseFieldId("Steps");
  expect(stepsFieldId).not.toBeNull();

  const textField = async (label: string) => {
    const systemName = `${label}_${stamp}`;
    const displayName = `${label} ${stamp}`;
    const id = await api.createCaseField({
      displayName,
      systemName,
      typeName: "Text String",
    });
    return { id, systemName, displayName };
  };
  const shared = await textField("shared");
  const sourceOnly = await textField("source_only");
  const targetOnly = await textField("target_only");

  const sourceName = `Source ${stamp}`;
  const targetName = `Target ${stamp}`;
  const sourceTemplateId = await api.createTemplate({
    name: sourceName,
    isEnabled: true,
    isDefault: false,
    caseFieldIds: [shared.id, sourceOnly.id, stepsFieldId!],
    projectIds: [projectId],
  });
  const targetTemplateId = await api.createTemplate({
    name: targetName,
    isEnabled: true,
    isDefault: false,
    caseFieldIds: [shared.id, targetOnly.id, stepsFieldId!],
    projectIds: [projectId],
  });

  return {
    projectId,
    folderId,
    sourceTemplateId,
    targetTemplateId,
    sourceName,
    targetName,
    shared,
    sourceOnly,
    targetOnly,
  };
}

async function getCase(api: ApiHelper, where: Record<string, unknown>) {
  const resp = await (api as any).request.get(
    `${(api as any).baseURL}/api/model/repositoryCases/findFirst?q=` +
      encodeURIComponent(
        JSON.stringify({
          where: { ...where, isDeleted: false },
          select: {
            id: true,
            name: true,
            templateId: true,
            steps: {
              where: { isDeleted: false },
              select: { id: true, step: true },
              orderBy: { order: "asc" },
            },
            caseFieldValues: { select: { fieldId: true, value: true } },
          },
        })
      )
  );
  expect(resp.ok()).toBe(true);
  return (await resp.json()).data;
}

async function pickTemplate(page: Page, trigger: string, name: string) {
  await page.getByTestId(trigger).getByRole("combobox").first().click();
  await page.getByRole("option", { name }).first().click();
}

test.describe("Switching a case's template", () => {
  test("Add Case carries entered values and steps to the next template", async ({
    api,
    page,
  }) => {
    const setup = await setupTemplates(api);
    const repositoryPage = new RepositoryPage(page);
    const dialog = page.getByTestId("add-case-dialog");
    const templateTrigger = dialog.getByRole("combobox").first();
    const caseName = `Carried ${Date.now()}`;
    const sharedValue = `Shared value ${Date.now()}`;
    const stepText = `Carried step ${Date.now()}`;

    await test.step("Open Add Case on the source template and fill it in", async () => {
      await repositoryPage.goto(setup.projectId);
      await repositoryPage.selectFolder(setup.folderId);
      await clickOverflowAction(
        page,
        "add-case-button",
        "repository-actions-menu"
      );
      await expect(dialog).toBeVisible({ timeout: 10000 });
      await pickTemplate(page, "add-case-dialog", setup.sourceName);
      await expect(templateTrigger).toHaveText(setup.sourceName);

      await page.getByTestId("case-name-input").fill(caseName);
      await page
        .getByTestId(`field-${setup.shared.systemName}-input`)
        .fill(sharedValue);
      await dialog.getByTestId("add-step-button").click();
      const stepEditor = dialog
        .getByTestId("step-editor-0")
        .locator('.ProseMirror[contenteditable="true"]')
        .first();
      await stepEditor.click();
      await stepEditor.pressSequentially(stepText);
    });

    await test.step("Switch to the target template — nothing is lost, so it does not ask", async () => {
      await pickTemplate(page, "add-case-dialog", setup.targetName);
      await expect(templateTrigger).toHaveText(setup.targetName);
      await expect(
        page.getByTestId("confirm-template-switch-dialog")
      ).toHaveCount(0);

      await expect(page.getByTestId("case-name-input")).toHaveValue(caseName);
      await expect(
        page.getByTestId(`field-${setup.shared.systemName}-input`)
      ).toHaveValue(sharedValue);
      await expect(
        page.getByTestId(`field-${setup.targetOnly.systemName}`)
      ).toBeVisible();
      await expect(
        page.getByTestId(`field-${setup.sourceOnly.systemName}`)
      ).toHaveCount(0);
      await expect(dialog.getByTestId("step-editor-0")).toContainText(stepText);
    });

    await test.step("Create the case and confirm everything saved", async () => {
      await page.getByTestId("case-submit-button").click();
      await expect(dialog).not.toBeVisible({ timeout: 20000 });

      const saved = await getCase(api, {
        folderId: setup.folderId,
        name: caseName,
      });
      expect(saved.templateId).toBe(setup.targetTemplateId);
      expect(saved.steps).toHaveLength(1);
      expect(JSON.stringify(saved.steps[0].step)).toContain(stepText);
      expect(
        saved.caseFieldValues.find(
          (cfv: { fieldId: number }) => cfv.fieldId === setup.shared.id
        )?.value
      ).toBe(sharedValue);
    });
  });

  test("Add Case asks before a switch discards an entered value", async ({
    api,
    page,
  }) => {
    const setup = await setupTemplates(api);
    const repositoryPage = new RepositoryPage(page);
    const dialog = page.getByTestId("add-case-dialog");
    const templateTrigger = dialog.getByRole("combobox").first();
    const confirmDialog = page.getByTestId("confirm-template-switch-dialog");
    const caseName = `Asked ${Date.now()}`;
    const sourceOnlyInput = page.getByTestId(
      `field-${setup.sourceOnly.systemName}-input`
    );

    await test.step("Fill a field only the source template has", async () => {
      await repositoryPage.goto(setup.projectId);
      await repositoryPage.selectFolder(setup.folderId);
      await clickOverflowAction(
        page,
        "add-case-button",
        "repository-actions-menu"
      );
      await expect(dialog).toBeVisible({ timeout: 10000 });
      await pickTemplate(page, "add-case-dialog", setup.sourceName);
      await expect(templateTrigger).toHaveText(setup.sourceName);
      await page.getByTestId("case-name-input").fill(caseName);
      await sourceOnlyInput.fill("Only here");
    });

    await test.step("Declining the switch keeps the template and the value", async () => {
      await pickTemplate(page, "add-case-dialog", setup.targetName);
      await expect(confirmDialog).toBeVisible();
      await expect(confirmDialog).toContainText(setup.sourceOnly.displayName);
      await page.getByTestId("confirm-template-switch-cancel").click();
      await expect(confirmDialog).toHaveCount(0);
      await expect(templateTrigger).toHaveText(setup.sourceName);
      await expect(sourceOnlyInput).toHaveValue("Only here");
    });

    await test.step("Confirming switches and keeps the rest", async () => {
      await pickTemplate(page, "add-case-dialog", setup.targetName);
      await expect(confirmDialog).toBeVisible();
      await page.getByTestId("confirm-template-switch-confirm").click();
      await expect(templateTrigger).toHaveText(setup.targetName);
      await expect(
        page.getByTestId(`field-${setup.sourceOnly.systemName}`)
      ).toHaveCount(0);
      await expect(page.getByTestId("case-name-input")).toHaveValue(caseName);
    });
  });

  test("Editing a case shows the new template's fields as soon as it is picked", async ({
    api,
    page,
  }) => {
    const setup = await setupTemplates(api);
    const caseId = await api.createTestCase(
      setup.projectId,
      setup.folderId,
      `Edit switch ${Date.now()}`,
      setup.sourceTemplateId
    );
    const newName = `Renamed ${Date.now()}`;
    const sharedValue = `Shared edit ${Date.now()}`;
    const targetValue = `Target value ${Date.now()}`;
    const sharedInput = page
      .getByTestId(`field-value-${setup.shared.systemName}`)
      .locator("input");
    const targetInput = page
      .getByTestId(`field-value-${setup.targetOnly.systemName}`)
      .locator("input");

    await test.step("Edit the name and a shared field", async () => {
      await page.goto(
        `/en-US/projects/repository/${setup.projectId}/${caseId}?edit=true`
      );
      await page.locator('textarea[name="name"]').fill(newName);
      await sharedInput.fill(sharedValue);
    });

    await test.step("Switch template — the target's field appears, the edits stay", async () => {
      await page
        .getByRole("combobox")
        .filter({ hasText: setup.sourceName })
        .click();
      await page.getByRole("option", { name: setup.targetName }).click();
      await expect(
        page.getByTestId("confirm-template-switch-dialog")
      ).toHaveCount(0);
      await expect(targetInput).toBeVisible();
      await expect(
        page.getByTestId(`field-value-${setup.sourceOnly.systemName}`)
      ).toHaveCount(0);
      await expect(page.locator('textarea[name="name"]')).toHaveValue(newName);
      await expect(sharedInput).toHaveValue(sharedValue);
      await targetInput.fill(targetValue);
    });

    await test.step("Save and confirm the case moved to the target template", async () => {
      await page.locator('button[type="submit"]').first().click();
      const valueOf = (saved: any, fieldId: number) =>
        saved.caseFieldValues.find(
          (cfv: { fieldId: number }) => cfv.fieldId === fieldId
        )?.value;
      // The field values are the save's last writes.
      await expect
        .poll(
          async () =>
            valueOf(await getCase(api, { id: caseId }), setup.targetOnly.id),
          { timeout: 30000 }
        )
        .toBe(targetValue);

      const saved = await getCase(api, { id: caseId });
      expect(saved.templateId).toBe(setup.targetTemplateId);
      expect(saved.name).toBe(newName);
      expect(valueOf(saved, setup.shared.id)).toBe(sharedValue);
    });
  });
});
