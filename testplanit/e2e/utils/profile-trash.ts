import { expect, type Page } from "@playwright/test";

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
