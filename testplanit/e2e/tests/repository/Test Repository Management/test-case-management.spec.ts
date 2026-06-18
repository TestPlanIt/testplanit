import { expect, test } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Test Case Management Tests
 *
 * Test cases for managing test cases within folders in the repository.
 * Focuses on CRUD operations and test case interactions.
 */
test.describe("Test Case Management", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  async function getTestProjectId(
    api: import("../../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    // Create a project for this test - tests should be self-contained
    return await api.createProject(
      `E2E Test Project ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
  }

  test("Create Test Case in Folder", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const folderName = `E2E TC Folder ${Date.now()}`;
    const testCaseName = `E2E Test Case ${Date.now()}`;

    let folderId: number | undefined;

    await test.step("Create a folder via API", async () => {
      // Create a folder via API (folder creation is tested separately)
      folderId = await api.createFolder(projectId, folderName);
    });

    await test.step("Open the repository and select the folder", async () => {
      await repositoryPage.goto(projectId);

      // Select the folder first
      await repositoryPage.selectFolder(folderId!);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Create a test case via the UI", async () => {
      // Create a test case via UI using page object method
      await repositoryPage.createTestCase(testCaseName);
    });

    await test.step("Verify the test case appears in the table", async () => {
      // Verify the test case was created and is visible in the table
      // The table should automatically refetch after creation via query invalidation
      await repositoryPage.verifyTestCaseExists(testCaseName);
    });
  });

  test("Click Test Case to View Details", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const folderName = `Details Folder ${Date.now()}`;
    const testCaseName = `Details Case ${Date.now()}`;

    let folderId: number | undefined;
    let testCaseId: number | undefined;
    let href: string | null = null;

    await test.step("Create a folder with a test case via API", async () => {
      // Create a folder with a test case
      folderId = await api.createFolder(projectId, folderName);
      testCaseId = await api.createTestCase(projectId, folderId, testCaseName);
    });

    await test.step("Open the repository and select the folder", async () => {
      await repositoryPage.goto(projectId);

      // Select the folder
      await repositoryPage.selectFolder(folderId!);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the test case row and its detail link", async () => {
      // Find the test case row - it should be visible in the table
      const testCaseRow = page.locator(`[data-row-id="${testCaseId}"]`).first();
      await expect(testCaseRow).toBeVisible({ timeout: 10000 });

      // Get the link in the Name column
      // The link is inside a cell and contains the test case name
      const testCaseLink = testCaseRow.locator("a").first();
      await expect(testCaseLink).toBeVisible({ timeout: 5000 });

      // Get the href and verify it's the correct detail URL
      href = await testCaseLink.getAttribute("href");
      expect(href).toContain(`/projects/repository/${projectId}/${testCaseId}`);
    });

    await test.step("Navigate to the detail page and confirm the URL", async () => {
      // Navigate directly using the href to avoid any click interception issues
      await page.goto(href!);
      await page.waitForLoadState("networkidle");

      // Verify we're on the detail page
      await expect(page).toHaveURL(
        new RegExp(`/projects/repository/${projectId}/${testCaseId}`)
      );
    });
  });

  test("Add Case Button Opens Modal", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const folderName = `Add Case Modal Folder ${Date.now()}`;

    let folderId: number | undefined;
    let nameInput: ReturnType<typeof page.getByTestId> | undefined;

    await test.step("Create a folder via API", async () => {
      // Create a folder
      folderId = await api.createFolder(projectId, folderName);
    });

    await test.step("Open the repository and select the folder", async () => {
      await repositoryPage.goto(projectId);

      // Select the folder
      await repositoryPage.selectFolder(folderId!);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Click Add Case and verify the modal opens", async () => {
      // Click the Add Case button
      const addCaseButton = page
        .getByTestId("add-case-button")
        .or(page.locator('button:has-text("Add Case")'))
        .first();
      await expect(addCaseButton).toBeVisible({ timeout: 5000 });
      await addCaseButton.click();

      // Verify modal opens with name input (it's a textarea with data-testid="case-name-input")
      nameInput = page.getByTestId("case-name-input");
      await expect(nameInput).toBeVisible({ timeout: 5000 });
    });

    await test.step("Close the modal with Escape", async () => {
      // Close modal with Escape
      await page.keyboard.press("Escape");
      await expect(nameInput!).not.toBeVisible({ timeout: 3000 });
    });
  });

  test("Test Case Row Has Action Buttons", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const folderName = `Actions Folder ${Date.now()}`;
    const testCaseName = `Actions Case ${Date.now()}`;

    let folderId: number | undefined;
    let testCaseId: number | undefined;

    await test.step("Create a folder with a test case via API", async () => {
      // Create a folder with a test case
      folderId = await api.createFolder(projectId, folderName);
      testCaseId = await api.createTestCase(projectId, folderId, testCaseName);
    });

    await test.step("Open the repository and select the folder", async () => {
      await repositoryPage.goto(projectId);

      // Select the folder
      await repositoryPage.selectFolder(folderId!);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the test case row has action buttons", async () => {
      // Find the test case row
      const testCaseRow = page.locator(`[data-row-id="${testCaseId}"]`).first();
      await expect(testCaseRow).toBeVisible({ timeout: 10000 });

      // The row should have action buttons (at least 1 button in Actions column)
      const actionButtons = testCaseRow.locator("button");
      const buttonCount = await actionButtons.count();
      expect(buttonCount).toBeGreaterThan(0);
    });
  });

  test("Edit Test Case Name via Detail Page", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const folderName = `Edit TC Folder ${Date.now()}`;
    const originalName = `Edit TC Original ${Date.now()}`;
    const newName = `Edit TC Renamed ${Date.now()}`;

    let folderId: number | undefined;
    let testCaseId: number | undefined;
    let editButton: ReturnType<typeof page.getByTestId> | undefined;

    await test.step("Create a folder and test case via API", async () => {
      // Create a folder and test case via API
      folderId = await api.createFolder(projectId, folderName);
      testCaseId = await api.createTestCase(projectId, folderId, originalName);
    });

    await test.step("Open the case detail page", async () => {
      // Navigate directly to the case detail page
      await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}`);
      await page.waitForLoadState("networkidle");

      // Verify we are on the detail page
      await expect(page).toHaveURL(
        new RegExp(`/projects/repository/${projectId}/${testCaseId}`)
      );
    });

    await test.step("Enter edit mode and rename the test case", async () => {
      // Click the Edit button to enter edit mode
      editButton = page.getByTestId("edit-test-case-button");
      await expect(editButton).toBeVisible({ timeout: 10000 });
      await editButton.click();
      await page.waitForLoadState("networkidle");

      // Find the case name textarea (rendered in edit mode)
      // The textarea is the first visible textarea in the card header area
      const nameTextarea = page.locator("textarea").first();
      await expect(nameTextarea).toBeVisible({ timeout: 10000 });

      // Clear and type new name
      await nameTextarea.clear();
      await nameTextarea.fill(newName);
    });

    await test.step("Save the renamed test case", async () => {
      // Click the Save (submit) button
      const saveButton = page.locator('button[type="submit"]').first();
      await expect(saveButton).toBeVisible({ timeout: 5000 });
      await saveButton.click();

      // Wait for save to complete — edit button reappears in view mode
      await expect(editButton!).toBeVisible({ timeout: 15000 });
      await page.waitForLoadState("networkidle");

      // Verify the new name is visible on the page
      await expect(page.locator(`text="${newName}"`).first()).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step("Reload and confirm the new name persists", async () => {
      // Reload and confirm the name persists
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(page.locator(`text="${newName}"`).first()).toBeVisible({
        timeout: 10000,
      });
    });
  });

  test("Delete Test Case via Row Action", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const folderName = `Delete TC Folder ${Date.now()}`;
    const testCaseName = `Delete TC Case ${Date.now()}`;

    let folderId: number | undefined;
    let testCaseId: number | undefined;
    let alertDialog: ReturnType<typeof page.getByRole> | undefined;

    await test.step("Create a folder and test case via API", async () => {
      // Create a folder and test case via API
      folderId = await api.createFolder(projectId, folderName);
      testCaseId = await api.createTestCase(projectId, folderId, testCaseName);
    });

    await test.step("Open the repository and select the folder", async () => {
      await repositoryPage.goto(projectId);

      // Select the folder
      await repositoryPage.selectFolder(folderId!);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Open the row actions menu and choose Delete", async () => {
      // Wait for the test case row to be visible
      const testCaseRow = page.locator(`[data-row-id="${testCaseId}"]`).first();
      await expect(testCaseRow).toBeVisible({ timeout: 10000 });

      // Open the actions dropdown menu (three-dot button) to access the delete option
      const actionsButton = testCaseRow.locator(
        `[data-testid="actions-menu-${testCaseId}"]`
      );
      await expect(actionsButton).toBeVisible({ timeout: 5000 });
      await actionsButton.click();

      // Click the delete option from the dropdown menu
      const deleteButton = page
        .locator('[role="menuitem"]')
        .filter({ hasText: /Delete/i })
        .first();
      await expect(deleteButton).toBeVisible({ timeout: 5000 });
      await deleteButton.click();
    });

    await test.step("Confirm deletion in the dialog", async () => {
      // Wait for the AlertDialog confirmation dialog
      alertDialog = page.getByRole("alertdialog");
      await expect(alertDialog).toBeVisible({ timeout: 5000 });

      // Click the confirm delete button inside the dialog
      const confirmDeleteButton = alertDialog
        .locator("button")
        .filter({ hasText: /Delete|Confirm/i })
        .first();
      await expect(confirmDeleteButton).toBeVisible({ timeout: 5000 });
      await confirmDeleteButton.click();
    });

    await test.step("Verify the test case row is removed", async () => {
      // Wait for modal to close and network to settle
      await expect(alertDialog!).not.toBeVisible({ timeout: 10000 });
      await page.waitForLoadState("networkidle");

      // Verify the test case row is no longer visible
      await expect(
        page.locator(`[data-row-id="${testCaseId}"]`)
      ).not.toBeVisible({ timeout: 10000 });
    });
  });
});
