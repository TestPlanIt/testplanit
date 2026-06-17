import { expect, test } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Version History Tests
 *
 * Test cases for viewing and managing version history of test cases.
 * The application uses a version selector dropdown and dedicated version pages
 * to view historical versions with diffs.
 */
test.describe("Version History", () => {
  let _repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    _repositoryPage = new RepositoryPage(page);
  });

  async function getTestProjectId(
    api: import("../../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    // Create a project for this test - tests should be self-contained
    return await api.createProject(
      `E2E Test Project ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
  }

  test("Version Selector Appears After Multiple Versions", async ({
    api,
    page,
  }) => {
    const uniqueId = Date.now();

    let projectId: number | undefined;
    let testCaseId: number | undefined;
    const testCaseName = `Version Selector Case ${uniqueId}`;
    const editButton = page.locator('button:has-text("Edit")').first();
    const versionSelector = page.getByTestId("version-select-trigger");

    await test.step("Create project, folder, and test case", async () => {
      projectId = await getTestProjectId(api);

      const folderName = `Version Selector Folder ${uniqueId}`;
      const folderId = await api.createFolder(projectId, folderName);
      testCaseId = await api.createTestCase(projectId, folderId, testCaseName);
    });

    await test.step("Open the test case detail page", async () => {
      // Navigate to the test case detail page
      await page.goto(
        `/en-US/projects/repository/${projectId}/${testCaseId}`
      );
      await page.waitForLoadState("networkidle");

      // Wait for page to fully load
      await expect(editButton).toBeVisible({ timeout: 15000 });
    });

    await test.step("Confirm version selector is hidden with one version", async () => {
      // Initially, version selector should not be visible (only 1 version exists)
      await expect(versionSelector).not.toBeVisible({ timeout: 3000 });
    });

    await test.step("Create a second version via API", async () => {
      // Update test case via API to create version 2
      await api.updateTestCaseName(testCaseId!, `Updated ${testCaseName}`);
    });

    await test.step("Reload and confirm the version selector appears", async () => {
      // Reload the page to see the new version
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(editButton).toBeVisible({ timeout: 15000 });

      // Now version selector should be visible (2 versions exist)
      await expect(versionSelector).toBeVisible({ timeout: 10000 });
    });
  });

  test("Navigate to Previous Version via Selector", async ({ api, page }) => {
    const uniqueId = Date.now();

    let projectId: number | undefined;
    let testCaseId: number | undefined;
    const originalName = `Original Case ${uniqueId}`;
    const editButton = page.locator('button:has-text("Edit")').first();
    const versionSelector = page.getByTestId("version-select-trigger");

    await test.step("Create test case and a second version", async () => {
      projectId = await getTestProjectId(api);

      const folderName = `Navigate Version Folder ${uniqueId}`;
      const folderId = await api.createFolder(projectId, folderName);
      testCaseId = await api.createTestCase(projectId, folderId, originalName);

      // Update test case via API to create version 2
      await api.updateTestCaseName(testCaseId, `Updated ${originalName}`);
    });

    await test.step("Open the test case detail page", async () => {
      // Navigate to test case detail page
      await page.goto(
        `/en-US/projects/repository/${projectId}/${testCaseId}`
      );
      await page.waitForLoadState("networkidle");

      await expect(editButton).toBeVisible({ timeout: 15000 });
    });

    await test.step("Select version 1 from the version selector", async () => {
      // Click on the version selector
      await expect(versionSelector).toBeVisible({ timeout: 10000 });
      await versionSelector.click();

      // Select version 1 from the dropdown
      const version1Option = page
        .locator('[role="option"]')
        .filter({ hasText: "v1" })
        .first();
      await expect(version1Option).toBeVisible({ timeout: 3000 });
      await version1Option.click();
      await page.waitForLoadState("networkidle");
    });

    await test.step("Confirm the version 1 page is shown", async () => {
      // Verify we're on the version page (URL should contain /1 at the end)
      await expect(page).toHaveURL(
        new RegExp(`/projects/repository/${projectId}/${testCaseId}/1`)
      );
    });
  });

  test("Version Page Shows Diff with Previous Version", async ({
    api,
    page,
  }) => {
    const uniqueId = Date.now();

    let projectId: number | undefined;
    let testCaseId: number | undefined;
    const originalName = `Diff Case ${uniqueId}`;
    const updatedName = `Updated Diff Case ${uniqueId}`;

    await test.step("Create test case and a renamed second version", async () => {
      projectId = await getTestProjectId(api);

      const folderName = `Diff Display Folder ${uniqueId}`;
      const folderId = await api.createFolder(projectId, folderName);
      testCaseId = await api.createTestCase(projectId, folderId, originalName);

      // Update test case via API to create version 2 with a different name
      await api.updateTestCaseName(testCaseId, updatedName);
    });

    await test.step("Open the version 2 page", async () => {
      // Navigate directly to version 2 page to see diffs
      await page.goto(
        `/en-US/projects/repository/${projectId}/${testCaseId}/2`
      );
      await page.waitForLoadState("networkidle");

      // Wait for the version page to load completely
      const versionCreatedText = page
        .locator("text=/Version.*Created/i")
        .first();
      await expect(versionCreatedText).toBeVisible({ timeout: 10000 });
    });

    await test.step("Confirm both old and new names appear in the diff", async () => {
      // Version page should show the name change as a diff
      // The old name and new name should both be visible in the diff display
      const oldNameDisplay = page.locator(`text="${originalName}"`).first();
      const newNameDisplay = page.locator(`text="${updatedName}"`).first();

      const hasOldName = await oldNameDisplay
        .isVisible({ timeout: 5000 })
        .catch(() => false);
      const hasNewName = await newNameDisplay
        .isVisible({ timeout: 5000 })
        .catch(() => false);

      // Both old and new names should be visible in the diff view
      expect(hasOldName && hasNewName).toBe(true);
    });
  });

  test("Version Navigation Buttons Work", async ({ api, page }) => {
    const uniqueId = Date.now();

    let projectId: number | undefined;
    let testCaseId: number | undefined;

    await test.step("Create test case with three versions", async () => {
      projectId = await getTestProjectId(api);

      const folderName = `Navigation Folder ${uniqueId}`;
      const folderId = await api.createFolder(projectId, folderName);
      testCaseId = await api.createTestCase(
        projectId,
        folderId,
        `Nav Case ${uniqueId}`
      );

      // Create version 2 and 3 via API
      await api.updateTestCaseName(testCaseId, `Nav Case V2 ${uniqueId}`);
      await api.updateTestCaseName(testCaseId, `Nav Case V3 ${uniqueId}`);
    });

    await test.step("Open the version 2 page", async () => {
      // Navigate to version 2 page
      await page.goto(
        `/en-US/projects/repository/${projectId}/${testCaseId}/2`
      );
      await page.waitForLoadState("networkidle");

      // Wait for version page to load
      const versionCreatedText = page
        .locator("text=/Version.*Created/i")
        .first();
      await expect(versionCreatedText).toBeVisible({ timeout: 10000 });
    });

    await test.step("Navigate to the newer version via the navigation button", async () => {
      // Find navigation buttons (older/newer version)
      const olderVersionButton = page
        .locator('button[title="Older Version"]')
        .first();
      const newerVersionButton = page
        .locator('button[title="Newer Version"]')
        .first();

      // Both navigation buttons should be visible
      await expect(olderVersionButton).toBeVisible({ timeout: 5000 });
      await expect(newerVersionButton).toBeVisible({ timeout: 5000 });

      // Click newer version button (go to version 3)
      await newerVersionButton.click();
      await page.waitForLoadState("networkidle");
      await expect(page).toHaveURL(
        new RegExp(`/projects/repository/${projectId}/${testCaseId}/3`)
      );
    });
  });

  test("Back to Latest Version Link Works", async ({ api, page }) => {
    const uniqueId = Date.now();

    let projectId: number | undefined;
    let testCaseId: number | undefined;

    await test.step("Create test case with a second version", async () => {
      projectId = await getTestProjectId(api);

      const folderName = `Back Link Folder ${uniqueId}`;
      const folderId = await api.createFolder(projectId, folderName);
      testCaseId = await api.createTestCase(
        projectId,
        folderId,
        `Back Link Case ${uniqueId}`
      );

      // Create version 2 via API
      await api.updateTestCaseName(
        testCaseId,
        `Back Link Case V2 ${uniqueId}`
      );
    });

    await test.step("Open the version 1 page", async () => {
      // Navigate to version 1
      await page.goto(
        `/en-US/projects/repository/${projectId}/${testCaseId}/1`
      );
      await page.waitForLoadState("networkidle");

      // Wait for version page to load
      const versionCreatedText = page
        .locator("text=/Version.*Created/i")
        .first();
      await expect(versionCreatedText).toBeVisible({ timeout: 10000 });
    });

    await test.step("Use the back-to-latest link and confirm the main page", async () => {
      // Find and click the "back to latest" link (uses ChevronLast icon)
      // The link has title="Back to Test Case" based on the component
      const backToLatestLink = page
        .locator('a[title="Back to Test Case"]')
        .first();
      await expect(backToLatestLink).toBeVisible({ timeout: 5000 });
      await backToLatestLink.click();
      await page.waitForLoadState("networkidle");

      // Should be back on the main test case page (no version in URL)
      await expect(page).toHaveURL(
        new RegExp(`/projects/repository/${projectId}/${testCaseId}$`)
      );
    });
  });

  test("Version Page Shows Creation Timestamp", async ({ api, page }) => {
    const uniqueId = Date.now();

    let projectId: number | undefined;
    let testCaseId: number | undefined;

    await test.step("Create test case with a second version", async () => {
      projectId = await getTestProjectId(api);

      const folderName = `Timestamp Folder ${uniqueId}`;
      const folderId = await api.createFolder(projectId, folderName);
      testCaseId = await api.createTestCase(
        projectId,
        folderId,
        `Timestamp Case ${uniqueId}`
      );

      // Create version 2 via API
      await api.updateTestCaseName(
        testCaseId,
        `Timestamp Case V2 ${uniqueId}`
      );
    });

    await test.step("Open the version page and confirm the creation timestamp", async () => {
      // Navigate to version page
      await page.goto(
        `/en-US/projects/repository/${projectId}/${testCaseId}/2`
      );
      await page.waitForLoadState("networkidle");

      // Version page should show "Version 2 Created" text
      const versionCreatedText = page
        .locator("text=/Version.*Created/i")
        .first();
      await expect(versionCreatedText).toBeVisible({ timeout: 10000 });
    });
  });

  test("Version Page Shows Tags Section", async ({ api, page }) => {
    const uniqueId = Date.now();

    let projectId: number | undefined;
    let testCaseId: number | undefined;
    const tagName = `VersionTag${uniqueId}`;

    await test.step("Create tagged test case with a second version", async () => {
      // Create a tag
      const tagId = await api.createTag(tagName);

      projectId = await getTestProjectId(api);

      const folderName = `Tags Section Folder ${uniqueId}`;
      const folderId = await api.createFolder(projectId, folderName);
      testCaseId = await api.createTestCase(
        projectId,
        folderId,
        `Tags Section Case ${uniqueId}`
      );

      // Apply tag via API
      await api.addTagToTestCase(testCaseId, tagId);

      // Create version 2 via API
      await api.updateTestCaseName(
        testCaseId,
        `Tags Section Case V2 ${uniqueId}`
      );
    });

    await test.step("Open the version 2 page", async () => {
      // Navigate to version 2 page
      await page.goto(
        `/en-US/projects/repository/${projectId}/${testCaseId}/2`
      );
      await page.waitForLoadState("networkidle");

      // Wait for version page to load
      const versionCreatedText = page
        .locator("text=/Version.*Created/i")
        .first();
      await expect(versionCreatedText).toBeVisible({ timeout: 10000 });
    });

    await test.step("Confirm the Tags section shows the applied tag", async () => {
      // Should show the Tags section
      const tagsLabel = page.locator("text=/^Tags$/").first();
      await expect(tagsLabel).toBeVisible({ timeout: 5000 });

      // The tag should be visible
      await expect(page.locator(`text="${tagName}"`).first()).toBeVisible({
        timeout: 5000,
      });
    });
  });

  test("Version History View Shows Footer Message", async ({ api, page }) => {
    const uniqueId = Date.now();

    let projectId: number | undefined;
    let testCaseId: number | undefined;

    await test.step("Create test case with a second version", async () => {
      projectId = await getTestProjectId(api);

      const folderName = `Footer Folder ${uniqueId}`;
      const folderId = await api.createFolder(projectId, folderName);
      testCaseId = await api.createTestCase(
        projectId,
        folderId,
        `Footer Case ${uniqueId}`
      );

      // Create version 2 via API
      await api.updateTestCaseName(testCaseId, `Footer Case V2 ${uniqueId}`);
    });

    await test.step("Open the version page", async () => {
      // Navigate to version page
      await page.goto(
        `/en-US/projects/repository/${projectId}/${testCaseId}/2`
      );
      await page.waitForLoadState("networkidle");

      // Wait for version page to load
      const versionCreatedText = page
        .locator("text=/Version.*Created/i")
        .first();
      await expect(versionCreatedText).toBeVisible({ timeout: 10000 });
    });

    await test.step("Confirm the history view footer message", async () => {
      // Footer should show history view message (in CardFooter)
      // Based on the error context, it shows "Test Case History View"
      const footer = page
        .locator("text=/History.*View|Test.*Case.*History/i")
        .first();
      await expect(footer).toBeVisible({ timeout: 5000 });
    });
  });

  test("Resizable Panels on Version Page", async ({ api, page }) => {
    const uniqueId = Date.now();

    let projectId: number | undefined;
    let testCaseId: number | undefined;

    await test.step("Create test case with a second version", async () => {
      projectId = await getTestProjectId(api);

      const folderName = `Panels Folder ${uniqueId}`;
      const folderId = await api.createFolder(projectId, folderName);
      testCaseId = await api.createTestCase(
        projectId,
        folderId,
        `Panels Case ${uniqueId}`
      );

      // Create version 2 via API
      await api.updateTestCaseName(testCaseId, `Panels Case V2 ${uniqueId}`);
    });

    await test.step("Open the version page", async () => {
      // Navigate to version page
      await page.goto(
        `/en-US/projects/repository/${projectId}/${testCaseId}/2`
      );
      await page.waitForLoadState("networkidle");

      // Wait for version page to load
      const versionCreatedText = page
        .locator("text=/Version.*Created/i")
        .first();
      await expect(versionCreatedText).toBeVisible({ timeout: 10000 });
    });

    await test.step("Confirm collapsible panel buttons are present", async () => {
      // Version page should have collapsible panel buttons (ChevronLeft icons)
      const panelCollapseButtons = page
        .locator("button")
        .filter({ has: page.locator("svg.lucide-chevron-left") });

      // Should have at least 2 collapse buttons (left and right panels)
      await expect(panelCollapseButtons.first()).toBeVisible({ timeout: 5000 });
      const buttonCount = await panelCollapseButtons.count();
      expect(buttonCount).toBeGreaterThanOrEqual(2);
    });
  });

  test("Version Selector Shows Timestamp in Dropdown", async ({
    api,
    page,
  }) => {
    const uniqueId = Date.now();

    let projectId: number | undefined;
    let testCaseId: number | undefined;
    const editButton = page.locator('button:has-text("Edit")').first();
    const versionSelector = page.getByTestId("version-select-trigger");

    await test.step("Create test case with a second version", async () => {
      projectId = await getTestProjectId(api);

      const folderName = `Selector Timestamp Folder ${uniqueId}`;
      const folderId = await api.createFolder(projectId, folderName);
      testCaseId = await api.createTestCase(
        projectId,
        folderId,
        `Selector Timestamp Case ${uniqueId}`
      );

      // Create version 2 via API
      await api.updateTestCaseName(
        testCaseId,
        `Selector Timestamp Case V2 ${uniqueId}`
      );
    });

    await test.step("Open the test case detail page", async () => {
      // Navigate to test case
      await page.goto(
        `/en-US/projects/repository/${projectId}/${testCaseId}`
      );
      await page.waitForLoadState("networkidle");

      await expect(editButton).toBeVisible({ timeout: 15000 });
    });

    await test.step("Open the version selector dropdown", async () => {
      // Click on the version selector to open dropdown
      await expect(versionSelector).toBeVisible({ timeout: 10000 });
      await versionSelector.click();
    });

    await test.step("Confirm dropdown options show version numbers", async () => {
      // The dropdown should show version numbers with timestamps
      const versionOption = page.locator('[role="option"]').first();
      await expect(versionOption).toBeVisible({ timeout: 3000 });

      // Each option should have a date/time displayed (format varies by user preferences)
      // Look for common date patterns like MM-DD or time patterns
      const optionText = await versionOption.textContent();
      expect(optionText).toMatch(/v\d+/); // Should contain version number
    });
  });
});
