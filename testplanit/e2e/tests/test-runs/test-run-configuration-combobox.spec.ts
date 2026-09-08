import { expect, test } from "../../fixtures";

/**
 * Test Run Configuration Combobox Tests
 *
 * Tests the MultiAsyncCombobox component used for selecting configurations
 * when creating a new test run. Covers:
 * - Opening the combobox and seeing available configurations
 * - Searching/filtering configurations
 * - Selecting multiple configurations (badge display)
 * - Removing selected configurations via badge X button
 * - Select All functionality
 * - Pagination in the combobox dropdown
 *
 * Note: The dialog has overflow-y-auto which intercepts pointer events;
 *       clicks inside the dialog use force: true or dispatchEvent("click").
 * Note: The page may render multiple dialog instances in the DOM from different
 *       trigger buttons. We use .last() to target the most recently opened one.
 */

/** Helper: open the AddTestRunModal and locate the configurations combobox */
async function openModalAndGetConfigCombobox(page: any) {
  const newRunButton = page.getByTestId("new-run-button");
  await expect(newRunButton).toBeVisible({ timeout: 15000 });
  await newRunButton.click();

  // Multiple dialog instances may exist in the DOM; target the last one (most recently opened)
  const dialog = page.locator('[role="dialog"]').last();
  await expect(dialog).toBeVisible({ timeout: 10000 });

  // The configurations label is inside a FormItem; the combobox is a sibling
  const configLabel = dialog.locator('label:has-text("Configurations")');
  await expect(configLabel).toBeVisible({ timeout: 5000 });
  const configFormItem = configLabel.locator("..");
  const configCombobox = configFormItem.locator('button[role="combobox"]');
  await expect(configCombobox).toBeVisible({ timeout: 5000 });

  return { dialog, configCombobox };
}

/** Helper: click the combobox trigger and wait for options to appear */
async function openComboboxDropdown(page: any, configCombobox: any) {
  // The dialog's overflow-y-auto can intercept pointer events.
  // Use multiple strategies to open the popover.
  await configCombobox.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);

  // Strategy 1: mouse click at element coordinates
  const box = await configCombobox.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
  await page.waitForTimeout(300);

  const popover = page.locator("[cmdk-list]").first();
  let isOpen = await popover.isVisible().catch(() => false);

  if (!isOpen) {
    // Strategy 2: force click
    await configCombobox.click({ force: true });
    await page.waitForTimeout(300);
    isOpen = await popover.isVisible().catch(() => false);
  }

  if (!isOpen) {
    // Strategy 3: programmatic click via evaluate
    await configCombobox.evaluate((el: HTMLElement) => {
      el.click();
    });
    await page.waitForTimeout(300);
  }

  await expect(popover).toBeVisible({ timeout: 5000 });
}

test.describe("Test Run Configuration Combobox", () => {
  test("should display configurations in multi-select combobox when creating a test run", async ({
    api,
    page,
  }) => {
    const configName1 = `Config Alpha ${Date.now()}`;
    const configName2 = `Config Beta ${Date.now()}`;
    let projectId: number | undefined;

    await test.step("Create project and configurations", async () => {
      projectId = await api.createProject(`E2E Config Combobox ${Date.now()}`);
      await api.createConfiguration(configName1, projectId);
      await api.createConfiguration(configName2, projectId);
    });

    let configCombobox: any;

    await test.step("Open the new test run modal configurations combobox", async () => {
      await page.goto(`/en-US/projects/runs/${projectId}`);
      await page.waitForLoadState("load");

      ({ configCombobox } = await openModalAndGetConfigCombobox(page));
      await openComboboxDropdown(page, configCombobox);
    });

    await test.step("Verify both configurations appear in the dropdown", async () => {
      await expect(
        page.locator(`[role="option"]:has-text("${configName1}")`)
      ).toBeVisible({ timeout: 5000 });
      await expect(
        page.locator(`[role="option"]:has-text("${configName2}")`)
      ).toBeVisible();
    });
  });

  test("should select and display configuration as badge", async ({
    api,
    page,
  }) => {
    const configName = `Badge Config ${Date.now()}`;
    let projectId: number | undefined;

    await test.step("Create project and configuration", async () => {
      projectId = await api.createProject(`E2E Config Badge ${Date.now()}`);
      await api.createConfiguration(configName, projectId);
    });

    let configCombobox: any;

    await test.step("Open the new test run modal configurations combobox", async () => {
      await page.goto(`/en-US/projects/runs/${projectId}`);
      await page.waitForLoadState("load");

      ({ configCombobox } = await openModalAndGetConfigCombobox(page));
      await openComboboxDropdown(page, configCombobox);
    });

    await test.step("Select the configuration and close the popover", async () => {
      const configOption = page.locator(
        `[role="option"]:has-text("${configName}")`
      );
      await expect(configOption).toBeVisible({ timeout: 5000 });
      await configOption.click();

      // Close the popover so the combobox trigger shows the selected badge
      await page.keyboard.press("Escape");
    });

    await test.step("Verify the selected configuration appears in the combobox trigger", async () => {
      await expect(configCombobox).toContainText(configName, {
        timeout: 5000,
      });
    });
  });

  test("should remove configuration by clicking badge X button", async ({
    api,
    page,
  }) => {
    const configName = `Remove Config ${Date.now()}`;
    let projectId: number | undefined;

    await test.step("Create project and configuration", async () => {
      projectId = await api.createProject(`E2E Config Remove ${Date.now()}`);
      await api.createConfiguration(configName, projectId);
    });

    let configCombobox: any;

    await test.step("Open the new test run modal configurations combobox", async () => {
      await page.goto(`/en-US/projects/runs/${projectId}`);
      await page.waitForLoadState("load");

      ({ configCombobox } = await openModalAndGetConfigCombobox(page));
      await openComboboxDropdown(page, configCombobox);
    });

    await test.step("Select the configuration and confirm it shows in the trigger", async () => {
      const configOption = page.locator(
        `[role="option"]:has-text("${configName}")`
      );
      await expect(configOption).toBeVisible({ timeout: 5000 });
      await configOption.click();

      // Close the popover
      await page.keyboard.press("Escape");

      // Verify config is shown in combobox trigger
      await expect(configCombobox).toContainText(configName, {
        timeout: 5000,
      });
    });

    await test.step("Remove the configuration via the badge X button", async () => {
      // Click the X button on the badge to remove it
      // The badge contains the config name and has a [role="button"] span with the X icon
      const badge = configCombobox
        .locator(`div:has-text("${configName}")`)
        .first();
      const removeButton = badge.locator('[role="button"]');
      await removeButton.click({ force: true });

      // Verify config is no longer in combobox trigger
      await expect(configCombobox).not.toContainText(configName, {
        timeout: 3000,
      });
    });
  });

  test("should search and filter configurations in combobox", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const configNameMatch = `Searchable Config ${ts}`;
    const configNameNoMatch = `Other Widget ${ts}`;
    let projectId: number | undefined;

    await test.step("Create project and two configurations", async () => {
      projectId = await api.createProject(`E2E Config Search ${Date.now()}`);
      await api.createConfiguration(configNameMatch, projectId);
      await api.createConfiguration(configNameNoMatch, projectId);
    });

    let configCombobox: any;

    await test.step("Open the new test run modal configurations combobox", async () => {
      await page.goto(`/en-US/projects/runs/${projectId}`);
      await page.waitForLoadState("load");

      ({ configCombobox } = await openModalAndGetConfigCombobox(page));
      await openComboboxDropdown(page, configCombobox);
    });

    const searchInput = page.locator("[cmdk-input]").first();

    await test.step("Filter by timestamp and verify both configs are visible", async () => {
      // Search for the timestamp to find only our test's configs (avoids pagination issues)
      await searchInput.fill(String(ts));
      await page.waitForTimeout(500);

      // Both configs should be visible when filtered by timestamp
      await expect(
        page.locator(`[role="option"]:has-text("${configNameMatch}")`)
      ).toBeVisible({ timeout: 5000 });
      await expect(
        page.locator(`[role="option"]:has-text("${configNameNoMatch}")`)
      ).toBeVisible();
    });

    await test.step("Narrow the search and verify only the matching config remains", async () => {
      // Now filter further with "Searchable" to narrow results
      await searchInput.fill("Searchable");
      await page.waitForTimeout(500);

      // Matching config should be visible, non-matching should not
      await expect(
        page.locator(`[role="option"]:has-text("${configNameMatch}")`)
      ).toBeVisible({ timeout: 5000 });
      await expect(
        page.locator(`[role="option"]:has-text("${configNameNoMatch}")`)
      ).not.toBeVisible({ timeout: 3000 });
    });
  });

  test("only shows configurations assigned to the current project", async ({
    api,
    page,
  }) => {
    // Two projects, each with its own configuration. The picker for project A
    // must show A's config and must NOT show B's (configurations are
    // project-scoped).
    const ts = Date.now();
    const configInA = `ScopedToA ${ts}`;
    const configInB = `ScopedToB ${ts}`;
    let projectAId: number | undefined;

    await test.step("Create two projects each with its own configuration", async () => {
      projectAId = await api.createProject(`E2E Scope A ${ts}`);
      const projectBId = await api.createProject(`E2E Scope B ${ts}`);
      await api.createConfiguration(configInA, projectAId);
      await api.createConfiguration(configInB, projectBId);
    });

    let configCombobox: any;

    await test.step("Open the new test run modal configurations combobox for project A", async () => {
      await page.goto(`/en-US/projects/runs/${projectAId}`);
      await page.waitForLoadState("load");

      ({ configCombobox } = await openModalAndGetConfigCombobox(page));
      await openComboboxDropdown(page, configCombobox);
    });

    await test.step("Verify only the project-assigned configuration appears", async () => {
      // Search by the shared timestamp so both candidate configs would match by
      // name; only the project-assigned one should actually appear.
      const searchInput = page.locator("[cmdk-input]").first();
      await searchInput.fill(String(ts));
      await page.waitForTimeout(500);

      await expect(
        page.locator(`[role="option"]:has-text("${configInA}")`)
      ).toBeVisible({ timeout: 5000 });
      await expect(
        page.locator(`[role="option"]:has-text("${configInB}")`)
      ).not.toBeVisible({ timeout: 3000 });
    });
  });

  test("should select multiple configurations", async ({ api, page }) => {
    const ts = Date.now();
    const config1 = `Multi A ${ts}`;
    const config2 = `Multi B ${ts}`;
    const config3 = `Multi C ${ts}`;
    let projectId: number | undefined;

    await test.step("Create project and three configurations", async () => {
      projectId = await api.createProject(`E2E Multi Config ${Date.now()}`);
      await api.createConfiguration(config1, projectId);
      await api.createConfiguration(config2, projectId);
      await api.createConfiguration(config3, projectId);
    });

    let configCombobox: any;

    await test.step("Open the new test run modal configurations combobox", async () => {
      await page.goto(`/en-US/projects/runs/${projectId}`);
      await page.waitForLoadState("load");

      ({ configCombobox } = await openModalAndGetConfigCombobox(page));
      await openComboboxDropdown(page, configCombobox);
    });

    await test.step("Select the first configuration and confirm it hides from the list", async () => {
      // Select first configuration
      await page.locator(`[role="option"]:has-text("${config1}")`).click();

      // The MultiAsyncCombobox stays open after selection with hideSelected=true
      // The selected option is hidden from the list
      await expect(
        page.locator(`[role="option"]:has-text("${config1}")`)
      ).not.toBeVisible({ timeout: 3000 });
    });

    await test.step("Select the second configuration and close the popover", async () => {
      // Select second configuration
      await page.locator(`[role="option"]:has-text("${config2}")`).click();

      // Close the popover by pressing Escape
      await page.keyboard.press("Escape");
    });

    await test.step("Verify both configurations appear in the combobox trigger", async () => {
      await expect(configCombobox).toContainText(config1, {
        timeout: 5000,
      });
      await expect(configCombobox).toContainText(config2);
    });
  });

  test("should use Select All to bulk select configurations", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const config1 = `SelectAll A ${ts}`;
    const config2 = `SelectAll B ${ts}`;
    let projectId: number | undefined;

    await test.step("Create project and two configurations", async () => {
      projectId = await api.createProject(`E2E Select All ${Date.now()}`);
      await api.createConfiguration(config1, projectId);
      await api.createConfiguration(config2, projectId);
    });

    let configCombobox: any;

    await test.step("Open the new test run modal configurations combobox", async () => {
      await page.goto(`/en-US/projects/runs/${projectId}`);
      await page.waitForLoadState("load");

      ({ configCombobox } = await openModalAndGetConfigCombobox(page));
      await openComboboxDropdown(page, configCombobox);
    });

    await test.step("Filter to this test's configs and click Select All", async () => {
      // Search for the timestamp to filter to only our test's configs
      // (avoids pagination issues when other tests create configs in parallel)
      const searchInput = page.locator("[cmdk-input]").first();
      await searchInput.fill(`SelectAll`);
      await page.waitForTimeout(500);

      // Wait for our options to load
      await expect(
        page.locator(`[role="option"]:has-text("${config1}")`)
      ).toBeVisible({ timeout: 5000 });

      // Click "Select All" (selects every config matching the search, not just
      // the visible page)
      const selectAll = page.getByTestId("multi-async-combobox-select-all");
      await expect(selectAll).toBeVisible({ timeout: 3000 });
      await selectAll.click();

      // Close the popover
      await page.keyboard.press("Escape");
    });

    await test.step("Verify both configurations are selected", async () => {
      await expect(configCombobox).toContainText(config1, {
        timeout: 5000,
      });
      await expect(configCombobox).toContainText(config2);
    });
  });

  test("should clear every selected configuration from the dropdown", async ({
    api,
    page,
  }) => {
    const configName = `ClearAll Config ${Date.now()}`;
    let projectId: number | undefined;

    await test.step("Create project and configuration", async () => {
      projectId = await api.createProject(`E2E Clear All ${Date.now()}`);
      await api.createConfiguration(configName, projectId);
    });

    let configCombobox: any;

    await test.step("Open the new test run modal configurations combobox", async () => {
      await page.goto(`/en-US/projects/runs/${projectId}`);
      await page.waitForLoadState("load");

      ({ configCombobox } = await openModalAndGetConfigCombobox(page));
      await openComboboxDropdown(page, configCombobox);
    });

    await test.step("Select the configuration and confirm it shows in the trigger", async () => {
      await page.locator(`[role="option"]:has-text("${configName}")`).click();

      // Close popover
      await page.keyboard.press("Escape");

      // Verify config is shown in combobox trigger
      await expect(configCombobox).toContainText(configName, {
        timeout: 5000,
      });
    });

    await test.step("Click Clear All and verify the configuration is removed", async () => {
      // Clear All lives in the dropdown, which is portaled outside the dialog
      await openComboboxDropdown(page, configCombobox);

      const clearAll = page.getByTestId("multi-async-combobox-clear-all");
      await expect(clearAll).toBeVisible();
      await clearAll.click();

      await page.keyboard.press("Escape");

      // Verify config is no longer in combobox trigger
      await expect(configCombobox).not.toContainText(configName, {
        timeout: 3000,
      });
    });
  });

  test("should show the loaded-count footer in the combobox dropdown", async ({
    api,
    page,
  }) => {
    const configName = `Paginated Config ${Date.now()}`;
    let projectId: number | undefined;

    await test.step("Create project and configuration", async () => {
      projectId = await api.createProject(
        `E2E Config Pagination ${Date.now()}`
      );
      await api.createConfiguration(configName, projectId);
    });

    let configCombobox: any;

    await test.step("Open the new test run modal configurations combobox", async () => {
      await page.goto(`/en-US/projects/runs/${projectId}`);
      await page.waitForLoadState("load");

      ({ configCombobox } = await openModalAndGetConfigCombobox(page));
      await openComboboxDropdown(page, configCombobox);

      // Wait for options to appear
      await expect(
        page.locator(`[role="option"]:has-text("${configName}")`)
      ).toBeVisible({ timeout: 5000 });
    });

    await test.step("Verify the count footer replaces the Previous/Next pager", async () => {
      // The list infinite-scrolls now: a count footer replaces the old pager.
      const countFooter = page.getByTestId("multi-async-combobox-count-footer");
      await expect(countFooter).toBeVisible();
      await expect(countFooter).toHaveText(/1 of 1/);
      await expect(
        page.getByRole("button", { name: "Previous" })
      ).not.toBeVisible();
    });
  });

  test("should proceed to step 2 with selected configurations", async ({
    api,
    page,
  }) => {
    const configName = `NextStep Config ${Date.now()}`;
    let projectId: number | undefined;

    await test.step("Create project, configuration, folder, and test case", async () => {
      projectId = await api.createProject(`E2E Config Next Step ${Date.now()}`);
      await api.createConfiguration(configName, projectId);

      // Create a folder and test case so step 2 has cases to show
      const folderId = await api.createFolder(projectId!, "Test Folder");
      await api.createTestCase(projectId!, folderId, `Test Case ${Date.now()}`);
    });

    let dialog: any;
    let configCombobox: any;

    await test.step("Open the new test run modal and fill in the run name", async () => {
      await page.goto(`/en-US/projects/runs/${projectId}`);
      await page.waitForLoadState("load");

      ({ dialog, configCombobox } = await openModalAndGetConfigCombobox(page));

      // Fill in required name field
      const nameInput = dialog.getByTestId("run-name-input");
      await nameInput.fill(`Test Run ${Date.now()}`);
    });

    await test.step("Select a configuration", async () => {
      await openComboboxDropdown(page, configCombobox);

      await page.locator(`[role="option"]:has-text("${configName}")`).click();

      await page.keyboard.press("Escape");
    });

    await test.step("Click Next and verify step 2 is shown", async () => {
      // Click "Next" to go to step 2 (use dispatchEvent to bypass dialog overlay)
      const nextButton = dialog.getByTestId("run-next-button");
      await expect(nextButton).toBeVisible({ timeout: 10000 });
      await nextButton.dispatchEvent("click");

      // Verify step 2 is shown (test case selection with repository)
      await expect(dialog.getByTestId("run-save-button")).toBeVisible({
        timeout: 10000,
      });
    });
  });
});
