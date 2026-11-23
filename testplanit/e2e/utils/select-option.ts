import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Picks an option from a Select. Firefox sometimes ignores a scripted
 * click on an option made right after the list opens, leaving the list
 * open and the value unchanged, so the pick is repeated until the trigger
 * shows the option.
 */
export async function pickSelectOption(
  page: Page,
  trigger: Locator,
  optionName: string
): Promise<void> {
  const option = page.getByRole("option", { name: optionName });
  await expect(async () => {
    if (!(await option.isVisible())) {
      await trigger.click({ timeout: 3000 });
    }
    await option.click({ timeout: 3000 });
    await expect(trigger).toHaveText(optionName, { timeout: 2000 });
  }).toPass({ timeout: 30_000 });
}
