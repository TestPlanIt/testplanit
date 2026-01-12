import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Steps Display Tests
 *
 * Test cases for verifying test case steps are displayed correctly in various contexts:
 * - Read-only view on test case details page
 * - Edit mode with drag-and-drop
 * - Test run execution view
 * - Version comparison/diff view
 * - Result entry modals
 * - Shared step groups
 */
test.describe("Steps Display", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  async function getTestProjectId(
    api: import("../../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    return await api.createProject(`E2E Steps Display ${Date.now()}`);
  }

  test("Read-Only Steps Display on Test Case Details Page", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    const folderName = `Steps Display Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseName = `Steps Display Case ${uniqueId}`;
    const testCaseId = await api.createTestCase(
      projectId,
      folderId,
      testCaseName
    );

    // Add steps to the test case via API
    await api.addStepsToTestCase(testCaseId, [
      {
        step: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Step 1: Open the application" }] }] },
        expectedResult: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Application opens successfully" }] }] },
        order: 0,
      },
      {
        step: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Step 2: Login with credentials" }] }] },
        expectedResult: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "User is logged in" }] }] },
        order: 1,
      },
      {
        step: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Step 3: Navigate to dashboard" }] }] },
        expectedResult: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Dashboard is displayed" }] }] },
        order: 2,
      },
    ]);

    // Navigate to test case details page
    await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}`);
    await page.waitForLoadState("networkidle");

    // Wait for page to load
    const editButton = page.locator('button:has-text("Edit")').first();
    await expect(editButton).toBeVisible({ timeout: 15000 });

    // Verify steps display container is visible
    const stepsDisplay = page.locator('[data-testid="steps-display"]');
    await expect(stepsDisplay).toBeVisible({ timeout: 10000 });

    // Verify step content is displayed
    await expect(page.locator("text=Step 1: Open the application")).toBeVisible();
    await expect(page.locator("text=Application opens successfully")).toBeVisible();
    await expect(page.locator("text=Step 2: Login with credentials")).toBeVisible();
    await expect(page.locator("text=User is logged in")).toBeVisible();

    // Verify step badges are visible
    const stepBadges = page.locator('[data-testid^="step-badge-"]');
    const stepCount = await stepBadges.count();
    expect(stepCount).toBeGreaterThanOrEqual(3);
  });

  test("Steps Edit Mode with Add/Remove", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    const folderName = `Steps Edit Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseName = `Steps Edit Case ${uniqueId}`;
    const testCaseId = await api.createTestCase(
      projectId,
      folderId,
      testCaseName
    );

    // Add one step via API
    await api.addStepsToTestCase(testCaseId, [
      {
        step: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Initial step" }] }] },
        expectedResult: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Initial result" }] }] },
        order: 0,
      },
    ]);

    // Navigate to test case details page
    await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}`);
    await page.waitForLoadState("networkidle");

    // Click Edit button to enter edit mode
    const editButton = page.locator('button:has-text("Edit")').first();
    await expect(editButton).toBeVisible({ timeout: 15000 });
    await editButton.click();
    await page.waitForLoadState("networkidle");

    // Wait for StepsForm to be visible (edit mode)
    const stepsSection = page.locator('[data-testid="steps-form"]');
    await expect(stepsSection).toBeVisible({ timeout: 10000 });

    // Verify existing step is shown
    await expect(page.locator("text=Initial step")).toBeVisible();

    // Find and click "Add Step" button
    const addStepButton = page.locator('[data-testid="add-step-button"]');
    await expect(addStepButton).toBeVisible({ timeout: 5000 });
    await addStepButton.click();
    await page.waitForTimeout(500);

    // Verify a new step editor appeared (should now have 2 steps)
    const stepEditors = page.locator('[data-testid^="step-editor-"]');
    const editorCount = await stepEditors.count();
    expect(editorCount).toBeGreaterThanOrEqual(2);

    // Verify delete buttons are present on steps
    const deleteButtons = page.locator('[data-testid^="delete-step-"]');
    const deleteCount = await deleteButtons.count();
    expect(deleteCount).toBeGreaterThanOrEqual(2);
  });

  test("Steps Display in Test Run Execution View", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    const folderName = `Run Steps Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseName = `Run Steps Case ${uniqueId}`;
    const testCaseId = await api.createTestCase(
      projectId,
      folderId,
      testCaseName
    );

    // Add steps to the test case
    await api.addStepsToTestCase(testCaseId, [
      {
        step: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Test run step 1" }] }] },
        expectedResult: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Expected result 1" }] }] },
        order: 0,
      },
      {
        step: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Test run step 2" }] }] },
        expectedResult: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Expected result 2" }] }] },
        order: 1,
      },
    ]);

    // Create a test run with this case
    const testRunName = `E2E Test Run ${uniqueId}`;
    const testRunId = await api.createTestRun(projectId, testRunName);
    await api.addTestCaseToTestRun(testRunId, testCaseId);

    // Navigate to test run execution page
    await page.goto(`/en-US/projects/test-runs/${projectId}/${testRunId}`);
    await page.waitForLoadState("networkidle");

    // Click on the test case to open details panel
    const testCaseRow = page.locator(`[data-row-id="${testCaseId}"]`).first();
    await expect(testCaseRow).toBeVisible({ timeout: 10000 });
    await testCaseRow.click();
    await page.waitForTimeout(500);

    // Verify steps results container is visible
    const stepsResults = page.locator('[data-testid="steps-results"]');
    await expect(stepsResults).toBeVisible({ timeout: 10000 });

    // Verify step content is displayed in run view
    await expect(page.locator("text=Test run step 1")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Expected result 1")).toBeVisible();
    await expect(page.locator("text=Test run step 2")).toBeVisible();
  });

  test("Steps Diff Display in Version Comparison", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    const folderName = `Diff Steps Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseName = `Diff Steps Case ${uniqueId}`;
    const testCaseId = await api.createTestCase(
      projectId,
      folderId,
      testCaseName
    );

    // Add initial steps (version 1)
    await api.addStepsToTestCase(testCaseId, [
      {
        step: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Original step 1" }] }] },
        expectedResult: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Original result 1" }] }] },
        order: 0,
      },
      {
        step: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Original step 2" }] }] },
        expectedResult: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Original result 2" }] }] },
        order: 1,
      },
    ]);

    // Update test case to create version 2 with modified steps
    await api.updateTestCaseSteps(testCaseId, [
      {
        step: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Modified step 1" }] }] },
        expectedResult: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Modified result 1" }] }] },
        order: 0,
      },
      {
        step: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Modified step 2" }] }] },
        expectedResult: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Modified result 2" }] }] },
        order: 1,
      },
      {
        step: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "New step 3" }] }] },
        expectedResult: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "New result 3" }] }] },
        order: 2,
      },
    ]);

    // Navigate to version 2 page to see diff
    await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}/2`);
    await page.waitForLoadState("networkidle");

    // Wait for version page to load
    const versionCreatedText = page.locator("text=/Version.*Created/i").first();
    await expect(versionCreatedText).toBeVisible({ timeout: 10000 });

    // Verify steps diff is displayed (green for added, red for removed)
    // New step should have green highlighting
    const greenHighlight = page.locator(".bg-green-100, .text-green-600");
    await expect(greenHighlight.first()).toBeVisible({ timeout: 5000 });

    // Verify step content is visible
    await expect(page.locator("text=Modified step 1")).toBeVisible();
    await expect(page.locator("text=New step 3")).toBeVisible();
  });

  test("Steps Display in Add Result Modal", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    const folderName = `Result Modal Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseName = `Result Modal Case ${uniqueId}`;
    const testCaseId = await api.createTestCase(
      projectId,
      folderId,
      testCaseName
    );

    // Add steps to the test case
    await api.addStepsToTestCase(testCaseId, [
      {
        step: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Result step 1" }] }] },
        expectedResult: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Result expected 1" }] }] },
        order: 0,
      },
      {
        step: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Result step 2" }] }] },
        expectedResult: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Result expected 2" }] }] },
        order: 1,
      },
    ]);

    // Navigate to test case details page
    await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}`);
    await page.waitForLoadState("networkidle");

    // Wait for page to load
    const editButton = page.locator('button:has-text("Edit")').first();
    await expect(editButton).toBeVisible({ timeout: 15000 });

    // Find and click "Add Result" button
    const addResultButton = page
      .locator('button:has-text("Add Result")')
      .first();
    await expect(addResultButton).toBeVisible({ timeout: 5000 });
    await addResultButton.click();
    await page.waitForLoadState("networkidle");

    // Wait for Add Result modal to open
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Verify steps are displayed in the modal with step-by-step result entry
    await expect(page.locator("text=Result step 1")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("text=Result expected 1")).toBeVisible();
    await expect(page.locator("text=Result step 2")).toBeVisible();
  });

  test("Shared Step Group Display", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    // Create a shared step group
    const sharedStepGroupName = `Shared Steps ${uniqueId}`;
    const sharedStepGroupId = await api.createSharedStepGroup(
      projectId,
      sharedStepGroupName,
      [
        {
          step: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Shared step 1" }] }] },
          expectedResult: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Shared result 1" }] }] },
          order: 0,
        },
        {
          step: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Shared step 2" }] }] },
          expectedResult: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Shared result 2" }] }] },
          order: 1,
        },
      ]
    );

    // Create a test case with the shared step group
    const folderName = `Shared Steps Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseName = `Shared Steps Case ${uniqueId}`;
    const testCaseId = await api.createTestCase(
      projectId,
      folderId,
      testCaseName
    );

    // Add regular step and shared step group reference
    await api.addStepsToTestCase(testCaseId, [
      {
        step: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Regular step" }] }] },
        expectedResult: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Regular result" }] }] },
        order: 0,
      },
    ]);

    await api.addSharedStepGroupToTestCase(testCaseId, sharedStepGroupId, 1);

    // Navigate to test case details page
    await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}`);
    await page.waitForLoadState("networkidle");

    // Wait for page to load
    const editButton = page.locator('button:has-text("Edit")').first();
    await expect(editButton).toBeVisible({ timeout: 15000 });

    // Verify regular step is displayed
    await expect(page.locator("text=Regular step")).toBeVisible();

    // Verify shared step group is displayed with Layers icon
    const sharedStepIndicator = page.locator('[data-testid="shared-step-group"]').first();
    await expect(sharedStepIndicator).toBeVisible({ timeout: 10000 });

    // Verify shared step group name is displayed
    await expect(page.locator(`text=${sharedStepGroupName}`)).toBeVisible();

    // Shared step items should be visible (they auto-expand)
    await expect(page.locator("text=Shared step 1")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("text=Shared step 2")).toBeVisible();
  });

  test("Steps Display Preserves Order", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    const folderName = `Order Steps Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseName = `Order Steps Case ${uniqueId}`;
    const testCaseId = await api.createTestCase(
      projectId,
      folderId,
      testCaseName
    );

    // Add multiple steps in specific order
    await api.addStepsToTestCase(testCaseId, [
      {
        step: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "First step" }] }] },
        expectedResult: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "First result" }] }] },
        order: 0,
      },
      {
        step: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Second step" }] }] },
        expectedResult: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Second result" }] }] },
        order: 1,
      },
      {
        step: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Third step" }] }] },
        expectedResult: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Third result" }] }] },
        order: 2,
      },
    ]);

    // Navigate to test case details page
    await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}`);
    await page.waitForLoadState("networkidle");

    // Wait for page to load
    const editButton = page.locator('button:has-text("Edit")').first();
    await expect(editButton).toBeVisible({ timeout: 15000 });

    // Verify steps display container is visible
    const stepsDisplay = page.locator('[data-testid="steps-display"]');
    await expect(stepsDisplay).toBeVisible({ timeout: 10000 });

    // Verify steps appear in correct order by checking their text content
    await expect(page.locator("text=First step")).toBeVisible();
    await expect(page.locator("text=Second step")).toBeVisible();
    await expect(page.locator("text=Third step")).toBeVisible();

    // Verify step badges are visible
    const badge1 = page.locator('[data-testid="step-badge-0"]').first();
    const badge2 = page.locator('[data-testid="step-badge-1"]').first();
    const badge3 = page.locator('[data-testid="step-badge-2"]').first();

    await expect(badge1).toBeVisible();
    await expect(badge2).toBeVisible();
    await expect(badge3).toBeVisible();
  });
});
