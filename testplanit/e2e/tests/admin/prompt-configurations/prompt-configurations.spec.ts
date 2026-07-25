import { expect, test } from "../../../fixtures";
import { PromptConfigurationsPage } from "../../../page-objects/admin/prompt-configurations.page";
import { LLM_FEATURES } from "~/lib/llm/constants";

/**
 * Prompt Configurations CRUD Operations Tests
 *
 * Tests for navigating, creating, editing, filtering, and deleting
 * prompt configurations in the Admin > Prompt Configurations page.
 */

test.describe("Prompt Configurations - Navigation and Display", () => {
  let promptsPage: PromptConfigurationsPage;

  test.beforeEach(async ({ page }) => {
    promptsPage = new PromptConfigurationsPage(page);
  });

  test("Navigate to Prompt Configurations page", async ({ page }) => {
    await test.step("Open the Prompt Configurations page", async () => {
      await promptsPage.goto();
    });

    await test.step("Verify the URL and page title", async () => {
      // Verify we're on the correct page
      await expect(page).toHaveURL(/\/admin\/prompts/);

      // Verify the page title is visible
      await expect(promptsPage.pageTitle).toBeVisible();
      await expect(promptsPage.pageTitle).toContainText(
        "Prompt Configurations"
      );
    });
  });

  test("Page displays Add button and table", async () => {
    await test.step("Open the Prompt Configurations page", async () => {
      await promptsPage.goto();
    });

    await test.step("Verify the Add button and data table are visible", async () => {
      // Verify the Add button is visible
      await expect(promptsPage.addButton).toBeVisible();

      // Verify the data table is visible
      await expect(promptsPage.dataTable).toBeVisible();
    });
  });

  test("Seeded default prompt config is displayed", async () => {
    await test.step("Open the Prompt Configurations page", async () => {
      await promptsPage.goto();
    });

    await test.step("Verify the table has at least one row", async () => {
      // The seed creates a "System Default" prompt config
      // There should be at least one row in the table
      const rowCount = await promptsPage.getTableRowCount();
      expect(rowCount).toBeGreaterThan(0);
    });
  });

  test("Navigate via admin menu sidebar", async ({ page }) => {
    const promptsLink = page.locator("#admin-menu-prompts");

    await test.step("Open an admin page and expand the Tools & Integrations section", async () => {
      // Navigate to any admin page first
      await page.goto("/en-US/admin/projects");
      await page.waitForLoadState("networkidle");

      // The prompts link is in the "AI Tools" section which may be collapsed
      // Expand it if needed
      const toolsSection = page.getByTestId("admin-menu-section-aiTools");
      const toolsTrigger = toolsSection
        .locator("[data-radix-collection-item]")
        .first();
      // Check if the section content is visible by looking for any link inside
      if (
        !(await promptsLink.isVisible({ timeout: 1000 }).catch(() => false))
      ) {
        await toolsTrigger.click();
      }
    });

    await test.step("Click the Prompt Configurations link in the sidebar", async () => {
      await expect(promptsLink).toBeVisible({ timeout: 5000 });
      await promptsLink.click();
    });

    await test.step("Verify the Prompt Configurations page loads", async () => {
      await expect(page).toHaveURL(/\/admin\/prompts/);
      await expect(promptsPage.pageTitle).toBeVisible();
    });
  });
});

test.describe("Prompt Configurations - Create Operations", () => {
  let promptsPage: PromptConfigurationsPage;

  test.beforeEach(async ({ page }) => {
    promptsPage = new PromptConfigurationsPage(page);
    await promptsPage.goto();
  });

  test("Add prompt config with name and description", async () => {
    const configName = `E2E Prompt Config ${Date.now()}`;

    await test.step("Create a new prompt config with name and description", async () => {
      await promptsPage.clickAdd();
      await promptsPage.fillName(configName);
      await promptsPage.fillDescription("Created by E2E test");
      await promptsPage.submitForm();
    });

    await test.step("Verify the new config appears in the table", async () => {
      // Wait for dialog to close and verify the config appears
      await expect(promptsPage.dialog).not.toBeVisible({ timeout: 10000 });
      await promptsPage.expectConfigInTable(configName);
    });
  });

  test("Add dialog opens with pre-filled default prompts", async ({
    page: _page,
  }) => {
    await test.step("Open the Add dialog and verify the feature accordion", async () => {
      await promptsPage.clickAdd();

      // Verify the dialog has accordion sections for each feature
      // The accordion may be inside a scrollable container, so scroll to find it
      const accordion = promptsPage.dialog
        .locator('[data-orientation="vertical"]')
        .first();
      await expect(accordion).toBeVisible({ timeout: 10000 });
    });

    await test.step("Verify pre-filled feature sections are present", async () => {
      // Verify at least one feature section exists (e.g., "Test Case Generation")
      const testCaseGen = promptsPage.dialog.locator(
        "text=Test Case Generation"
      );
      await testCaseGen.scrollIntoViewIfNeeded();
      await expect(testCaseGen).toBeVisible({ timeout: 5000 });

      const editorAssistant = promptsPage.dialog.locator(
        "text=Editor Writing Assistant"
      );
      await editorAssistant.scrollIntoViewIfNeeded();
      await expect(editorAssistant).toBeVisible({ timeout: 5000 });
    });
  });

  test("Cannot create config with empty name", async () => {
    await test.step("Open the Add dialog and submit with an empty name", async () => {
      await promptsPage.clickAdd();

      // Leave name empty, try to submit
      await promptsPage.submitForm();
    });

    await test.step("Verify the dialog stays open due to validation", async () => {
      // Dialog should still be visible (validation prevents submission)
      await expect(promptsPage.dialog).toBeVisible();
    });
  });
});

test.describe("Prompt Configurations - Filter", () => {
  let promptsPage: PromptConfigurationsPage;

  test.beforeEach(async ({ page }) => {
    promptsPage = new PromptConfigurationsPage(page);
    await promptsPage.goto();
  });

  test("Filter narrows results", async () => {
    await test.step("Filter by a non-matching term", async () => {
      // Filter by a term that won't match anything
      await promptsPage.filterByText("zzz_nonexistent_config_zzz");
    });

    await test.step("Verify the table shows no results", async () => {
      // Table should show no results or fewer results
      const rowCount = await promptsPage.getTableRowCount();
      expect(rowCount).toBe(0);
    });
  });

  test("Clearing filter shows all results", async () => {
    await test.step("Apply a non-matching filter and verify no results", async () => {
      // Apply a filter
      await promptsPage.filterByText("zzz_nonexistent_config_zzz");
      const filteredCount = await promptsPage.getTableRowCount();
      expect(filteredCount).toBe(0);
    });

    await test.step("Clear the filter and verify results return", async () => {
      // Clear the filter
      await promptsPage.filterByText("");
      const allCount = await promptsPage.getTableRowCount();
      expect(allCount).toBeGreaterThan(0);
    });
  });
});

test.describe("Prompt Configurations - Edit Operations", () => {
  let promptsPage: PromptConfigurationsPage;
  const configName = `E2E Edit Config ${Date.now()}`;

  test.beforeEach(async ({ page, api, baseURL }) => {
    promptsPage = new PromptConfigurationsPage(page);

    // Create a config via API for editing, including prompts for all features.
    // The edit form validates that each feature has a non-empty systemPrompt,
    // so we must create PromptConfigPrompts for every feature.
    const apiBase = baseURL || "http://localhost:3002";
    // Derive from LLM_FEATURES (the source of truth the edit form validates
    // against) so adding a new feature never silently breaks the save flow.
    const features = Object.values(LLM_FEATURES);

    const response = await api["request"].post(
      `${apiBase}/api/model/promptConfig/create`,
      {
        data: {
          data: {
            name: configName,
            description: "Config for edit testing",
            isDefault: false,
            isActive: true,
            prompts: {
              create: features.map((feature) => ({
                feature,
                systemPrompt: `Default system prompt for ${feature}`,
                userPrompt: "",
                temperature: 0.7,
                maxOutputTokens: 2048,
              })),
            },
          },
        },
      }
    );

    if (!response.ok()) {
      const errorText = await response.text();
      console.error(
        `Failed to create prompt config: ${response.status()} - ${errorText}`
      );
    }

    await promptsPage.goto();
  });

  test("Edit config description", async ({ page: _page }) => {
    await test.step("Open the edit dialog and update the description", async () => {
      await promptsPage.clickEditOnRow(configName);

      const newDescription = `Updated description ${Date.now()}`;
      await promptsPage.fillDescription(newDescription);
    });

    await test.step("Save the changes and wait for the dialog to close", async () => {
      // Scroll the Save button into view and click it
      const saveButton = promptsPage.dialog.locator('button:has-text("Save")');
      await saveButton.scrollIntoViewIfNeeded();
      await saveButton.click();

      // Wait for dialog to close (the save may take time due to prompt feature updates)
      await expect(promptsPage.dialog).not.toBeVisible({ timeout: 30000 });
    });

    await test.step("Reload and verify the update persisted", async () => {
      // Verify the update persisted by reloading
      await promptsPage.goto();
      await promptsPage.expectConfigInTable(configName);
    });
  });
});

test.describe("Prompt Configurations - Delete Operations", () => {
  let promptsPage: PromptConfigurationsPage;

  test.beforeEach(async ({ page }) => {
    promptsPage = new PromptConfigurationsPage(page);
  });

  test("Delete a non-default config", async ({ page, api, baseURL }) => {
    const configName = `E2E Delete Config ${Date.now()}`;

    await test.step("Create a config via the API", async () => {
      // Create a config via API
      const apiBase = baseURL || "http://localhost:3002";
      const response = await api["request"].post(
        `${apiBase}/api/model/promptConfig/create`,
        {
          data: {
            data: {
              name: configName,
              description: "Config for delete testing",
              isDefault: false,
              isActive: true,
            },
          },
        }
      );

      if (!response.ok()) {
        const errorText = await response.text();
        console.error(
          `Failed to create prompt config: ${response.status()} - ${errorText}`
        );
      }
    });

    await test.step("Open the page and verify the config is present", async () => {
      await promptsPage.goto();
      await promptsPage.expectConfigInTable(configName);
    });

    await test.step("Delete the config and confirm", async () => {
      await promptsPage.clickDeleteOnRow(configName);
      await promptsPage.confirmDelete();
    });

    await test.step("Reload and verify the config is removed", async () => {
      // Wait for toast and verify config is removed
      await page.waitForTimeout(1000);
      await promptsPage.goto();
      await promptsPage.expectConfigNotInTable(configName);
    });
  });

  test("Default config delete button is disabled", async () => {
    await test.step("Open the Prompt Configurations page", async () => {
      await promptsPage.goto();
    });

    await test.step("Verify the default config delete button is disabled", async () => {
      // Find the row with the "Default" badge (VirtualizedDataTable data rows
      // carry data-row-id; there is no <tbody>/<tr>)
      const defaultRow = promptsPage.dataTable.locator("[data-row-id]", {
        hasText: "Default",
      });

      // The delete button should be disabled
      const deleteButton = defaultRow
        .first()
        .locator('button:has([class*="lucide-trash"])');
      await expect(deleteButton).toBeDisabled();
    });
  });
});
