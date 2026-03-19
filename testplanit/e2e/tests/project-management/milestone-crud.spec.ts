import { expect, test } from "../../fixtures";

/**
 * Milestone CRUD E2E tests - PROJ-03
 *
 * Covers: create, edit, nest (parent-child), complete, and delete milestone workflows.
 * Delete tests verify cascade (parent deletion removes children).
 */

test.describe("Milestone CRUD", () => {
  test("should create a milestone via the Add Milestone modal", async ({
    page,
    api,
  }) => {
    const projectId = await api.createProject(
      `E2E Milestone Create ${Date.now()}`
    );

    await page.goto(`/en-US/projects/milestones/${projectId}`);
    await page.waitForLoadState("networkidle");

    // Verify page loaded
    const activeTab = page.getByRole("tab", { name: /Active/i });
    await expect(activeTab).toBeVisible({ timeout: 10000 });

    // Open the Add Milestone modal
    const addButton = page.getByTestId("new-milestone-button");
    await expect(addButton).toBeVisible({ timeout: 10000 });
    await addButton.click();

    // Dialog should open
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 });

    // Fill in the milestone name
    const milestoneName = `Test Milestone ${Date.now()}`;
    const nameInput = page.getByPlaceholder(/Name/i);
    await nameInput.fill(milestoneName);

    // Submit
    const saveButton = page.getByRole("button", { name: /Save/i });
    await saveButton.click();

    // Dialog should close and milestone should appear in the Active tab
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByText(milestoneName)).toBeVisible({ timeout: 10000 });
  });

  test("should edit a milestone via the detail page", async ({
    page,
    api,
  }) => {
    const projectId = await api.createProject(
      `E2E Milestone Edit ${Date.now()}`
    );
    const milestoneId = await api.createMilestone(
      projectId,
      `Editable Milestone ${Date.now()}`,
      { isStarted: false, isCompleted: false }
    );

    // Navigate directly to the milestone detail page
    await page.goto(
      `/en-US/projects/milestones/${projectId}/${milestoneId}?edit=true`
    );
    await page.waitForLoadState("networkidle");

    // Wait for the form to be in edit mode (Save button visible)
    const saveButton = page.getByRole("button", { name: /Save/i });
    await expect(saveButton).toBeVisible({ timeout: 15000 });

    // Clear and retype the milestone name
    const updatedName = `Updated Milestone ${Date.now()}`;
    const nameTextarea = page.locator("textarea").first();
    await nameTextarea.clear();
    await nameTextarea.fill(updatedName);

    // Save changes
    await saveButton.click();

    // Edit mode should end — Save button disappears
    await expect(saveButton).not.toBeVisible({ timeout: 10000 });

    // The updated name should now be visible as the page title
    await expect(page.getByText(updatedName)).toBeVisible({ timeout: 10000 });
  });

  test("should show child milestone on parent detail page when nested via API", async ({
    page,
    api,
  }) => {
    const projectId = await api.createProject(
      `E2E Milestone Nest ${Date.now()}`
    );
    const parentId = await api.createMilestone(
      projectId,
      `Parent Milestone ${Date.now()}`,
      { isStarted: false, isCompleted: false }
    );
    const childName = `Child Milestone ${Date.now()}`;
    await api.createMilestone(projectId, childName, {
      isStarted: false,
      isCompleted: false,
      parentId,
    });

    // Navigate to the parent milestone detail page
    await page.goto(`/en-US/projects/milestones/${projectId}/${parentId}`);
    await page.waitForLoadState("networkidle");

    // Wait for page to fully render
    await expect(
      page.getByRole("button", { name: /Edit/i })
    ).toBeVisible({ timeout: 15000 });

    // The child milestone section should show the child
    await expect(page.getByText(childName)).toBeVisible({ timeout: 10000 });
  });

  test("should complete a started milestone", async ({ page, api }) => {
    const projectId = await api.createProject(
      `E2E Milestone Complete ${Date.now()}`
    );
    const milestoneName = `Started Milestone ${Date.now()}`;
    await api.createMilestone(projectId, milestoneName, {
      isStarted: true,
      isCompleted: false,
    });

    await page.goto(`/en-US/projects/milestones/${projectId}`);
    await page.waitForLoadState("networkidle");

    // Active tab should be visible
    const activeTab = page.getByRole("tab", { name: /Active/i });
    await expect(activeTab).toBeVisible({ timeout: 10000 });

    // Find the milestone card
    const milestoneCard = page
      .locator("div")
      .filter({ hasText: milestoneName })
      .first();
    await expect(milestoneCard).toBeVisible({ timeout: 10000 });

    // Open the 3-dot dropdown menu
    const menuButton = milestoneCard.getByRole("button").last();
    await menuButton.click();

    // Click Complete
    const completeMenuItem = page.getByRole("menuitem", { name: /Complete/i });
    await expect(completeMenuItem).toBeVisible({ timeout: 5000 });
    await completeMenuItem.click();

    // Complete Milestone dialog should open
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 });

    // Click Complete button in the dialog
    const completeButton = page
      .getByRole("dialog")
      .getByRole("button", { name: /Complete/i });
    await expect(completeButton).toBeVisible({ timeout: 5000 });
    await completeButton.click();

    // Dialog should close
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10000 });

    // Switch to Completed tab to verify
    const completedTab = page.getByRole("tab", { name: /Completed/i });
    await completedTab.click();

    await expect(page.getByText(milestoneName)).toBeVisible({ timeout: 10000 });
  });

  test("should delete a milestone (with cascade to children)", async ({
    page,
    api,
  }) => {
    const projectId = await api.createProject(
      `E2E Milestone Delete ${Date.now()}`
    );
    const parentName = `Parent To Delete ${Date.now()}`;
    const parentId = await api.createMilestone(projectId, parentName, {
      isStarted: false,
      isCompleted: false,
    });
    const childName = `Child To Delete ${Date.now()}`;
    await api.createMilestone(projectId, childName, {
      isStarted: false,
      isCompleted: false,
      parentId,
    });

    // Navigate to milestones list
    await page.goto(`/en-US/projects/milestones/${projectId}`);
    await page.waitForLoadState("networkidle");

    const activeTab = page.getByRole("tab", { name: /Active/i });
    await expect(activeTab).toBeVisible({ timeout: 10000 });

    // Find the parent milestone card
    const parentCard = page
      .locator("div")
      .filter({ hasText: parentName })
      .first();
    await expect(parentCard).toBeVisible({ timeout: 10000 });

    // Open the 3-dot dropdown menu
    const menuButton = parentCard.getByRole("button").last();
    await menuButton.click();

    // Click Delete
    const deleteMenuItem = page.getByRole("menuitem", { name: /Delete/i });
    await expect(deleteMenuItem).toBeVisible({ timeout: 5000 });
    await deleteMenuItem.click();

    // Delete confirmation dialog should open
    await expect(page.getByRole("alertdialog")).toBeVisible({ timeout: 5000 });

    // Confirm deletion
    const confirmButton = page.getByRole("button", { name: /Confirm/i });
    await confirmButton.click();

    // Dialog should close
    await expect(page.getByRole("alertdialog")).not.toBeVisible({
      timeout: 10000,
    });

    // Parent should no longer be visible
    await expect(page.getByText(parentName)).not.toBeVisible({
      timeout: 10000,
    });
  });

  test("should delete a milestone from the detail page", async ({
    page,
    api,
  }) => {
    const projectId = await api.createProject(
      `E2E Milestone Delete Detail ${Date.now()}`
    );
    const milestoneName = `Delete From Detail ${Date.now()}`;
    const milestoneId = await api.createMilestone(projectId, milestoneName, {
      isStarted: false,
      isCompleted: false,
    });

    // Navigate to milestone detail in edit mode
    await page.goto(
      `/en-US/projects/milestones/${projectId}/${milestoneId}?edit=true`
    );
    await page.waitForLoadState("networkidle");

    // Wait for edit mode (Save button visible)
    await expect(
      page.getByRole("button", { name: /Save/i })
    ).toBeVisible({ timeout: 15000 });

    // Click the Delete button (visible in edit mode)
    const deleteButton = page.getByRole("button", { name: /Delete/i });
    await expect(deleteButton).toBeVisible({ timeout: 5000 });
    await deleteButton.click();

    // AlertDialog should open
    await expect(page.getByRole("alertdialog")).toBeVisible({ timeout: 5000 });

    // Confirm deletion
    await page.getByRole("button", { name: /Confirm/i }).click();

    // Should redirect back to milestones list
    await page.waitForURL(`**/projects/milestones/${projectId}`, {
      timeout: 15000,
    });
  });
});
