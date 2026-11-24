import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Opens the Trash section of a profile page. The sections above it are still
 * growing as their data lands, and a click made while they shift is lost, so
 * the click is repeated until the section reports itself open.
 */
export async function openProfileTrash(page: Page): Promise<void> {
  const trigger = page.getByTestId("profile-trash-trigger");
  await expect(async () => {
    if ((await trigger.getAttribute("aria-expanded")) !== "true") {
      await trigger.click({ timeout: 3000 });
    }
    await expect(trigger).toHaveAttribute("aria-expanded", "true", {
      timeout: 2000,
    });
  }).toPass({ timeout: 30_000 });
}

/**
 * Clicks a row's Restore button and returns the confirmation dialog. The
 * Trash lists everything the shared admin deleted, so rows shift while other
 * specs run and a click can be lost; it is repeated until the dialog shows.
 */
export async function openRestoreConfirm(
  page: Page,
  restoreTestId: string
): Promise<Locator> {
  const alert = page.getByRole("alertdialog");
  await expect(async () => {
    if (!(await alert.isVisible())) {
      await page.getByTestId(restoreTestId).click({ timeout: 3000 });
    }
    await expect(alert).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30_000 });
  return alert;
}
