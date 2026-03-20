import { expect, test } from "../../fixtures";

/**
 * Test Run Edit Configuration Tests
 *
 * Tests the ConfigurationSelect (AsyncCombobox single-select) component
 * used for editing the configuration on an existing test run's detail page.
 * Covers:
 * - Viewing the configuration combobox in edit mode
 * - Switching configuration via the combobox
 * - Searching configurations in the edit combobox
 *
 * The AsyncCombobox uses a Popover with a Command list. The combobox
 * trigger is a button[role="combobox"] inside the Configuration FormItem.
 *
 * Note: The FormItem containing Configuration is a div with "space-y-2" class.
 * The FormLabel renders as a <label> element but Playwright sometimes shows it
 * as generic text in the accessibility tree. We locate by finding the container
 * with "Configuration" text and the combobox inside it.
 */

/** Helper: locate the Configuration combobox on the edit page */
async function getConfigCombobox(page: any) {
  // Wait for the page to fully load and stabilize
  await page.waitForTimeout(2000);

  // Wait for any combobox to be visible (the form has loaded)
  await page
    .locator('button[role="combobox"]')
    .first()
    .waitFor({ state: "visible", timeout: 15000 });

  // Find the Configuration form item: a container with exact text "Configuration"
  // that contains a combobox. The label renders inside a FormItem div.
  const configText = page.getByText("Configuration", { exact: true }).first();
  await expect(configText).toBeVisible({ timeout: 10000 });

  // Navigate to the FormItem parent (the div with class "space-y-2")
  const configFormItem = configText.locator("..");
  const configCombobox = configFormItem
    .locator('button[role="combobox"]')
    .first();
  await expect(configCombobox).toBeVisible({ timeout: 10000 });
  return configCombobox;
}

/** Helper: open the combobox and wait for options to load */
async function openComboboxAndWait(page: any, configCombobox: any) {
  // The right panel's resizable layout can intercept pointer events.
  // We use multiple strategies to open the popover.
  await configCombobox.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);

  // Strategy 1: mouse click at coordinates
  const box = await configCombobox.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
  await page.waitForTimeout(300);

  // Check if popover opened
  let commandList = page.locator('[cmdk-list]').first();
  let isOpen = await commandList.isVisible().catch(() => false);

  if (!isOpen) {
    // Strategy 2: force click
    await configCombobox.click({ force: true });
    await page.waitForTimeout(300);
    isOpen = await commandList.isVisible().catch(() => false);
  }

  if (!isOpen) {
    // Strategy 3: evaluate to simulate React click event
    await configCombobox.evaluate((el: HTMLElement) => {
      el.click();
    });
    await page.waitForTimeout(300);
  }

  await expect(commandList).toBeVisible({ timeout: 5000 });
  // Allow time for the async fetch of configurations to complete
  await page.waitForTimeout(1500);
}

test.describe("Test Run Edit Configuration", () => {
  test("should show ConfigurationSelect combobox in edit mode", async ({
    api,
    page,
  }) => {
    // Setup: Create project, configuration, and test run
    const projectId = await api.createProject(
      `E2E EditCfg ${Date.now()}`
    );
    const configName = `EditCfg Config ${Date.now()}`;
    await api.createConfiguration(configName);

    // Create a test run
    const testRunId = await api.createTestRun(
      projectId,
      `Config Run ${Date.now()}`
    );

    // Navigate directly to test run detail page in edit mode
    await page.goto(
      `/en-US/projects/runs/${projectId}/${testRunId}?edit=true`
    );
    await page.waitForLoadState("load");

    const configCombobox = await getConfigCombobox(page);

    // Open the combobox
    await openComboboxAndWait(page, configCombobox);

    // Verify the configuration appears in the dropdown
    await expect(
      page.locator(`[role="option"]:has-text("${configName}")`)
    ).toBeVisible({ timeout: 10000 });

    // Verify pagination controls are present
    const prevButton = page.getByRole("button", { name: "Previous" });
    await expect(prevButton).toBeVisible();
  });

  test("should change configuration via combobox in edit mode", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E ChangeCfg ${Date.now()}`
    );
    const ts = Date.now();
    const config1Name = `Original Config ${ts}`;
    const config2Name = `New Config ${ts}`;
    await api.createConfiguration(config1Name);
    await api.createConfiguration(config2Name);

    const testRunId = await api.createTestRun(
      projectId,
      `Change Config Run ${Date.now()}`
    );

    // Navigate directly in edit mode
    await page.goto(
      `/en-US/projects/runs/${projectId}/${testRunId}?edit=true`
    );
    await page.waitForLoadState("load");

    const configCombobox = await getConfigCombobox(page);
    await openComboboxAndWait(page, configCombobox);

    // Select config2
    const config2Option = page.locator(
      `[role="option"]:has-text("${config2Name}")`
    );
    await expect(config2Option).toBeVisible({ timeout: 10000 });
    await config2Option.click();

    // Verify combobox shows the new config
    await expect(configCombobox).toContainText(config2Name, {
      timeout: 5000,
    });
  });

  test("should search configurations in edit mode combobox", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E SearchCfg ${Date.now()}`
    );
    const ts = Date.now();
    const configMatch = `Searchable Edit ${ts}`;
    const configNoMatch = `Other Edit ${ts}`;
    await api.createConfiguration(configMatch);
    await api.createConfiguration(configNoMatch);

    const testRunId = await api.createTestRun(
      projectId,
      `Search Edit Run ${Date.now()}`
    );

    // Navigate directly in edit mode
    await page.goto(
      `/en-US/projects/runs/${projectId}/${testRunId}?edit=true`
    );
    await page.waitForLoadState("load");

    const configCombobox = await getConfigCombobox(page);
    await openComboboxAndWait(page, configCombobox);

    // Type in search — the Command input inside the popover
    const searchInput = page.locator('[cmdk-input]').first();
    await searchInput.fill("Searchable");

    await page.waitForTimeout(500);

    // Verify filtering
    await expect(
      page.locator(`[role="option"]:has-text("${configMatch}")`)
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator(`[role="option"]:has-text("${configNoMatch}")`)
    ).not.toBeVisible({ timeout: 3000 });
  });
});
