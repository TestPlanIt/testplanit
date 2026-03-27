import { expect, test } from "../../../fixtures";

/**
 * Project AI Models Per-Feature Override E2E Tests
 *
 * Tests for assigning, verifying, and clearing per-feature LLM overrides
 * on the Project Settings > AI Models page.
 *
 * Covers TEST-04: E2E coverage for project AI Models per-feature override workflow.
 */

test.describe("Project AI Models - Feature Overrides Table", () => {
  test("Feature overrides table shows all 7 features", async ({
    page,
    api,
  }) => {
    // Create a fresh project so we have a valid projectId
    const projectId = await api.createProject(`E2E AI Models Features ${Date.now()}`);

    await page.goto(`/en-US/projects/settings/${projectId}/ai-models`);
    await page.waitForLoadState("networkidle");

    // Verify all 7 LLM features are listed in the table
    const featureNames = [
      "Markdown Test Case Parsing",
      "Test Case Generation",
      "Smart Test Case Selection",
      "Editor Writing Assistant",
      "LLM Connection Test",
      "Export Code Generation",
      "AI Tag Suggestions",
    ];

    for (const name of featureNames) {
      await expect(page.locator("td", { hasText: name }).first()).toBeVisible({
        timeout: 10000,
      });
    }
  });
});

test.describe("Project AI Models - Assign Per-Feature Override", () => {
  test("Assign LLM override for a feature", async ({
    page,
    api,
  }) => {
    const ts = Date.now();
    const llmName = `E2E Override ${ts}`;

    // Create a fresh project and LLM integration
    const projectId = await api.createProject(`E2E AI Override ${ts}`);
    const llmId = await api.createLlmIntegration(llmName);
    await api.linkLlmToProject(projectId, llmId);

    await page.goto(`/en-US/projects/settings/${projectId}/ai-models`);
    await page.waitForLoadState("networkidle");

    // Find the Feature Overrides table — it's the last table on the page
    const lastTable = page.locator("table").last();

    // Find the row for "Test Case Generation"
    const row = lastTable
      .locator("tr")
      .filter({ hasText: "Test Case Generation" });

    // Click the override Select trigger in that row
    const selectTrigger = row.locator('button[role="combobox"]');
    await selectTrigger.scrollIntoViewIfNeeded();
    await selectTrigger.click();

    // Select the created integration from the portal dropdown
    const option = page.getByRole("option", { name: llmName });
    await option.click();

    // Wait for the mutation to complete
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Verify the "Effective LLM" column shows the integration name
    await expect(row).toContainText(llmName);

    // Verify the "Source" column shows "Project Override" badge text
    await expect(row.getByText("Project Override")).toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe("Project AI Models - Clear Per-Feature Override", () => {
  test("Clear per-feature override returns to fallback", async ({
    page,
    api,
    baseURL,
  }) => {
    const ts = Date.now();
    const llmName = `E2E Override Clear ${ts}`;
    const apiBase = baseURL || "http://localhost:3002";

    // Create a fresh project and LLM integration
    const projectId = await api.createProject(`E2E AI Clear ${ts}`);
    const llmId = await api.createLlmIntegration(llmName);
    await api.linkLlmToProject(projectId, llmId);

    // Pre-assign override via API by creating an LlmFeatureConfig
    const featureConfigResponse = await api["request"].post(
      `${apiBase}/api/model/llmFeatureConfig/create`,
      {
        data: {
          data: {
            projectId,
            feature: "test_case_generation",
            llmIntegrationId: llmId,
            enabled: true,
          },
        },
      }
    );

    if (!featureConfigResponse.ok()) {
      const errorText = await featureConfigResponse.text();
      throw new Error(
        `Failed to create feature config: ${featureConfigResponse.status()} - ${errorText}`
      );
    }

    await page.goto(`/en-US/projects/settings/${projectId}/ai-models`);
    await page.waitForLoadState("networkidle");

    // Find the Feature Overrides table (last table on the page)
    const lastTable = page.locator("table").last();

    // Find the "Test Case Generation" row
    const row = lastTable
      .locator("tr")
      .filter({ hasText: "Test Case Generation" });

    // Verify the row shows "Project Override" badge (the override is set)
    await expect(row.getByText("Project Override")).toBeVisible({
      timeout: 10000,
    });

    // Click the Select to open the dropdown and choose "No override" to clear
    const selectTrigger = row.locator('button[role="combobox"]');
    await selectTrigger.scrollIntoViewIfNeeded();
    await selectTrigger.click();

    // Select "No override" to clear the override
    const noOverrideOption = page.getByRole("option", { name: "No override" });
    await noOverrideOption.click();

    // Wait for mutation to complete
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Verify the "Project Override" badge is gone from the Source column
    await expect(row.getByText("Project Override")).not.toBeVisible({
      timeout: 5000,
    });
  });
});
