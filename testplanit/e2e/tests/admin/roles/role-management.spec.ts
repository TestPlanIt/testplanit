import { expect, test } from "../../../fixtures";

/**
 * Role Management E2E Tests
 *
 * Tests for role CRUD operations and permission editing:
 * - View roles list
 * - Create a new role
 * - Edit a role name
 * - Delete a role
 * - Toggle default role
 * - Edit role permissions (canAddEdit, canDelete, canClose)
 */

test.describe("Role Management", () => {
  test("Admin can view roles list", async ({ page }) => {
    await page.goto("/en-US/admin/roles");
    await page.waitForLoadState("networkidle");

    // The page should render
    await expect(page.locator("main")).toBeVisible();

    // Should show the Roles title (CardTitle renders as a styled element)
    const rolesTitle = page
      .locator("h1, h2, h3, p, span, div")
      .filter({ hasText: /^roles$/i })
      .first();
    await expect(rolesTitle).toBeVisible({ timeout: 10000 });

    // DataTable should be rendered
    const table = page.locator("table");
    await expect(table).toBeVisible({ timeout: 10000 });

    // There should be at least one role row (seeded data)
    const roleRows = page.locator("tbody tr");
    await expect(roleRows.first()).toBeVisible({ timeout: 10000 });
  });

  test("Admin can create a new role", async ({ page }) => {
    const roleName = `Test Role ${Date.now()}`;
    let createdRoleId: number | undefined;

    try {
      await page.goto("/en-US/admin/roles");
      await page.waitForLoadState("networkidle");

      // Click the Add Role button (triggers AddRoleModal)
      const addButton = page.getByRole("button", { name: /add/i }).first();
      await expect(addButton).toBeVisible({ timeout: 10000 });
      await addButton.click();

      // Wait for the dialog to open
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Fill in the role name
      const nameInput = dialog.locator('input').first();
      await expect(nameInput).toBeVisible();
      await nameInput.fill(roleName);

      // Wait for form validation
      await page.waitForTimeout(300);

      // Submit the form
      const submitButton = dialog.getByRole("button", { name: /submit/i });
      await expect(submitButton).toBeVisible();
      await submitButton.click();

      // Wait for dialog to close
      await expect(dialog).not.toBeVisible({ timeout: 15000 });

      // Wait for page to refresh
      await page.waitForLoadState("networkidle");

      // Verify the new role appears in the table
      const newRoleRow = page.locator("tr").filter({ hasText: roleName });
      await expect(newRoleRow).toBeVisible({ timeout: 10000 });

      // Get the role ID for cleanup
      const roleResponse = await page.request.get(
        `/api/model/roles/findFirst?q=${encodeURIComponent(
          JSON.stringify({ where: { name: roleName } })
        )}`
      );
      if (roleResponse.ok()) {
        const roleData = await roleResponse.json();
        createdRoleId = roleData?.data?.id;
      }
    } finally {
      if (createdRoleId) {
        await page.request.post(`/api/model/roles/update`, {
          data: {
            where: { id: createdRoleId },
            data: { isDeleted: true },
          },
        });
      }
    }
  });

  test("Admin can edit a role name", async ({ page, api }) => {
    const originalName = `Edit Role ${Date.now()}`;
    const updatedName = `Updated Role ${Date.now()}`;
    let createdRoleId: number | undefined;

    try {
      // Create a role via API helper
      createdRoleId = await api.createRole(originalName);
      expect(createdRoleId).toBeDefined();

      await page.goto("/en-US/admin/roles");
      await page.waitForLoadState("networkidle");

      // Find the role row
      const roleRow = page.locator("tr").filter({ hasText: originalName });
      await expect(roleRow).toBeVisible({ timeout: 10000 });

      // Click the edit button (SquarePen icon button) in actions cell
      const actionsCell = roleRow.locator("td").last();
      const editButton = actionsCell.locator("button").first();
      await expect(editButton).toBeVisible();
      await editButton.click();

      // Wait for edit dialog
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Update the name field
      const nameInput = dialog.locator('input').first();
      await expect(nameInput).toBeVisible();
      await nameInput.clear();
      await nameInput.fill(updatedName);

      // Wait for form validation
      await page.waitForTimeout(300);

      // Submit
      const submitButton = dialog.getByRole("button", { name: /submit/i });
      await expect(submitButton).toBeVisible();
      await submitButton.click();

      // Wait for dialog to close
      await expect(dialog).not.toBeVisible({ timeout: 10000 });

      // Reload to confirm update
      await page.reload();
      await page.waitForLoadState("networkidle");

      // Verify updated name appears
      const updatedRow = page.locator("tr").filter({ hasText: updatedName });
      await expect(updatedRow).toBeVisible({ timeout: 10000 });
    } finally {
      if (createdRoleId) {
        await page.request.post(`/api/model/roles/update`, {
          data: {
            where: { id: createdRoleId },
            data: { isDeleted: true },
          },
        });
      }
    }
  });

  test("Admin can delete a role", async ({ page, api }) => {
    const roleName = `Delete Role ${Date.now()}`;
    let createdRoleId: number | undefined;

    try {
      createdRoleId = await api.createRole(roleName);
      expect(createdRoleId).toBeDefined();

      await page.goto("/en-US/admin/roles");
      await page.waitForLoadState("networkidle");

      // Find the role row
      const roleRow = page.locator("tr").filter({ hasText: roleName });
      await expect(roleRow).toBeVisible({ timeout: 10000 });

      // Click the delete button (Trash2 destructive button) in actions cell
      const actionsCell = roleRow.locator("td").last();
      const deleteButton = actionsCell
        .locator("button[class*='destructive']")
        .first();
      await expect(deleteButton).toBeVisible();
      await deleteButton.click();

      // Wait for the alert dialog
      const alertDialog = page.locator('[role="alertdialog"]');
      await expect(alertDialog).toBeVisible({ timeout: 5000 });

      // Click the confirm delete action button
      const actionButton = alertDialog.locator("button").last();
      await expect(actionButton).toBeVisible();
      await actionButton.click();

      // Wait for dialog to close
      await expect(alertDialog).not.toBeVisible({ timeout: 10000 });

      // Reload and verify role is gone
      await page.reload();
      await page.waitForLoadState("networkidle");

      await expect(
        page.locator("tr").filter({ hasText: roleName })
      ).toHaveCount(0, { timeout: 5000 });

      // Role was deleted, clear ID so cleanup doesn't double-delete
      createdRoleId = undefined;
    } finally {
      if (createdRoleId) {
        await page.request.post(`/api/model/roles/update`, {
          data: {
            where: { id: createdRoleId },
            data: { isDeleted: true },
          },
        });
      }
    }
  });

  test("Admin can toggle default role status", async ({ page, api }) => {
    const roleName = `Default Toggle Role ${Date.now()}`;
    let createdRoleId: number | undefined;

    try {
      createdRoleId = await api.createRole(roleName);
      expect(createdRoleId).toBeDefined();

      await page.goto("/en-US/admin/roles");
      await page.waitForLoadState("networkidle");

      // Find the role row
      const roleRow = page.locator("tr").filter({ hasText: roleName });
      await expect(roleRow).toBeVisible({ timeout: 10000 });

      // The isDefault column has a Switch — find it in the role row
      // The switch is disabled when already default (disabled={row.original.isDefault})
      // Our newly created role is NOT default, so the switch should be enabled
      const defaultSwitch = roleRow.locator('[role="switch"]').first();
      await expect(defaultSwitch).toBeVisible();

      // The switch should be unchecked (new role is not default)
      const initialState = await defaultSwitch.getAttribute("data-state");
      expect(initialState).toBe("unchecked");

      // Click to make it default
      await defaultSwitch.click();

      // Wait for the UI to update — making it default disables the switch
      await expect(defaultSwitch).toHaveAttribute("data-state", "checked", {
        timeout: 15000,
      });

      // The switch should now be disabled (default role cannot be un-defaulted via this switch)
      await expect(defaultSwitch).toBeDisabled({ timeout: 5000 });
    } finally {
      if (createdRoleId) {
        // Restore: first unset this as default (set another role as default), then delete
        // Find the original default role and restore it
        const rolesResponse = await page.request.get(
          `/api/model/roles/findFirst?q=${encodeURIComponent(
            JSON.stringify({
              where: {
                isDefault: false,
                isDeleted: false,
                name: { not: roleName },
              },
            })
          )}`
        );

        if (rolesResponse.ok()) {
          const rolesData = await rolesResponse.json();
          const otherRoleId = rolesData?.data?.id;
          if (otherRoleId) {
            // Make the original role default again
            await page.request.post(`/api/model/roles/updateMany`, {
              data: {
                where: { isDefault: true },
                data: { isDefault: false },
              },
            });
            await page.request.post(`/api/model/roles/update`, {
              data: {
                where: { id: otherRoleId },
                data: { isDefault: true },
              },
            });
          }
        }

        // Now delete the test role
        await page.request.post(`/api/model/roles/update`, {
          data: {
            where: { id: createdRoleId },
            data: { isDeleted: true },
          },
        });
      }
    }
  });

  test("Admin can edit role permissions via edit modal", async ({
    page,
    api,
  }) => {
    const roleName = `Permissions Test Role ${Date.now()}`;
    let createdRoleId: number | undefined;

    try {
      createdRoleId = await api.createRole(roleName);
      expect(createdRoleId).toBeDefined();

      await page.goto("/en-US/admin/roles");
      await page.waitForLoadState("networkidle");

      // Find the role row
      const roleRow = page.locator("tr").filter({ hasText: roleName });
      await expect(roleRow).toBeVisible({ timeout: 10000 });

      // Open the edit modal
      const actionsCell = roleRow.locator("td").last();
      const editButton = actionsCell.locator("button").first();
      await expect(editButton).toBeVisible();
      await editButton.click();

      // Wait for edit dialog
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Wait for permissions to load (the dialog fetches permissions via useFindManyRolePermission)
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1000);

      // The permissions table has Switches for canAddEdit, canDelete, canClose per application area
      // Find the permissions table
      const permissionsTable = dialog.locator("table");
      await expect(permissionsTable).toBeVisible({ timeout: 10000 });

      // Find the first canAddEdit switch that is visible and enabled (not a '-' placeholder)
      // Switches in the table have aria-label like "{AreaName} Add/Edit"
      const addEditSwitches = permissionsTable.locator('[role="switch"]');
      const switchCount = await addEditSwitches.count();
      expect(switchCount).toBeGreaterThan(0);

      // Toggle the first available switch
      const firstSwitch = addEditSwitches.first();
      await expect(firstSwitch).toBeVisible();
      const initialSwitchState = await firstSwitch.getAttribute("data-state");

      await firstSwitch.click();
      await page.waitForTimeout(300);

      // Verify the switch state changed
      const newSwitchState = await firstSwitch.getAttribute("data-state");
      expect(newSwitchState).not.toBe(initialSwitchState);

      // Submit the form
      const submitButton = dialog.getByRole("button", { name: /submit/i });
      await expect(submitButton).toBeVisible();
      await submitButton.click();

      // Wait for dialog to close
      await expect(dialog).not.toBeVisible({ timeout: 10000 });

      // Verify the dialog closed successfully (permission was saved)
      await expect(page).not.toHaveURL(/error/);
    } finally {
      if (createdRoleId) {
        await page.request.post(`/api/model/roles/update`, {
          data: {
            where: { id: createdRoleId },
            data: { isDeleted: true },
          },
        });
      }
    }
  });
});
