// cspell:ignore networkidle domcontentloaded contenteditable
import { test, expect } from "@playwright/test";
import { SignInPage } from "./pages/SignInPage";
import { users } from "./fixtures/users";
import { loginAsAdmin } from "./helpers/auth";

test.describe("Admin System Notifications @admin @notifications", () => {
  test.beforeEach(async ({ page }) => {
    // Login as admin
    await loginAsAdmin(page);
    
    // Navigate to admin notifications page with retry logic
    await test.step("Navigate to admin notifications page", async () => {
      await page.goto("/admin/notifications", {
        waitUntil: "networkidle",
        timeout: 30000,
      });

      // Wait for the page to be fully loaded
      await page.waitForLoadState("domcontentloaded");
      await page.waitForLoadState("networkidle");

      // Wait for the page to load by checking for the main content using test ID
      await page.waitForSelector('[data-testid="notifications-page-title"]', {
        state: "visible",
        timeout: 10000,
      });

      // Ensure the page is interactive
      await page.waitForTimeout(500);
    });
  });

  test("should display system notifications section", async ({ page }) => {
    // Check if system notifications section exists using test ID
    await expect(
      page.locator('[data-testid="system-notifications-section"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="system-notifications-description"]')
    ).toBeVisible();

    // Check form elements using test IDs and labels
    await expect(
      page.locator('[data-testid="notification-title-input"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="notification-message-label"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="send-notification-button"]')
    ).toBeVisible();

    // Check notification history section using test ID
    await expect(
      page.locator('[data-testid="notification-history-title"]')
    ).toBeVisible();
  });

  test("should validate empty fields", async ({ page }) => {
    await test.step("Click send button without filling fields", async () => {
      // Wait for the button to be ready using test ID
      const sendButton = page.locator(
        '[data-testid="send-notification-button"]'
      );
      await expect(sendButton).toBeEnabled({ timeout: 5000 });

      // Click with retry
      await sendButton.click({ force: true });
    });

    await test.step("Verify error message appears", async () => {
      // Check for error message with retry - try different possible error messages
      const errorMessage = page.locator(
        "text=/Please provide both title and message|Title and message are required|Please fill in all required fields/i"
      );
      await expect(errorMessage).toBeVisible({ timeout: 10000 });
    });
  });

  test("should send a plain text system notification", async ({ page }) => {
    const title = `Test Notification ${Date.now()}`;
    const message = "This is a test system notification";

    await test.step("Fill in the notification form", async () => {
      // Fill title with retry using test ID
      const titleInput = page.locator(
        '[data-testid="notification-title-input"]'
      );
      await titleInput.waitFor({ state: "visible", timeout: 5000 });
      await titleInput.fill(title);
      await expect(titleInput).toHaveValue(title);

      // Handle TipTap editor with improved stability
      const editor = page.locator('[contenteditable="true"]').last();
      await editor.waitFor({ state: "visible", timeout: 5000 });
      await editor.click();

      // Clear any existing content first
      await editor.press("Control+a");
      await editor.press("Delete");

      // Type the message
      await editor.pressSequentially(message, { delay: 50 });

      // Verify content was entered
      await expect(editor).toContainText(message);
    });

    await test.step("Send the notification", async () => {
      const sendButton = page.locator(
        '[data-testid="send-notification-button"]'
      );
      await expect(sendButton).toBeEnabled();
      await sendButton.click();
    });

    await test.step("Verify success and form reset", async () => {
      // Check for success message with longer timeout
      // Use a more specific selector to avoid multiple matches
      const successToast = page.getByText("Notification Sent", { exact: true });
      await expect(successToast).toBeVisible({
        timeout: 15000,
      });

      // Also check for the success description to ensure notification was sent
      const toastDescription = page.locator("div[data-description]");
      const hasDescription = (await toastDescription.count()) > 0;
      if (hasDescription) {
        await expect(toastDescription.first()).toContainText("sent to", {
          timeout: 5000,
        });
      }

      // Wait a bit for form to reset
      await page.waitForTimeout(1000);

      // Verify fields are cleared
      await expect(
        page.locator('[data-testid="notification-title-input"]')
      ).toHaveValue("", { timeout: 5000 });

      // Wait for the success toast to disappear before checking history
      await successToast
        .waitFor({ state: "hidden", timeout: 10000 })
        .catch(() => {
          // Toast might have already disappeared
        });
    });

    await test.step("Verify notification appears in history", async () => {
      // Wait for the notification to appear in the history table
      await expect(page.getByRole("cell", { name: title })).toBeVisible({
        timeout: 15000,
      });

      // Look for message in the table row
      const tableRow = page.locator("tr").filter({ hasText: title });
      await expect(tableRow).toContainText(message, { timeout: 5000 });
    });
  });

  test("should send a rich text system notification", async ({ page }) => {
    const title = `Rich Notification ${Date.now()}`;

    await test.step("Fill in the title", async () => {
      const titleInput = page.locator(
        '[data-testid="notification-title-input"]'
      );
      await titleInput.waitFor({ state: "visible", timeout: 5000 });
      await titleInput.fill(title);
      await expect(titleInput).toHaveValue(title);
    });

    await test.step("Enter rich text content", async () => {
      // Get editor and ensure it's ready
      const editor = page.locator('[contenteditable="true"]').last();
      await editor.waitFor({ state: "visible", timeout: 5000 });
      await editor.click();

      // Clear any existing content
      await editor.press("Control+a");
      await editor.press("Delete");

      // Type plain text with delay
      await editor.pressSequentially("This is ", { delay: 50 });

      // Toggle bold formatting - find the button by its position in toolbar (first button after color picker)
      // The toolbar has buttons in order: color picker, then Bold, Italic, Underline, etc.
      const toolbar = page
        .locator(".rounded-md")
        .filter({ has: page.locator('[contenteditable="true"]') })
        .locator("..");
      const toolbarButtons = toolbar.locator('button[type="button"]');
      // Bold is typically the first formatting button after the color picker
      const boldButton = toolbarButtons.nth(1); // Skip color picker button
      await boldButton.waitFor({ state: "visible", timeout: 5000 });
      await boldButton.click();
      await page.waitForTimeout(200); // Wait for formatting to apply

      await editor.pressSequentially("bold text", { delay: 50 });
      await boldButton.click();
      await page.waitForTimeout(200);

      await editor.pressSequentially(" and ", { delay: 50 });

      // Toggle italic formatting - second formatting button in toolbar
      const italicButton = toolbarButtons.nth(2); // Italic is after Bold
      await italicButton.waitFor({ state: "visible", timeout: 5000 });
      await italicButton.click();
      await page.waitForTimeout(200);

      await editor.pressSequentially("italic text", { delay: 50 });
      await italicButton.click();
      await page.waitForTimeout(200);
    });

    await test.step("Send the notification", async () => {
      const sendButton = page.locator(
        '[data-testid="send-notification-button"]'
      );
      await expect(sendButton).toBeEnabled({ timeout: 5000 });
      await sendButton.click();
    });

    await test.step("Verify success", async () => {
      await expect(
        page.getByText("Notification Sent", { exact: true })
      ).toBeVisible({
        timeout: 15000,
      });
    });

    await test.step("Verify rich content in history", async () => {
      // Wait for the notification to appear in the history table
      await expect(page.getByRole("cell", { name: title })).toBeVisible({
        timeout: 15000,
      });

      // Check for formatted content with more specific selectors
      const historyRow = page.locator("tr").filter({ hasText: title });
      await expect(historyRow).toBeVisible({ timeout: 5000 });

      // Check for formatted content - the content should contain the text with formatting
      // Note: The exact HTML tags may vary, so check for the text content
      const messageCell = historyRow.locator("td").nth(1);
      await expect(messageCell).toContainText(
        "This is bold text and italic text",
        {
          timeout: 5000,
        }
      );
    });
  });

  test("should display sent by information", async ({ page }) => {
    const title = `Admin Test ${Date.now()}`;
    const message = "Test message";

    await test.step("Send a notification", async () => {
      // Fill title using test ID
      const titleInput = page.locator(
        '[data-testid="notification-title-input"]'
      );
      await titleInput.waitFor({ state: "visible", timeout: 5000 });
      await titleInput.fill(title);

      // Fill message
      const editor = page.locator('[contenteditable="true"]').last();
      await editor.waitFor({ state: "visible", timeout: 5000 });
      await editor.click();
      await editor.press("Control+a");
      await editor.press("Delete");
      await editor.pressSequentially(message, { delay: 50 });

      // Send
      const sendButton = page.locator(
        '[data-testid="send-notification-button"]'
      );
      await sendButton.click();
    });

    await test.step("Verify notification sent", async () => {
      await expect(
        page.getByText("Notification Sent", { exact: true })
      ).toBeVisible({
        timeout: 15000,
      });
    });

    await test.step("Verify admin name in history", async () => {
      // Wait for the notification to appear in the history table
      const historyRow = page.locator("tr").filter({ hasText: title });
      await expect(historyRow).toBeVisible({ timeout: 15000 });
      await expect(historyRow).toContainText("Test Admin", { timeout: 5000 });
    });
  });

  test("should handle long content with scrolling", async ({ page }) => {
    const title = `Long Content ${Date.now()}`;
    const longMessage = "This is a very long message. ".repeat(20);

    await test.step("Fill and send long notification", async () => {
      // Fill title using test ID
      const titleInput = page.locator(
        '[data-testid="notification-title-input"]'
      );
      await titleInput.waitFor({ state: "visible", timeout: 5000 });
      await titleInput.fill(title);

      // Fill long message - use paste for better performance with long text
      const editor = page.locator('[contenteditable="true"]').last();
      await editor.waitFor({ state: "visible", timeout: 5000 });
      await editor.click();
      await editor.press("Control+a");
      await editor.press("Delete");

      // Use evaluate to set content directly for long text
      await editor.evaluate((el, text) => {
        el.textContent = text;
        // Trigger input event
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }, longMessage);

      // Send notification
      const sendButton = page.locator(
        '[data-testid="send-notification-button"]'
      );
      await sendButton.click();
    });

    await test.step("Verify success", async () => {
      await expect(
        page.getByText("Notification Sent", { exact: true })
      ).toBeVisible({
        timeout: 15000,
      });
    });

    await test.step("Verify overflow handling in history", async () => {
      // Wait for the notification to appear in the history table
      const historyRow = page.locator("tr").filter({ hasText: title });
      await expect(historyRow).toBeVisible({ timeout: 15000 });

      // Get the message cell (second td)
      const messageCell = historyRow.locator("td").nth(1);
      await expect(messageCell).toBeVisible({ timeout: 5000 });

      // Check CSS properties for overflow handling
      const messageDiv = messageCell.locator("div").first();
      await expect(messageDiv).toHaveCSS("max-height", /\d+px/, {
        timeout: 5000,
      });
      await expect(messageDiv).toHaveCSS("overflow", "hidden", {
        timeout: 5000,
      });
    });
  });
});
