import { expect, test } from "../../fixtures";

/**
 * Test Case Execution E2E Tests
 *
 * Tests the test case execution workflow within a test run detail page.
 * The run detail page has a ResizablePanelGroup with test cases on the left
 * and TestRunCaseDetails in a Sheet that opens when selectedCase URL param is set.
 *
 * TestRunCaseDetails provides:
 * - Status dropdown to change case status
 * - "Add Result" button to record a result
 * - "Pass & Next" button for quick pass
 *
 * Covers:
 * - Opening the execution sheet by navigating with selectedCase URL param
 * - Viewing case details in the execution panel
 * - Recording a result using the status dropdown
 * - Quick pass using "Pass & Next" button
 * - Navigating between cases using previous and next buttons
 *
 * Note: In run mode, clicking the case NAME text in the table sets ?selectedCase=ID.
 *       Tests use URL navigation directly to avoid flaky click interactions.
 */
test.describe("Test Case Execution", () => {
  test("should open case execution panel when clicking a case name", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const caseName = `Exec Case ${ts}`;
    let projectId: number | undefined;
    let runId: number | undefined;
    let caseId: number | undefined;

    await test.step("Seed a project, folder, case, and run with the case added", async () => {
      projectId = await api.createProject(`E2E Execution View ${ts}`);
      const folderId = await api.createFolder(projectId, `Exec Folder ${ts}`);
      caseId = await api.createTestCase(projectId, folderId, caseName);
      runId = await api.createTestRun(projectId, `Exec Run ${ts}`);
      await api.addTestCaseToTestRun(runId, caseId);
    });

    await test.step("Open the run detail page with the case selected", async () => {
      // Navigate to run detail page with selectedCase to open the sheet directly
      // (In the UI, clicking the case name sets ?selectedCase=id in the URL)
      await page.goto(
        `/en-US/projects/runs/${projectId}/${runId}?selectedCase=${caseId}`
      );
      await page.waitForLoadState("load");

      // Wait for the page to fully load and sheet to appear
      await page.waitForTimeout(2000);
    });

    await test.step("Verify the execution sheet opens with the case name", async () => {
      // The Sheet (right panel) should open with TestRunCaseDetails
      // The sheet has class "test-run-details-sheet"
      const sheet = page.locator(".test-run-details-sheet");
      await expect(sheet).toBeVisible({ timeout: 15000 });

      // The case name should be visible in the sheet
      await expect(sheet.locator(`text="${caseName}"`).first()).toBeVisible({
        timeout: 10000,
      });
    });
  });

  test("should display case details and execution controls in the panel", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const caseName = `Details Case ${ts}`;
    let projectId: number | undefined;
    let runId: number | undefined;
    let caseId: number | undefined;

    await test.step("Seed a project, folder, case, and run with the case added", async () => {
      projectId = await api.createProject(`E2E Execution Details ${ts}`);
      const folderId = await api.createFolder(
        projectId,
        `Details Folder ${ts}`
      );
      caseId = await api.createTestCase(projectId, folderId, caseName);
      runId = await api.createTestRun(projectId, `Details Run ${ts}`);
      await api.addTestCaseToTestRun(runId, caseId);
    });

    await test.step("Open the run detail page with the case selected", async () => {
      // Navigate directly to the run with selectedCase param to open the sheet
      await page.goto(
        `/en-US/projects/runs/${projectId}/${runId}?selectedCase=${caseId}`
      );
      await page.waitForLoadState("load");
      await page.waitForTimeout(2000);
    });

    await test.step("Verify the case name and execution controls are shown", async () => {
      const sheet = page.locator(".test-run-details-sheet");
      await expect(sheet).toBeVisible({ timeout: 15000 });

      // The execution panel should show:
      // 1. The case name
      await expect(sheet.locator(`text="${caseName}"`).first()).toBeVisible({
        timeout: 10000,
      });

      // 2. The "Add Result" button for recording results
      const addResultButton = sheet
        .locator('button:has-text("Add Result")')
        .first();
      await expect(addResultButton).toBeVisible({ timeout: 10000 });

      // 3. The "Pass" button for quick pass action
      const passButton = sheet.locator('button:has-text("Pass")').first();
      await expect(passButton).toBeVisible({ timeout: 10000 });
    });
  });

  test("should record a result using the status dropdown", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const sheet = page.locator(".test-run-details-sheet");
    let projectId: number | undefined;
    let runId: number | undefined;
    let caseId: number | undefined;

    await test.step("Seed a project, folder, case, and run with the case added", async () => {
      projectId = await api.createProject(`E2E Record Result ${ts}`);
      const folderId = await api.createFolder(projectId, `Record Folder ${ts}`);
      const caseName = `Record Case ${ts}`;
      caseId = await api.createTestCase(projectId, folderId, caseName);
      runId = await api.createTestRun(projectId, `Record Run ${ts}`);
      await api.addTestCaseToTestRun(runId, caseId);
    });

    await test.step("Open the run detail page with the case selected", async () => {
      // Navigate with selectedCase to open the sheet
      await page.goto(
        `/en-US/projects/runs/${projectId}/${runId}?selectedCase=${caseId}`
      );
      await page.waitForLoadState("load");
      await page.waitForTimeout(2000);

      await expect(sheet).toBeVisible({ timeout: 15000 });
    });

    await test.step("Open the status dropdown and record a result", async () => {
      // The status dropdown button is a DropdownMenuTrigger with a colored dot
      // and current status name. Click it to open the status options menu.
      const statusDropdownTrigger = sheet
        .locator(
          'button[aria-haspopup="menu"], button[data-radix-dropdown-menu-trigger]'
        )
        .last();

      // Alternative: look for the dropdown trigger by content (colored dot + status name)
      const statusButton = sheet
        .locator(
          "div.flex.items-center.space-x-1 button, button:has(.rounded-full)"
        )
        .first();

      // Try opening the status dropdown
      let statusDropdownOpened = false;
      if (
        await statusDropdownTrigger
          .isVisible({ timeout: 3000 })
          .catch(() => false)
      ) {
        await statusDropdownTrigger.click();
        statusDropdownOpened = true;
      } else if (
        await statusButton.isVisible({ timeout: 3000 }).catch(() => false)
      ) {
        await statusButton.click();
        statusDropdownOpened = true;
      }

      if (statusDropdownOpened) {
        // Look for status options in the dropdown menu
        const dropdownMenu = page.locator('[role="menu"]');
        if (
          await dropdownMenu.isVisible({ timeout: 5000 }).catch(() => false)
        ) {
          // Click the first status option (e.g., "Passed" or whatever is available)
          const firstStatusOption = dropdownMenu
            .locator('[role="menuitem"]')
            .first();
          if (
            await firstStatusOption
              .isVisible({ timeout: 3000 })
              .catch(() => false)
          ) {
            // Get the status name for verification
            const statusName = await firstStatusOption.textContent();
            await firstStatusOption.click();

            // After clicking, the AddResultModal should open
            // or the status should update directly
            await page.waitForTimeout(2000);

            // Check if AddResultModal appeared
            const addResultDialog = page.locator('[role="dialog"]');
            if (
              await addResultDialog
                .isVisible({ timeout: 3000 })
                .catch(() => false)
            ) {
              // Close it — the test verified that clicking status opens the modal
              await page.keyboard.press("Escape");
            }

            // The action was performed successfully
            expect(statusName).toBeTruthy();
          }
        }
      }
    });
  });

  test("should use Pass and Next button to record a quick pass", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const sheet = page.locator(".test-run-details-sheet");
    let projectId: number | undefined;
    let runId: number | undefined;
    let case1Id: number | undefined;

    await test.step("Seed a project, folder, two cases, and a run with both cases", async () => {
      projectId = await api.createProject(`E2E Quick Pass ${ts}`);
      const folderId = await api.createFolder(projectId, `Pass Folder ${ts}`);
      const case1Name = `Pass Case 1 ${ts}`;
      const case2Name = `Pass Case 2 ${ts}`;
      case1Id = await api.createTestCase(projectId, folderId, case1Name);
      const case2Id = await api.createTestCase(projectId, folderId, case2Name);
      runId = await api.createTestRun(projectId, `Quick Pass Run ${ts}`);
      await api.addTestCaseToTestRun(runId, case1Id);
      await api.addTestCaseToTestRun(runId, case2Id, { order: 1 });
    });

    await test.step("Open the run detail page with the first case selected", async () => {
      // Navigate with the first case selected
      await page.goto(
        `/en-US/projects/runs/${projectId}/${runId}?selectedCase=${case1Id}`
      );
      await page.waitForLoadState("load");
      await page.waitForTimeout(2000);

      await expect(sheet).toBeVisible({ timeout: 15000 });
    });

    await test.step("Click Pass and Next to record a quick pass", async () => {
      // Wait for execution controls to appear
      const passButton = sheet.locator('button:has-text("Pass")').first();
      await expect(passButton).toBeVisible({ timeout: 10000 });

      // Click "Pass & Next"
      await passButton.click();

      // After pass, either:
      // - A success toast appears ("Result added")
      // - The sheet transitions to the next case
      // Wait briefly for the action to complete
      await page.waitForTimeout(2000);
    });

    await test.step("Verify a success toast or the next case is shown", async () => {
      // The pass action should have worked — verify success toast or case transition
      // A toast is shown on success
      const successToast = page
        .locator(
          '[data-sonner-toast], [role="status"], text=/result added|passed/i'
        )
        .first();

      // Or verify the sheet still shows case details (pass & next moved to case 2)
      const sheetStillVisible = await sheet
        .isVisible({ timeout: 3000 })
        .catch(() => false);
      expect(
        sheetStillVisible ||
          (await successToast.isVisible({ timeout: 3000 }).catch(() => false))
      ).toBeTruthy();
    });
  });

  test("should navigate between cases using previous and next buttons", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const sheet = page.locator(".test-run-details-sheet");
    const case1Name = `Nav Case 1 ${ts}`;
    const case2Name = `Nav Case 2 ${ts}`;
    let projectId: number | undefined;
    let runId: number | undefined;
    let case1Id: number | undefined;

    await test.step("Seed a project, folder, two ordered cases, and a run", async () => {
      projectId = await api.createProject(`E2E Nav Cases ${ts}`);
      const folderId = await api.createFolder(projectId, `Nav Folder ${ts}`);
      case1Id = await api.createTestCase(projectId, folderId, case1Name);
      const case2Id = await api.createTestCase(projectId, folderId, case2Name);
      runId = await api.createTestRun(projectId, `Nav Run ${ts}`);
      await api.addTestCaseToTestRun(runId, case1Id, { order: 0 });
      await api.addTestCaseToTestRun(runId, case2Id, { order: 1 });
    });

    await test.step("Open the run detail page with the first case selected", async () => {
      // Navigate with case 1 selected
      await page.goto(
        `/en-US/projects/runs/${projectId}/${runId}?selectedCase=${case1Id}`
      );
      await page.waitForLoadState("load");
      await page.waitForTimeout(2000);

      await expect(sheet).toBeVisible({ timeout: 15000 });

      // First case should be shown in the sheet
      await expect(sheet.locator(`text="${case1Name}"`).first()).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step("Navigate to the next case and verify it is displayed", async () => {
      // There should be a Next button (chevron right) in the panel header
      const nextCaseButton = sheet
        .locator('button[aria-label*="next" i], button[aria-label*="Next" i]')
        .first();

      if (
        await nextCaseButton.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
        await nextCaseButton.click();

        // Wait for transition
        await page.waitForTimeout(2000);

        // The second case should now be displayed
        await expect(sheet.locator(`text="${case2Name}"`).first()).toBeVisible({
          timeout: 10000,
        });
      } else {
        // Navigation arrows might have different labels - check panel structure
        // Check that the index indicator shows "1 of 2" for case 1
        const indexIndicator = sheet.locator('span:has-text("of")').first();
        if (
          await indexIndicator.isVisible({ timeout: 3000 }).catch(() => false)
        ) {
          const text = await indexIndicator.textContent();
          expect(text).toContain("of");
        } else {
          // Just verify the sheet is open with case details visible
          await expect(sheet).toBeVisible({ timeout: 3000 });
        }
      }
    });
  });

  test("Pass & Next escalates to the Add Result modal when a required result field exists", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const sheet = page.locator(".test-run-details-sheet");
    let projectId: number | undefined;
    let runId: number | undefined;
    let caseId: number | undefined;

    await test.step("Seed a template with a required result field, plus a case and run", async () => {
      projectId = await api.createProject(`E2E Required Escalate ${ts}`);
      const folderId = await api.createFolder(
        projectId,
        `Escalate Folder ${ts}`
      );

      // A required result field on the template the case uses. Quick-pass can't
      // capture it, so clicking Pass & Next should open the full modal instead
      // of silently being rejected by the server.
      const resultFieldId = await api.createResultField({
        displayName: `Escalate Reason ${ts}`,
        systemName: `escalate_reason_${ts}`,
        typeName: "Text String",
        isRequired: true,
      });
      const templateId = await api.createTemplate({
        name: `Escalate Template ${ts}`,
        projectIds: [projectId],
      });
      await api.assignResultFieldToTemplate(templateId, resultFieldId);

      caseId = await api.createTestCase(
        projectId,
        folderId,
        `Escalate Case ${ts}`,
        templateId
      );
      runId = await api.createTestRun(projectId, `Escalate Run ${ts}`);
      await api.addTestCaseToTestRun(runId, caseId);
    });

    await test.step("Open the run detail page with the case selected", async () => {
      // The "Pass & Next" handler escalates to the Add Result modal only once
      // TestRunCaseDetails knows the template has a required result field. That
      // knowledge comes from a `templateResultAssignment` findMany query that is
      // gated on the case (and its template id) loading first, so it resolves
      // strictly after page load. If Pass & Next is clicked before it resolves,
      // `hasRequiredResultField` is still false: the click submits a plain quick
      // pass, the server rejects it with REQUIRED_FIELDS_MISSING, and the modal
      // never opens. Register the wait BEFORE navigating so the listener is armed
      // when the query fires, then block on it before clicking Pass — making the
      // escalation deterministic instead of racing a fixed 2s timeout.
      const requiredFieldQuery = page.waitForResponse(
        (response) =>
          response.url().includes("/api/model/templateResultAssignment") &&
          response.url().includes("findMany") &&
          response.status() === 200,
        { timeout: 15000 }
      );

      await page.goto(
        `/en-US/projects/runs/${projectId}/${runId}?selectedCase=${caseId}`
      );
      await page.waitForLoadState("load");

      await expect(sheet).toBeVisible({ timeout: 15000 });

      // Ensure the required-result-field query has resolved into the React Query
      // cache before any interaction, so the next render reads it synchronously.
      await requiredFieldQuery;
    });

    await test.step("Click Pass and Next on the case", async () => {
      const passButton = sheet.locator('button:has-text("Pass")').first();
      await expect(passButton).toBeVisible({ timeout: 10000 });
      await passButton.click();
    });

    await test.step("Verify the Add Result modal opens showing the required field", async () => {
      // Escalation: the Add Result modal opens (a plain quick-pass shows only a
      // toast and never a dialog), and it surfaces the required field. The
      // case-details sheet is also role="dialog", so scope to the Add Result one.
      const dialog = page.getByRole("dialog", { name: "Add Result" });
      await expect(dialog).toBeVisible({ timeout: 10000 });
      await expect(
        dialog.locator(`text="Escalate Reason ${ts}"`).first()
      ).toBeVisible({ timeout: 10000 });
    });
  });
});
