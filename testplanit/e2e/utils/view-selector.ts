import { expect, type Page } from "@playwright/test";

/**
 * Picks a grouping in the Repository's "View by" selector. A scripted click
 * on an option right after the list opens is sometimes ignored, leaving the
 * list open and the view unchanged, so the pick is repeated until the
 * selector shows the chosen view.
 */
export async function selectRepositoryView(
  page: Page,
  label: RegExp
): Promise<void> {
  const trigger = page.getByTestId("view-selector-trigger");
  await expect(trigger).toBeVisible({ timeout: 15000 });
  const option = page.locator('[role="option"]').filter({ hasText: label });

  await expect(async () => {
    if (!(await option.first().isVisible())) {
      await trigger.click({ timeout: 3000 });
    }
    await option.first().click({ timeout: 3000 });
    await expect(trigger).toContainText(label, { timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
}
