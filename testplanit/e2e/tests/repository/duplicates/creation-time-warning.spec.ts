import { expect, test } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";
import { clickOverflowAction } from "../../../utils/action-overflow";

/**
 * Creation-Time Duplicate Warning Tests
 *
 * Tests the toast warning that appears after saving a new test case that
 * resembles an existing one. The check-new API endpoint is mocked so these
 * tests are deterministic and do not require Elasticsearch to be running.
 */
test.describe("Creation-Time Duplicate Warning", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  test("Shows duplicate warning toast with clickable case link for a single match", async ({
    api,
    page,
  }) => {
    let projectId: number | undefined;
    let folderId: number | undefined;
    let existingCaseId: number | undefined;

    await test.step("Create project, folder, and an existing duplicate case via API", async () => {
      // Create project and folder via API
      projectId = await api.createProject(
        `E2E Duplicate Warning Project ${Date.now()}`
      );
      const folderName = `E2E Duplicate Warning Folder ${Date.now()}`;
      folderId = await api.createFolder(projectId, folderName);

      // Create an existing test case that will be reported as a duplicate
      existingCaseId = await api.createTestCase(
        projectId,
        folderId,
        "Login form submit test"
      );
    });

    await test.step("Mock check-new endpoint to return the existing case as a duplicate", async () => {
      // Mock the check-new endpoint to return the existing case as a duplicate
      await page.route("**/api/duplicate-scan/check-new", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            cases: [{ id: existingCaseId, name: "Login form submit test" }],
          }),
        });
      });
    });

    await test.step("Open the repository page and select the folder", async () => {
      // Navigate to the repository page
      await repositoryPage.goto(projectId!);

      // Select the folder in the tree
      await repositoryPage.selectFolder(folderId!);
      await page.waitForLoadState("networkidle");
    });

    const addCaseDialog = page.getByTestId("add-case-dialog");

    await test.step("Open the Add Case dialog", async () => {
      // Click the Add Case button
      await clickOverflowAction(
        page,
        "add-case-button",
        "repository-actions-menu"
      );

      // Wait for the dialog to open
      await expect(addCaseDialog).toBeVisible({ timeout: 8000 });
    });

    await test.step("Enter a name variant of the existing case and submit", async () => {
      // Fill in the case name with a variant of the existing case name
      const caseNameInput = addCaseDialog.getByTestId("case-name-input");
      await expect(caseNameInput).toBeVisible({ timeout: 5000 });
      await caseNameInput.fill("Login form submit test variant");

      // Submit the case
      const submitButton = addCaseDialog.getByTestId("case-submit-button");
      await expect(submitButton).toBeVisible({ timeout: 5000 });
      await submitButton.click();

      // Wait for dialog to close (save succeeded)
      await expect(addCaseDialog).not.toBeVisible({ timeout: 15000 });
    });

    await test.step("Verify the warning toast links to the matching case and the duplicates review page", async () => {
      // The check-new call is fire-and-forget — wait briefly for the toast
      await page.waitForTimeout(1500);

      // Verify the warning toast appears
      const toast = page.locator("[data-sonner-toast]").first();
      await expect(toast).toBeVisible({ timeout: 8000 });

      // Verify the toast contains text indicating a duplicate was found
      await expect(toast).toContainText(/similar|duplicate/i);

      // Verify the toast contains a clickable link to the matching case
      const caseLink = toast.locator(`a[href*="/${existingCaseId}"]`);
      await expect(caseLink).toBeVisible();

      // Verify the Review link to the duplicates page is also present
      const reviewLink = toast.locator(`a[href*="/duplicates"]`);
      await expect(reviewLink).toBeVisible();
    });
  });

  test("Shows Review link to duplicates page when multiple matches found", async ({
    api,
    page,
  }) => {
    let projectId: number | undefined;
    let folderId: number | undefined;
    let caseAId: number | undefined;
    let caseBId: number | undefined;

    await test.step("Create project, folder, and two existing duplicate cases via API", async () => {
      projectId = await api.createProject(
        `E2E Multi Duplicate Project ${Date.now()}`
      );
      const folderName = `E2E Multi Duplicate Folder ${Date.now()}`;
      folderId = await api.createFolder(projectId, folderName);

      caseAId = await api.createTestCase(projectId, folderId, "Login test A");
      caseBId = await api.createTestCase(projectId, folderId, "Login test B");
    });

    await test.step("Mock check-new endpoint to return multiple matches", async () => {
      // Mock the check-new endpoint to return multiple matches
      await page.route("**/api/duplicate-scan/check-new", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            cases: [
              { id: caseAId, name: "Login test A" },
              { id: caseBId, name: "Login test B" },
            ],
          }),
        });
      });
    });

    await test.step("Open the repository page and select the folder", async () => {
      await repositoryPage.goto(projectId!);
      await repositoryPage.selectFolder(folderId!);
      await page.waitForLoadState("networkidle");
    });

    const addCaseDialog = page.getByTestId("add-case-dialog");

    await test.step("Open the Add Case dialog", async () => {
      // Create a new test case
      await clickOverflowAction(
        page,
        "add-case-button",
        "repository-actions-menu"
      );

      await expect(addCaseDialog).toBeVisible({ timeout: 8000 });
    });

    await test.step("Enter a case name variant and submit", async () => {
      const caseNameInput = addCaseDialog.getByTestId("case-name-input");
      await expect(caseNameInput).toBeVisible({ timeout: 5000 });
      await caseNameInput.fill("Login test variant");

      const submitButton = addCaseDialog.getByTestId("case-submit-button");
      await expect(submitButton).toBeVisible({ timeout: 5000 });
      await submitButton.click();

      await expect(addCaseDialog).not.toBeVisible({ timeout: 15000 });
    });

    await test.step("Verify the toast lists each match and the Review link points to the duplicates page", async () => {
      await page.waitForTimeout(1500);

      // Verify the warning toast appears
      const toast = page.locator("[data-sonner-toast]").first();
      await expect(toast).toBeVisible({ timeout: 8000 });

      // Verify there are links for each matching case
      const caseLinks = toast.locator("a");
      const linkCount = await caseLinks.count();
      // At least 2 case links + 1 Review link = 3+
      expect(linkCount).toBeGreaterThanOrEqual(3);

      // Verify the Review link points to the duplicates page
      const reviewLink = toast.locator(
        `a[href*="/projects/repository/${projectId}/duplicates"]`
      );
      await expect(reviewLink).toBeVisible();
    });
  });

  test("No warning shown when check-new finds no duplicates", async ({
    api,
    page,
  }) => {
    let projectId: number | undefined;
    let folderId: number | undefined;

    await test.step("Create project and folder via API", async () => {
      // Create project and folder via API
      projectId = await api.createProject(
        `E2E No Duplicate Project ${Date.now()}`
      );
      const folderName = `E2E No Duplicate Folder ${Date.now()}`;
      folderId = await api.createFolder(projectId, folderName);
    });

    await test.step("Mock check-new endpoint to return no duplicates", async () => {
      // Mock the check-new endpoint to return an empty list (no duplicates)
      await page.route("**/api/duplicate-scan/check-new", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ cases: [] }),
        });
      });
    });

    await test.step("Open the repository page and select the folder", async () => {
      // Navigate to the repository page
      await repositoryPage.goto(projectId!);

      // Select the folder in the tree
      await repositoryPage.selectFolder(folderId!);
      await page.waitForLoadState("networkidle");
    });

    const addCaseDialog = page.getByTestId("add-case-dialog");

    await test.step("Open the Add Case dialog", async () => {
      // Click the Add Case button
      await clickOverflowAction(
        page,
        "add-case-button",
        "repository-actions-menu"
      );

      // Wait for the dialog to open
      await expect(addCaseDialog).toBeVisible({ timeout: 8000 });
    });

    await test.step("Enter a unique case name and submit", async () => {
      // Fill in a unique case name
      const caseNameInput = addCaseDialog.getByTestId("case-name-input");
      await expect(caseNameInput).toBeVisible({ timeout: 5000 });
      await caseNameInput.fill(`Unique Case ${Date.now()}`);

      // Submit the case
      const submitButton = addCaseDialog.getByTestId("case-submit-button");
      await expect(submitButton).toBeVisible({ timeout: 5000 });
      await submitButton.click();

      // Wait for dialog to close (save succeeded)
      await expect(addCaseDialog).not.toBeVisible({ timeout: 15000 });
    });

    await test.step("Wait for any toast and verify no warning toast is shown", async () => {
      // Wait long enough for any toast to appear (3 seconds)
      await page.waitForTimeout(3000);

      // Verify NO warning toast is shown
      await expect(
        page.locator('[data-sonner-toast][data-type="warning"]')
      ).not.toBeVisible();
    });
  });
});
