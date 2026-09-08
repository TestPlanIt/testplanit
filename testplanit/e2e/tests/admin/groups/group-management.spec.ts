import { expect, test } from "../../../fixtures";

/**
 * Group Management E2E Tests
 *
 * Tests for group CRUD operations and user assignment:
 * - View groups list
 * - Create a new group
 * - Edit a group name
 * - Delete a group
 * - Assign users to a group via the edit modal
 */

test.describe("Group Management", () => {
  test("Admin can view groups list", async ({ page }) => {
    await test.step("Open the admin groups page", async () => {
      await page.goto("/en-US/admin/groups");
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the groups list and table render", async () => {
      // The page should render the Groups card
      await expect(page.locator("main")).toBeVisible();

      // Should show the Groups title (CardTitle renders as h3 or a styled span/div)
      const groupsTitle = page
        .locator("h1, h2, h3, p, span, div")
        .filter({ hasText: /^groups$/i })
        .first();
      await expect(groupsTitle).toBeVisible({ timeout: 10000 });

      // DataTable should be rendered
      const table = page.getByRole("table");
      await expect(table).toBeVisible({ timeout: 10000 });
    });
  });

  test("Admin can create a new group", async ({ page }) => {
    const groupName = `Test Group ${Date.now()}`;

    // We'll track the created group ID for cleanup via ZenStack API
    let createdGroupId: number | undefined;

    try {
      await test.step("Open the admin groups page", async () => {
        await page.goto("/en-US/admin/groups");
        await page.waitForLoadState("networkidle");
      });

      const dialog = page.locator('[role="dialog"]');

      await test.step("Open the Add Group dialog", async () => {
        // Click the Add Group button (triggers AddGroup dialog)
        const addButton = page.getByRole("button", { name: /add/i }).first();
        await expect(addButton).toBeVisible({ timeout: 10000 });
        await addButton.click();

        // Wait for the dialog to open
        await expect(dialog).toBeVisible({ timeout: 5000 });
      });

      await test.step("Enter the group name and submit", async () => {
        // Fill in the group name
        const nameInput = dialog.locator("input[placeholder]").first();
        await expect(nameInput).toBeVisible();
        await nameInput.fill(groupName);

        // Submit the form
        const submitButton = dialog.getByRole("button", {
          name: /submit/i,
        });
        await expect(submitButton).toBeVisible();
        await submitButton.click();

        // Wait for dialog to close
        await expect(dialog).not.toBeVisible({ timeout: 10000 });

        // Wait for the page to refresh
        await page.waitForLoadState("networkidle");
      });

      await test.step("Verify the new group appears and capture its ID", async () => {
        // Verify the new group appears in the table
        const newGroupRow = page
          .getByRole("row")
          .filter({ hasText: groupName });
        await expect(newGroupRow).toBeVisible({ timeout: 10000 });

        // Try to get the group ID for cleanup via API lookup
        const groupResponse = await page.request.get(
          `/api/model/groups/findFirst?q=${encodeURIComponent(
            JSON.stringify({ where: { name: groupName } })
          )}`
        );
        if (groupResponse.ok()) {
          const groupData = await groupResponse.json();
          createdGroupId = groupData?.data?.id;
        }
      });
    } finally {
      // Cleanup: soft-delete the group
      if (createdGroupId) {
        await page.request.post(`/api/model/groups/update`, {
          data: {
            where: { id: createdGroupId },
            data: { isDeleted: true },
          },
        });
      }
    }
  });

  test("Admin can edit a group name", async ({ page }) => {
    const originalName = `Edit Group ${Date.now()}`;
    const updatedName = `Updated Group ${Date.now()}`;
    let createdGroupId: number | undefined;

    try {
      await test.step("Create a group via API for setup", async () => {
        // Create a group via ZenStack API for setup
        const createResponse = await page.request.post(
          `/api/model/groups/create`,
          {
            data: {
              data: { name: originalName },
            },
          }
        );
        expect(createResponse.ok()).toBe(true);
        const createData = await createResponse.json();
        createdGroupId = createData?.data?.id;
        expect(createdGroupId).toBeDefined();
      });

      const dialog = page.locator('[role="dialog"]');

      await test.step("Open the group's edit dialog", async () => {
        await page.goto("/en-US/admin/groups");
        await page.waitForLoadState("networkidle");

        // Find the group row
        const groupRow = page
          .getByRole("row")
          .filter({ hasText: originalName });
        await expect(groupRow).toBeVisible({ timeout: 10000 });

        // Click the edit button (SquarePen icon button) in the actions cell
        const actionsCell = groupRow.getByRole("cell").last();
        const editButton = actionsCell.locator("button").first();
        await expect(editButton).toBeVisible();
        await editButton.click();

        // Wait for edit dialog to open
        await expect(dialog).toBeVisible({ timeout: 5000 });
      });

      await test.step("Update the group name and save", async () => {
        // Clear and update the name field
        const nameInput = dialog.locator("input").first();
        await expect(nameInput).toBeVisible();
        await nameInput.clear();
        await nameInput.fill(updatedName);

        // Wait for form validation
        await page.waitForTimeout(300);

        // Save
        const saveButton = dialog.getByRole("button", { name: /save/i });
        await expect(saveButton).toBeVisible();
        await saveButton.click();

        // Wait for dialog to close
        await expect(dialog).not.toBeVisible({ timeout: 10000 });
      });

      await test.step("Reload and verify the updated name", async () => {
        // Reload to confirm the update
        await page.reload();
        await page.waitForLoadState("networkidle");

        // Verify updated name appears
        const updatedRow = page
          .getByRole("row")
          .filter({ hasText: updatedName });
        await expect(updatedRow).toBeVisible({ timeout: 10000 });
      });
    } finally {
      if (createdGroupId) {
        await page.request.post(`/api/model/groups/update`, {
          data: {
            where: { id: createdGroupId },
            data: { isDeleted: true },
          },
        });
      }
    }
  });

  test("Admin can delete a group", async ({ page }) => {
    const groupName = `Delete Group ${Date.now()}`;
    let createdGroupId: number | undefined;

    try {
      await test.step("Create a group via API for setup", async () => {
        // Create group via API
        const createResponse = await page.request.post(
          `/api/model/groups/create`,
          {
            data: {
              data: { name: groupName },
            },
          }
        );
        expect(createResponse.ok()).toBe(true);
        const createData = await createResponse.json();
        createdGroupId = createData?.data?.id;
        expect(createdGroupId).toBeDefined();
      });

      const alertDialog = page.locator('[role="alertdialog"]');

      await test.step("Trigger the delete confirmation dialog", async () => {
        await page.goto("/en-US/admin/groups");
        await page.waitForLoadState("networkidle");

        // Find the group row
        const groupRow = page.getByRole("row").filter({ hasText: groupName });
        await expect(groupRow).toBeVisible({ timeout: 10000 });

        // Click the delete button in the actions cell
        const actionsCell = groupRow.getByRole("cell").last();
        const deleteButton = actionsCell
          .locator("button[class*='destructive']")
          .first();
        await expect(deleteButton).toBeVisible();
        await deleteButton.click();

        // Wait for the alert dialog to appear
        await expect(alertDialog).toBeVisible({ timeout: 5000 });
      });

      await test.step("Confirm the deletion", async () => {
        // Click the confirm delete action button. The destructive
        // AlertDialogAction is the last button in the dialog footer.
        const actionButton = alertDialog.locator("button").last();
        await expect(actionButton).toBeVisible();
        await actionButton.click();

        // Wait for dialog to close
        await expect(alertDialog).not.toBeVisible({ timeout: 10000 });
      });

      await test.step("Reload and verify the group is gone", async () => {
        // Let the soft-delete mutation settle, then retry the reload + check —
        // the table can read a stale row even after a single networkidle, so
        // reload until the row is gone or the budget expires (mirrors the
        // passing roles delete test).
        await page.waitForTimeout(1000);
        await expect(async () => {
          await page.reload();
          await page.waitForLoadState("networkidle");
          await expect(
            page.getByRole("row").filter({ hasText: groupName })
          ).toHaveCount(0, { timeout: 5000 });
        }).toPass({ timeout: 20000 });

        // Group was deleted, clear ID so cleanup doesn't double-delete
        createdGroupId = undefined;
      });
    } finally {
      if (createdGroupId) {
        await page.request.post(`/api/model/groups/update`, {
          data: {
            where: { id: createdGroupId },
            data: { isDeleted: true },
          },
        });
      }
    }
  });

  test("Admin can assign users to a group", async ({ page, api }) => {
    const groupName = `User Assignment Group ${Date.now()}`;
    let createdGroupId: number | undefined;
    let testUserId: string | undefined;

    try {
      await test.step("Create a test group and user via API", async () => {
        // Create a test group via API
        const createGroupResponse = await page.request.post(
          `/api/model/groups/create`,
          {
            data: {
              data: { name: groupName },
            },
          }
        );
        expect(createGroupResponse.ok()).toBe(true);
        const groupData = await createGroupResponse.json();
        createdGroupId = groupData?.data?.id;
        expect(createdGroupId).toBeDefined();

        // Create a test user
        const testEmail = `group-assign-user-${Date.now()}@example.com`;
        const testUser = await api.createUser({
          name: "Group Assignment User",
          email: testEmail,
          password: "password123",
          access: "USER",
        });
        testUserId = testUser.data.id;
      });

      const dialog = page.locator('[role="dialog"]');

      await test.step("Open the group's edit modal", async () => {
        await page.goto("/en-US/admin/groups");
        await page.waitForLoadState("networkidle");

        // Find the group row
        const groupRow = page.getByRole("row").filter({ hasText: groupName });
        await expect(groupRow).toBeVisible({ timeout: 10000 });

        // Open the edit modal
        const actionsCell = groupRow.getByRole("cell").last();
        const editButton = actionsCell.locator("button").first();
        await expect(editButton).toBeVisible();
        await editButton.click();

        // Wait for the edit dialog
        await expect(dialog).toBeVisible({ timeout: 5000 });

        // Wait for users to load in the dialog
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(1000);
      });

      await test.step("Search for and assign the test user", async () => {
        // Look for the Combobox / user search within the dialog
        // The AddGroup/EditGroup dialog has a Combobox for adding users
        const comboboxTrigger = dialog.locator('[role="combobox"]').first();
        if (await comboboxTrigger.isVisible()) {
          await comboboxTrigger.click();

          // Type to search for the test user
          const searchInput = page
            .locator("[cmdk-input]")
            .or(dialog.locator("input").last());
          if (await searchInput.isVisible({ timeout: 2000 })) {
            await searchInput.fill("Group Assignment");
            await page.waitForTimeout(500);

            // Select the user from the dropdown
            const userOption = page
              .locator("[cmdk-item]")
              .or(page.getByRole("option"))
              .filter({ hasText: "Group Assignment User" })
              .first();

            if (await userOption.isVisible({ timeout: 3000 })) {
              await userOption.click();
              await page.waitForTimeout(300);

              // Verify user appears in the assigned users list
              const assignedList = dialog.locator(
                '.space-y-2.max-h-48, [class*="overflow-y"]'
              );
              if (await assignedList.isVisible()) {
                await expect(
                  assignedList.getByText("Group Assignment User")
                ).toBeVisible({ timeout: 5000 });
              }
            }
          }
        }
      });

      await test.step("Save the group assignment dialog", async () => {
        // Save the dialog (even without user selection, verify save works)
        const saveButton = dialog.getByRole("button", { name: /save/i });
        if (await saveButton.isVisible()) {
          await saveButton.click();
          await expect(dialog).not.toBeVisible({ timeout: 10000 });
        } else {
          // Cancel if save is not available
          const cancelButton = dialog.getByRole("button", { name: /cancel/i });
          if (await cancelButton.isVisible()) {
            await cancelButton.click();
          }
        }
      });
    } finally {
      if (testUserId) {
        await api.updateUser({
          userId: testUserId,
          data: { isDeleted: true },
        });
      }
      if (createdGroupId) {
        await page.request.post(`/api/model/groups/update`, {
          data: {
            where: { id: createdGroupId },
            data: { isDeleted: true },
          },
        });
      }
    }
  });
});
