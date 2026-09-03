import type { Page } from "@playwright/test";
import { expect, test } from "../../../fixtures";

/**
 * QuickScript export templates (admin): create, edit and delete a template
 * through the dialogs on /admin/quickscripts. Rows carry no test id, so a
 * template's row is scoped by its name.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Category, framework, extension and language are creatable comboboxes: the
 * trigger opens a popover whose search input doubles as the free-text value.
 */
async function typeIntoCombobox(page: Page, testId: string, value: string) {
  await page.getByTestId(testId).click();
  const search = page.getByTestId(`${testId}-search`);
  await expect(search).toBeVisible({ timeout: 5000 });
  await search.fill(value);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId(testId)).toContainText(value);
}

function templateRow(page: Page, name: string) {
  return page
    .getByTestId("quickscript-templates-section")
    .locator("tr")
    .filter({ hasText: name })
    .first();
}

async function revealTemplate(page: Page, category: string, name: string) {
  const row = templateRow(page, name);
  if (await row.isVisible().catch(() => false)) return row;
  // Templates are grouped in an accordion by category.
  await page
    .getByTestId("quickscript-templates-section")
    .getByRole("button", { name: new RegExp(category) })
    .first()
    .click();
  await expect(row).toBeVisible({ timeout: 10000 });
  return row;
}

test.describe("QuickScript templates", () => {
  test("admin can create, edit and delete a template", async ({
    page,
    request,
    baseURL,
  }) => {
    const ts = uid();
    const category = `E2E Category ${ts}`;
    const name = `E2E Template ${ts}`;
    const renamed = `E2E Template renamed ${ts}`;

    try {
      await test.step("Create a template with the required fields", async () => {
        await page.goto("/en-US/admin/quickscripts");
        await page.getByTestId("add-export-template-button").click();
        const dialog = page.getByTestId("export-template-dialog");
        await expect(dialog).toBeVisible({ timeout: 10000 });
        await dialog.getByTestId("export-template-name-input").fill(name);
        await typeIntoCombobox(
          page,
          "export-template-category-input",
          category
        );
        await typeIntoCombobox(page, "export-template-framework-input", "E2E");
        await typeIntoCombobox(page, "export-template-extension-input", "txt");
        await typeIntoCombobox(page, "export-template-language-input", "text");
        await dialog
          .getByTestId("export-template-body-textarea")
          .fill("Case: {{testCase.name}}");
        await dialog.getByTestId("export-template-submit-button").click();
        await expect(dialog).toBeHidden({ timeout: 15000 });
        await revealTemplate(page, category, name);
      });

      await test.step("Rename the template from its edit dialog", async () => {
        const row = await revealTemplate(page, category, name);
        await row.getByTestId("edit-export-template-button").click();
        const dialog = page.getByTestId("edit-export-template-dialog");
        await expect(dialog).toBeVisible({ timeout: 10000 });
        const nameInput = dialog.getByTestId("edit-export-template-name-input");
        await nameInput.clear();
        await nameInput.fill(renamed);
        await dialog.getByTestId("edit-export-template-submit-button").click();
        await expect(dialog).toBeHidden({ timeout: 15000 });
        await expect(templateRow(page, renamed)).toBeVisible({
          timeout: 15000,
        });
      });

      await test.step("Delete the template and confirm", async () => {
        const row = await revealTemplate(page, category, renamed);
        await row.getByTestId("delete-export-template-button").click();
        const alert = page.getByRole("alertdialog");
        await expect(alert).toBeVisible({ timeout: 10000 });
        await alert.getByRole("button", { name: "Confirm" }).click();
        await expect(alert).toBeHidden({ timeout: 15000 });
        await expect(templateRow(page, renamed)).toHaveCount(0, {
          timeout: 15000,
        });
      });
    } finally {
      // Belt and braces: soft-delete anything this test left behind.
      await request
        .patch(`${baseURL}/api/model/caseExportTemplate/updateMany`, {
          data: {
            where: { name: { in: [name, renamed] } },
            data: { isDeleted: true },
          },
        })
        .catch(() => {});
    }
  });
});
