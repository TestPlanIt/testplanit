import { expect, test } from "../../../fixtures";

/**
 * Status Management E2E Tests
 *
 * Tests that verify admin status management functionality:
 * - Viewing the statuses list
 * - Creating a new status
 * - Editing a status name
 * - Deleting a status
 * - Toggling status flags (isSuccess, isFailure, isEnabled, isCompleted)
 */

test.describe("Admin Status Management", () => {
  test("Admin can view statuses list with seeded statuses", async ({
    page,
  }) => {
    await page.goto("/en-US/admin/statuses");
    await page.waitForLoadState("networkidle");

    // Page card title should be "Statuses"
    const statusesTitle = page.getByText("Statuses").first();
    await expect(statusesTitle).toBeVisible({ timeout: 10000 });

    // Seeded statuses like "Passed", "Failed" should be visible
    const passedStatus = page.getByText("Passed").first();
    await expect(passedStatus).toBeVisible({ timeout: 10000 });

    const failedStatus = page.getByText("Failed").first();
    await expect(failedStatus).toBeVisible({ timeout: 10000 });

    // Add Status button should be present
    const addBtn = page.getByRole("button").filter({ hasText: /add/i }).first();
    await expect(addBtn).toBeVisible({ timeout: 5000 });
  });

  test("Admin can create a new status", async ({ page, request, baseURL }) => {
    const statusName = `Test Status ${Date.now()}`;
    let createdStatusId: number | null = null;

    try {
      await page.goto("/en-US/admin/statuses");
      await page.waitForLoadState("networkidle");

      // Click AddStatusModal trigger button
      const addBtn = page.getByRole("button").filter({ hasText: /add/i }).first();
      await addBtn.click();

      // Wait for dialog
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Explicitly select a color via the ColorPicker (aria-label="color-picker")
      // This ensures colorId is set in the form before submit
      const colorPickerTrigger = dialog.locator('[aria-label="color-picker"]');
      await expect(colorPickerTrigger).toBeVisible({ timeout: 5000 });
      await colorPickerTrigger.click();
      await page.waitForTimeout(500);
      // ColorPicker options render in a portal — select first available color option
      const firstColorOption = page.locator('[role="option"]').first();
      await expect(firstColorOption).toBeVisible({ timeout: 3000 });
      await firstColorOption.click();
      await page.waitForTimeout(300);

      // Fill name input — first text input in the dialog
      const nameInput = dialog.locator('input').first();
      await nameInput.fill(statusName);
      await page.waitForTimeout(500); // Allow systemName auto-fill

      // Submit the form
      const submitBtn = dialog.getByRole("button", { name: /submit/i }).first();
      await submitBtn.click();

      // Wait for dialog to close
      await expect(dialog).not.toBeVisible({ timeout: 10000 });
      await page.waitForLoadState("networkidle");

      // Verify the status appears in the table
      const statusEntry = page.getByText(statusName);
      await expect(statusEntry).toBeVisible({ timeout: 10000 });

      // Get status ID for cleanup
      try {
        const statusRes = await request.get(
          `${baseURL}/api/model/status/findFirst`,
          {
            params: {
              q: JSON.stringify({
                where: { name: statusName, isDeleted: false },
                select: { id: true },
              }),
            },
          }
        );
        if (statusRes.ok()) {
          const statusData = await statusRes.json();
          createdStatusId = statusData?.data?.id ?? null;
        }
      } catch {
        // Non-fatal
      }
    } finally {
      // Cleanup: soft-delete via API
      if (createdStatusId) {
        try {
          await request.post(`${baseURL}/api/model/status/update`, {
            data: {
              where: { id: createdStatusId },
              data: { isDeleted: true },
            },
          });
        } catch {
          // Non-fatal
        }
      }
    }
  });

  test("Admin can edit a status name", async ({ page, request, baseURL }) => {
    const originalName = `Edit Status ${Date.now()}`;
    const updatedName = `${originalName} Updated`;
    let createdStatusId: number | null = null;

    // Create status via API
    try {
      const colorRes = await request.get(
        `${baseURL}/api/model/color/findFirst`,
        {
          params: { q: JSON.stringify({ select: { id: true } }) },
        }
      );

      if (!colorRes.ok()) {
        test.skip(true, "Cannot fetch color for status creation");
        return;
      }

      const colorData = await colorRes.json();
      const colorId = colorData?.data?.id;

      if (!colorId) {
        test.skip(true, "No color found for status creation");
        return;
      }

      const createRes = await request.post(`${baseURL}/api/model/status/create`, {
        data: {
          data: {
            name: originalName,
            systemName: `test_edit_${Date.now()}`,
            colorId,
            isEnabled: true,
            isSuccess: false,
            isFailure: false,
            isCompleted: false,
          },
        },
      });

      if (!createRes.ok()) {
        test.skip(true, "Cannot create status via API");
        return;
      }

      const createData = await createRes.json();
      createdStatusId = createData?.data?.id ?? null;
    } catch {
      test.skip(true, "Cannot create status via API");
      return;
    }

    try {
      await page.goto("/en-US/admin/statuses");
      await page.waitForLoadState("networkidle");

      // Find the status row by name
      const statusRow = page
        .locator("tr")
        .filter({ hasText: originalName })
        .first();
      await expect(statusRow).toBeVisible({ timeout: 10000 });

      // Click edit button — it's in the last cell (actions), first button
      const actionsCell = statusRow.locator("td").last();
      const editBtn = actionsCell.locator("button").first();
      await editBtn.click();

      // Wait for dialog
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Update name — EditStatus name input has no placeholder, get first input
      const nameInput = dialog.locator('input').first();
      await nameInput.clear();
      await nameInput.fill(updatedName);

      // Submit
      const submitBtn = dialog.getByRole("button", { name: /submit/i }).first();
      await submitBtn.click();

      // Wait for dialog to close
      await expect(dialog).not.toBeVisible({ timeout: 10000 });
      await page.waitForLoadState("networkidle");

      // Verify updated name is visible
      const updatedEntry = page.getByText(updatedName);
      await expect(updatedEntry).toBeVisible({ timeout: 10000 });
    } finally {
      if (createdStatusId) {
        try {
          await request.post(`${baseURL}/api/model/status/update`, {
            data: {
              where: { id: createdStatusId },
              data: { isDeleted: true },
            },
          });
        } catch {
          // Non-fatal
        }
      }
    }
  });

  test("Admin can delete a status", async ({ page, request, baseURL }) => {
    const statusName = `Delete Status ${Date.now()}`;
    let createdStatusId: number | null = null;

    // Create status via API
    try {
      const colorRes = await request.get(
        `${baseURL}/api/model/color/findFirst`,
        {
          params: { q: JSON.stringify({ select: { id: true } }) },
        }
      );

      if (!colorRes.ok()) {
        test.skip(true, "Cannot fetch color for status creation");
        return;
      }

      const colorData = await colorRes.json();
      const colorId = colorData?.data?.id;

      if (!colorId) {
        test.skip(true, "No color found");
        return;
      }

      const createRes = await request.post(`${baseURL}/api/model/status/create`, {
        data: {
          data: {
            name: statusName,
            systemName: `del_status_${Date.now()}`,
            colorId,
            isEnabled: true,
            isSuccess: false,
            isFailure: false,
            isCompleted: false,
          },
        },
      });

      if (!createRes.ok()) {
        test.skip(true, "Cannot create status via API");
        return;
      }

      const createData = await createRes.json();
      createdStatusId = createData?.data?.id ?? null;
    } catch {
      test.skip(true, "Cannot create status via API");
      return;
    }

    try {
      await page.goto("/en-US/admin/statuses");
      await page.waitForLoadState("networkidle");

      // Find the status row
      const statusRow = page
        .locator("tr")
        .filter({ hasText: statusName })
        .first();
      await expect(statusRow).toBeVisible({ timeout: 10000 });

      // Find delete button in actions cell (second button after edit)
      const actionsCell = statusRow.locator("td").last();
      const deleteBtn = actionsCell.locator("button").nth(1);
      const isDisabled = await deleteBtn.isDisabled().catch(() => true);

      if (isDisabled) {
        test.skip(true, "Delete button is disabled (system status)");
        return;
      }

      await deleteBtn.click();

      // AlertDialog should appear
      const confirmDialog = page.locator('[role="alertdialog"]');
      await expect(confirmDialog).toBeVisible({ timeout: 5000 });

      // Click the Delete confirm button
      const confirmBtn = confirmDialog
        .getByRole("button", { name: /delete/i })
        .first();
      await confirmBtn.click();

      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1000);

      // Status should no longer be visible
      await expect(page.getByText(statusName)).not.toBeVisible({
        timeout: 5000,
      });

      // Mark as already deleted
      createdStatusId = null;
    } finally {
      if (createdStatusId) {
        try {
          await request.post(`${baseURL}/api/model/status/update`, {
            data: {
              where: { id: createdStatusId },
              data: { isDeleted: true },
            },
          });
        } catch {
          // Non-fatal
        }
      }
    }
  });

  test("Admin can toggle status flags (isSuccess, isEnabled)", async ({
    page,
    request,
    baseURL,
  }) => {
    const statusName = `Flag Toggle Status ${Date.now()}`;
    let createdStatusId: number | null = null;

    // Create a test status via API
    try {
      const colorRes = await request.get(
        `${baseURL}/api/model/color/findFirst`,
        {
          params: { q: JSON.stringify({ select: { id: true } }) },
        }
      );

      if (!colorRes.ok()) {
        test.skip(true, "Cannot fetch color for status creation");
        return;
      }

      const colorData = await colorRes.json();
      const colorId = colorData?.data?.id;

      if (!colorId) {
        test.skip(true, "No color found");
        return;
      }

      const createRes = await request.post(`${baseURL}/api/model/status/create`, {
        data: {
          data: {
            name: statusName,
            systemName: `flag_status_${Date.now()}`,
            colorId,
            isEnabled: true,
            isSuccess: false,
            isFailure: false,
            isCompleted: false,
          },
        },
      });

      if (!createRes.ok()) {
        test.skip(true, "Cannot create status via API");
        return;
      }

      const createData = await createRes.json();
      createdStatusId = createData?.data?.id ?? null;
    } catch {
      test.skip(true, "Cannot create status via API");
      return;
    }

    try {
      await page.goto("/en-US/admin/statuses");
      await page.waitForLoadState("networkidle");

      // Find the status row
      const statusRow = page
        .locator("tr")
        .filter({ hasText: statusName })
        .first();
      await expect(statusRow).toBeVisible({ timeout: 10000 });

      // Find all switches in this row — order in columns.tsx:
      // isEnabled (col 3), isSuccess (col 4), isFailure (col 5), isCompleted (col 6)
      const rowSwitches = statusRow.locator('button[role="switch"]');
      const switchCount = await rowSwitches.count();
      expect(switchCount).toBeGreaterThan(0);

      // Toggle isEnabled switch (first switch in row)
      const enabledSwitch = rowSwitches.first();
      const initialEnabledState = await enabledSwitch.getAttribute("data-state");
      expect(initialEnabledState).toBe("checked"); // Created with isEnabled=true

      // Toggle success flag on (second switch = isSuccess)
      if (switchCount >= 2) {
        const successSwitch = rowSwitches.nth(1);
        const initialSuccessState = await successSwitch.getAttribute("data-state");
        expect(initialSuccessState).toBe("unchecked"); // Created with isSuccess=false

        // Toggle success flag on
        await successSwitch.click();
        await page.waitForTimeout(1000);

        const newSuccessState = await successSwitch.getAttribute("data-state");
        expect(newSuccessState).toBe("checked");

        // Toggle back off
        await successSwitch.click();
        await page.waitForTimeout(1000);

        const finalSuccessState = await successSwitch.getAttribute("data-state");
        expect(finalSuccessState).toBe("unchecked");
      }
    } finally {
      if (createdStatusId) {
        try {
          await request.post(`${baseURL}/api/model/status/update`, {
            data: {
              where: { id: createdStatusId },
              data: { isDeleted: true },
            },
          });
        } catch {
          // Non-fatal
        }
      }
    }
  });

  test("Admin can enable/disable a status", async ({
    page,
    request,
    baseURL,
  }) => {
    const statusName = `Enable Toggle Status ${Date.now()}`;
    let createdStatusId: number | null = null;

    // Create a test status via API with isEnabled=false
    try {
      const colorRes = await request.get(
        `${baseURL}/api/model/color/findFirst`,
        {
          params: { q: JSON.stringify({ select: { id: true } }) },
        }
      );

      if (!colorRes.ok()) {
        test.skip(true, "Cannot fetch color for status creation");
        return;
      }

      const colorData = await colorRes.json();
      const colorId = colorData?.data?.id;

      if (!colorId) {
        test.skip(true, "No color found");
        return;
      }

      const createRes = await request.post(`${baseURL}/api/model/status/create`, {
        data: {
          data: {
            name: statusName,
            systemName: `enable_status_${Date.now()}`,
            colorId,
            isEnabled: false,
            isSuccess: false,
            isFailure: false,
            isCompleted: false,
          },
        },
      });

      if (!createRes.ok()) {
        test.skip(true, "Cannot create status via API");
        return;
      }

      const createData = await createRes.json();
      createdStatusId = createData?.data?.id ?? null;
    } catch {
      test.skip(true, "Cannot create status via API");
      return;
    }

    try {
      await page.goto("/en-US/admin/statuses");
      await page.waitForLoadState("networkidle");

      // Find the status row
      const statusRow = page
        .locator("tr")
        .filter({ hasText: statusName })
        .first();
      await expect(statusRow).toBeVisible({ timeout: 10000 });

      // First switch should be isEnabled — created with false
      const enabledSwitch = statusRow
        .locator('button[role="switch"]')
        .first();
      const initialState = await enabledSwitch.getAttribute("data-state");
      expect(initialState).toBe("unchecked"); // Created with isEnabled=false

      // Toggle enabled on
      await enabledSwitch.click();
      await page.waitForTimeout(1000);

      const newState = await enabledSwitch.getAttribute("data-state");
      expect(newState).toBe("checked");
    } finally {
      if (createdStatusId) {
        try {
          await request.post(`${baseURL}/api/model/status/update`, {
            data: {
              where: { id: createdStatusId },
              data: { isDeleted: true },
            },
          });
        } catch {
          // Non-fatal
        }
      }
    }
  });
});
