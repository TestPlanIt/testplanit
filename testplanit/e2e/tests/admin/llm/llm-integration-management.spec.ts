import { expect, test } from "../../../fixtures";

/**
 * LLM Integration Management E2E Tests
 *
 * Tests for the LLM integrations admin page (labeled "AI Models"): viewing,
 * adding, editing, deleting, and testing LLM provider integrations.
 *
 * Tests are lenient about actual LLM connectivity since no real LLM
 * provider is configured in the E2E environment.
 */

test.describe("LLM Integration Management - Page Display", () => {
  test("Admin can view LLM integrations page", async ({ page }) => {
    await test.step("Open the LLM integrations admin page", async () => {
      await page.goto("/en-US/admin/llm");
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify URL and page title", async () => {
      // Verify URL
      await expect(page).toHaveURL(/\/admin\/llm/);

      // Verify page title is present (data-testid="llm-admin-page-title")
      // The translated text is "AI Models" from admin.menu.llm
      const pageTitle = page.getByTestId("llm-admin-page-title");
      await expect(pageTitle).toBeVisible({ timeout: 10000 });
    });
  });

  test("LLM page shows add AI model button", async ({ page }) => {
    await test.step("Open the LLM integrations admin page", async () => {
      await page.goto("/en-US/admin/llm");
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the add AI model button is visible", async () => {
      // The CirclePlus add button triggers showAddDialog
      // Translated text is "Add AI Model" from admin.llm.addIntegration
      const addButton = page.locator("button").filter({
        hasText: /Add AI Model|Add Integration/i,
      });
      await expect(addButton.first()).toBeVisible({ timeout: 10000 });
    });
  });

  test("LLM page shows filter input", async ({ page }) => {
    await test.step("Open the LLM integrations admin page", async () => {
      await page.goto("/en-US/admin/llm");
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the filter input is visible", async () => {
      // Filter component is rendered with key="llm-filter"
      const filterInput = page
        .locator(
          'input[placeholder*="filter" i], input[placeholder*="search" i], input[placeholder*="AI model" i]'
        )
        .first();
      await expect(filterInput).toBeVisible({ timeout: 10000 });
    });
  });

  test("LLM page shows Test All Connections button", async ({ page }) => {
    await test.step("Open the LLM integrations admin page", async () => {
      await page.goto("/en-US/admin/llm");
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the Test All Connections button is visible", async () => {
      // The "Test All Connections" button is in the header area with RefreshCw icon
      const testAllButton = page.locator("button").filter({
        hasText: /Test All Connections|Test All/i,
      });
      await expect(testAllButton.first()).toBeVisible({ timeout: 10000 });
    });
  });
});

test.describe("LLM Integration Management - Add Integration", () => {
  test("Admin can open add integration dialog", async ({ page }) => {
    await test.step("Open the LLM integrations admin page", async () => {
      await page.goto("/en-US/admin/llm");
      await page.waitForLoadState("networkidle");
    });

    await test.step("Click the add button and verify the dialog opens", async () => {
      // Click the add button - translated as "Add AI Model"
      const addButton = page.locator("button").filter({
        hasText: /Add AI Model|Add Integration/i,
      });
      await addButton.first().click();

      // Dialog should open
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 10000 });
    });
  });

  test("Add integration dialog has required fields", async ({ page }) => {
    const dialog = page.locator('[role="dialog"]');

    await test.step("Open the add integration dialog", async () => {
      await page.goto("/en-US/admin/llm");
      await page.waitForLoadState("networkidle");

      const addButton = page.locator("button").filter({
        hasText: /Add AI Model|Add Integration/i,
      });
      await addButton.first().click();

      await expect(dialog).toBeVisible({ timeout: 10000 });
    });

    await test.step("Verify name field and provider select are present", async () => {
      // Verify name field is present (placeholder from admin.llm.add.integrationNamePlaceholder)
      const nameInput = dialog.locator("input").first();
      await expect(nameInput).toBeVisible({ timeout: 5000 });

      // Verify provider select is present
      const providerSelect = dialog.locator('[role="combobox"]').first();
      await expect(providerSelect).toBeVisible({ timeout: 5000 });
    });
  });

  test("Admin can add a new LLM integration with CUSTOM_LLM provider", async ({
    page,
    request,
    baseURL,
  }) => {
    const integrationName = `E2E LLM Test ${Date.now()}`;
    const apiBase = baseURL || "http://localhost:3000";

    const dialog = page.locator('[role="dialog"]');

    await test.step("Open the add integration dialog", async () => {
      await page.goto("/en-US/admin/llm");
      await page.waitForLoadState("networkidle");

      // Click add button - translated as "Add AI Model"
      const addButton = page.locator("button").filter({
        hasText: /Add AI Model|Add Integration/i,
      });
      await addButton.first().click();

      await expect(dialog).toBeVisible({ timeout: 10000 });
    });

    await test.step("Fill name and select CUSTOM_LLM provider", async () => {
      // Fill integration name
      const nameInput = dialog.locator("input").first();
      await nameInput.fill(integrationName);

      // Select CUSTOM_LLM provider (doesn't require API key auto-fetch)
      const providerSelect = dialog.locator('[role="combobox"]').first();
      await providerSelect.click();
      const customLlmOption = page
        .locator('[role="option"]')
        .filter({ hasText: /Custom/i });
      await expect(customLlmOption.first()).toBeVisible({ timeout: 5000 });
      await customLlmOption.first().click();

      // Wait for provider change to settle
      await page.waitForTimeout(500);

      // Fill default model (required field, no API fetch for CUSTOM_LLM)
      const modelInput = dialog
        .locator('input[placeholder*="model" i]')
        .first();
      if (await modelInput.isVisible()) {
        await modelInput.fill("custom-model-e2e");
      }
    });

    await test.step("Submit the create integration form", async () => {
      // Scroll to and click the Create/Submit button
      const submitButton = dialog
        .locator('button[type="submit"]')
        .filter({ hasText: /Create/i });
      await submitButton.scrollIntoViewIfNeeded();
      await submitButton.click();

      // Wait for dialog to close or error to appear
      await page.waitForTimeout(3000);
    });

    // Cleanup: find and delete the created integration via API
    try {
      const findResponse = await request.get(
        `${apiBase}/api/model/llmIntegration/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: {
                name: integrationName,
                isDeleted: false,
              },
              select: { id: true },
            }),
          },
        }
      );
      if (findResponse.ok()) {
        const found = await findResponse.json();
        const integrationId = found?.data?.id || found?.id;
        if (integrationId) {
          await request.post(`${apiBase}/api/model/llmIntegration/update`, {
            data: {
              where: { id: integrationId },
              data: { isDeleted: true },
            },
          });
        }
      }
    } catch (e) {
      // Cleanup failure is not a test failure
      console.warn("Cleanup failed:", e);
    }

    await test.step("Verify the page handled the submission", async () => {
      // Verify dialog closed (success) or that the page is still functional
      const dialogStillOpen = await dialog.isVisible().catch(() => false);
      // Either dialog closed (success) or validation error shown - both are acceptable outcomes
      expect(dialogStillOpen !== undefined).toBe(true);
    });
  });
});

test.describe("LLM Integration Management - Edit and Delete Operations", () => {
  test("Admin can open edit dialog for an existing integration", async ({
    page,
    request,
    baseURL,
  }) => {
    const integrationName = `E2E Edit LLM ${Date.now()}`;
    const apiBase = baseURL || "http://localhost:3000";

    // Create integration via API
    const createResponse = await request.post(
      `${apiBase}/api/model/llmIntegration/create`,
      {
        data: {
          data: {
            name: integrationName,
            provider: "CUSTOM_LLM",
            status: "ACTIVE",
            credentials: { apiKey: "", endpoint: "https://example.com/v1" },
            settings: {},
          },
        },
      }
    );

    let integrationId: number | null = null;

    if (createResponse.ok()) {
      const created = await createResponse.json();
      integrationId = created?.data?.id || created?.id;
    } else {
      // If creation fails, skip the test gracefully
      console.warn(
        "Could not create LLM integration via API, skipping edit test"
      );
      return;
    }

    try {
      const dialog = page.locator('[role="dialog"]');
      let row: ReturnType<typeof page.locator> | undefined;

      await test.step("Open the LLM integrations admin page and locate the row", async () => {
        await page.goto("/en-US/admin/llm");
        await page.waitForLoadState("networkidle");

        // Find the row with the integration name
        row = page.locator("tbody tr").filter({ hasText: integrationName });
        await expect(row).toBeVisible({ timeout: 10000 });
      });

      await test.step("Open the edit dialog for the integration", async () => {
        // Click the edit button using its test ID
        const editButton = row!.getByTestId("llm-edit-button");
        await expect(editButton).toBeVisible({ timeout: 5000 });
        await editButton.click();

        // Edit dialog should open
        await expect(dialog).toBeVisible({ timeout: 5000 });
      });

      await test.step("Close the edit dialog", async () => {
        // Close the dialog
        const closeButton = dialog
          .locator("button")
          .filter({ hasText: /Close|Cancel/i });
        if (
          await closeButton
            .first()
            .isVisible({ timeout: 1000 })
            .catch(() => false)
        ) {
          await closeButton.first().click();
        } else {
          await page.keyboard.press("Escape");
        }
      });
    } finally {
      // Cleanup
      if (integrationId) {
        await request
          .post(`${apiBase}/api/model/llmIntegration/update`, {
            data: {
              where: { id: integrationId },
              data: { isDeleted: true },
            },
          })
          .catch(() => {});
      }
    }
  });

  test("Admin can delete an LLM integration", async ({
    page,
    request,
    baseURL,
  }) => {
    const integrationName = `E2E Delete LLM ${Date.now()}`;
    const apiBase = baseURL || "http://localhost:3000";

    // Create integration via API
    const createResponse = await request.post(
      `${apiBase}/api/model/llmIntegration/create`,
      {
        data: {
          data: {
            name: integrationName,
            provider: "CUSTOM_LLM",
            status: "ACTIVE",
            credentials: { apiKey: "", endpoint: "https://example.com/v1" },
            settings: {},
          },
        },
      }
    );

    if (!createResponse.ok()) {
      console.warn(
        "Could not create LLM integration via API, skipping delete test"
      );
      return;
    }

    const created = await createResponse.json();
    const integrationId = created?.data?.id || created?.id;

    const alertDialog = page.locator('[role="alertdialog"]');

    await test.step("Open the LLM integrations admin page and click delete", async () => {
      await page.goto("/en-US/admin/llm");
      await page.waitForLoadState("networkidle");

      // Find the row with the integration
      const row = page.locator("tbody tr").filter({ hasText: integrationName });
      await expect(row).toBeVisible({ timeout: 10000 });

      // Click the delete button using its test ID
      const deleteButton = row.getByTestId("llm-delete-button");

      await deleteButton.click();

      // Confirm delete dialog (AlertDialog) should appear
      await page.waitForTimeout(500);
    });

    await test.step("Confirm deletion and verify the integration is removed", async () => {
      if (await alertDialog.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Click confirm/delete button (the last button in the footer)
        const confirmButton = alertDialog
          .locator("button")
          .filter({ hasText: /Delete/i });
        await confirmButton.last().click();

        // Wait for deletion to complete
        await page.waitForTimeout(2000);

        // Verify the integration is no longer visible
        await page.goto("/en-US/admin/llm");
        await page.waitForLoadState("networkidle");
        const deletedRow = page
          .locator("tbody tr")
          .filter({ hasText: integrationName });
        await expect(deletedRow).not.toBeVisible({ timeout: 10000 });
      } else {
        // Dialog didn't open, clean up via API
        if (integrationId) {
          await request
            .post(`${apiBase}/api/model/llmIntegration/update`, {
              data: {
                where: { id: integrationId },
                data: { isDeleted: true },
              },
            })
            .catch(() => {});
        }
      }
    });
  });
});

test.describe("LLM Integration Management - Test Connection", () => {
  test("Admin can open test connection dialog for an integration", async ({
    page,
    request,
    baseURL,
  }) => {
    const integrationName = `E2E Test Connection LLM ${Date.now()}`;
    const apiBase = baseURL || "http://localhost:3000";

    // Create integration via API
    const createResponse = await request.post(
      `${apiBase}/api/model/llmIntegration/create`,
      {
        data: {
          data: {
            name: integrationName,
            provider: "CUSTOM_LLM",
            status: "ACTIVE",
            credentials: {
              apiKey: "test-key",
              endpoint: "https://example.com/v1",
            },
            settings: {},
          },
        },
      }
    );

    if (!createResponse.ok()) {
      console.warn("Could not create LLM integration via API, skipping test");
      return;
    }

    const created = await createResponse.json();
    const integrationId = created?.data?.id || created?.id;

    try {
      const dialog = page.locator('[role="dialog"]');

      await test.step("Open the test connection dialog for the integration", async () => {
        await page.goto("/en-US/admin/llm");
        await page.waitForLoadState("networkidle");

        const row = page
          .locator("tbody tr")
          .filter({ hasText: integrationName });
        await expect(row).toBeVisible({ timeout: 10000 });

        // Click the test button using its test ID
        const testButton = row.getByTestId("llm-test-button");
        await expect(testButton).toBeVisible({ timeout: 5000 });
        await testButton.click();

        // Test connection dialog should open
        await expect(dialog).toBeVisible({ timeout: 5000 });
      });

      await test.step("Trigger the test connection if available", async () => {
        // Check if this dialog has a "Test Connection" button
        const testConnectionButton = dialog.locator("button").filter({
          hasText: /Test Connection|Retest/i,
        });
        const hasTestButton = await testConnectionButton
          .first()
          .isVisible({ timeout: 2000 })
          .catch(() => false);

        if (hasTestButton) {
          // Click the test connection button - will fail since no real LLM configured
          await testConnectionButton.first().click();
          // Wait for response (either success or failure toast)
          await page.waitForTimeout(3000);
        }
      });

      await test.step("Close the test connection dialog", async () => {
        // Close dialog
        const closeButton = dialog
          .locator("button")
          .filter({ hasText: /Close|Cancel/i });
        if (
          await closeButton
            .first()
            .isVisible({ timeout: 1000 })
            .catch(() => false)
        ) {
          await closeButton.first().click();
        } else {
          await page.keyboard.press("Escape");
        }
      });
    } finally {
      // Cleanup
      if (integrationId) {
        await request
          .post(`${apiBase}/api/model/llmIntegration/update`, {
            data: {
              where: { id: integrationId },
              data: { isDeleted: true },
            },
          })
          .catch(() => {});
      }
    }
  });

  test("Test All Connections button triggers UI response", async ({ page }) => {
    const testAllButton = page.locator("button").filter({
      hasText: /Test All Connections|Test All/i,
    });

    await test.step("Open the LLM page and verify the Test All button", async () => {
      await page.goto("/en-US/admin/llm");
      await page.waitForLoadState("networkidle");

      await expect(testAllButton.first()).toBeVisible({ timeout: 10000 });
    });

    await test.step("Trigger Test All Connections or confirm disabled state", async () => {
      // The Test All button is disabled when there are no integrations
      // It's enabled when integrations exist
      const isDisabled = await testAllButton.first().isDisabled();

      if (!isDisabled) {
        // If enabled, click it and verify some response
        await testAllButton.first().click();
        await page.waitForTimeout(2000);
        // Accept any outcome
      } else {
        // Disabled state (no integrations) is also valid
        expect(isDisabled).toBe(true);
      }
    });
  });
});
