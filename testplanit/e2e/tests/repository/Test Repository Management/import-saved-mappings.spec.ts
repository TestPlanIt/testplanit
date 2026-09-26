import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Saved CSV import column mappings
 *
 * A mapping saved from the Test Cases import wizard is suggested the next time
 * a file with the same columns is imported, and applying it restores every
 * column the auto-matcher can't place on its own.
 */
test.describe("Saved import column mappings", () => {
  test("save a mapping, then apply it from the suggestion on the next import", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const repositoryPage = new RepositoryPage(page);
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const projectId = await api.createProject(`E2E Import Mapping ${uid}`);
    const folderName = `Mapping Folder ${uid}`;
    const mappingName = `E2E mapping ${uid}`;
    // "Owner" matches no field, so the auto-matcher leaves it on Ignore Column.
    const csv = `Title,Owner\nMapped case ${uid},qa-team`;

    const importDialog = page.locator('[role="dialog"]').first();
    const ownerMapping = importDialog.getByTestId(
      "import-column-mapping-Owner"
    );

    await test.step("Open the repository", async () => {
      const folderId = await api.createFolder(projectId, folderName);
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Map Owner to Tags and save the mapping", async () => {
      await openMappingPage(page, importDialog, csv, folderName);
      await expect(ownerMapping).toContainText("Ignore Column");

      await ownerMapping.click();
      await page.getByRole("option", { name: "Tags", exact: true }).click();
      await expect(ownerMapping).toContainText("Tags");

      await importDialog.getByTestId("saved-import-mappings-trigger").click();
      await page.getByTestId("save-import-mapping-button").click();
      await page.getByTestId("import-mapping-name-input").fill(mappingName);
      await page.getByTestId("import-mapping-save-button").click();
      await expect(page.getByTestId("import-mapping-name-input")).toBeHidden();
    });

    await test.step("Close the wizard", async () => {
      await page.keyboard.press("Escape");
      await expect(importDialog).toBeHidden();
    });

    await test.step("Reimport the same file and apply the suggestion", async () => {
      await openMappingPage(page, importDialog, csv, folderName);
      await expect(ownerMapping).toContainText("Ignore Column");

      const suggestion = importDialog.getByTestId(
        "saved-import-mapping-suggestion"
      );
      await expect(suggestion).toContainText(mappingName);
      await suggestion
        .getByTestId("saved-import-mapping-suggestion-apply")
        .click();

      await expect(ownerMapping).toContainText("Tags");
      await expect(suggestion).toBeHidden();
    });

    await test.step("Soft-delete the saved mapping", async () => {
      const found = await request.get(
        `${baseURL}/api/model/importMapping/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: { name: mappingName },
              select: { id: true },
            }),
          },
        }
      );
      const mapping = (await found.json()).data;
      expect(mapping?.id).toBeTruthy();
      const deleted = await request.patch(
        `${baseURL}/api/model/importMapping/update`,
        {
          data: {
            where: { id: mapping.id },
            data: { isDeleted: true },
          },
        }
      );
      expect(deleted.ok()).toBeTruthy();
    });
  });
});

/** Opens the import wizard, uploads the CSV and advances to the mapping page. */
async function openMappingPage(
  page: Page,
  importDialog: Locator,
  csv: string,
  folderName: string
) {
  await page.locator('button:has-text("Import Test Cases")').first().click();
  await expect(importDialog).toBeVisible({ timeout: 5000 });

  const fileInput = page.locator('input[type="file"]').first();
  await expect(fileInput).toBeAttached({ timeout: 5000 });
  await fileInput.setInputFiles({
    name: "saved-mapping.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf-8"),
  });
  await expect(importDialog.getByText("saved-mapping.csv").first()).toBeVisible(
    { timeout: 5000 }
  );

  await importDialog.getByTestId("template-select").click();
  await page.locator('[role="option"]').first().click();

  await importDialog.locator('button:has-text("Select a folder")').click();
  await page
    .locator('[role="option"]')
    .filter({ hasText: folderName })
    .first()
    .click();

  await importDialog.getByTestId("next-button").click();
  await expect(
    importDialog.getByTestId("saved-import-mappings-trigger")
  ).toBeVisible({ timeout: 10000 });
}
