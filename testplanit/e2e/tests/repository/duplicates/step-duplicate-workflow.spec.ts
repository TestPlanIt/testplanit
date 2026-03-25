import { expect, test } from "../../../fixtures";

/**
 * Step Duplicate Detection & Conversion E2E Tests
 *
 * Tests the step duplicate detection UI workflow:
 * - Viewing step-duplicate scan results (seeded directly, not worker-dependent)
 * - Opening the conversion dialog from a result row
 * - Dismissing a step sequence match
 * - Converting matched steps to a shared step group
 *
 * Tests create StepSequenceMatch records directly via the API,
 * making them deterministic regardless of BullMQ worker state.
 */

function makeTipTapDoc(text: string) {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text }] },
    ],
  };
}

function makeStep(text: string, expectedResult: string, order: number) {
  return {
    step: makeTipTapDoc(text),
    expectedResult: makeTipTapDoc(expectedResult),
    order,
  };
}

test.describe("Step Duplicate Detection Workflow", () => {
  test("View step-duplicate results page with seeded data", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E Step Dups ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    const folderId = await api.createFolder(projectId, `Folder ${Date.now()}`);

    // Create two cases with identical steps
    const caseAId = await api.createTestCase(projectId, folderId, "Login flow test A");
    const caseBId = await api.createTestCase(projectId, folderId, "Login flow test B");

    const sharedSteps = [
      makeStep("Navigate to login page", "Login page is displayed", 0),
      makeStep("Enter username", "Username field is populated", 1),
      makeStep("Enter password", "Password field is populated", 2),
      makeStep("Click login button", "User is logged in", 3),
    ];

    const stepIdsA = await api.addStepsToTestCase(caseAId, sharedSteps);
    const stepIdsB = await api.addStepsToTestCase(caseBId, sharedSteps);

    // Create a StepSequenceMatch directly — no worker dependency
    await api.createStepSequenceMatch(
      projectId,
      [
        { caseId: caseAId, startStepId: stepIdsA[0], endStepId: stepIdsA[3] },
        { caseId: caseBId, startStepId: stepIdsB[0], endStepId: stepIdsB[3] },
      ],
      4
    );

    // Navigate to the step-duplicates page
    await page.goto(`/en-US/projects/shared-steps/${projectId}/step-duplicates`);
    await page.waitForLoadState("networkidle");

    // The step-duplicates table should be visible
    const table = page.locator('[data-testid="step-duplicates-table"]');
    await expect(table).toBeVisible({ timeout: 10000 });

    // Should show at least one row with step count and case count
    const tableBody = table.locator("tbody tr");
    await expect(tableBody.first()).toBeVisible({ timeout: 10000 });
  });

  test("Open conversion dialog from result row", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E Step Dups ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    const folderId = await api.createFolder(projectId, `Folder ${Date.now()}`);

    const caseAId = await api.createTestCase(projectId, folderId, "Conversion test A");
    const caseBId = await api.createTestCase(projectId, folderId, "Conversion test B");

    const steps = [
      makeStep("Open settings page", "Settings page loads", 0),
      makeStep("Click profile tab", "Profile tab is active", 1),
      makeStep("Update display name", "Name field updated", 2),
    ];

    const stepIdsA = await api.addStepsToTestCase(caseAId, steps);
    const stepIdsB = await api.addStepsToTestCase(caseBId, steps);

    await api.createStepSequenceMatch(
      projectId,
      [
        { caseId: caseAId, startStepId: stepIdsA[0], endStepId: stepIdsA[2] },
        { caseId: caseBId, startStepId: stepIdsB[0], endStepId: stepIdsB[2] },
      ],
      3
    );

    await page.goto(`/en-US/projects/shared-steps/${projectId}/step-duplicates`);
    await page.waitForLoadState("networkidle");

    // Click the first row to open the conversion dialog
    const table = page.locator('[data-testid="step-duplicates-table"]');
    const firstRow = table.locator("tbody tr").first();
    await expect(firstRow).toBeVisible({ timeout: 10000 });
    await firstRow.click();

    // Conversion dialog should appear
    const dialog = page.locator('[data-testid="step-conversion-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Should have the shared step name input
    const nameInput = page.locator('[data-testid="shared-step-name-input"]');
    await expect(nameInput).toBeVisible();

    // Should have convert and dismiss buttons
    await expect(page.locator('[data-testid="step-convert-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="step-dismiss-button"]')).toBeVisible();
  });

  test("Dismiss a step sequence match", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E Step Dups ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    const folderId = await api.createFolder(projectId, `Folder ${Date.now()}`);

    const caseAId = await api.createTestCase(projectId, folderId, "Dismiss test A");
    const caseBId = await api.createTestCase(projectId, folderId, "Dismiss test B");

    const steps = [
      makeStep("Step one", "Result one", 0),
      makeStep("Step two", "Result two", 1),
      makeStep("Step three", "Result three", 2),
    ];

    const stepIdsA = await api.addStepsToTestCase(caseAId, steps);
    const stepIdsB = await api.addStepsToTestCase(caseBId, steps);

    await api.createStepSequenceMatch(
      projectId,
      [
        { caseId: caseAId, startStepId: stepIdsA[0], endStepId: stepIdsA[2] },
        { caseId: caseBId, startStepId: stepIdsB[0], endStepId: stepIdsB[2] },
      ],
      3
    );

    await page.goto(`/en-US/projects/shared-steps/${projectId}/step-duplicates`);
    await page.waitForLoadState("networkidle");

    // Click row to open dialog
    const table = page.locator('[data-testid="step-duplicates-table"]');
    const firstRow = table.locator("tbody tr").first();
    await expect(firstRow).toBeVisible({ timeout: 10000 });
    await firstRow.click();

    const dialog = page.locator('[data-testid="step-conversion-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Click dismiss
    const dismissButton = page.locator('[data-testid="step-dismiss-button"]');
    await dismissButton.click();

    // Dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // Success toast should appear
    const toast = page.locator('[data-sonner-toast]');
    await expect(toast).toBeVisible({ timeout: 10000 });
  });

  test("Convert matched steps to shared step group", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E Step Dups ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    const folderId = await api.createFolder(projectId, `Folder ${Date.now()}`);

    const caseAId = await api.createTestCase(projectId, folderId, "Convert test A");
    const caseBId = await api.createTestCase(projectId, folderId, "Convert test B");

    const steps = [
      makeStep("Open dashboard", "Dashboard loads", 0),
      makeStep("Click reports section", "Reports section displayed", 1),
      makeStep("Select date range", "Date range picker opens", 2),
    ];

    const stepIdsA = await api.addStepsToTestCase(caseAId, steps);
    const stepIdsB = await api.addStepsToTestCase(caseBId, steps);

    await api.createStepSequenceMatch(
      projectId,
      [
        { caseId: caseAId, startStepId: stepIdsA[0], endStepId: stepIdsA[2] },
        { caseId: caseBId, startStepId: stepIdsB[0], endStepId: stepIdsB[2] },
      ],
      3
    );

    await page.goto(`/en-US/projects/shared-steps/${projectId}/step-duplicates`);
    await page.waitForLoadState("networkidle");

    // Click row to open dialog
    const table = page.locator('[data-testid="step-duplicates-table"]');
    const firstRow = table.locator("tbody tr").first();
    await expect(firstRow).toBeVisible({ timeout: 10000 });
    await firstRow.click();

    const dialog = page.locator('[data-testid="step-conversion-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Clear and type a custom group name
    const nameInput = page.locator('[data-testid="shared-step-name-input"]');
    await nameInput.clear();
    const groupName = `E2E Shared Steps ${Date.now()}`;
    await nameInput.fill(groupName);

    // Click convert
    const convertButton = page.locator('[data-testid="step-convert-button"]');
    await convertButton.click();

    // Dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 15000 });

    // Success toast should appear
    const toast = page.locator('[data-sonner-toast]');
    await expect(toast).toBeVisible({ timeout: 10000 });
  });

  test("Bulk dismiss multiple step sequence matches", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E Step Dups ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    const folderId = await api.createFolder(projectId, `Folder ${Date.now()}`);

    // Create 3 cases with shared steps to make 2 match groups
    const caseAId = await api.createTestCase(projectId, folderId, "Bulk test A");
    const caseBId = await api.createTestCase(projectId, folderId, "Bulk test B");
    const caseCId = await api.createTestCase(projectId, folderId, "Bulk test C");

    const stepsGroup1 = [
      makeStep("Group1 step one", "Result", 0),
      makeStep("Group1 step two", "Result", 1),
      makeStep("Group1 step three", "Result", 2),
    ];
    const stepsGroup2 = [
      makeStep("Group2 step one", "Result", 0),
      makeStep("Group2 step two", "Result", 1),
      makeStep("Group2 step three", "Result", 2),
    ];

    const stepIdsA = await api.addStepsToTestCase(caseAId, stepsGroup1);
    const stepIdsB = await api.addStepsToTestCase(caseBId, stepsGroup1);
    const stepIdsC1 = await api.addStepsToTestCase(caseBId, stepsGroup2.map((s, i) => ({ ...s, order: i + 3 })));
    const stepIdsC2 = await api.addStepsToTestCase(caseCId, stepsGroup2);

    await api.createStepSequenceMatch(
      projectId,
      [
        { caseId: caseAId, startStepId: stepIdsA[0], endStepId: stepIdsA[2] },
        { caseId: caseBId, startStepId: stepIdsB[0], endStepId: stepIdsB[2] },
      ],
      3
    );

    await api.createStepSequenceMatch(
      projectId,
      [
        { caseId: caseBId, startStepId: stepIdsC1[0], endStepId: stepIdsC1[2] },
        { caseId: caseCId, startStepId: stepIdsC2[0], endStepId: stepIdsC2[2] },
      ],
      3
    );

    await page.goto(`/en-US/projects/shared-steps/${projectId}/step-duplicates`);
    await page.waitForLoadState("networkidle");

    const table = page.locator('[data-testid="step-duplicates-table"]');
    const rows = table.locator("tbody tr");
    await expect(rows).toHaveCount(2, { timeout: 10000 });

    // Select both rows using checkboxes
    const checkbox1 = rows.nth(0).locator('input[type="checkbox"], button[role="checkbox"]').first();
    const checkbox2 = rows.nth(1).locator('input[type="checkbox"], button[role="checkbox"]').first();
    await checkbox1.click();
    await checkbox2.click();

    // Click bulk dismiss button
    const bulkDismissBtn = page.getByRole("button", { name: /Dismiss/i });
    await expect(bulkDismissBtn).toBeVisible({ timeout: 5000 });
    await bulkDismissBtn.click();

    // Success toast should appear
    const toast = page.locator('[data-sonner-toast]');
    await expect(toast).toBeVisible({ timeout: 10000 });

    // Table should be empty or show no results
    await expect(rows).toHaveCount(0, { timeout: 10000 });
  });
});
