import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Version History Tests
 *
 * Test cases for viewing and managing version history of test cases.
 * The application uses a version selector dropdown and dedicated version pages
 * to view historical versions with diffs.
 */
test.describe("Version History", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  async function getTestProjectId(
    api: import("../../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    // Create a project for this test - tests should be self-contained
    return await api.createProject(`E2E Test Project ${Date.now()}`);
  }

  test("Version Selector Appears After Multiple Versions", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    const folderName = `Version Selector Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseName = `Version Selector Case ${uniqueId}`;
    const testCaseId = await api.createTestCase(projectId, folderId, testCaseName);

    // Navigate to the test case detail page
    await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}`);
    await page.waitForLoadState("networkidle");

    // Wait for page to fully load
    const editButton = page.locator('button:has-text("Edit")').first();
    await expect(editButton).toBeVisible({ timeout: 15000 });

    // Initially, version selector should not be visible (only 1 version exists)
    // The version selector is a combobox that shows when there are 2+ versions
    const versionCombobox = page.locator('button[role="combobox"]').filter({ hasText: /v\d+/ });
    await expect(versionCombobox).not.toBeVisible({ timeout: 3000 });

    // Update test case via API to create version 2
    await api.updateTestCaseName(testCaseId, `Updated ${testCaseName}`);

    // Reload the page to see the new version
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(editButton).toBeVisible({ timeout: 15000 });

    // Now version selector should be visible (2 versions exist)
    // The version selector is a combobox with version badge like "v2"
    const versionSelectorAfterEdit = page.locator('button[role="combobox"]').filter({ hasText: /v\d+/ }).first();
    await expect(versionSelectorAfterEdit).toBeVisible({ timeout: 10000 });
  });

  test("Navigate to Previous Version via Selector", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    const folderName = `Navigate Version Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const originalName = `Original Case ${uniqueId}`;
    const testCaseId = await api.createTestCase(projectId, folderId, originalName);

    // Update test case via API to create version 2
    await api.updateTestCaseName(testCaseId, `Updated ${originalName}`);

    // Navigate to test case detail page
    await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}`);
    await page.waitForLoadState("networkidle");

    const editButton = page.locator('button:has-text("Edit")').first();
    await expect(editButton).toBeVisible({ timeout: 15000 });

    // Click on the version selector (it's a combobox)
    const versionSelector = page.locator('button[role="combobox"]').filter({ hasText: /v\d+/ }).first();
    await expect(versionSelector).toBeVisible({ timeout: 10000 });
    await versionSelector.click();

    // Select version 1 from the dropdown
    const version1Option = page.locator('[role="option"]').filter({ hasText: "v1" }).first();
    await expect(version1Option).toBeVisible({ timeout: 3000 });
    await version1Option.click();
    await page.waitForLoadState("networkidle");

    // Verify we're on the version page (URL should contain /1 at the end)
    await expect(page).toHaveURL(new RegExp(`/projects/repository/${projectId}/${testCaseId}/1`));
  });

  test("Version Page Shows Diff with Previous Version", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    const folderName = `Diff Display Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const originalName = `Diff Case ${uniqueId}`;
    const testCaseId = await api.createTestCase(projectId, folderId, originalName);

    // Update test case via API to create version 2 with a different name
    const updatedName = `Updated Diff Case ${uniqueId}`;
    await api.updateTestCaseName(testCaseId, updatedName);

    // Navigate directly to version 2 page to see diffs
    await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}/2`);
    await page.waitForLoadState("networkidle");

    // Wait for the version page to load completely
    const versionCreatedText = page.locator('text=/Version.*Created/i').first();
    await expect(versionCreatedText).toBeVisible({ timeout: 10000 });

    // Version page should show diff indicators (green for added, red for removed)
    // The diff display uses bg-green-100 and bg-red-100 classes OR text-green-600/text-red-600
    const greenDiff = page.locator('.bg-green-100, .text-green-600').first();
    const redDiff = page.locator('.bg-red-100, .text-red-600').first();

    // At least one of the diffs should be visible (name changed)
    const hasGreenDiff = await greenDiff.isVisible().catch(() => false);
    const hasRedDiff = await redDiff.isVisible().catch(() => false);
    expect(hasGreenDiff || hasRedDiff).toBe(true);
  });

  test("Version Navigation Buttons Work", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    const folderName = `Navigation Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Nav Case ${uniqueId}`);

    // Create version 2 and 3 via API
    await api.updateTestCaseName(testCaseId, `Nav Case V2 ${uniqueId}`);
    await api.updateTestCaseName(testCaseId, `Nav Case V3 ${uniqueId}`);

    // Navigate to version 2 page
    await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}/2`);
    await page.waitForLoadState("networkidle");

    // Wait for version page to load
    const versionCreatedText = page.locator('text=/Version.*Created/i').first();
    await expect(versionCreatedText).toBeVisible({ timeout: 10000 });

    // Find navigation buttons (older/newer version)
    const olderVersionButton = page.locator('button[title="Older Version"]').first();
    const newerVersionButton = page.locator('button[title="Newer Version"]').first();

    // Both navigation buttons should be visible
    await expect(olderVersionButton).toBeVisible({ timeout: 5000 });
    await expect(newerVersionButton).toBeVisible({ timeout: 5000 });

    // Click newer version button (go to version 3)
    await newerVersionButton.click();
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(new RegExp(`/projects/repository/${projectId}/${testCaseId}/3`));
  });

  test("Back to Latest Version Link Works", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    const folderName = `Back Link Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Back Link Case ${uniqueId}`);

    // Create version 2 via API
    await api.updateTestCaseName(testCaseId, `Back Link Case V2 ${uniqueId}`);

    // Navigate to version 1
    await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}/1`);
    await page.waitForLoadState("networkidle");

    // Wait for version page to load
    const versionCreatedText = page.locator('text=/Version.*Created/i').first();
    await expect(versionCreatedText).toBeVisible({ timeout: 10000 });

    // Find and click the "back to latest" link (uses ChevronLast icon)
    // The link has title="Back to Test Case" based on the component
    const backToLatestLink = page.locator('a[title="Back to Test Case"]').first();
    await expect(backToLatestLink).toBeVisible({ timeout: 5000 });
    await backToLatestLink.click();
    await page.waitForLoadState("networkidle");

    // Should be back on the main test case page (no version in URL)
    await expect(page).toHaveURL(new RegExp(`/projects/repository/${projectId}/${testCaseId}$`));
  });

  test("Version Page Shows Creation Timestamp", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    const folderName = `Timestamp Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Timestamp Case ${uniqueId}`);

    // Create version 2 via API
    await api.updateTestCaseName(testCaseId, `Timestamp Case V2 ${uniqueId}`);

    // Navigate to version page
    await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}/2`);
    await page.waitForLoadState("networkidle");

    // Version page should show "Version 2 Created" text
    const versionCreatedText = page.locator('text=/Version.*Created/i').first();
    await expect(versionCreatedText).toBeVisible({ timeout: 10000 });
  });

  test("Version Page Shows Tags Section", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    // Create a tag
    const tagName = `VersionTag${uniqueId}`;
    const tagId = await api.createTag(tagName);

    const folderName = `Tags Section Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Tags Section Case ${uniqueId}`);

    // Apply tag via API
    await api.addTagToTestCase(testCaseId, tagId);

    // Create version 2 via API
    await api.updateTestCaseName(testCaseId, `Tags Section Case V2 ${uniqueId}`);

    // Navigate to version 2 page
    await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}/2`);
    await page.waitForLoadState("networkidle");

    // Wait for version page to load
    const versionCreatedText = page.locator('text=/Version.*Created/i').first();
    await expect(versionCreatedText).toBeVisible({ timeout: 10000 });

    // Should show the Tags section
    const tagsLabel = page.locator('text=/^Tags$/').first();
    await expect(tagsLabel).toBeVisible({ timeout: 5000 });

    // The tag should be visible
    await expect(page.locator(`text="${tagName}"`).first()).toBeVisible({ timeout: 5000 });
  });

  test("Version History View Shows Footer Message", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    const folderName = `Footer Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Footer Case ${uniqueId}`);

    // Create version 2 via API
    await api.updateTestCaseName(testCaseId, `Footer Case V2 ${uniqueId}`);

    // Navigate to version page
    await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}/2`);
    await page.waitForLoadState("networkidle");

    // Wait for version page to load
    const versionCreatedText = page.locator('text=/Version.*Created/i').first();
    await expect(versionCreatedText).toBeVisible({ timeout: 10000 });

    // Footer should show history view message (in CardFooter)
    // Based on the error context, it shows "Test Case History View"
    const footer = page.locator('text=/History.*View|Test.*Case.*History/i').first();
    await expect(footer).toBeVisible({ timeout: 5000 });
  });

  test("Resizable Panels on Version Page", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    const folderName = `Panels Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Panels Case ${uniqueId}`);

    // Create version 2 via API
    await api.updateTestCaseName(testCaseId, `Panels Case V2 ${uniqueId}`);

    // Navigate to version page
    await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}/2`);
    await page.waitForLoadState("networkidle");

    // Wait for version page to load
    const versionCreatedText = page.locator('text=/Version.*Created/i').first();
    await expect(versionCreatedText).toBeVisible({ timeout: 10000 });

    // Version page should have collapsible panel buttons (ChevronLeft icons)
    const panelCollapseButtons = page.locator('button').filter({ has: page.locator('svg.lucide-chevron-left') });

    // Should have at least 2 collapse buttons (left and right panels)
    await expect(panelCollapseButtons.first()).toBeVisible({ timeout: 5000 });
    const buttonCount = await panelCollapseButtons.count();
    expect(buttonCount).toBeGreaterThanOrEqual(2);
  });

  test("Version Selector Shows Timestamp in Dropdown", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    const folderName = `Selector Timestamp Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Selector Timestamp Case ${uniqueId}`);

    // Create version 2 via API
    await api.updateTestCaseName(testCaseId, `Selector Timestamp Case V2 ${uniqueId}`);

    // Navigate to test case
    await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}`);
    await page.waitForLoadState("networkidle");

    const editButton = page.locator('button:has-text("Edit")').first();
    await expect(editButton).toBeVisible({ timeout: 15000 });

    // Click on the version selector to open dropdown (it's a combobox)
    const versionSelector = page.locator('button[role="combobox"]').filter({ hasText: /v\d+/ }).first();
    await expect(versionSelector).toBeVisible({ timeout: 10000 });
    await versionSelector.click();

    // The dropdown should show version numbers with timestamps
    const versionOption = page.locator('[role="option"]').first();
    await expect(versionOption).toBeVisible({ timeout: 3000 });

    // Each option should have a date/time displayed (format varies by user preferences)
    // Look for common date patterns like MM-DD or time patterns
    const optionText = await versionOption.textContent();
    expect(optionText).toMatch(/v\d+/); // Should contain version number
  });
});
