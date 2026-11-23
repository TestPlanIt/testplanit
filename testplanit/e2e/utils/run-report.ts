import { expect, type Page } from "@playwright/test";

/**
 * Clicks Run Report and waits for the response to that run. The builder
 * usually runs once on its own from the URL, so results already on screen
 * say nothing about this run, and a click made while the report re-renders
 * is lost.
 */
export async function clickRunReport(page: Page): Promise<void> {
  const runButton = page.getByTestId("run-report-button");
  await expect(runButton).toBeVisible({ timeout: 5000 });
  await expect(runButton).toBeEnabled({ timeout: 10000 });
  const ran = page.waitForResponse(
    (response) =>
      response.url().includes("/api/report-builder/") &&
      response.request().method() === "POST"
  );
  await runButton.click();
  await ran;
}

/**
 * Opens the Share dialog. The Share button is re-rendered when results
 * land, and a click that hits it at that moment opens nothing, so the
 * click is repeated until the dialog shows.
 */
export async function openShareDialog(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog");
  await expect(async () => {
    if (!(await dialog.first().isVisible())) {
      await page.getByTestId("share-report-button").click({ timeout: 3000 });
    }
    await expect(dialog.first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
}
