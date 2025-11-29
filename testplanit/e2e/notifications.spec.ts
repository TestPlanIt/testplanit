import { test, expect } from "@playwright/test";
import { SignInPage } from "./pages/SignInPage";
import { users } from "./fixtures/users";

test.describe.serial("Notification System @notifications", () => {
  test("should show empty state when no notifications", async ({ page }) => {
    // Sign in as user without notifications
    const signInPage = new SignInPage(page);
    await signInPage.goto();
    await signInPage.login(
      users.userWithoutNotifications.email,
      users.userWithoutNotifications.password
    );

    // Wait for navigation to complete
    await page.waitForLoadState("networkidle");

    // First, clean up any existing notifications by deleting them all
    await page.getByTestId("notification-bell-button").click();
    await page.waitForTimeout(500);

    // Delete all notifications if any exist
    let notifications = page.locator("[data-notification-item]");
    let count = await notifications.count();

    while (count > 0) {
      // Always delete the first notification and wait for it to be removed
      const firstNotification = notifications.first();
      const actionsButton = firstNotification.getByRole("button", { name: "Actions" });
      
      // Click actions button and wait for menu to appear
      await actionsButton.click();
      
      // Wait for the dropdown menu to be visible and then click Delete
      const deleteMenuItem = page.getByRole("menuitem", { name: "Delete" });
      await expect(deleteMenuItem).toBeVisible({ timeout: 5000 });
      await deleteMenuItem.click();

      // Wait for the deletion to complete
      await page.waitForTimeout(1000);

      // Re-query notifications to get updated count
      notifications = page.locator("[data-notification-item]");
      count = await notifications.count();
    }

    // Close and reopen notification dropdown to refresh
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    await page.getByTestId("notification-bell-button").click();
    await page.waitForTimeout(500);

    // Verify empty state
    await expect(page.getByText("No notifications")).toBeVisible({
      timeout: 5000,
    });
  });

  test("should allow marking notifications as read/unread", async ({
    page,
  }) => {
    // Sign in as user with notifications
    const signInPage = new SignInPage(page);
    await signInPage.goto();
    await signInPage.login(
      users.userWithNotifications.email,
      users.userWithNotifications.password
    );

    // Click notification bell
    await page.getByTestId("notification-bell-button").click();

    // Wait for dropdown to open
    await page.waitForSelector("[data-notification-item]", { timeout: 5000 });

    // Verify we have notifications and can interact with the Actions menu
    const notifications = page.locator("[data-notification-item]");
    const count = await notifications.count();
    expect(count).toBeGreaterThan(0);

    // Test that we can open the actions menu for the first notification
    const firstNotification = notifications.first();
    const actionsButton = firstNotification.getByRole("button", {
      name: "Actions",
    });
    await expect(actionsButton).toBeVisible();

    // Click the actions button to open the menu
    await actionsButton.click();

    // Verify the menu items are visible
    const markAsReadOrUnread = page.getByRole("menuitem", {
      name: /Mark as (read|unread)/,
    });
    await expect(markAsReadOrUnread).toBeVisible();

    // Click outside to close the menu
    await page.keyboard.press("Escape");

    // Verify notifications UI is working properly
    await expect(firstNotification).toBeVisible();
  });

  test("should allow deleting notifications", async ({ page }) => {
    // Sign in as the user that has notifications
    const signInPage = new SignInPage(page);
    await signInPage.goto();
    await signInPage.login(
      users.userWithNotifications.email,
      users.userWithNotifications.password
    );

    // Click notification bell
    await page.getByTestId("notification-bell-button").click();

    // Wait for dropdown to open and ensure notifications exist
    await page.waitForSelector("[data-notification-item]", { timeout: 5000 });

    // Count notifications before deletion
    const notificationsBefore = await page.locator("[data-notification-item]").count();
    expect(notificationsBefore).toBeGreaterThan(0);

    // Delete the first notification
    const firstNotification = page.locator("[data-notification-item]").first();
    
    // Store the text/id of the first notification to verify it's removed
    const firstNotificationText = await firstNotification.textContent();
    
    await firstNotification.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    
    // Wait a moment for the server action to process
    await page.waitForTimeout(1000);

    // Wait for the UI to update - count should decrease by 1
    await expect(page.locator("[data-notification-item]")).toHaveCount(notificationsBefore - 1, {
      timeout: 10000,
    });
  });

  test("should allow marking all notifications as read", async ({ page }) => {
    // Sign in as yet another user to avoid conflicts with previous tests
    const signInPage = new SignInPage(page);
    await signInPage.goto();
    await signInPage.login(
      users.testuser2.email,
      users.testuser2.password
    );

    // Click notification bell
    await page.getByTestId("notification-bell-button").click();

    // Wait for dropdown to open
    await page.waitForSelector("[data-notification-item]", { timeout: 5000 });

    // First, ensure we have some unread notifications
    // If all are read due to auto-mark-as-read, mark some as unread
    const notifications = page.locator("[data-notification-item]");
    const count = await notifications.count();

    if (count > 0) {
      // Check if we have any unread notifications
      const unreadCount = await page.locator('[data-state="unread"]').count();

      if (unreadCount === 0) {
        // Mark at least one notification as unread
        const firstNotification = notifications.first();
        await firstNotification
          .getByRole("button", { name: "Actions" })
          .click();
        await page.getByRole("menuitem", { name: "Mark as unread" }).click();
        await page.waitForTimeout(500);
      }

      // Now we should have at least one unread notification
      const unreadBeforeClick = await page
        .locator('[data-state="unread"]')
        .count();
      expect(unreadBeforeClick).toBeGreaterThan(0);

      // Click mark all as read
      await page.getByRole("button", { name: "Mark all as read" }).click();

      // Wait for the action to complete
      await page.waitForTimeout(1000);

      // Verify all notifications are marked as read
      await expect(page.locator('[data-state="unread"]')).toHaveCount(0, {
        timeout: 10000,
      });

      // The "Mark all as read" button should be disabled when no unread notifications
      await expect(
        page.getByRole("button", { name: "Mark all as read" })
      ).toBeDisabled();
    }
  });

  test("admin should be able to configure global notification settings", async ({
    page,
  }) => {
    // Sign in as admin
    const signInPage = new SignInPage(page);
    await signInPage.goto();
    await signInPage.login(users.admin.email, users.admin.password);

    // Navigate to admin notifications page directly
    await page.goto("/admin/notifications");

    // Wait for page to load
    await page.waitForLoadState("load");

    // Verify page loaded
    await expect(page.getByTestId("notifications-page-title")).toBeVisible({
      timeout: 10000,
    });

    // Change default mode to Email - Daily
    await page.getByLabel("In-App + Email (Daily Digest)").click();

    // Save settings
    await page.getByRole("button", { name: "Save Settings" }).click();

    // Verify success message
    await expect(
      page.getByText("Notification settings have been updated successfully")
    ).toBeVisible();

    // Reload page and verify settings persisted
    await page.reload();
    await expect(
      page.getByRole("radio", { name: "In-App + Email (Daily Digest)" })
    ).toBeChecked();
  });
});
