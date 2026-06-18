import { expect, test } from "../../../fixtures";

/**
 * Duplicate Scan Workflow E2E Tests
 *
 * Tests the duplicate scan UI workflow:
 * - Triggering a scan from the repository page
 * - Viewing duplicate scan results (seeded directly, not ES-dependent)
 * - Resolving pairs via dismiss and link actions
 *
 * Tests that need results on the duplicates page create DuplicateScanResult
 * records directly via the API, making them deterministic regardless of
 * Elasticsearch state.
 */

test.describe("Duplicate Scan Workflow", () => {
  test("Trigger duplicate scan and see scan in progress", async ({
    api,
    page,
  }) => {
    let projectId: number | undefined;
    let folderId: number | undefined;

    await test.step("Seed project with two similar test cases", async () => {
      projectId = await api.createProject(
        `E2E Duplicates Project ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      );
      folderId = await api.createFolder(projectId!, `Dup Folder ${Date.now()}`);
      await api.createTestCase(
        projectId!,
        folderId!,
        "Login form validation test"
      );
      await api.createTestCase(
        projectId!,
        folderId!,
        "Login form validation test copy"
      );
    });

    await test.step("Open the repository page", async () => {
      await page.goto(`/en-US/projects/repository/${projectId}`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Find and click the scan trigger button", async () => {
      const findDuplicatesBtn = page.locator(
        '[data-testid="find-duplicates-button"]'
      );
      await expect(findDuplicatesBtn).toBeVisible({ timeout: 10000 });
      await findDuplicatesBtn.click();
    });

    await test.step("Verify scan is in progress or complete", async () => {
      // Scan should be in progress or complete almost immediately
      const scanIndicator = page.locator(
        '[data-testid="scan-progress"],[data-testid="view-duplicates-button"]'
      );
      await expect(scanIndicator).toBeVisible({ timeout: 15000 });
    });
  });

  test("View duplicate scan results page", async ({ api, page }) => {
    let projectId: number | undefined;
    let folderId: number | undefined;
    let caseAId: number | undefined;
    let caseBId: number | undefined;

    await test.step("Seed project, folder, and two test cases", async () => {
      projectId = await api.createProject(
        `E2E Duplicates Project ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      );
      folderId = await api.createFolder(projectId!, `Dup Folder ${Date.now()}`);
      caseAId = await api.createTestCase(projectId!, folderId!, "Login test A");
      caseBId = await api.createTestCase(projectId!, folderId!, "Login test B");
    });

    await test.step("Create a duplicate scan result directly", async () => {
      // Create a DuplicateScanResult directly — no ES dependency
      await api.createDuplicateScanResult(
        projectId!,
        caseAId!,
        caseBId!,
        0.92,
        ["name"]
      );
    });

    await test.step("Navigate to the duplicates page", async () => {
      // Navigate to the duplicates page
      await page.goto(`/en-US/projects/repository/${projectId}/duplicates`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the duplicates table and a result row are visible", async () => {
      // The duplicates table should be visible
      const table = page.locator('[data-testid="duplicates-table"]');
      await expect(table).toBeVisible({ timeout: 10000 });

      // At least one row should be visible
      const firstRow = page.locator('[data-testid^="case-row-"]').first();
      await expect(firstRow).toBeVisible({ timeout: 10000 });
    });
  });

  test("Dismiss a duplicate pair", async ({ api, page }) => {
    let projectId: number | undefined;
    let folderId: number | undefined;
    let caseAId: number | undefined;
    let caseBId: number | undefined;

    await test.step("Seed project, folder, and two test cases", async () => {
      projectId = await api.createProject(
        `E2E Duplicates Project ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      );
      folderId = await api.createFolder(projectId!, `Dup Folder ${Date.now()}`);
      caseAId = await api.createTestCase(
        projectId!,
        folderId!,
        "Dismissable test A"
      );
      caseBId = await api.createTestCase(
        projectId!,
        folderId!,
        "Dismissable test B"
      );
    });

    await test.step("Create a duplicate scan result and open the duplicates page", async () => {
      await api.createDuplicateScanResult(
        projectId!,
        caseAId!,
        caseBId!,
        0.88,
        ["name"]
      );

      await page.goto(`/en-US/projects/repository/${projectId}/duplicates`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Open the comparison dialog for the first pair", async () => {
      // Click the first row to open the comparison dialog
      const firstRow = page.locator('[data-testid^="case-row-"]').first();
      await expect(firstRow).toBeVisible({ timeout: 10000 });
      await firstRow.click();

      // Wait for the comparison dialog to appear
      const dialog = page.locator('[data-testid="comparison-dialog"]');
      await expect(dialog).toBeVisible({ timeout: 10000 });
    });

    await test.step("Dismiss the pair and verify the dialog closes with a success toast", async () => {
      // Click dismiss
      const dismissButton = page.locator('[data-testid="dismiss-button"]');
      await expect(dismissButton).toBeVisible({ timeout: 10000 });
      await dismissButton.click();

      // Dialog should close
      const dialog = page.locator('[data-testid="comparison-dialog"]');
      await expect(dialog).not.toBeVisible({ timeout: 10000 });

      // Success toast should appear
      const toast = page.locator("[data-sonner-toast]");
      await expect(toast).toBeVisible({ timeout: 10000 });
    });
  });

  test("Link two duplicate cases as related", async ({ api, page }) => {
    let projectId: number | undefined;
    let folderId: number | undefined;
    let caseAId: number | undefined;
    let caseBId: number | undefined;

    await test.step("Seed project, folder, and two test cases", async () => {
      projectId = await api.createProject(
        `E2E Duplicates Project ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      );
      folderId = await api.createFolder(projectId!, `Dup Folder ${Date.now()}`);
      caseAId = await api.createTestCase(
        projectId!,
        folderId!,
        "Linkable test A"
      );
      caseBId = await api.createTestCase(
        projectId!,
        folderId!,
        "Linkable test B"
      );
    });

    await test.step("Create a duplicate scan result and open the duplicates page", async () => {
      await api.createDuplicateScanResult(
        projectId!,
        caseAId!,
        caseBId!,
        0.85,
        ["name"]
      );

      await page.goto(`/en-US/projects/repository/${projectId}/duplicates`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Open the comparison dialog for the first pair", async () => {
      // Click the first row to open the comparison dialog
      const firstRow = page.locator('[data-testid^="case-row-"]').first();
      await expect(firstRow).toBeVisible({ timeout: 10000 });
      await firstRow.click();

      // Wait for the comparison dialog to appear
      const dialog = page.locator('[data-testid="comparison-dialog"]');
      await expect(dialog).toBeVisible({ timeout: 10000 });
    });

    await test.step("Link the pair and verify the dialog closes with a success toast", async () => {
      // Click link
      const linkButton = page.locator('[data-testid="link-button"]');
      await expect(linkButton).toBeVisible({ timeout: 10000 });
      await linkButton.click();

      // Dialog should close
      const dialog = page.locator('[data-testid="comparison-dialog"]');
      await expect(dialog).not.toBeVisible({ timeout: 10000 });

      // Success toast should appear
      const toast = page.locator("[data-sonner-toast]");
      await expect(toast).toBeVisible({ timeout: 10000 });
    });
  });
});
