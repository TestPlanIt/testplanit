import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { TemplatesFieldsPage } from "../../page-objects/admin/templates-fields.page";
import { clickOverflowAction } from "../../utils/action-overflow";

/**
 * Per-project default template (#707): chosen under Settings > Advanced,
 * preselected in Add Case, skipped once the template is disabled, and named
 * by the admin warnings before a template that projects use as their default
 * is disabled or deleted.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const sameOrigin = { "sec-fetch-site": "same-origin" };

async function updateModel(
  request: APIRequestContext,
  baseURL: string | undefined,
  model: string,
  id: number,
  data: Record<string, unknown>
): Promise<void> {
  const response = await request.patch(`${baseURL}/api/model/${model}/update`, {
    headers: sameOrigin,
    data: { where: { id }, data },
  });
  expect(response.ok()).toBeTruthy();
}

async function readModel<T>(
  request: APIRequestContext,
  baseURL: string | undefined,
  model: string,
  id: number,
  select: Record<string, true>
): Promise<T> {
  const q = encodeURIComponent(JSON.stringify({ where: { id }, select }));
  const response = await request.get(
    `${baseURL}/api/model/${model}/findUnique?q=${q}`
  );
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data as T;
}

/** Opens Add Case in the folder and returns its header template select. */
async function openAddCaseTemplateSelect(
  page: Page,
  projectId: number,
  folderId: number
) {
  await page.goto(`/en-US/projects/repository/${projectId}?node=${folderId}`);
  await page.waitForLoadState("networkidle");
  const dialog = page.getByTestId("add-case-dialog");
  // The toolbar can re-render while the page settles, detaching the menu
  // item mid-click; close any half-open menu and try again.
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await page.keyboard.press("Escape");
      await clickOverflowAction(
        page,
        "add-case-button",
        "repository-actions-menu",
        { timeout: 5000 }
      );
    }
    await expect(dialog).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30000 });
  return dialog.getByRole("heading").getByRole("combobox");
}

test.describe("Project default template", () => {
  test("is preselected for new cases and falls back once it is disabled", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const projectId = await api.createProject(`E2E Default Template ${uid()}`);
    const folderId = await api.createFolder(projectId, `Folder ${uid()}`);
    const templateName = `E2E Project Default ${uid()}`;
    const templateId = await api.createTemplate({
      name: templateName,
      projectIds: [projectId],
    });

    await test.step("Choose it under Settings > Advanced", async () => {
      await page.goto(`/en-US/projects/settings/${projectId}/advanced`);
      const select = page.getByTestId("default-template-select");
      await expect(select).toBeEnabled({ timeout: 15000 });
      await select.click();
      await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes("/api/model/projects/update") &&
            response.ok()
        ),
        page.getByRole("option", { name: templateName }).click(),
      ]);
      await expect(select).toHaveText(templateName);

      const project = await readModel<{ defaultTemplateId: number | null }>(
        request,
        baseURL,
        "projects",
        projectId,
        { defaultTemplateId: true }
      );
      expect(project.defaultTemplateId).toBe(templateId);
    });

    await test.step("Add Case starts with it, marked as the project default", async () => {
      const templateSelect = await openAddCaseTemplateSelect(
        page,
        projectId,
        folderId
      );
      await expect(templateSelect).toHaveText(templateName, {
        timeout: 15000,
      });
      await expect(
        templateSelect.getByTestId("default-template-badge-project")
      ).toBeVisible();
    });

    await test.step("Disabling it warns in settings and Add Case falls back", async () => {
      await updateModel(request, baseURL, "templates", templateId, {
        isEnabled: false,
      });

      await page.goto(`/en-US/projects/settings/${projectId}/advanced`);
      await expect(
        page.getByTestId("default-template-unavailable-warning")
      ).toBeVisible({ timeout: 15000 });

      const templateSelect = await openAddCaseTemplateSelect(
        page,
        projectId,
        folderId
      );
      // The project's only other template is the seeded one createProject
      // assigns, so the fallback lands on it whichever template is the
      // system default right now.
      await expect(templateSelect).toHaveText(/^Default Template/, {
        timeout: 15000,
      });
    });
  });

  test("admins see the projects that use a template as their default before disabling or deleting it", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const projectName = `E2E Default Template Admin ${uid()}`;
    const projectId = await api.createProject(projectName);
    const templateName = `E2E Admin Default ${uid()}`;
    const templateId = await api.createTemplate({
      name: templateName,
      projectIds: [projectId],
    });
    await updateModel(request, baseURL, "projects", projectId, {
      defaultTemplateId: templateId,
    });

    const templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
    const enabledSwitch = templatesPage
      .getTemplateRow(templateName)
      .locator('[role="switch"]')
      .first();
    const disableDialog = page.getByTestId("disable-template-dialog");

    await test.step("Switching it off asks first and names the project", async () => {
      await enabledSwitch.click();
      await expect(disableDialog).toBeVisible({ timeout: 10000 });
      await expect(
        disableDialog.getByTestId("template-project-default-warning")
      ).toContainText(projectName);

      await disableDialog.getByRole("button", { name: "Cancel" }).click();
      await expect(disableDialog).not.toBeVisible();
      const template = await readModel<{ isEnabled: boolean }>(
        request,
        baseURL,
        "templates",
        templateId,
        { isEnabled: true }
      );
      expect(template.isEnabled).toBe(true);
    });

    await test.step("Confirming disables it", async () => {
      await enabledSwitch.click();
      await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes("/api/model/templates/update") &&
            response.ok()
        ),
        page.getByTestId("disable-template-confirm").click(),
      ]);
      await expect(enabledSwitch).toHaveAttribute("aria-checked", "false");
    });

    await test.step("The delete dialog names the project too", async () => {
      await templatesPage.clickDeleteTemplate(templateName);
      const deleteDialog = page.getByRole("alertdialog");
      await expect(
        deleteDialog.getByTestId("template-project-default-warning")
      ).toContainText(projectName, { timeout: 10000 });
      await deleteDialog.getByRole("button", { name: "Cancel" }).click();
      await expect(deleteDialog).not.toBeVisible();
    });
  });
});
