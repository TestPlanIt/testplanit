import { expect, test } from "../../../fixtures";

/**
 * Shared Steps Management Tests
 *
 * Tests for the dedicated shared steps management page where users create, edit,
 * and manage shared step groups — covering CRUD and usage in test cases (REPO-06).
 *
 * Note: steps-display.spec.ts covers display-only rendering of shared steps within
 * test case detail views. This file covers the management UI at:
 *   /en-US/projects/shared-steps/{projectId}
 */
test.describe("Shared Steps Management", () => {
  /**
   * Test 1: Create Shared Step Group via UI
   *
   * Navigates to the shared steps page, opens the manual entry dialog,
   * fills in group name and step items, saves, and verifies the group
   * appears in the list.
   */
  test("Create Shared Step Group via UI", async ({ api, page }) => {
    const projectId = await api.createProject(
      `E2E Shared Steps Create ${Date.now()}`
    );
    const groupName = `UI Created Group ${Date.now()}`;

    // Navigate to shared steps page
    await page.goto(`/en-US/projects/shared-steps/${projectId}`, {
      waitUntil: "networkidle",
    });

    // Open the manual shared steps dialog
    const addButton = page.getByTestId("manual-shared-steps-btn");
    await expect(addButton).toBeVisible({ timeout: 15000 });
    await addButton.click();

    // Wait for dialog to open
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Fill in the group name
    const groupNameInput = page.getByTestId("manual-group-name-input");
    await expect(groupNameInput).toBeVisible({ timeout: 5000 });
    await groupNameInput.fill(groupName);

    // The dialog initializes with one empty step. Fill in the first step.
    const stepsForm = page.getByTestId("steps-form");
    await expect(stepsForm).toBeVisible({ timeout: 10000 });

    // Fill in step 1 — click the tiptap editor inside step-editor-0
    const step0Editor = page.getByTestId("step-editor-0");
    await expect(step0Editor).toBeVisible({ timeout: 10000 });
    const step0StepEditor = step0Editor.locator(".tiptap").first();
    await step0StepEditor.click();
    await page.keyboard.type("Login to the application");
    const step0ResultEditor = step0Editor.locator(".tiptap").nth(1);
    await step0ResultEditor.click();
    await page.keyboard.type("User is successfully logged in");

    // Add a second step by clicking the "Add" button
    const addStepButton = page.getByTestId("add-step-button");
    await expect(addStepButton).toBeVisible({ timeout: 10000 });
    await addStepButton.click();
    await page.waitForTimeout(500);

    // Fill in step 2
    const step1Editor = page.getByTestId("step-editor-1");
    await expect(step1Editor).toBeVisible({ timeout: 10000 });
    const step1StepEditor = step1Editor.locator(".tiptap").first();
    await step1StepEditor.click();
    await page.keyboard.type("Navigate to dashboard");
    const step1ResultEditor = step1Editor.locator(".tiptap").nth(1);
    await step1ResultEditor.click();
    await page.keyboard.type("Dashboard is displayed");

    // Save the dialog
    const saveButton = page.getByTestId("save-manual-shared-steps-btn");
    await expect(saveButton).toBeEnabled({ timeout: 5000 });
    await saveButton.click();

    // Dialog should close and page should reload with the new group
    await expect(dialog).not.toBeVisible({ timeout: 15000 });

    // Wait for page reload (onComplete calls window.location.reload)
    await page.waitForLoadState("networkidle");

    // Verify the new group appears in the list
    const groupNameEl = page
      .locator('[data-testid="group-name"]')
      .filter({ hasText: groupName });
    await expect(groupNameEl).toBeVisible({ timeout: 15000 });
  });

  /**
   * Test 2: Edit Shared Step Group Name and Steps
   *
   * Creates a shared step group via API, navigates to the shared steps page,
   * selects the group, enters edit mode, changes the name and edits a step,
   * adds a new step, saves, and verifies the updated group in the list.
   */
  test("Edit Shared Step Group Name and Steps", async ({ api, page }) => {
    const projectId = await api.createProject(
      `E2E Shared Steps Edit ${Date.now()}`
    );
    const originalName = `Original Group ${Date.now()}`;
    const updatedName = `Updated Group ${Date.now()}`;

    // Create a shared step group via API
    await api.createSharedStepGroup(projectId, originalName, [
      {
        step: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Original step 1" }],
            },
          ],
        },
        expectedResult: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Original result 1" }],
            },
          ],
        },
        order: 0,
      },
      {
        step: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Original step 2" }],
            },
          ],
        },
        expectedResult: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Original result 2" }],
            },
          ],
        },
        order: 1,
      },
    ]);

    // Navigate to shared steps page
    await page.goto(`/en-US/projects/shared-steps/${projectId}`, {
      waitUntil: "networkidle",
    });

    // Click the group in the list to select it
    const groupNameEl = page
      .locator('[data-testid="group-name"]')
      .filter({ hasText: originalName });
    await expect(groupNameEl).toBeVisible({ timeout: 15000 });
    await groupNameEl.click();

    // Wait for the right pane to show the selected group
    const selectedGroupName = page.getByTestId("selected-group-name");
    await expect(selectedGroupName).toBeVisible({ timeout: 10000 });
    await expect(selectedGroupName).toContainText(originalName);

    // Wait for the group steps to load in the right pane
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Click "Edit" to enter edit mode
    const editButton = page.getByTestId("edit-group-name-btn-main");
    await expect(editButton).toBeVisible({ timeout: 10000 });
    await editButton.click();

    // Wait for edit mode — the name input should be visible
    const nameInput = page.getByTestId("edit-group-name-input-main");
    await expect(nameInput).toBeVisible({ timeout: 10000 });

    // Verify existing steps are loaded in edit mode (the form resets with current items)
    await expect(page.getByTestId("step-editor-0")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("step-editor-1")).toBeVisible({ timeout: 10000 });

    // Update the group name
    await nameInput.clear();
    await nameInput.fill(updatedName);

    // Edit the first step's text
    const step0Editor = page.getByTestId("step-editor-0");
    await expect(step0Editor).toBeVisible({ timeout: 10000 });
    const step0StepEditor = step0Editor.locator(".tiptap").first();
    await step0StepEditor.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("Edited step 1 text");

    // Add a new step
    const addStepButton = page.getByTestId("add-step-button");
    await expect(addStepButton).toBeVisible({ timeout: 10000 });
    await addStepButton.click();
    await page.waitForTimeout(500);

    // Fill in the new step
    const step2Editor = page.getByTestId("step-editor-2");
    await expect(step2Editor).toBeVisible({ timeout: 10000 });
    const step2StepEditor = step2Editor.locator(".tiptap").first();
    await step2StepEditor.click();
    await page.keyboard.type("New step 3");
    const step2ResultEditor = step2Editor.locator(".tiptap").nth(1);
    await step2ResultEditor.click();
    await page.keyboard.type("New result 3");

    // Save the changes
    const saveButton = page.getByTestId("save-group-btn");
    await expect(saveButton).toBeVisible({ timeout: 10000 });
    await saveButton.click();

    // Wait for save to complete — edit mode should exit
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("edit-group-name-input-main")).not.toBeVisible({
      timeout: 15000,
    });

    // Verify the updated name is shown in the right pane
    const updatedGroupNameDisplay = page.getByTestId("selected-group-name");
    await expect(updatedGroupNameDisplay).toContainText(updatedName, {
      timeout: 10000,
    });

    // Verify updated name also appears in the left pane list
    const updatedGroupInList = page
      .locator('[data-testid="group-name"]')
      .filter({ hasText: updatedName });
    await expect(updatedGroupInList).toBeVisible({ timeout: 10000 });

    // Verify step count increased to 3 (was 2, added 1)
    const stepsCount = page
      .locator('[data-testid="group-steps-count"]')
      .filter({ hasText: "3" });
    await expect(stepsCount.first()).toBeVisible({ timeout: 10000 });
  });

  /**
   * Test 3: Delete Shared Step Group
   *
   * Creates a shared step group via API, navigates to the shared steps page,
   * selects the group, clicks delete, confirms, and verifies it's gone.
   */
  test("Delete Shared Step Group", async ({ api, page }) => {
    const projectId = await api.createProject(
      `E2E Shared Steps Delete ${Date.now()}`
    );
    const groupName = `Group To Delete ${Date.now()}`;

    // Create a shared step group via API
    await api.createSharedStepGroup(projectId, groupName, [
      {
        step: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Step to delete" }],
            },
          ],
        },
        expectedResult: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Result to delete" }],
            },
          ],
        },
        order: 0,
      },
    ]);

    // Navigate to shared steps page
    await page.goto(`/en-US/projects/shared-steps/${projectId}`, {
      waitUntil: "networkidle",
    });

    // Click the group in the list to select it
    const groupNameEl = page
      .locator('[data-testid="group-name"]')
      .filter({ hasText: groupName });
    await expect(groupNameEl).toBeVisible({ timeout: 15000 });
    await groupNameEl.click();

    // Wait for the right pane to show the selected group
    const selectedGroupName = page.getByTestId("selected-group-name");
    await expect(selectedGroupName).toBeVisible({ timeout: 10000 });

    // The delete button appears on the selected list row (visible when selected & not in edit mode)
    const deleteBtn = page.getByTestId("delete-group-btn");
    await expect(deleteBtn).toBeVisible({ timeout: 10000 });
    await deleteBtn.click();

    // Confirm deletion in the alert dialog
    const confirmDeleteBtn = page.getByTestId("confirm-delete-group-btn");
    await expect(confirmDeleteBtn).toBeVisible({ timeout: 10000 });
    await confirmDeleteBtn.click();

    // Wait for the deletion to complete
    await page.waitForLoadState("networkidle");

    // Verify the group is no longer in the list
    const deletedGroupInList = page
      .locator('[data-testid="group-name"]')
      .filter({ hasText: groupName });
    await expect(deletedGroupInList).not.toBeVisible({ timeout: 15000 });
  });

  /**
   * Test 4: Use Shared Step Group in Test Case
   *
   * Creates a project, folder, test case, and shared step group via API.
   * Navigates to the test case detail page, enters edit mode,
   * adds the shared step group reference via the "Add Shared Steps" button,
   * saves, and verifies the shared step group is displayed in view mode.
   */
  test("Use Shared Step Group in Test Case", async ({ api, page }) => {
    const uniqueId = Date.now();
    const projectId = await api.createProject(
      `E2E Shared Steps Usage ${uniqueId}`
    );

    // Create a template for the test case
    const standardCaseFields = await api.getStandardCaseFieldIds();
    const standardResultFields = await api.getStandardResultFieldIds();
    const templateId = await api.createTemplate({
      name: `E2E Shared Steps Usage Template ${uniqueId}`,
      isEnabled: true,
      isDefault: false,
      caseFieldIds: standardCaseFields,
      resultFieldIds: standardResultFields,
      projectIds: [projectId],
    });

    // Create folder, test case, and shared step group via API
    const folderId = await api.createFolder(projectId, `Usage Folder ${uniqueId}`);
    const testCaseId = await api.createTestCase(
      projectId,
      folderId,
      `Usage Test Case ${uniqueId}`,
      templateId
    );

    const sharedGroupName = `Shared Group For Usage ${uniqueId}`;
    await api.createSharedStepGroup(projectId, sharedGroupName, [
      {
        step: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Shared step item 1" }],
            },
          ],
        },
        expectedResult: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Shared result item 1" }],
            },
          ],
        },
        order: 0,
      },
    ]);

    // Navigate to test case detail page
    await page.goto(
      `/en-US/projects/repository/${projectId}/${testCaseId}`,
      { waitUntil: "networkidle" }
    );

    // Wait for the Edit button to confirm the page loaded
    const editButton = page.getByTestId("edit-test-case-button");
    await expect(editButton).toBeVisible({ timeout: 15000 });
    await editButton.click();

    // Wait for Cancel button — confirms edit mode is active
    const cancelButton = page.locator('button:has-text("Cancel")').first();
    await expect(cancelButton).toBeVisible({ timeout: 10000 });

    // Click "Add Shared Steps" button to open the selection dialog
    // This button is rendered in StepsForm when hideSharedStepsButtons is false
    const addSharedStepsButton = page
      .locator('button')
      .filter({ hasText: /add shared steps/i });
    await expect(addSharedStepsButton.first()).toBeVisible({ timeout: 15000 });
    await addSharedStepsButton.first().click();

    // Wait for the AlertDialog (Add Existing Shared Step Group dialog)
    const sharedStepsDialog = page.locator('[role="alertdialog"]');
    await expect(sharedStepsDialog).toBeVisible({ timeout: 10000 });

    // The AsyncCombobox renders a Button trigger. Click it to open the popover.
    const comboboxTrigger = sharedStepsDialog.locator('[role="combobox"]');
    await expect(comboboxTrigger).toBeVisible({ timeout: 10000 });
    await comboboxTrigger.click();

    // Wait for the popover with CommandInput to open
    // CommandInput renders as an input with cmdk-input attribute
    const commandInput = page.locator('[cmdk-input]');
    await expect(commandInput).toBeVisible({ timeout: 10000 });
    await commandInput.fill(sharedGroupName);
    await page.waitForTimeout(800); // Wait for async fetch to complete

    // Click the shared group option in the popover
    const groupOption = page
      .locator('[role="option"]')
      .filter({ hasText: sharedGroupName });
    await expect(groupOption.first()).toBeVisible({ timeout: 10000 });
    await groupOption.first().click();

    // Close the popover by pressing Escape or clicking outside
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // Click "Add Shared Steps" in the dialog footer
    const addSharedStepsConfirmButton = sharedStepsDialog
      .locator('[role="button"], button')
      .filter({ hasText: /add shared steps/i });
    await expect(addSharedStepsConfirmButton.first()).toBeVisible({
      timeout: 5000,
    });
    await addSharedStepsConfirmButton.first().click();

    // Wait for dialog to close
    await expect(sharedStepsDialog).not.toBeVisible({ timeout: 10000 });

    // Save the test case
    const saveButton = page.locator('button:has-text("Save")').first();
    await expect(saveButton).toBeVisible({ timeout: 10000 });
    await saveButton.click();

    // Wait for save to complete and view mode to restore
    await page.waitForLoadState("networkidle");
    await expect(editButton).toBeVisible({ timeout: 15000 });

    // Expand left panel for visibility (pattern from steps-display.spec.ts)
    await page.waitForTimeout(500);
    try {
      const resizeHandle = page.locator('[data-panel-resize-handle-id]').first();
      await resizeHandle.waitFor({ state: "visible", timeout: 3000 });
      const handleBox = await resizeHandle.boundingBox();
      if (handleBox) {
        const viewportSize = page.viewportSize();
        const targetX = (viewportSize?.width ?? 1280) * 0.6;
        if (handleBox.x < targetX - 50) {
          await resizeHandle.hover();
          await page.mouse.down();
          await page.mouse.move(targetX, handleBox.y, { steps: 10 });
          await page.mouse.up();
          await page.waitForTimeout(800);
        }
      }
    } catch {
      // Panel expansion not available in this layout
    }

    // Verify the shared step group is displayed with the Layers icon indicator
    const sharedStepIndicator = page
      .locator('[data-testid="shared-step-group"]')
      .first();
    await expect(sharedStepIndicator).toBeVisible({ timeout: 15000 });

    // Verify the group name is displayed
    await expect(page.locator(`text=${sharedGroupName}`)).toBeVisible({
      timeout: 10000,
    });
  });

  /**
   * Test 5: Shared Step Group Version History Indicator
   *
   * Creates a shared step group via API, navigates to the shared steps page,
   * verifies the group appears with its step count visible (basic version
   * indicator). Then edits the group via UI to update the step count and
   * verifies the steps count reflects the change.
   */
  test("Shared Step Group Steps Count Reflects Updates", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E Shared Steps Version ${Date.now()}`
    );
    const groupName = `Versioned Group ${Date.now()}`;

    // Create a shared step group with 2 steps via API
    await api.createSharedStepGroup(projectId, groupName, [
      {
        step: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Initial step 1" }],
            },
          ],
        },
        expectedResult: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Initial result 1" }],
            },
          ],
        },
        order: 0,
      },
      {
        step: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Initial step 2" }],
            },
          ],
        },
        expectedResult: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Initial result 2" }],
            },
          ],
        },
        order: 1,
      },
    ]);

    // Navigate to shared steps page
    await page.goto(`/en-US/projects/shared-steps/${projectId}`, {
      waitUntil: "networkidle",
    });

    // Verify the group appears in the list with 2 steps shown
    const groupInList = page
      .locator('[data-testid="group-name"]')
      .filter({ hasText: groupName });
    await expect(groupInList).toBeVisible({ timeout: 15000 });

    // Check that the step count indicator shows "2" initially
    // The group row has data-testid="shared-step-group-{id}", find by group name first
    const groupRow = page
      .locator('[data-testid^="shared-step-group-"]')
      .filter({ hasText: groupName });
    await expect(groupRow).toBeVisible({ timeout: 10000 });

    const stepsCountBefore = groupRow.getByTestId("group-steps-count");
    await expect(stepsCountBefore).toContainText("2", { timeout: 10000 });

    // Select the group and enter edit mode
    await groupInList.click();

    const editButton = page.getByTestId("edit-group-name-btn-main");
    await expect(editButton).toBeVisible({ timeout: 10000 });

    // Wait for the group steps to load in the right pane before entering edit mode
    // The StepsDisplay renders after items are fetched
    await expect(
      page.getByTestId("selected-group-name")
    ).toBeVisible({ timeout: 10000 });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000); // Extra wait for items query to complete

    await editButton.click();

    // Wait for edit mode — the form should show existing steps
    const cancelEditBtn = page.getByTestId("cancel-edit-group-btn");
    await expect(cancelEditBtn).toBeVisible({ timeout: 10000 });

    // Verify the 2 existing steps are visible in edit mode before adding a new one
    await expect(page.getByTestId("step-editor-0")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("step-editor-1")).toBeVisible({ timeout: 10000 });

    // Add one more step
    const addStepButton = page.getByTestId("add-step-button");
    await expect(addStepButton).toBeVisible({ timeout: 10000 });
    await addStepButton.click();
    await page.waitForTimeout(500);

    const step2Editor = page.getByTestId("step-editor-2");
    await expect(step2Editor).toBeVisible({ timeout: 10000 });
    const step2StepEditor = step2Editor.locator(".tiptap").first();
    await step2StepEditor.click();
    await page.keyboard.type("Added third step");
    const step2ResultEditor = step2Editor.locator(".tiptap").nth(1);
    await step2ResultEditor.click();
    await page.keyboard.type("Added third result");

    // Save
    const saveButton = page.getByTestId("save-group-btn");
    await expect(saveButton).toBeVisible({ timeout: 10000 });
    await saveButton.click();

    // Wait for edit mode to exit
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("edit-group-name-input-main")).not.toBeVisible({
      timeout: 15000,
    });

    // Verify the step count now shows 3 in the list
    const updatedGroupRow = page
      .locator('[data-testid^="shared-step-group-"]')
      .filter({ hasText: groupName });
    const stepsCountAfter = updatedGroupRow.getByTestId("group-steps-count");
    await expect(stepsCountAfter).toContainText("3", { timeout: 10000 });
  });
});
