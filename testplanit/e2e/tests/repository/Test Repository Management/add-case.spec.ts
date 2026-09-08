import { expect, test } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";
import { clickOverflowAction } from "../../../utils/action-overflow";

/**
 * Add Case Tests — Inline Row and Modal
 *
 * Covers the two surfaces through which a user creates a single test case:
 *   1. AddCaseRow — the inline form that lives below the cases table
 *   2. AddCase modal — the full dialog opened by the "Add Case" button
 *
 * Both surfaces were refactored to call importGeneratedTestCases() server
 * action (same path as the AI wizard). These tests guard against regressions
 * in that critical path.
 */

async function setupProjectAndFolder(
  api: import("../../../fixtures/api.fixture").ApiHelper
): Promise<{ projectId: number; folderId: number }> {
  const projectId = await api.createProject(
    `E2E Add Case ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  );
  const folderId = await api.createFolder(projectId, `Folder ${Date.now()}`);
  return { projectId, folderId };
}

test.describe("Add Case — Inline Row", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  test("Empty folder shows the inline AddCaseRow @smoke", async ({
    api,
    page,
  }) => {
    const { projectId, folderId } = await setupProjectAndFolder(api);

    await test.step("Open the empty folder in the repository", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);
    });

    await test.step("Verify the inline add row is visible in the empty folder", async () => {
      // The inline add row must be visible even when the folder has no cases yet.
      // This was a bug fixed as part of the importGeneratedTestCases refactor.
      await expect(page.getByTestId("inline-case-name-input")).toBeVisible({
        timeout: 10000,
      });
    });
  });

  test("Creates a case in an empty folder via Enter key @smoke", async ({
    api,
    page,
  }) => {
    const { projectId, folderId } = await setupProjectAndFolder(api);
    const caseName = `Inline Case ${Date.now()}`;

    const nameInput = page.getByTestId("inline-case-name-input");
    let duplicateScanPromise:
      ReturnType<typeof page.waitForRequest> | undefined;

    await test.step("Open the folder and wait for the inline form", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);

      // Wait for inline form to appear
      await expect(nameInput).toBeVisible({ timeout: 10000 });
    });

    await test.step("Type the case name and submit via Enter key", async () => {
      // Listen for the duplicate-scan request BEFORE triggering submission
      duplicateScanPromise = page.waitForRequest(
        (req) =>
          req.url().includes("/api/duplicate-scan/check-new") &&
          req.method() === "POST",
        { timeout: 10000 }
      );

      // Type and submit via Enter key
      await nameInput.fill(caseName);
      await page.keyboard.press("Enter");
    });

    await test.step("Verify the case is created, input refocuses, and duplicate-scan fired", async () => {
      // Case should appear in the cases table
      await expect(repositoryPage.getTestCaseByName(caseName)).toBeVisible({
        timeout: 15000,
      });

      // Input should regain focus so the user can immediately type the next case
      await expect(nameInput).toBeFocused({ timeout: 5000 });

      // Duplicate-scan advisory check must have fired
      await duplicateScanPromise!;
    });
  });

  test("Creates a case via the submit button click @smoke", async ({
    api,
    page,
  }) => {
    const { projectId, folderId } = await setupProjectAndFolder(api);
    // Put one existing case in the folder so we exercise the non-empty path
    await api.createTestCase(
      projectId,
      folderId,
      `Existing Case ${Date.now()}`
    );
    const caseName = `Button Case ${Date.now()}`;

    await test.step("Open the folder and type the case name", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);

      const nameInput = page.getByTestId("inline-case-name-input");
      await expect(nameInput).toBeVisible({ timeout: 10000 });
      await nameInput.fill(caseName);
    });

    await test.step("Submit via the inline add case button", async () => {
      await page.getByTestId("inline-add-case-button").click();
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the case appears in the cases table", async () => {
      await expect(repositoryPage.getTestCaseByName(caseName)).toBeVisible({
        timeout: 15000,
      });
    });
  });

  test("Inline form clears after submit and accepts a second case @smoke", async ({
    api,
    page,
  }) => {
    const { projectId, folderId } = await setupProjectAndFolder(api);
    const ts = Date.now();
    const firstName = `First Case ${ts}`;
    const secondName = `Second Case ${ts}`;

    const nameInput = page.getByTestId("inline-case-name-input");

    await test.step("Open the folder and wait for the inline form", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);

      await expect(nameInput).toBeVisible({ timeout: 10000 });
    });

    await test.step("Submit the first case", async () => {
      // Submit first case
      await nameInput.fill(firstName);
      await page.keyboard.press("Enter");
      await expect(repositoryPage.getTestCaseByName(firstName)).toBeVisible({
        timeout: 15000,
      });
    });

    await test.step("Verify the input clears and refocuses for the next case", async () => {
      // Input should be empty and focused — ready for the second case
      await expect(nameInput).toHaveValue("", { timeout: 5000 });
      await expect(nameInput).toBeFocused({ timeout: 5000 });
    });

    await test.step("Submit a second case without re-focusing", async () => {
      // Submit second case without re-focusing
      await nameInput.fill(secondName);
      await page.keyboard.press("Enter");
      await expect(repositoryPage.getTestCaseByName(secondName)).toBeVisible({
        timeout: 15000,
      });
    });
  });
});

test.describe("Add Case — Modal", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  test("Creates a case via the modal with default template and state @smoke", async ({
    api,
    page,
  }) => {
    const { projectId, folderId } = await setupProjectAndFolder(api);
    const caseName = `Modal Case ${Date.now()}`;

    const dialog = page.getByTestId("add-case-dialog");

    await test.step("Open the folder and launch the Add Case modal", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);

      // Open the Add Case modal via the toolbar button
      await clickOverflowAction(
        page,
        "add-case-button",
        "repository-actions-menu"
      );

      await expect(dialog).toBeVisible({ timeout: 10000 });
    });

    await test.step("Fill the case name and submit the modal", async () => {
      // Wait for template and state dropdowns to populate
      const nameInput = dialog.getByTestId("case-name-input");
      await expect(nameInput).toBeVisible({ timeout: 10000 });

      await nameInput.fill(caseName);

      // Submit
      const submitButton = page.getByTestId("case-submit-button");
      await expect(submitButton).toBeEnabled({ timeout: 5000 });
      await submitButton.click();
    });

    await test.step("Verify the modal closes and the case appears", async () => {
      // Dialog closes on success
      await expect(dialog).not.toBeVisible({ timeout: 15000 });

      // Case must appear in the table
      await expect(repositoryPage.getTestCaseByName(caseName)).toBeVisible({
        timeout: 15000,
      });
    });
  });

  test("Created case is navigable and shows correct name in detail view @smoke", async ({
    api,
    page,
  }) => {
    const { projectId, folderId } = await setupProjectAndFolder(api);
    const caseName = `Detail Case ${Date.now()}`;

    const dialog = page.getByTestId("add-case-dialog");

    await test.step("Open the folder and launch the Add Case modal", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);

      await clickOverflowAction(
        page,
        "add-case-button",
        "repository-actions-menu"
      );

      await expect(dialog).toBeVisible({ timeout: 10000 });
    });

    await test.step("Fill the case name and submit the modal", async () => {
      const nameInput = dialog.getByTestId("case-name-input");
      await expect(nameInput).toBeVisible({ timeout: 10000 });
      await nameInput.fill(caseName);

      const submitButton = page.getByTestId("case-submit-button");
      await expect(submitButton).toBeEnabled({ timeout: 5000 });
      await submitButton.click();
      await expect(dialog).not.toBeVisible({ timeout: 15000 });
    });

    await test.step("Open the case and verify its name in the detail panel", async () => {
      // Click the case row — this opens the case in the right-side detail panel
      const caseRow = repositoryPage.getTestCaseByName(caseName);
      await expect(caseRow).toBeVisible({ timeout: 15000 });
      await caseRow.click();
      await page.waitForLoadState("networkidle");

      // The case name must be visible in the detail panel
      await expect(page.locator(`text="${caseName}"`).first()).toBeVisible({
        timeout: 10000,
      });
    });
  });

  test("Modal cancel does not create a case", async ({ api, page }) => {
    const { projectId, folderId } = await setupProjectAndFolder(api);
    const caseName = `Cancelled Case ${Date.now()}`;

    const dialog = page.getByTestId("add-case-dialog");

    await test.step("Open the folder and launch the Add Case modal", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);

      await clickOverflowAction(
        page,
        "add-case-button",
        "repository-actions-menu"
      );

      await expect(dialog).toBeVisible({ timeout: 10000 });
    });

    await test.step("Fill the case name then cancel the modal", async () => {
      const nameInput = dialog.getByTestId("case-name-input");
      await expect(nameInput).toBeVisible({ timeout: 10000 });
      await nameInput.fill(caseName);

      // Cancel instead of submitting
      await page.getByTestId("case-cancel-button").click();
      await expect(dialog).not.toBeVisible({ timeout: 5000 });
    });

    await test.step("Verify the cancelled case was not created", async () => {
      // The case must NOT appear in the table
      await expect(repositoryPage.getTestCaseByName(caseName)).not.toBeVisible({
        timeout: 3000,
      });
    });
  });
});
