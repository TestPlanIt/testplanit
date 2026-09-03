import type { Page } from "@playwright/test";
import { expect, test } from "../../fixtures";

/**
 * JUnit settings (/projects/settings/:projectId/junit): the iteration
 * property list that tells the importer which <property> names identify an
 * iteration. Add a name, save, reload, remove it, save again.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Save persists through a PUT; wait for it to land before the reload below,
 * otherwise the navigation aborts the request and nothing is stored.
 */
async function saveAndWait(page: Page): Promise<void> {
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/junit-iteration-property-names") &&
        response.request().method() === "PUT" &&
        response.ok(),
      { timeout: 15000 }
    ),
    page.getByTestId("junit-iteration-property-save").click(),
  ]);
}

test.describe("JUnit iteration properties", () => {
  test("adds, persists and removes a property name", async ({ api, page }) => {
    const projectId = await api.createProject(`E2E JUnit ${uid()}`);
    const property = `browser${Date.now() % 1000}`;

    await test.step("Add a property and save", async () => {
      await page.goto(`/en-US/projects/settings/${projectId}/junit`);
      const input = page.getByTestId("junit-iteration-property-input");
      await expect(input).toBeVisible({ timeout: 15000 });
      await input.fill(property);
      await page.getByTestId("junit-iteration-property-add").click();
      await expect(
        page.getByTestId(`junit-iteration-property-tag-${property}`)
      ).toBeVisible();
      await saveAndWait(page);
    });

    await test.step("The property survives a reload", async () => {
      await page.reload();
      await expect(
        page.getByTestId(`junit-iteration-property-tag-${property}`)
      ).toBeVisible({ timeout: 15000 });
    });

    await test.step("Remove it, save, and confirm it is gone after a reload", async () => {
      await page
        .getByTestId(`junit-iteration-property-remove-${property}`)
        .click();
      await expect(
        page.getByTestId(`junit-iteration-property-tag-${property}`)
      ).toHaveCount(0);
      await saveAndWait(page);
      await page.reload();
      await expect(
        page.getByTestId("junit-iteration-property-input")
      ).toBeVisible({ timeout: 15000 });
      await expect(
        page.getByTestId(`junit-iteration-property-tag-${property}`)
      ).toHaveCount(0);
    });
  });
});
