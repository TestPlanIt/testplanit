import { expect, test } from "../../../fixtures";

/**
 * Security Settings E2E Tests
 *
 * Tests for the Admin → Security page:
 * - Page loads and displays password policy settings
 * - Slider interactions update values
 * - Save persists settings across page reloads
 * - Force All Users dialog renders with affected count
 *
 * Tests for user table password actions:
 * - Three-dot menu shows Force Password Change / Revoke Password for other users
 * - Three-dot menu hides password actions for the current admin user
 */

test.describe("Admin Security Settings", () => {
  test("Security page loads with all policy sections", async ({ page }) => {
    await test.step("Open the Admin Security page", async () => {
      await page.goto("/en-US/admin/security");
      await page.waitForLoadState("networkidle");

      // Verify page title
      await expect(page.getByText("Security").first()).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step("Verify password policy section and sliders", async () => {
      // Verify password policy section (exact match to avoid matching description)
      await expect(
        page.getByText("Password Policy", { exact: true })
      ).toBeVisible();

      // Verify all 5 sliders are present (by their labels)
      await expect(page.getByText("Minimum Password Length")).toBeVisible();
      await expect(page.getByText("Password History Depth")).toBeVisible();
      await expect(page.getByText("Password Expiration")).toBeVisible();
    });

    await test.step("Verify lockout policy section", async () => {
      // Verify lockout policy section
      await expect(
        page.getByText("Lockout Policy", { exact: true })
      ).toBeVisible();
      await expect(page.getByText("Lockout Threshold")).toBeVisible();
      await expect(page.getByText("Lockout Duration")).toBeVisible();
    });

    await test.step("Verify enforcement section and save button", async () => {
      // Verify enforcement section
      await expect(
        page.getByText("Force All Users to Change Password")
      ).toBeVisible();

      // Verify save button
      await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
    });
  });

  test("Slider changes value and persists after save", async ({ page }) => {
    let initialValue: string | null | undefined;
    let newValue: string | null | undefined;

    await test.step("Open Security page and read the initial slider value", async () => {
      await page.goto("/en-US/admin/security");
      await page.waitForLoadState("networkidle");

      // Find the min password length slider
      const minLengthSlider = page.locator("#minPasswordLength");
      await expect(minLengthSlider).toBeVisible({ timeout: 10000 });

      // Read the initial value — scope to the label row to get only this slider's value
      const minLengthLabel = page.getByText("Minimum Password Length");
      const minLengthRow = minLengthLabel.locator("..");
      initialValue = await minLengthRow
        .locator("span.tabular-nums")
        .textContent();
    });

    await test.step("Increment the slider with the keyboard", async () => {
      const minLengthSlider = page.locator("#minPasswordLength");

      // Sliders respond to keyboard: focus and press ArrowRight to increment
      await minLengthSlider.locator('[role="slider"]').focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");

      // Value should have changed
      const minLengthLabel = page.getByText("Minimum Password Length");
      const minLengthRow = minLengthLabel.locator("..");
      newValue = await minLengthRow.locator("span.tabular-nums").textContent();
      expect(Number(newValue)).toBeGreaterThan(Number(initialValue));
    });

    await test.step("Save the changed value", async () => {
      // Save
      await page.getByRole("button", { name: "Save" }).click();

      // Wait for success toast
      await expect(
        page.locator('[data-sonner-toast][data-type="success"]')
      ).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step("Reload and verify the value persisted", async () => {
      // Reload and verify persistence
      await page.reload();
      await page.waitForLoadState("networkidle");

      const reloadedLabel = page.getByText("Minimum Password Length");
      const reloadedRow = reloadedLabel.locator("..");
      const persistedValue = await reloadedRow
        .locator("span.tabular-nums")
        .textContent();

      expect(Number(persistedValue)).toBe(Number(newValue));
    });

    await test.step("Reset the slider back to the original value and save", async () => {
      // Reset back to original value
      const resetSlider = page
        .locator("#minPasswordLength")
        .locator('[role="slider"]');
      await resetSlider.focus();
      const diff = Number(newValue) - Number(initialValue);
      for (let i = 0; i < diff; i++) {
        await page.keyboard.press("ArrowLeft");
      }
      await page.getByRole("button", { name: "Save" }).click();
      await expect(
        page.locator('[data-sonner-toast][data-type="success"]')
      ).toBeVisible({
        timeout: 10000,
      });
    });
  });

  test("Force All Users dialog shows affected count", async ({ page }) => {
    const dialog = page.locator('[role="dialog"]');

    await test.step("Open the Force All Users dialog", async () => {
      await page.goto("/en-US/admin/security");
      await page.waitForLoadState("networkidle");

      // Click the Force All Users button
      await page.getByRole("button", { name: /Force All Users/i }).click();

      // Verify dialog opens
      await expect(dialog).toBeVisible({ timeout: 5000 });
    });

    await test.step("Verify the dialog shows an affected user count", async () => {
      // Dialog should show a count of affected users
      const dialogText = await dialog.textContent();
      expect(dialogText).toMatch(/\d+/);
    });

    await test.step("Cancel out of the dialog", async () => {
      // Close without confirming
      await dialog.getByRole("button", { name: /cancel/i }).click();
      await expect(dialog).not.toBeVisible();
    });
  });
});

test.describe("User Table Password Actions", () => {
  test("Three-dot menu shows password actions for other internal users", async ({
    page,
    api,
  }) => {
    // Create a test user to check menu items on
    const testEmail = `pwd-actions-test-${Date.now()}@example.com`;

    await test.step("Create a test user and open the users page", async () => {
      await api.createUser({
        name: "Password Actions Test",
        email: testEmail,
        password: "TestPass123!",
        access: "USER",
      });

      await page.goto("/en-US/admin/users");
      await page.waitForLoadState("networkidle");
    });

    await test.step("Open the three-dot menu for the test user", async () => {
      // Find the test user's row
      const userRow = page.locator("tr").filter({ hasText: testEmail });
      await expect(userRow).toBeVisible({ timeout: 10000 });

      // Click the three-dot menu button
      await userRow
        .locator("button")
        .filter({ has: page.locator("svg") })
        .last()
        .click();
    });

    await test.step("Verify password actions are available", async () => {
      // Verify password actions are visible
      const menu = page.locator('[role="menu"]');
      await expect(menu).toBeVisible({ timeout: 5000 });
      await expect(
        menu.getByRole("menuitem", { name: /Force Password Change/i })
      ).toBeVisible();
      await expect(
        menu.getByRole("menuitem", { name: /Revoke Password/i })
      ).toBeVisible();

      // Close menu
      await page.keyboard.press("Escape");
    });
  });

  test("Three-dot menu hides password actions for current admin", async ({
    page,
  }) => {
    await test.step("Open the three-dot menu for the current admin user", async () => {
      await page.goto("/en-US/admin/users");
      await page.waitForLoadState("networkidle");

      // The seeded admin email is admin@example.com
      const adminRow = page
        .locator("tr")
        .filter({ hasText: "admin@example.com" });
      await expect(adminRow).toBeVisible({ timeout: 10000 });

      // Click three-dot menu
      await adminRow
        .locator("button")
        .filter({ has: page.locator("svg") })
        .last()
        .click();
    });

    await test.step("Verify Edit is available but password and delete actions are hidden", async () => {
      const menu = page.locator('[role="menu"]');
      await expect(menu).toBeVisible({ timeout: 5000 });

      // Edit should be visible
      await expect(menu.getByRole("menuitem", { name: /edit/i })).toBeVisible();

      // Password actions should NOT be visible
      await expect(
        menu.getByRole("menuitem", { name: /Force Password Change/i })
      ).not.toBeVisible();
      await expect(
        menu.getByRole("menuitem", { name: /Revoke Password/i })
      ).not.toBeVisible();

      // Delete should also NOT be visible (self-delete protection)
      await expect(
        menu.getByRole("menuitem", { name: /delete/i })
      ).not.toBeVisible();

      await page.keyboard.press("Escape");
    });
  });
});
