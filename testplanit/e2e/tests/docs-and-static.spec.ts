import { expect, test } from "../fixtures";

/**
 * Two static-ish pages the route sweep found uncovered: the interactive API
 * docs and the trial-expired notice.
 */
test.describe("API docs and static pages", () => {
  test("/docs/api renders the API categories and the Swagger UI", async ({
    page,
  }) => {
    await page.goto("/en-US/docs/api");
    const category = page.getByText("Custom API Endpoints");
    await expect(category).toBeVisible({ timeout: 15000 });
    // Swagger UI mounts only once a category is chosen.
    await category.click();
    await expect(page.locator(".swagger-ui").first()).toBeVisible({
      timeout: 30000,
    });
  });

  test("/trial-expired shows the expiry notice", async ({ page }) => {
    await page.goto("/en-US/trial-expired");
    await expect(page.getByText("Your Trial Has Expired")).toBeVisible({
      timeout: 15000,
    });
  });
});
