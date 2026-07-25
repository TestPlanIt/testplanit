import { expect, Locator, Page } from "@playwright/test";

/**
 * Helpers for toolbars rendered through `ActionOverflow`
 * (components/ui/action-bar.tsx).
 *
 * Wide containers render each action as a real `<Button data-testid=...>`;
 * below the compact threshold the whole bar collapses into a single kebab
 * trigger (`data-testid={menuTestId}`) whose menu items reuse the same
 * per-action test ids — but only exist while the menu is open. Which mode is
 * active depends on measured container width (panel splits, viewport,
 * persisted panel sizes), so specs must never assume one mode.
 *
 * Known menus:
 *  - "repository-actions-menu"  — repository right-panel header
 *    (import-cases-button, generate-cases-button, add-case-button)
 *  - "cases-actions-menu"       — cases toolbar
 *    (bulk-edit-button, auto-tag-cases-button, create-test-run-button,
 *     copy-move-button, export-cases-button, quickscript-cases-button)
 */

export type ActionOverflowMenuId =
  "repository-actions-menu" | "cases-actions-menu";

/**
 * Resolve an ActionOverflow action to a clickable, visible locator regardless
 * of compact state. In compact mode this opens the kebab menu and returns the
 * menu item (caller should click it or press Escape to dismiss).
 */
export async function revealOverflowAction(
  page: Page,
  actionTestId: string,
  menuTestId: ActionOverflowMenuId,
  { timeout = 10_000 }: { timeout?: number } = {}
): Promise<Locator> {
  const direct = page.getByTestId(actionTestId);
  const menuTrigger = page.getByTestId(menuTestId);

  // Wide mode renders the action button itself; compact mode renders only the
  // kebab trigger. Wait until either exists so we know which mode we're in.
  await expect(direct.or(menuTrigger).first()).toBeVisible({ timeout });

  if (await direct.isVisible().catch(() => false)) {
    return direct;
  }

  await menuTrigger.click();
  const menuItem = page.getByTestId(actionTestId);
  await expect(menuItem).toBeVisible({ timeout: 5_000 });
  return menuItem;
}

/**
 * Click an ActionOverflow action, opening the kebab menu first when the bar is
 * collapsed.
 */
export async function clickOverflowAction(
  page: Page,
  actionTestId: string,
  menuTestId: ActionOverflowMenuId,
  options: { timeout?: number } = {}
): Promise<void> {
  const action = await revealOverflowAction(
    page,
    actionTestId,
    menuTestId,
    options
  );
  await action.click();
}

/**
 * Assert an ActionOverflow action is currently offered (visible button in wide
 * mode, present menu item in compact mode). Closes the kebab menu afterwards
 * so the page returns to its pre-assertion state.
 */
export async function expectOverflowActionAvailable(
  page: Page,
  actionTestId: string,
  menuTestId: ActionOverflowMenuId,
  options: { timeout?: number } = {}
): Promise<void> {
  const action = await revealOverflowAction(
    page,
    actionTestId,
    menuTestId,
    options
  );
  await expect(action).toBeVisible();
  // If we opened the kebab to find it, close the menu again.
  const isMenuItem = await action
    .evaluate((el) => el.closest('[role="menu"]') !== null)
    .catch(() => false);
  if (isMenuItem) {
    await page.keyboard.press("Escape");
  }
}
