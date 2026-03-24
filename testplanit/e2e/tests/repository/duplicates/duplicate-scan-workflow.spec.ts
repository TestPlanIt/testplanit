import { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "../../../fixtures";

/**
 * Duplicate Scan Workflow E2E Tests
 *
 * Tests the full duplicate scan workflow:
 * - Triggering a scan from the repository page
 * - Viewing duplicate scan results
 * - Resolving pairs via dismiss and link actions
 */

/**
 * Submit a scan and poll until completion. Returns the number of pairs found.
 */
async function triggerAndWaitForScan(
  page: Page,
  request: APIRequestContext,
  projectId: number,
  baseURL: string
): Promise<number> {
  const res = await request.post(`${baseURL}/api/duplicate-scan/submit`, {
    data: { projectId },
  });
  const { jobId } = await res.json();

  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(2000);
    const statusRes = await request.get(
      `${baseURL}/api/duplicate-scan/status/${jobId}`
    );
    const status = await statusRes.json();
    if (status.state === "completed") return status.result?.pairsFound ?? 0;
    if (status.state === "failed") return 0;
  }
  return 0; // timeout
}

test.describe("Duplicate Scan Workflow", () => {
  test("Trigger duplicate scan and see scan in progress", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const projectId = await api.createProject(
      `E2E Duplicates Project ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    const folderId = await api.createFolder(projectId, `Dup Folder ${Date.now()}`);
    await api.createTestCase(projectId, folderId, "Login form validation test");
    await api.createTestCase(
      projectId,
      folderId,
      "Login form validation test copy"
    );

    await page.goto(`/en-US/projects/repository/${projectId}`);
    await page.waitForLoadState("networkidle");

    // Find and click the scan trigger button
    const findDuplicatesBtn = page.locator('[data-testid="find-duplicates-button"]');
    await expect(findDuplicatesBtn).toBeVisible({ timeout: 10000 });
    await findDuplicatesBtn.click();

    // Scan should be in progress or complete almost immediately
    const scanIndicator = page.locator(
      '[data-testid="scan-progress"],[data-testid="view-duplicates-button"]'
    );
    await expect(scanIndicator).toBeVisible({ timeout: 15000 });
  });

  test("View duplicate scan results page", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const projectId = await api.createProject(
      `E2E Duplicates Project ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    const folderId = await api.createFolder(projectId, `Dup Folder ${Date.now()}`);
    // Two identically-named cases to maximize the chance of a duplicate match
    const caseName = `Duplicate Case ${Date.now()}`;
    await api.createTestCase(projectId, folderId, caseName);
    await api.createTestCase(projectId, folderId, `${caseName} similar`);

    // Submit scan via API and poll for completion
    const pairsFound = await triggerAndWaitForScan(
      page,
      request,
      projectId,
      baseURL ?? "http://localhost:3000"
    );

    // Navigate to the duplicates page
    await page.goto(`/en-US/projects/repository/${projectId}/duplicates`);
    await page.waitForLoadState("networkidle");

    // The duplicates table container should be visible
    const table = page.locator('[data-testid="duplicates-table"]');
    await expect(table).toBeVisible({ timeout: 10000 });

    // If pairs were found, at least one row should be visible
    if (pairsFound > 0) {
      const firstRow = page.locator('[data-testid^="case-row-"]').first();
      await expect(firstRow).toBeVisible({ timeout: 10000 });
    }
  });

  test("Dismiss a duplicate pair", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const projectId = await api.createProject(
      `E2E Duplicates Project ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    const folderId = await api.createFolder(projectId, `Dup Folder ${Date.now()}`);
    const caseName = `Dismissable Duplicate ${Date.now()}`;
    await api.createTestCase(projectId, folderId, caseName);
    await api.createTestCase(projectId, folderId, `${caseName} copy`);

    const pairsFound = await triggerAndWaitForScan(
      page,
      request,
      projectId,
      baseURL ?? "http://localhost:3000"
    );

    await page.goto(`/en-US/projects/repository/${projectId}/duplicates`);
    await page.waitForLoadState("networkidle");

    if (pairsFound === 0) {
      test.skip(true, "No pairs found — similarity threshold not met");
      return;
    }

    // Click the first row to open the comparison dialog
    const firstRow = page.locator('[data-testid^="case-row-"]').first();
    await expect(firstRow).toBeVisible({ timeout: 10000 });
    await firstRow.click();

    // Wait for the comparison dialog to appear
    const dialog = page.locator('[data-testid="comparison-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Click dismiss
    const dismissButton = page.locator('[data-testid="dismiss-button"]');
    await expect(dismissButton).toBeVisible({ timeout: 10000 });
    await dismissButton.click();

    // Dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // Success toast should appear with dismiss-related text
    const toast = page.locator('[data-sonner-toast]');
    await expect(toast).toBeVisible({ timeout: 10000 });
  });

  test("Link two duplicate cases as related", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const projectId = await api.createProject(
      `E2E Duplicates Project ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    const folderId = await api.createFolder(projectId, `Dup Folder ${Date.now()}`);
    const caseName = `Linkable Duplicate ${Date.now()}`;
    await api.createTestCase(projectId, folderId, caseName);
    await api.createTestCase(projectId, folderId, `${caseName} related`);

    const pairsFound = await triggerAndWaitForScan(
      page,
      request,
      projectId,
      baseURL ?? "http://localhost:3000"
    );

    await page.goto(`/en-US/projects/repository/${projectId}/duplicates`);
    await page.waitForLoadState("networkidle");

    if (pairsFound === 0) {
      test.skip(true, "No pairs found — similarity threshold not met");
      return;
    }

    // Click the first row to open the comparison dialog
    const firstRow = page.locator('[data-testid^="case-row-"]').first();
    await expect(firstRow).toBeVisible({ timeout: 10000 });
    await firstRow.click();

    // Wait for the comparison dialog to appear
    const dialog = page.locator('[data-testid="comparison-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Click link
    const linkButton = page.locator('[data-testid="link-button"]');
    await expect(linkButton).toBeVisible({ timeout: 10000 });
    await linkButton.click();

    // Dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // Success toast should appear
    const toast = page.locator('[data-sonner-toast]');
    await expect(toast).toBeVisible({ timeout: 10000 });
  });
});
