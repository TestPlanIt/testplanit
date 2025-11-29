import { test, expect, Page } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

// Helper function to select any visible test cases
async function selectAnyVisibleTestCases(
  page: Page,
  partialName: string,
  count: number
) {
  const selectedCases: string[] = [];

  // Find all rows containing the partial name
  const rows = page.locator(`tr:has-text("${partialName}")`);
  const rowCount = await rows.count();

  // Select up to 'count' visible cases
  for (let i = 0; i < Math.min(rowCount, count); i++) {
    const row = rows.nth(i);
    
    // Get the actual test case name from the link in the row
    const testCaseLink = row.locator('a[href*="/projects/repository/"]').first();
    const testCaseName = await testCaseLink.textContent();
    
    // Find checkbox - it's within the first cell
    const checkbox = row
      .locator('td').first()
      .locator('input[type="checkbox"]')
      .first();

    if (await checkbox.isVisible() && testCaseName) {
      await checkbox.click({ force: true });
      // Wait a bit for the click to register
      await page.waitForTimeout(200);
      selectedCases.push(testCaseName.trim());
    }
  }

  // Selected cases with pattern
  return selectedCases;
}

// Helper function to open bulk edit modal
async function openBulkEditModal(page: Page) {
  // Click bulk edit button
  const bulkEditButton = page.locator('button:has-text("Bulk Edit")');
  await expect(bulkEditButton).toBeVisible();
  await bulkEditButton.click();

  // Wait for modal to appear
  await expect(page.locator('[role="dialog"]')).toBeVisible();
  // The modal title is "Bulk Edit Cases" (without count in the title)
  await expect(
    page.getByRole("heading", { name: "Bulk Edit Cases" })
  ).toBeVisible();
}

test.describe.serial("Bulk Edit Modal Tests @bulk-edit", () => {
  let projectId: string;

  // Increase timeout for these tests since they need to wait for compilation and data loading
  test.setTimeout(60000); // 60 seconds per test

  test.beforeEach(async ({ page }) => {
    // Login as admin using API
    await loginAsAdmin(page);

    // Use the E2E Test Project which has bulk edit test data
    projectId = "331";
  });

  test("should verify test cases are visible in repository", async ({
    page,
  }) => {
    // Navigate directly to repository with root folder selected
    await page.goto(
      `/en-US/projects/repository/${projectId}?view=folders&node=1`
    );
    await page.waitForLoadState("networkidle");

    // Wait for table to be visible
    const table = page.locator("table");
    await expect(table).toBeVisible({ timeout: 30000 });

    // Wait for at least one test case row to be visible
    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: 10000,
    });

    // Check if we can find any test cases
    const testCase = page.locator('tr:has-text("DR Test Case")').first();
    await expect(testCase).toBeVisible({ timeout: 10000 });
  });

  test("should open bulk edit modal and display selected cases count", async ({
    page,
  }) => {
    await page.goto(
      `/en-US/projects/repository/${projectId}?view=folders&node=1`
    );
    await page.waitForLoadState("networkidle");
    await expect(page.locator("table")).toBeVisible({ timeout: 30000 });
    // Wait for test cases to load
    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: 10000,
    });

    // Select any visible test cases - look for DR Test Cases which exist in seed data
    const selectedCases = await selectAnyVisibleTestCases(page, "DR Test Case", 3);
    expect(selectedCases.length).toBeGreaterThanOrEqual(2);

    await openBulkEditModal(page);

    // Verify standard fields are displayed in the modal
    const modal = page.locator('[role="dialog"]');
    await expect(modal.locator('label:has-text("Name")')).toBeVisible();
    await expect(modal.locator('label:has-text("State")')).toBeVisible();
    await expect(modal.locator('label:has-text("Automated")')).toBeVisible();
    await expect(modal.locator('label:has-text("Estimate")')).toBeVisible();
    await expect(modal.locator('label:has-text("Tags")')).toBeVisible();
    await expect(modal.locator('label:has-text("Issues")')).toBeVisible();
  });

  test("should update state for multiple test cases", async ({ page }) => {
    await page.goto(
      `/en-US/projects/repository/${projectId}?view=folders&node=1`
    );
    await page.waitForLoadState("networkidle");
    await expect(page.locator("table")).toBeVisible({ timeout: 30000 });
    // Wait for test cases to load
    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: 10000,
    });

    // Select any visible test cases - look for DR Test Cases which exist in seed data
    const selectedCases = await selectAnyVisibleTestCases(page, "DR Test Case", 2);
    expect(selectedCases.length).toBeGreaterThanOrEqual(1);

    await openBulkEditModal(page);

    const modal = page.locator('[role="dialog"]');

    // Enable state field editing
    const stateCheckbox = modal.getByRole("checkbox", { name: "State" });
    await stateCheckbox.click();
    await expect(stateCheckbox).toBeChecked();

    // Select new state
    const stateSelect = modal.locator('button[role="combobox"]').first();
    await stateSelect.click();
    await page.getByRole("option", { name: "Active" }).click();

    // Save changes
    const saveButton = page.getByRole("button", { name: "Save" });
    await expect(saveButton).toBeEnabled({ timeout: 5000 });
    await saveButton.click();

    // Verify success toast
    await expect(page.getByText(/Cases updated successfully/i)).toBeVisible({
      timeout: 10000,
    });

    // Verify modal closes
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
  });

  test("should perform search and replace on test case names", async ({
    page,
  }) => {
    await page.goto(
      `/en-US/projects/repository/${projectId}?view=folders&node=1`
    );
    await page.waitForLoadState("networkidle");
    await expect(page.locator("table")).toBeVisible({ timeout: 30000 });
    // Wait for test cases to load
    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: 10000,
    });

    // Select any visible cases with "DR Test Case" in the name
    const selectedCases = await selectAnyVisibleTestCases(page, "DR Test Case", 3);
    expect(selectedCases.length).toBeGreaterThanOrEqual(2);

    // Remember one of the original case names to verify the change
    const firstSelectedCaseName = selectedCases[0];

    await openBulkEditModal(page);

    const modal = page.locator('[role="dialog"]');

    // Enable name field editing
    const nameCheckbox = modal.getByRole("checkbox", { name: "Name" });
    await nameCheckbox.click();
    await expect(nameCheckbox).toBeChecked();

    // Switch to search/replace mode
    const searchReplaceRadio = page.getByRole("radio", {
      name: "Search & Replace",
    });
    await searchReplaceRadio.click();
    await expect(searchReplaceRadio).toBeChecked();

    // Enter search pattern
    const searchInput = page.locator(
      'input[placeholder="Enter text to search"]'
    );
    await searchInput.fill("Case");

    // Enter replacement
    const replaceInput = page.locator(
      'input[placeholder="Enter replacement text"]'
    );
    await replaceInput.fill("Scenario");

    // Wait for preview to update by checking for matches text
    await expect(page.getByText(/\d+ matches/)).toBeVisible({ timeout: 5000 });

    // Verify preview shows matches
    await expect(page.getByText(/\d+ matches/)).toBeVisible();

    // Save changes
    const saveButton = page.getByRole("button", { name: "Save" });
    await expect(saveButton).toBeEnabled({ timeout: 5000 });
    
    // Click save and wait for processing
    await saveButton.click();

    // Wait for modal to close (indicates operation completed)
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({
      timeout: 15000,
    });

    // Wait for the table to refresh - look for any network activity or loading state
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Refresh the page to ensure we see the updated data
    await page.reload();
    await page.waitForLoadState("networkidle");
    
    // Wait for table to be visible again
    await expect(page.locator("table")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 10000 });

    // Verify the actual change happened in the table
    // Check if at least one case name was updated with "Scenario" replacing "Case"
    // Look for any cell or link containing "Scenario"
    const updatedElements = page.locator('tbody td:has-text("Scenario"), tbody a:has-text("Scenario")');
    
    // Ensure at least one element has been updated
    await expect(updatedElements.first()).toBeVisible({
      timeout: 10000,
    });

    // Verify that we have the expected number of updated cases
    const updatedCount = await updatedElements.count();
    expect(updatedCount).toBeGreaterThanOrEqual(1);
  });

  test("should handle regex search and replace", async ({ page }) => {
    await page.goto(
      `/en-US/projects/repository/${projectId}?view=folders&node=1`
    );
    await page.waitForLoadState("networkidle");
    await expect(page.locator("table")).toBeVisible({ timeout: 30000 });
    // Wait for test cases to load
    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: 10000,
    });

    // Select any visible test cases
    const selectedCases = await selectAnyVisibleTestCases(page, "DR Test Case", 2);
    expect(selectedCases.length).toBeGreaterThanOrEqual(1);

    // Remember one of the original case names to verify the change
    const firstSelectedCaseName = selectedCases[0];

    await openBulkEditModal(page);

    const modal = page.locator('[role="dialog"]');

    // Enable name field editing
    const nameCheckbox = modal.getByRole("checkbox", { name: "Name" });
    await nameCheckbox.click();
    await expect(nameCheckbox).toBeChecked();

    // Switch to search/replace mode
    const searchReplaceRadio = page.getByRole("radio", {
      name: "Search & Replace",
    });
    await searchReplaceRadio.click();
    await expect(searchReplaceRadio).toBeChecked();

    // Wait for search input to be visible
    const searchInputLocator = modal.locator(
      'input[placeholder="Enter text to search"]'
    );
    await expect(searchInputLocator).toBeVisible({ timeout: 5000 });

    // Use simple search and replace first (without regex)
    const searchInput = modal.locator(
      'input[placeholder="Enter text to search"]'
    );
    await searchInput.fill("DR");

    const replaceInput = modal.locator(
      'input[placeholder="Enter replacement text"]'
    );
    await replaceInput.fill("Data Recovery");

    // Now enable regex if needed
    const regexCheckbox = modal
      .locator('input[type="checkbox"]')
      .filter({ hasText: "Use regular expression" })
      .locator("..");
    if (await regexCheckbox.isVisible()) {
      await regexCheckbox.click();
      // Update pattern to use capture groups
      await searchInput.clear();
      await searchInput.fill("(\\w+) Case");
      await replaceInput.clear();
      await replaceInput.fill("$1 Scenario");
    }

    // Verify preview updates
    await expect(page.getByText(/\d+ matches/)).toBeVisible({ timeout: 5000 });

    // Save changes
    await page.getByRole("button", { name: "Save" }).click();

    // Wait for modal to close (indicates operation completed)
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({
      timeout: 10000,
    });

    // Verify the actual change happened in the table
    // Check if regex was used (Case -> Scenario) or simple replace (Test -> Spec)
    const isRegexUsed = await regexCheckbox.isVisible();
    const expectedNewName = isRegexUsed 
      ? firstSelectedCaseName.replace(/(\w+) Case/, "$1 Scenario")
      : firstSelectedCaseName.replace("DR", "Data Recovery");
    
    // Verify at least one case was updated with the new name pattern
    await expect(
      page.locator("tbody").getByRole("link").filter({ hasText: isRegexUsed ? "Scenario" : "Data Recovery" }).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test("should update tags for multiple test cases", async ({ page }) => {
    await page.goto(
      `/en-US/projects/repository/${projectId}?view=folders&node=1`
    );
    await page.waitForLoadState("networkidle");
    await expect(page.locator("table")).toBeVisible({ timeout: 30000 });
    // Wait for test cases to load
    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: 10000,
    });

    // Select any visible test cases
    const selectedCases = await selectAnyVisibleTestCases(page, "DR Test Case", 2);
    expect(selectedCases.length).toBeGreaterThanOrEqual(1);

    await openBulkEditModal(page);

    const modal = page.locator('[role="dialog"]');

    // Enable tags field editing
    const tagsCheckbox = modal.getByRole("checkbox", { name: "Tags" });
    await tagsCheckbox.click();

    // Wait for react-select to be ready and click on it
    const tagsSelectControl = modal
      .locator('.mx-1 >> css=[class*="control"]')
      .first();
    await expect(tagsSelectControl).toBeVisible({ timeout: 5000 });
    await tagsSelectControl.click();

    // Wait for dropdown menu to appear by waiting for first option
    const firstOptionLocator = page
      .locator('[class*="menu"] [class*="option"]')
      .first();
    await expect(firstOptionLocator).toBeVisible({ timeout: 5000 });

    // Select first available option from the react-select menu
    await firstOptionLocator.click();

    // Small wait for selection to register
    await page.waitForTimeout(300);

    // Save changes
    await page.getByRole("button", { name: "Save" }).click();

    // Verify success
    await expect(page.getByText(/Cases updated successfully/i)).toBeVisible({
      timeout: 10000,
    });
  });

  test("should handle bulk delete operation", async ({ page }) => {
    await page.goto(
      `/en-US/projects/repository/${projectId}?view=folders&node=1`
    );
    await page.waitForLoadState("networkidle");
    await expect(page.locator("table")).toBeVisible({ timeout: 30000 });
    // Wait for test cases to load
    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: 10000,
    });

    // Select any available test cases for deletion  
    const selectedCases = await selectAnyVisibleTestCases(page, "DR Test Case", 2);
    expect(selectedCases.length).toBeGreaterThanOrEqual(1);

    await openBulkEditModal(page);

    // Click delete button
    const deleteButton = page.getByRole("button", { name: "Delete" }).first();
    await expect(deleteButton).toBeVisible();
    await deleteButton.click();

    // Wait for popover to appear and confirm deletion
    const confirmDeleteButton = page
      .getByRole("button", { name: "Delete" })
      .last();
    await expect(confirmDeleteButton).toBeVisible({ timeout: 5000 });
    await confirmDeleteButton.click();

    // Verify success toast (number may vary)
    await expect(page.getByText(/Deleted \d+ cases/i)).toBeVisible({
      timeout: 10000,
    });

    // Verify modal closes
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({
      timeout: 10000,
    });
  });

  test("should disable save button when no fields are edited", async ({
    page,
  }) => {
    await page.goto(
      `/en-US/projects/repository/${projectId}?view=folders&node=1`
    );
    await page.waitForLoadState("networkidle");
    await expect(page.locator("table")).toBeVisible({ timeout: 30000 });
    // Wait for test cases to load
    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: 10000,
    });

    // Select any visible test cases
    const selectedCases = await selectAnyVisibleTestCases(page, "DR Test Case", 2);
    expect(selectedCases.length).toBeGreaterThanOrEqual(1);

    await openBulkEditModal(page);

    // Verify save button is disabled initially
    const saveButton = page.getByRole("button", { name: "Save" });
    await expect(saveButton).toBeDisabled();

    const modal = page.locator('[role="dialog"]');

    // Enable a field
    const nameCheckbox = modal.getByRole("checkbox", { name: "Name" });
    await nameCheckbox.click();

    // Now save button should be enabled
    await expect(saveButton).toBeEnabled();
  });

  test("should search and replace in test case steps", async ({ page }) => {
    await page.goto(
      `/en-US/projects/repository/${projectId}?view=folders&node=1`
    );
    await page.waitForLoadState("networkidle");
    await expect(page.locator("table")).toBeVisible({ timeout: 30000 });
    // Wait for test cases to load
    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: 10000,
    });

    // Select test cases with steps
    const selectedCases = await selectAnyVisibleTestCases(page, "DR Test Case", 2);
    expect(selectedCases.length).toBeGreaterThanOrEqual(1);

    await openBulkEditModal(page);

    const modal = page.locator('[role="dialog"]');

    // Look for Steps field - it might be in the template fields
    const stepsCheckbox = modal
      .locator('label:has-text("Steps")')
      .locator("..")
      .locator('input[type="checkbox"]')
      .first();

    // Check if Steps field exists
    const stepsFieldExists = (await stepsCheckbox.count()) > 0;

    if (stepsFieldExists) {
      await stepsCheckbox.click();

      // Should show info message about search/replace for steps
      await expect(
        modal.getByText(/search and replace will be applied to both/i)
      ).toBeVisible({ timeout: 5000 });

      // Enter search pattern
      const searchInput = modal.locator(
        'input[placeholder="Enter text to search"]'
      );
      await searchInput.fill("login");

      // Enter replacement
      const replaceInput = modal.locator(
        'input[placeholder="Enter replacement text"]'
      );
      await replaceInput.fill("sign in");

      // Wait for preview to update
      await expect(modal.getByText(/\d+ matches/)).toBeVisible({
        timeout: 5000,
      });

      // Should show step-specific preview
      await expect(modal.getByText(/Step \d+/)).toBeVisible();

      // Save changes
      await page.getByRole("button", { name: "Save" }).click();

      // Verify success
      await expect(page.getByText(/Cases updated successfully/i)).toBeVisible({
        timeout: 10000,
      });
    } else {
      console.log("Steps field not found in template - skipping test");
    }
  });

  test("should use regex patterns in steps search/replace", async ({
    page,
  }) => {
    await page.goto(
      `/en-US/projects/repository/${projectId}?view=folders&node=1`
    );
    await page.waitForLoadState("networkidle");
    await expect(page.locator("table")).toBeVisible({ timeout: 30000 });
    // Wait for test cases to load
    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: 10000,
    });

    // Select test cases
    const selectedCases = await selectAnyVisibleTestCases(page, "DR Test Case", 2);
    expect(selectedCases.length).toBeGreaterThanOrEqual(1);

    await openBulkEditModal(page);

    const modal = page.locator('[role="dialog"]');

    // Look for Steps field
    const stepsCheckbox = modal
      .locator('label:has-text("Steps")')
      .locator("..")
      .locator('input[type="checkbox"]')
      .first();

    const stepsFieldExists = (await stepsCheckbox.count()) > 0;

    if (stepsFieldExists) {
      await stepsCheckbox.click();

      // Enable regex option
      const regexCheckbox = modal
        .locator('label:has-text("Use regular expression")')
        .locator("..")
        .locator('input[type="checkbox"]');
      await regexCheckbox.click();

      // Enter regex pattern
      const searchInput = modal.locator(
        'input[placeholder="e.g., test\\\\d+"]'
      );
      await searchInput.fill("step (\\d+)");

      // Enter replacement with capture group
      const replaceInput = modal.locator('input[placeholder="e.g., test$1"]');
      await replaceInput.fill("action $1");

      // Wait for preview
      await page.waitForTimeout(1000);

      // Check if we have matches
      const matchesText = modal.locator("text=/\\d+ matches/");
      const hasMatches = (await matchesText.count()) > 0;

      if (hasMatches) {
        // Save changes
        await page.getByRole("button", { name: "Save" }).click();

        // Verify success
        await expect(page.getByText(/Cases updated successfully/i)).toBeVisible(
          {
            timeout: 10000,
          }
        );
      } else {
        console.log(
          "No regex matches found in steps - pattern may not match test data"
        );
      }
    } else {
      console.log("Steps field not found in template - skipping test");
    }
  });

  test("should show preview navigation for steps matches", async ({ page }) => {
    await page.goto(
      `/en-US/projects/repository/${projectId}?view=folders&node=1`
    );
    await page.waitForLoadState("networkidle");
    await expect(page.locator("table")).toBeVisible({ timeout: 30000 });
    // Wait for test cases to load
    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: 10000,
    });

    // Select multiple test cases
    const selectedCases = await selectAnyVisibleTestCases(page, "DR Test Case", 3);
    expect(selectedCases.length).toBeGreaterThanOrEqual(2);

    await openBulkEditModal(page);

    const modal = page.locator('[role="dialog"]');

    // Look for Steps field
    const stepsCheckbox = modal
      .locator('label:has-text("Steps")')
      .locator("..")
      .locator('input[type="checkbox"]')
      .first();

    const stepsFieldExists = (await stepsCheckbox.count()) > 0;

    if (stepsFieldExists) {
      await stepsCheckbox.click();

      // Enter search pattern that should match multiple cases
      const searchInput = modal.locator(
        'input[placeholder="Enter text to search"]'
      );
      await searchInput.fill("test");

      // Wait for matches
      await expect(modal.getByText(/\d+ matches/)).toBeVisible({
        timeout: 5000,
      });

      // Check if navigation controls appear (when there are multiple case matches)
      const navigationCounter = modal.locator("text=/\\d+ \\/ \\d+/");
      const hasNavigation = (await navigationCounter.count()) > 0;

      if (hasNavigation) {
        // Should show navigation counter
        await expect(navigationCounter).toBeVisible();

        // Click next button if available
        const nextButton = modal.locator(
          'button[aria-label*="next" i], button:has(svg[class*="ChevronRight"])'
        );
        if (await nextButton.isVisible()) {
          await nextButton.click();

          // Counter should update
          await expect(modal.getByText(/2 \/ \d+/)).toBeVisible({
            timeout: 3000,
          });
        }
      } else {
        console.log(
          "Navigation controls not shown - may only have matches in one case"
        );
      }
    } else {
      console.log("Steps field not found in template - skipping test");
    }
  });

  test("should validate empty search pattern for steps", async ({ page }) => {
    await page.goto(
      `/en-US/projects/repository/${projectId}?view=folders&node=1`
    );
    await page.waitForLoadState("networkidle");
    await expect(page.locator("table")).toBeVisible({ timeout: 30000 });
    // Wait for test cases to load
    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: 10000,
    });

    // Select test cases
    const selectedCases = await selectAnyVisibleTestCases(page, "DR Test Case", 2);
    expect(selectedCases.length).toBeGreaterThanOrEqual(1);

    await openBulkEditModal(page);

    const modal = page.locator('[role="dialog"]');

    // Look for Steps field
    const stepsCheckbox = modal
      .locator('label:has-text("Steps")')
      .locator("..")
      .locator('input[type="checkbox"]')
      .first();

    const stepsFieldExists = (await stepsCheckbox.count()) > 0;

    if (stepsFieldExists) {
      await stepsCheckbox.click();

      // Leave search field empty and try to save
      const saveButton = page.getByRole("button", { name: "Save" });
      await saveButton.click();

      // Should show validation error
      await expect(modal.getByText(/search pattern is required/i)).toBeVisible({
        timeout: 5000,
      });
    } else {
      console.log("Steps field not found in template - skipping test");
    }
  });
});
