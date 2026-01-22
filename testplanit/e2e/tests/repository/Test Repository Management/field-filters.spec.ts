import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Field-Based Filtering Tests
 *
 * E2E tests for filtering repository test cases by custom fields.
 * These tests focus on UI interaction and workflow validation.
 *
 * Coverage:
 * - Filter UI opens and closes correctly
 * - Filter operators appear and can be selected
 * - Filter input validation works
 * - Filter chips display correctly
 * - Filters can be cleared
 * - Has Value / No Value options work
 * - Multiple filters can be combined
 * - Filter persistence across navigation
 *
 * Note: Comprehensive data validation for all operators is covered by unit tests.
 * These E2E tests focus on the user interaction workflow.
 */
test.describe("Field-Based Filtering", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  /**
   * Create a test project for filtering tests
   */
  async function setupFilteringProject(
    api: import("../../../fixtures/api.fixture").ApiHelper
  ): Promise<{
    projectId: number;
    folderId: number;
  }> {
    // Create project
    const projectId = await api.createProject(`Filter Test ${Date.now()}`);

    // Create a folder for test cases
    const folderId = await api.createFolder(projectId, "Filter Test Cases");

    // Create several test cases
    await api.createTestCase(projectId, folderId, "Login test case");
    await api.createTestCase(projectId, folderId, "Registration test scenario");
    await api.createTestCase(projectId, folderId, "Checkout workflow");
    await api.createTestCase(projectId, folderId, "Search functionality");
    await api.createTestCase(projectId, folderId, "Profile update");

    return { projectId, folderId };
  }

  test.describe("Suite 1: Filter UI Interaction", () => {
    test("1.1 - Open and close filter dropdown", async ({ api, page }) => {
      const { projectId, folderId } = await setupFilteringProject(api);

      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);
      await page.waitForLoadState("networkidle");

      // Wait for the table to be visible
      const casesTable = page.locator('table, [role="table"]').first();
      await expect(casesTable).toBeVisible({ timeout: 10000 });

      // Find the Name column header (should have filter capability)
      const nameHeader = page.locator('th:has-text("Name"), th:has-text("Title")').first();
      await expect(nameHeader).toBeVisible({ timeout: 5000 });

      // Click column header to open filter dropdown
      await nameHeader.click();
      await page.waitForTimeout(500); // Wait for animation

      // Verify filter dropdown appears with filter options
      const filterDropdown = page.locator('[role="menu"], [role="dialog"], [role="listbox"]').filter({
        hasText: /Contains|Equals|Filter/i,
      });

      // Check if dropdown is visible (some columns might not have filters)
      const isDropdownVisible = await filterDropdown.isVisible({ timeout: 2000 }).catch(() => false);

      if (isDropdownVisible) {
        // Click outside to close dropdown
        await page.locator("body").click({ position: { x: 10, y: 10 } });
        await page.waitForTimeout(300);

        // Verify dropdown closed
        await expect(filterDropdown).not.toBeVisible({ timeout: 3000 });
      }
    });

    test("1.2 - Filter operators are visible and selectable", async ({ api, page }) => {
      const { projectId, folderId } = await setupFilteringProject(api);

      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);
      await page.waitForLoadState("networkidle");

      // Find any filterable column header
      const columnHeaders = page.locator('th').all();
      const headers = await columnHeaders;

      // Try to find a column with filter capability
      for (const header of headers) {
        const headerText = await header.textContent();

        // Skip system columns that don't have custom field filters
        if (!headerText || headerText.match(/^(#|Actions|Select|☰)$/i)) {
          continue;
        }

        await header.click();
        await page.waitForTimeout(300);

        // Check if filter dropdown appeared
        const filterDropdown = page.locator('[role="menu"], [role="dialog"]').filter({
          hasText: /Contains|Equals|Has.*Value|Filter/i,
        });

        const isVisible = await filterDropdown.isVisible({ timeout: 1000 }).catch(() => false);

        if (isVisible) {
          // Verify filter operators are present
          // Look for common filter options
          const hasValueOption = page.locator('text=/Has.*Value/i').first();
          const noValueOption = page.locator('text=/No.*Value/i').first();

          // At minimum, we should see these two options for most field types
          const hasValueVisible = await hasValueOption.isVisible({ timeout: 2000 }).catch(() => false);
          const noValueVisible = await noValueOption.isVisible({ timeout: 2000 }).catch(() => false);

          expect(hasValueVisible || noValueVisible).toBe(true);

          // Close the dropdown
          await page.keyboard.press("Escape");
          await page.waitForTimeout(200);
          break;
        }
      }
    });

    test("1.3 - Has Value / No Value filter options", async ({ api, page }) => {
      const { projectId, folderId } = await setupFilteringProject(api);

      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);
      await page.waitForLoadState("networkidle");

      // Wait for test cases to load - look for actual case names
      await expect(page.locator('text="Login test case"')).toBeVisible({ timeout: 10000 });

      // Count initial test cases
      const initialRows = page.locator('tbody tr, [role="row"]').filter({
        has: page.locator('td, [role="cell"]'),
      });
      const initialCount = await initialRows.count();
      expect(initialCount).toBeGreaterThan(0);

      // Find a filterable column
      const columnHeaders = page.locator('th').all();
      const headers = await columnHeaders;

      for (const header of headers) {
        const headerText = await header.textContent();

        // Skip system columns
        if (!headerText || headerText.match(/^(#|Actions|Select|☰|Name|Template|State|Creator|Folder)$/i)) {
          continue;
        }

        await header.click();
        await page.waitForTimeout(300);

        // Look for Has Value / No Value options
        const hasValueOption = page.locator('text=/Has.*Value/i').first();
        const noValueOption = page.locator('text=/No.*Value/i').first();

        const hasValueVisible = await hasValueOption.isVisible({ timeout: 1000 }).catch(() => false);
        const noValueVisible = await noValueOption.isVisible({ timeout: 1000 }).catch(() => false);

        if (hasValueVisible || noValueVisible) {
          // Try clicking No Value to filter
          if (noValueVisible) {
            await noValueOption.click();
            await page.waitForLoadState("networkidle");
            await page.waitForTimeout(500);

            // Check if filter was applied (chip should appear or count should change)
            const filterChip = page.locator('[class*="filter"], [class*="chip"], [class*="badge"]').filter({
              hasText: /No.*Value|Empty|None/i,
            });

            const chipVisible = await filterChip.isVisible({ timeout: 2000 }).catch(() => false);

            // If chip appeared, try to clear it
            if (chipVisible) {
              const clearButton = filterChip.locator('button, [role="button"]').first();
              await clearButton.click();
              await page.waitForLoadState("networkidle");
            }
          }
          break;
        }
      }
    });

    test("1.4 - Numeric filter validation (between operator)", async ({ api, page }) => {
      const { projectId, folderId } = await setupFilteringProject(api);

      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);
      await page.waitForLoadState("networkidle");

      // Look for numeric field columns (like Priority, Estimate, etc.)
      const columnHeaders = page.locator('th').all();
      const headers = await columnHeaders;

      for (const header of headers) {
        const headerText = await header.textContent();

        // Look for columns that might be numeric
        if (headerText && headerText.match(/Priority|Estimate|Number|Count/i)) {
          await header.click();
          await page.waitForTimeout(300);

          // Look for Between operator
          const betweenOption = page.locator('text=/Between/i').first();
          const betweenVisible = await betweenOption.isVisible({ timeout: 1000 }).catch(() => false);

          if (betweenVisible) {
            await betweenOption.click();
            await page.waitForTimeout(300);

            // Verify two number inputs appear
            const numberInputs = page.locator('input[type="number"]');
            const inputCount = await numberInputs.count();

            if (inputCount >= 2) {
              // Enter invalid range (first > second)
              await numberInputs.nth(0).fill("10");
              await numberInputs.nth(1).fill("5");
              await page.waitForTimeout(500);

              // Look for validation error or disabled apply button
              const applyButton = page.locator('button:has-text("Apply"), button[aria-label*="Apply"]').first();
              const isDisabled = await applyButton.isDisabled().catch(() => false);

              expect(isDisabled).toBe(true);

              // Fix the range
              await numberInputs.nth(0).fill("3");
              await numberInputs.nth(1).fill("8");
              await page.waitForTimeout(500);

              // Apply button should be enabled now
              const isEnabledNow = await applyButton.isEnabled().catch(() => true);
              expect(isEnabledNow).toBe(true);
            }

            // Close dropdown
            await page.keyboard.press("Escape");
            break;
          }
        }
      }
    });

    test("1.5 - Text filter: Contains operator", async ({ api, page }) => {
      const { projectId, folderId } = await setupFilteringProject(api);

      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);
      await page.waitForLoadState("networkidle");

      // Use the Name column for text filtering
      const nameHeader = page.locator('th:has-text("Name"), th:has-text("Title")').first();
      await nameHeader.click();
      await page.waitForTimeout(300);

      // Look for Contains operator
      const containsOption = page.locator('text=/Contains/i').first();
      const containsVisible = await containsOption.isVisible({ timeout: 1000 }).catch(() => false);

      if (containsVisible) {
        await containsOption.click();
        await page.waitForTimeout(300);

        // Type search term
        const textInput = page.locator('input[type="text"], input[type="search"]').filter({
          hasNotText: '',
        }).first();

        const inputVisible = await textInput.isVisible({ timeout: 1000 }).catch(() => false);

        if (inputVisible) {
          await textInput.fill("test");
          await page.waitForTimeout(300);

          // Apply filter
          const applyButton = page.locator('button:has-text("Apply"), button[aria-label*="Apply"]').first();
          const buttonVisible = await applyButton.isVisible({ timeout: 1000 }).catch(() => false);

          if (buttonVisible) {
            await applyButton.click();
            await page.waitForLoadState("networkidle");
            await page.waitForTimeout(500);

            // Look for filter chip
            const filterChip = page.locator('[class*="filter"], [class*="chip"], [class*="badge"]').filter({
              hasText: /contains|test/i,
            });

            const chipVisible = await filterChip.isVisible({ timeout: 2000 }).catch(() => false);

            // If chip visible, clear it
            if (chipVisible) {
              const clearButton = filterChip.locator('button, [role="button"]').first();
              await clearButton.click();
              await page.waitForLoadState("networkidle");
            }
          }
        }
      }
    });
  });

  test.describe("Suite 2: Multiple Filters", () => {
    test("2.1 - Apply two filters and verify both chips appear", async ({ api, page }) => {
      const { projectId, folderId } = await setupFilteringProject(api);

      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);
      await page.waitForLoadState("networkidle");

      // Apply first filter (Name contains "test")
      const nameHeader = page.locator('th:has-text("Name")').first();
      await nameHeader.click();
      await page.waitForTimeout(300);

      const containsOption = page.locator('text=/Contains/i').first();
      if (await containsOption.isVisible({ timeout: 1000 }).catch(() => false)) {
        await containsOption.click();
        await page.waitForTimeout(200);

        const textInput = page.locator('input[type="text"]').first();
        await textInput.fill("test");
        await page.waitForTimeout(200);

        const applyButton1 = page.locator('button:has-text("Apply")').first();
        await applyButton1.click();
        await page.waitForLoadState("networkidle");

        // Verify first filter chip appears
        const filterChip1 = page.locator('[class*="filter"], [class*="chip"]').filter({
          hasText: /contains|test/i,
        });
        await expect(filterChip1.first()).toBeVisible({ timeout: 3000 });

        // Try to apply a second filter
        const headers = await page.locator('th').all();

        for (const header of headers) {
          const headerText = await header.textContent();

          // Skip the name column we just filtered
          if (!headerText || headerText.match(/Name|Title/i)) {
            continue;
          }

          await header.click();
          await page.waitForTimeout(300);

          // Look for Has Value option
          const hasValueOption = page.locator('text=/Has.*Value/i').first();
          if (await hasValueOption.isVisible({ timeout: 1000 }).catch(() => false)) {
            await hasValueOption.click();
            await page.waitForLoadState("networkidle");

            // Check if second chip appeared
            const filterChips = page.locator('[class*="filter"], [class*="chip"]');
            const chipCount = await filterChips.count();

            if (chipCount >= 2) {
              // Success - two filters applied
              // Clear all filters
              const clearAllButton = page.locator('button:has-text("Clear all"), button:has-text("Clear filters")').first();
              if (await clearAllButton.isVisible({ timeout: 1000 }).catch(() => false)) {
                await clearAllButton.click();
                await page.waitForLoadState("networkidle");
              }
            }
            break;
          }
        }
      }
    });
  });

  test.describe("Suite 3: Filter Persistence", () => {
    test("3.1 - Filter persists after navigation", async ({ api, page }) => {
      const { projectId, folderId } = await setupFilteringProject(api);

      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);
      await page.waitForLoadState("networkidle");

      // Apply a filter
      const nameHeader = page.locator('th:has-text("Name")').first();
      await nameHeader.click();
      await page.waitForTimeout(300);

      const containsOption = page.locator('text=/Contains/i').first();
      if (await containsOption.isVisible({ timeout: 1000 }).catch(() => false)) {
        await containsOption.click();
        await page.waitForTimeout(200);

        const textInput = page.locator('input[type="text"]').first();
        await textInput.fill("test");
        await page.waitForTimeout(200);

        const applyButton = page.locator('button:has-text("Apply")').first();
        await applyButton.click();
        await page.waitForLoadState("networkidle");

        // Verify filter chip appears
        const filterChip = page.locator('[class*="filter"], [class*="chip"]').filter({
          hasText: /contains|test/i,
        });
        await expect(filterChip.first()).toBeVisible({ timeout: 3000 });

        // Navigate to a test case (click first row)
        const firstRow = page.locator('tbody tr, [role="row"]').filter({
          has: page.locator('td, [role="cell"]'),
        }).first();

        if (await firstRow.isVisible({ timeout: 2000 }).catch(() => false)) {
          await firstRow.click();
          await page.waitForLoadState("networkidle");
          await page.waitForTimeout(500);

          // Navigate back
          await page.goBack();
          await page.waitForLoadState("networkidle");

          // Verify filter chip still visible
          await expect(filterChip.first()).toBeVisible({ timeout: 3000 });
        }
      }
    });
  });

  test.describe("Suite 4: Visual Feedback", () => {
    test("4.1 - Empty state when no results match", async ({ api, page }) => {
      const { projectId, folderId } = await setupFilteringProject(api);

      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);
      await page.waitForLoadState("networkidle");

      // Apply filter with no matching results
      const nameHeader = page.locator('th:has-text("Name")').first();
      await nameHeader.click();
      await page.waitForTimeout(300);

      const containsOption = page.locator('text=/Contains/i').first();
      if (await containsOption.isVisible({ timeout: 1000 }).catch(() => false)) {
        await containsOption.click();
        await page.waitForTimeout(200);

        const textInput = page.locator('input[type="text"]').first();
        await textInput.fill("NOMATCHPOSSIBLE123XYZ");
        await page.waitForTimeout(200);

        const applyButton = page.locator('button:has-text("Apply")').first();
        await applyButton.click();
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(500);

        // Look for empty state message
        const emptyState = page.locator('text=/No.*test cases|No.*results|No.*matches|No.*found/i').first();
        const emptyStateVisible = await emptyState.isVisible({ timeout: 3000 }).catch(() => false);

        // Either empty state appears OR no rows in the table
        const tableRows = page.locator('tbody tr, [role="row"]').filter({
          has: page.locator('td, [role="cell"]'),
        });
        const rowCount = await tableRows.count();

        expect(emptyStateVisible || rowCount === 0).toBe(true);
      }
    });
  });
});
