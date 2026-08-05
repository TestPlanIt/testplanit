import type { Locator } from "@playwright/test";

/**
 * Waits until a locator's bounding box stops moving.
 *
 * The FilterBar's pickers are Radix popovers anchored to the Add-filter
 * button, so anything that reflows the bar — chips wrapping, the run-mode
 * quick toggle appearing once the session resolves, counts arriving, the
 * table's scrollbar coming and going as a filter narrows the rows — drags the
 * open popover with it. Playwright's own actionability check samples stability
 * over two animation frames, which a still-settling page can defeat
 * repeatedly; this waits for the box to hold still across `stableFrames`
 * consecutive samples before the caller clicks.
 */
export async function waitForStableBox(
  locator: Locator,
  { timeout = 15000, stableFrames = 3, interval = 100 } = {}
): Promise<void> {
  const deadline = Date.now() + timeout;
  let previous: string | null = null;
  let stable = 0;

  while (Date.now() < deadline) {
    const box = await locator.boundingBox();
    const current = box ? `${box.x},${box.y},${box.width},${box.height}` : null;

    if (current !== null && current === previous) {
      stable += 1;
      if (stable >= stableFrames) return;
    } else {
      stable = 0;
    }

    previous = current;
    await locator.page().waitForTimeout(interval);
  }

  throw new Error(
    `waitForStableBox: ${locator} kept moving for ${timeout}ms — the page never settled`
  );
}
