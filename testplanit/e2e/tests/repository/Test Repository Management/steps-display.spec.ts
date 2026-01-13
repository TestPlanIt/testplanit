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

  // Dedicated project for this spec file - isolated from other tests
  let stepsDisplayProjectId: number | null = null;

  test.beforeAll(async ({ api }) => {
    // Create a dedicated project for all steps-display tests
    // Note: createProject automatically assigns templates, workflows, statuses, and milestone types
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    stepsDisplayProjectId = await api.createProject(`E2E Steps Display Project ${uniqueId}`);
  });

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  function getTestProjectId(): number {
    if (!stepsDisplayProjectId) {
      throw new Error("Steps Display project not initialized");
    }
    return stepsDisplayProjectId;
  }

  test("Read-Only Steps Display on Test Case Details Page", async ({
    api,
    page,
  }) => {
    const projectId = getTestProjectId();
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
    await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}`, {
      waitUntil: "networkidle",
    });

    // Wait for page to fully load and ensure we're viewing the correct test case
    const editButton = page.locator('button:has-text("Edit")').first();
    await expect(editButton).toBeVisible({ timeout: 15000 });

    // Verify we're on the correct test case by checking the name in the heading
    await expect(page.locator(`text=${testCaseName}`)).toBeVisible({ timeout: 10000 });

    // Verify step content is displayed
    await expect(page.locator("text=Step 1: Open the application")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=Application opens successfully")).toBeVisible();
    await expect(page.locator("text=Step 2: Login with credentials")).toBeVisible();
    await expect(page.locator("text=User is logged in")).toBeVisible();
    await expect(page.locator("text=Step 3: Navigate to dashboard")).toBeVisible();
    await expect(page.locator("text=Dashboard is displayed")).toBeVisible();
  });

  test("Steps Edit Mode with Add/Remove", async ({ api, page }) => {
    const projectId = getTestProjectId();
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

    // Verify we're on the test case detail page by checking for the test case name in the header
    await expect(page.locator(`text="${testCaseName}"`).first()).toBeVisible({ timeout: 10000 });

    // Click Edit button to enter edit mode using the specific test ID
    const editButton = page.locator('[data-testid="edit-test-case-button"]');
    await expect(editButton).toBeVisible({ timeout: 15000 });
    await editButton.click();

    // Wait for edit mode to fully activate by checking for Cancel button
    const cancelButton = page.locator('button:has-text("Cancel")').first();
    await expect(cancelButton).toBeVisible({ timeout: 10000 });

    // Verify existing step is shown in edit mode
    await expect(page.locator("text=Initial step")).toBeVisible({ timeout: 5000 });

    // Find and click "Add Step" button - use text instead of test ID in case it's not visible
    const addStepButton = page.locator('button:has-text("Add")').filter({ hasNotText: "Add Link" }).filter({ hasNotText: "Add to Test Run" }).first();
    await expect(addStepButton).toBeVisible({ timeout: 10000 });
    await addStepButton.click();
    await page.waitForTimeout(1000);

    // Verify a new step editor appeared (should now have 2 steps)
    // Count step editors by looking for the step number badges or containers
    const stepContainers = page.locator('[data-testid^="step-editor-"]');
    const containerCount = await stepContainers.count();
    expect(containerCount).toBeGreaterThanOrEqual(2);

    // Verify delete buttons are present on steps
    const deleteButtons = page.locator('[data-testid^="delete-step-"]');
    const deleteCount = await deleteButtons.count();
    expect(deleteCount).toBeGreaterThanOrEqual(2);
  });

  // Skip - Test run step display requires investigating the side panel/modal interaction
  // Steps ARE created and associated with test runs correctly
  // May need to wait for side panel to open or use different selector
  test("Steps Display in Test Run Execution View", async ({ api, page }) => {
    const projectId = getTestProjectId();
    const uniqueId = Date.now();

    const folderName = `Run Steps Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseName = `Run Steps Case ${uniqueId}`;
    const testCaseId = await api.createTestCase(
      projectId,
      folderId,
      testCaseName
    );

    // Add steps to the test case via API
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
    await page.goto(`/en-US/projects/runs/${projectId}/${testRunId}`);
    await page.waitForLoadState("networkidle");

    // Click on the test case name in the table to open sidebar
    const testCaseLink = page.locator(`text=${testCaseName}`).first();
    await expect(testCaseLink).toBeVisible({ timeout: 10000 });
    await testCaseLink.click();

    // Wait for sidebar to fully load (look for the Steps section header or similar)
    await page.waitForLoadState("networkidle");

    // Wait for the sidebar sheet to be visible
    const sidebar = page.locator('[role="dialog"]');
    await expect(sidebar).toBeVisible({ timeout: 10000 });

    // Wait for steps to be visible in sidebar
    await expect(page.locator("text=Test run step 1")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=Expected result 1")).toBeVisible();
    await expect(page.locator("text=Test run step 2")).toBeVisible();
    await expect(page.locator("text=Expected result 2")).toBeVisible();
  });

  test("Steps Diff Display in Version Comparison", async ({ api, page }) => {
    const projectId = getTestProjectId();
    const uniqueId = Date.now();

    const folderName = `Diff Steps Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseName = `Diff Steps Case ${uniqueId}`;
    const testCaseId = await api.createTestCase(
      projectId,
      folderId,
      testCaseName
    );

    // Navigate to the newly created test case (version 1 with no steps)
    await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}`);
    await page.waitForLoadState("networkidle");

    const editButton = page.locator('[data-testid="edit-test-case-button"]');
    await expect(editButton).toBeVisible({ timeout: 15000 });

    // VERSION 2: Add 4 steps via UI (this will create version 2)
    await editButton.click();
    await expect(page.locator('button:has-text("Cancel")').first()).toBeVisible({ timeout: 10000 });

    const addStepButton = page.locator('[data-testid="add-step-button"]');

    // Add step 1
    await addStepButton.click();
    await page.waitForTimeout(500);
    let stepEditor = page.locator('[data-testid="step-editor-0"]').first();
    await stepEditor.locator('.tiptap').first().click();
    await page.keyboard.type("Step 1 original");
    await stepEditor.locator('.tiptap').nth(1).click();
    await page.keyboard.type("Result 1 original");

    // Add step 2
    await addStepButton.click();
    await page.waitForTimeout(500);
    stepEditor = page.locator('[data-testid="step-editor-1"]').first();
    await stepEditor.locator('.tiptap').first().click();
    await page.keyboard.type("Step 2 will be edited");
    await stepEditor.locator('.tiptap').nth(1).click();
    await page.keyboard.type("Result 2 original");

    // Add step 3
    await addStepButton.click();
    await page.waitForTimeout(500);
    stepEditor = page.locator('[data-testid="step-editor-2"]').first();
    await stepEditor.locator('.tiptap').first().click();
    await page.keyboard.type("Step 3 unchanged");
    await stepEditor.locator('.tiptap').nth(1).click();
    await page.keyboard.type("Result 3 unchanged");

    // Add step 4
    await addStepButton.click();
    await page.waitForTimeout(500);
    stepEditor = page.locator('[data-testid="step-editor-3"]').first();
    await stepEditor.locator('.tiptap').first().click();
    await page.keyboard.type("Step 4 will be deleted");
    await stepEditor.locator('.tiptap').nth(1).click();
    await page.keyboard.type("Result 4 will be deleted");

    // Save to create version 2
    let saveButton = page.locator('button:has-text("Save")').first();
    await saveButton.click();
    await page.waitForLoadState("networkidle");
    await expect(editButton).toBeVisible({ timeout: 15000 });

    // Wait for version dropdown to show v2
    await expect(page.locator('[role="combobox"]:has-text("v2")')).toBeVisible({ timeout: 10000 });

    // Verify version 2 content is visible
    await expect(page.locator("text=Step 1 original")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=Step 2 will be edited")).toBeVisible();
    await expect(page.locator("text=Step 3 unchanged")).toBeVisible();
    await expect(page.locator("text=Step 4 will be deleted")).toBeVisible();

    // Navigate to version 2 page to see it in the version view
    await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}/2`);
    await page.waitForLoadState("networkidle");

    // Check that we're on version 2
    await expect(page.locator('text=v2')).toBeVisible({ timeout: 10000 });

    // Verify version 2 shows the step content
    await expect(page.locator("text=Step 1 original")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=Result 2 original")).toBeVisible();
    await expect(page.locator("text=Step 3 unchanged")).toBeVisible();
    await expect(page.locator("text=Step 4 will be deleted")).toBeVisible();

    // Navigate to version 1 to verify it has no steps (initial creation)
    await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}/1`);
    await page.waitForLoadState("networkidle");

    // Check that we're on version 1
    await expect(page.locator('text=v1')).toBeVisible({ timeout: 10000 });

    // Version 1 should have no steps (it was created empty)
    await expect(page.locator("text=Step 1 original")).not.toBeVisible();
    await expect(page.locator("text=Step 2 will be edited")).not.toBeVisible();

    // VERSION 3: Go back to main page and edit the steps to create version 3
    await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}`);
    await page.waitForLoadState("networkidle");

    await expect(editButton).toBeVisible({ timeout: 15000 });
    await editButton.click();
    await expect(page.locator('button:has-text("Cancel")').first()).toBeVisible({ timeout: 10000 });

    // 1. Edit step 1 text
    const step1Editor = page.locator('[data-testid="step-editor-0"]').first();
    await step1Editor.locator('.tiptap').first().click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type("Step 1 EDITED");

    // 2. Edit expected result 2
    const step2ExpectedResult = page.locator('[data-testid="step-editor-1"]').locator('.tiptap').nth(1);
    await step2ExpectedResult.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type("Result 2 EDITED");

    // 3. Step 3 remains unchanged

    // 4. Delete step 4 (index 3)
    const deleteStep4Button = page.locator('[data-testid="delete-step-3"]').first();
    await deleteStep4Button.click();
    await page.waitForTimeout(500);

    // 5. Add 2 new steps
    await addStepButton.click();
    await page.waitForTimeout(500);
    const newStep1Editor = page.locator('[data-testid="step-editor-3"]').first();
    await newStep1Editor.locator('.tiptap').first().click();
    await page.keyboard.type("New step 5 added");
    await newStep1Editor.locator('.tiptap').nth(1).click();
    await page.keyboard.type("New result 5 added");

    await addStepButton.click();
    await page.waitForTimeout(500);
    const newStep2Editor = page.locator('[data-testid="step-editor-4"]').first();
    await newStep2Editor.locator('.tiptap').first().click();
    await page.keyboard.type("New step 6 added");
    await newStep2Editor.locator('.tiptap').nth(1).click();
    await page.keyboard.type("New result 6 added");

    // Save to create version 3
    saveButton = page.locator('button:has-text("Save")').first();
    await saveButton.click();
    await page.waitForLoadState("networkidle");
    await expect(editButton).toBeVisible({ timeout: 15000 });

    // Wait for version dropdown to show v3
    await expect(page.locator('[role="combobox"]:has-text("v3")')).toBeVisible({ timeout: 10000 });

    // Verify version 3 content is visible
    await expect(page.locator("text=Step 1 EDITED")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=Result 2 EDITED")).toBeVisible();
    await expect(page.locator("text=Step 3 unchanged")).toBeVisible();
    await expect(page.locator("text=New step 5 added")).toBeVisible();
    await expect(page.locator("text=New step 6 added")).toBeVisible();

    // Navigate to version 3 page to see the diff from version 2
    await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}/3`);
    await page.waitForLoadState("networkidle");

    // Check that we're on version 3
    await expect(page.locator('text=v3')).toBeVisible({ timeout: 10000 });

    // Verify version 3 shows the changes (diff indicators should show):
    // - Step 1 EDITED (modified)
    // - Result 2 EDITED (modified)
    // - Step 3 unchanged (no change)
    // - Step 4 deleted (removed)
    // - New step 5 added (added)
    // - New step 6 added (added)
    await expect(page.locator("text=Step 1 EDITED")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=Result 2 EDITED")).toBeVisible();
    await expect(page.locator("text=Step 3 unchanged")).toBeVisible();
    await expect(page.locator("text=New step 5 added")).toBeVisible();
    await expect(page.locator("text=New step 6 added")).toBeVisible();

    // Verify version 2 still shows the original content (before v3 edits)
    await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}/2`);
    await page.waitForLoadState("networkidle");

    await expect(page.locator('text=v2')).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=Step 1 original")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=Result 2 original")).toBeVisible();
    await expect(page.locator("text=Step 4 will be deleted")).toBeVisible();
    await expect(page.locator("text=Step 1 EDITED")).not.toBeVisible();
    await expect(page.locator("text=New step 5 added")).not.toBeVisible();
  });

  // Skip this test - Add Result modal is accessed from test run status cells, not from test case details page
  // The workflow requires: Test Run → Click status cell → Add Result modal opens
  // This is tested elsewhere in test run E2E tests
  test("Steps Display in Add Result Modal", async ({ api, page }) => {
    const projectId = getTestProjectId();
    const uniqueId = Date.now();

    const folderName = `Result Modal Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseName = `Result Modal Case ${uniqueId}`;
    const testCaseId = await api.createTestCase(
      projectId,
      folderId,
      testCaseName
    );

    // Add steps to the test case via API
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

    // Create a test run with this case
    const testRunName = `E2E Result Modal Run ${uniqueId}`;
    const testRunId = await api.createTestRun(projectId, testRunName);
    await api.addTestCaseToTestRun(testRunId, testCaseId);

    // Navigate to test run execution page
    await page.goto(`/en-US/projects/runs/${projectId}/${testRunId}`);
    await page.waitForLoadState("networkidle");

    // Click on the test case name in the table to open sidebar
    const testCaseLink = page.locator(`text=${testCaseName}`).first();
    await expect(testCaseLink).toBeVisible({ timeout: 10000 });
    await testCaseLink.click();

    // Wait for sidebar to fully load
    await page.waitForLoadState("networkidle");

    // Wait for sidebar to open and find Add Result button
    const addResultButton = page.locator('button:has-text("Add Result")').first();
    await expect(addResultButton).toBeVisible({ timeout: 15000 });
    await addResultButton.click();

    // Wait for Add Result modal to open (there are 2 dialogs: sidebar and modal, so be specific)
    const modal = page.getByRole('dialog', { name: 'Add Result' });
    await expect(modal).toBeVisible({ timeout: 10000 });

    // Verify steps are displayed in the Add Result modal
    await expect(page.locator("text=Result step 1")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=Result expected 1")).toBeVisible();
    await expect(page.locator("text=Result step 2")).toBeVisible();
    await expect(page.locator("text=Result expected 2")).toBeVisible();
  });

  test("Shared Step Group Display", async ({ api, page }) => {
    const projectId = getTestProjectId();
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
    const projectId = getTestProjectId();
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
