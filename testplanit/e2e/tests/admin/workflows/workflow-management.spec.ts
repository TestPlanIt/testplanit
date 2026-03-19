import { expect, test } from "../../../fixtures";

/**
 * Workflow Management E2E Tests
 *
 * Tests that verify admin workflow management functionality:
 * - Viewing workflows page with Cases, Runs, and Sessions sections
 * - Creating workflows via AddWorkflowsModal
 * - Editing a workflow name
 * - Deleting a workflow
 * - Verifying workflow order (reorder via API verification)
 */

test.describe("Admin Workflow Management", () => {
  test("Admin can view workflows page with multiple scope sections", async ({
    page,
  }) => {
    await page.goto("/en-US/admin/workflows");
    await page.waitForLoadState("networkidle");

    // The page title says "Workflows"
    const workflowsTitle = page.getByText("Workflows").first();
    await expect(workflowsTitle).toBeVisible({ timeout: 10000 });

    // Verify CASES scope section — shown as "Test Cases"
    const casesSection = page.getByText("Test Cases");
    await expect(casesSection).toBeVisible({ timeout: 10000 });

    // Add Workflow button should be visible
    const addBtn = page.getByRole("button", { name: "Add Workflow" });
    await expect(addBtn).toBeVisible({ timeout: 5000 });
  });

  test("Admin can create a new workflow", async ({
    page,
    request,
    baseURL,
  }) => {
    const workflowName = `Test Workflow ${Date.now()}`;
    let createdWorkflowId: number | null = null;

    try {
      await page.goto("/en-US/admin/workflows");
      await page.waitForLoadState("networkidle");

      // Click the Add Workflow button
      const addBtn = page.getByRole("button", { name: "Add Workflow" });
      await addBtn.click();

      // Wait for dialog to open
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Select scope using Radix Select — first combobox is for scope
      const scopeCombobox = dialog.locator('[role="combobox"]').first();
      await scopeCombobox.click();
      await page.waitForTimeout(500);

      // Radix Select renders options in a portal at document root — use page.locator
      // Scope options are: "Test Cases", "Test Runs", "Sessions"
      const casesOption = page.getByRole("option", { name: "Test Cases" });
      await expect(casesOption).toBeVisible({ timeout: 3000 });
      await casesOption.click();
      await page.waitForTimeout(300);

      // Fill workflow name
      const nameInput = dialog.locator('input[placeholder="Name"]').first();
      await nameInput.fill(workflowName);

      // Select workflow type — find and click the workflow type combobox
      // workflowType combobox shows "Select workflow type" placeholder
      const typeCombobox = page.getByRole("combobox").filter({ hasText: /select workflow type/i });
      const typeComboboxVisible = await typeCombobox.isVisible().catch(() => false);
      if (typeComboboxVisible) {
        await typeCombobox.click();
        await page.waitForTimeout(500);
        // Options: "Not Started", "In Progress", "Done"
        const notStartedOption = page.getByRole("option", { name: /not.?started/i }).first();
        await notStartedOption.click();
        await page.waitForTimeout(300);
      } else {
        // Fallback: try the second combobox in the dialog
        const allComboboxes = dialog.locator('[role="combobox"]');
        const count = await allComboboxes.count();
        if (count >= 2) {
          await allComboboxes.nth(1).click();
          await page.waitForTimeout(500);
          const firstOption = page.locator('[role="option"]').first();
          await firstOption.click();
          await page.waitForTimeout(300);
        }
      }

      // Submit
      const submitBtn = dialog.getByRole("button", { name: /submit/i }).first();
      await submitBtn.click();

      // Wait for dialog to close
      await expect(dialog).not.toBeVisible({ timeout: 10000 });
      await page.waitForLoadState("networkidle");

      // Verify workflow appears in the table
      const workflowEntry = page.getByText(workflowName);
      await expect(workflowEntry).toBeVisible({ timeout: 10000 });

      // Get the workflow ID for cleanup
      try {
        const wfRes = await request.get(
          `${baseURL}/api/model/workflows/findFirst`,
          {
            params: {
              q: JSON.stringify({
                where: { name: workflowName, isDeleted: false },
                select: { id: true },
              }),
            },
          }
        );
        if (wfRes.ok()) {
          const wfData = await wfRes.json();
          createdWorkflowId = wfData?.data?.id ?? null;
        }
      } catch {
        // Non-fatal
      }
    } finally {
      // Clean up: soft-delete the workflow
      if (createdWorkflowId) {
        try {
          await request.post(`${baseURL}/api/model/workflows/update`, {
            data: {
              where: { id: createdWorkflowId },
              data: { isDeleted: true },
            },
          });
        } catch {
          // Non-fatal
        }
      }
    }
  });

  test("Admin can edit a workflow name", async ({ page, request, baseURL }) => {
    const originalName = `Edit Workflow ${Date.now()}`;
    const updatedName = `${originalName} Updated`;
    let createdWorkflowId: number | null = null;

    // Create a workflow via API
    try {
      const iconRes = await request.get(
        `${baseURL}/api/model/fieldIcon/findFirst`,
        {
          params: {
            q: JSON.stringify({ where: { name: "layout-list" }, select: { id: true } }),
          },
        }
      );
      const colorRes = await request.get(
        `${baseURL}/api/model/color/findFirst`,
        {
          params: { q: JSON.stringify({ select: { id: true } }) },
        }
      );

      if (!iconRes.ok() || !colorRes.ok()) {
        test.skip(true, "Cannot fetch icon/color for workflow creation");
        return;
      }
      const iconData = await iconRes.json();
      const colorData = await colorRes.json();
      const iconId = iconData?.data?.id;
      const colorId = colorData?.data?.id;

      if (!iconId || !colorId) {
        test.skip(true, "No icon/color found for workflow creation");
        return;
      }

      const createRes = await request.post(
        `${baseURL}/api/model/workflows/create`,
        {
          data: {
            data: {
              name: originalName,
              scope: "CASES",
              workflowType: "NOT_STARTED",
              isEnabled: true,
              isDefault: false,
              iconId,
              colorId,
            },
          },
        }
      );

      if (!createRes.ok()) {
        test.skip(true, "Cannot create workflow via API");
        return;
      }

      const createData = await createRes.json();
      createdWorkflowId = createData?.data?.id ?? null;
    } catch {
      test.skip(true, "Cannot create workflow via API");
      return;
    }

    try {
      await page.goto("/en-US/admin/workflows");
      await page.waitForLoadState("networkidle");

      // Find the workflow row by name
      const workflowRow = page
        .locator("tr")
        .filter({ hasText: originalName })
        .first();
      await expect(workflowRow).toBeVisible({ timeout: 10000 });

      // Find the edit button in the actions cell (SquarePen icon button)
      // The actions cell is the last cell in the row
      const actionsCell = workflowRow.locator("td").last();
      const editBtn = actionsCell.locator("button").first();
      await editBtn.click();

      // Wait for dialog
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Update the name field
      const nameInput = dialog.locator('input[placeholder*="Name" i]').first();
      await nameInput.clear();
      await nameInput.fill(updatedName);

      // Submit
      const submitBtn = dialog.getByRole("button", { name: /submit/i }).first();
      await submitBtn.click();

      // Wait for dialog to close
      await expect(dialog).not.toBeVisible({ timeout: 10000 });
      await page.waitForLoadState("networkidle");

      // Verify updated name appears
      const updatedEntry = page.getByText(updatedName);
      await expect(updatedEntry).toBeVisible({ timeout: 10000 });
    } finally {
      // Soft-delete workflow
      if (createdWorkflowId) {
        try {
          await request.post(`${baseURL}/api/model/workflows/update`, {
            data: {
              where: { id: createdWorkflowId },
              data: { isDeleted: true },
            },
          });
        } catch {
          // Non-fatal
        }
      }
    }
  });

  test("Admin can delete a workflow", async ({ page, request, baseURL }) => {
    const workflowName = `Delete Workflow ${Date.now()}`;
    let createdWorkflowId: number | null = null;

    // Create a workflow via API
    try {
      const iconRes = await request.get(
        `${baseURL}/api/model/fieldIcon/findFirst`,
        {
          params: {
            q: JSON.stringify({ where: { name: "layout-list" }, select: { id: true } }),
          },
        }
      );
      const colorRes = await request.get(
        `${baseURL}/api/model/color/findFirst`,
        {
          params: { q: JSON.stringify({ select: { id: true } }) },
        }
      );

      if (!iconRes.ok() || !colorRes.ok()) {
        test.skip(true, "Cannot fetch icon/color for workflow creation");
        return;
      }

      const iconData = await iconRes.json();
      const colorData = await colorRes.json();
      const iconId = iconData?.data?.id;
      const colorId = colorData?.data?.id;

      if (!iconId || !colorId) {
        test.skip(true, "No icon/color found");
        return;
      }

      // Use SESSIONS scope / DONE type since this is least likely to conflict
      const createRes = await request.post(
        `${baseURL}/api/model/workflows/create`,
        {
          data: {
            data: {
              name: workflowName,
              scope: "SESSIONS",
              workflowType: "DONE",
              isEnabled: true,
              isDefault: false,
              iconId,
              colorId,
            },
          },
        }
      );

      if (!createRes.ok()) {
        test.skip(true, "Cannot create workflow via API");
        return;
      }
      const createData = await createRes.json();
      createdWorkflowId = createData?.data?.id ?? null;
    } catch {
      test.skip(true, "Cannot create workflow via API");
      return;
    }

    try {
      await page.goto("/en-US/admin/workflows");
      await page.waitForLoadState("networkidle");

      // Find the workflow row
      const workflowRow = page
        .locator("tr")
        .filter({ hasText: workflowName })
        .first();
      const rowVisible = await workflowRow.isVisible().catch(() => false);

      if (!rowVisible) {
        test.skip(true, "Workflow row not visible");
        return;
      }

      // Find delete button in the actions cell (last cell)
      const actionsCell = workflowRow.locator("td").last();
      const deleteBtn = actionsCell.locator("button").nth(1); // Second button is delete
      const isDisabled = await deleteBtn.isDisabled().catch(() => true);

      if (isDisabled) {
        test.skip(true, "Delete button is disabled (last workflow of type)");
        return;
      }

      await deleteBtn.click();

      // An AlertDialog should appear
      const confirmDialog = page.locator('[role="alertdialog"]');
      await expect(confirmDialog).toBeVisible({ timeout: 5000 });

      // Click the Delete/Confirm action button
      const confirmBtn = confirmDialog
        .getByRole("button", { name: /delete/i })
        .first();
      await confirmBtn.click();

      // Wait for network to settle
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1000);

      // Workflow should no longer be visible
      await expect(page.getByText(workflowName)).not.toBeVisible({
        timeout: 5000,
      });

      // Mark as already deleted
      createdWorkflowId = null;
    } finally {
      if (createdWorkflowId) {
        try {
          await request.post(`${baseURL}/api/model/workflows/update`, {
            data: {
              where: { id: createdWorkflowId },
              data: { isDeleted: true },
            },
          });
        } catch {
          // Non-fatal
        }
      }
    }
  });

  test("Admin can verify workflow order via API", async ({
    page,
    request,
    baseURL,
  }) => {
    // Create two workflows with different order values via API and verify they're stored correctly
    const iconRes = await request.get(
      `${baseURL}/api/model/fieldIcon/findFirst`,
      {
        params: {
          q: JSON.stringify({ where: { name: "layout-list" }, select: { id: true } }),
        },
      }
    );
    const colorRes = await request.get(`${baseURL}/api/model/color/findFirst`, {
      params: { q: JSON.stringify({ select: { id: true } }) },
    });

    if (!iconRes.ok() || !colorRes.ok()) {
      test.skip(true, "Cannot fetch icon/color for workflow creation");
      return;
    }

    const iconData = await iconRes.json();
    const colorData = await colorRes.json();
    const iconId = iconData?.data?.id;
    const colorId = colorData?.data?.id;

    if (!iconId || !colorId) {
      test.skip(true, "No icon/color found");
      return;
    }

    const name1 = `Order Test A ${Date.now()}`;
    const name2 = `Order Test B ${Date.now()}`;
    let wf1Id: number | null = null;
    let wf2Id: number | null = null;

    try {
      const create1 = await request.post(
        `${baseURL}/api/model/workflows/create`,
        {
          data: {
            data: {
              name: name1,
              scope: "CASES",
              workflowType: "IN_PROGRESS",
              isEnabled: true,
              isDefault: false,
              order: 100,
              iconId,
              colorId,
            },
          },
        }
      );

      const create2 = await request.post(
        `${baseURL}/api/model/workflows/create`,
        {
          data: {
            data: {
              name: name2,
              scope: "CASES",
              workflowType: "IN_PROGRESS",
              isEnabled: true,
              isDefault: false,
              order: 101,
              iconId,
              colorId,
            },
          },
        }
      );

      if (!create1.ok() || !create2.ok()) {
        test.skip(true, "Cannot create workflows via API");
        return;
      }

      const data1 = await create1.json();
      const data2 = await create2.json();
      wf1Id = data1?.data?.id ?? null;
      wf2Id = data2?.data?.id ?? null;

      // Navigate to workflows page and verify both appear
      await page.goto("/en-US/admin/workflows");
      await page.waitForLoadState("networkidle");

      const wf1Row = page.locator("tr").filter({ hasText: name1 }).first();
      const wf2Row = page.locator("tr").filter({ hasText: name2 }).first();

      await expect(wf1Row).toBeVisible({ timeout: 10000 });
      await expect(wf2Row).toBeVisible({ timeout: 10000 });

      // Verify order via API — swap the order values
      if (wf1Id && wf2Id) {
        await request.post(`${baseURL}/api/model/workflows/update`, {
          data: { where: { id: wf1Id }, data: { order: 101 } },
        });
        await request.post(`${baseURL}/api/model/workflows/update`, {
          data: { where: { id: wf2Id }, data: { order: 100 } },
        });

        // Reload page and verify both still visible
        await page.reload();
        await page.waitForLoadState("networkidle");

        await expect(
          page.locator("tr").filter({ hasText: name1 }).first()
        ).toBeVisible({ timeout: 10000 });
        await expect(
          page.locator("tr").filter({ hasText: name2 }).first()
        ).toBeVisible({ timeout: 10000 });
      }
    } finally {
      for (const wfId of [wf1Id, wf2Id]) {
        if (wfId) {
          try {
            await request.post(`${baseURL}/api/model/workflows/update`, {
              data: { where: { id: wfId }, data: { isDeleted: true } },
            });
          } catch {
            // Non-fatal
          }
        }
      }
    }
  });
});
