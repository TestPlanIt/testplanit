import { expect, test } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

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

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);

    // The inline add row must be visible even when the folder has no cases yet.
    // This was a bug fixed as part of the importGeneratedTestCases refactor.
    await expect(page.getByTestId("inline-case-name-input")).toBeVisible({
      timeout: 10000,
    });
  });

  test("Creates a case in an empty folder via Enter key @smoke", async ({
    api,
    page,
  }) => {
    const { projectId, folderId } = await setupProjectAndFolder(api);
    const caseName = `Inline Case ${Date.now()}`;

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);

    // Wait for inline form to appear
    const nameInput = page.getByTestId("inline-case-name-input");
    await expect(nameInput).toBeVisible({ timeout: 10000 });

    // Listen for the duplicate-scan request BEFORE triggering submission
    const duplicateScanPromise = page.waitForRequest(
      (req) =>
        req.url().includes("/api/duplicate-scan/check-new") &&
        req.method() === "POST",
      { timeout: 10000 }
    );

    // Type and submit via Enter key
    await nameInput.fill(caseName);
    await page.keyboard.press("Enter");

    // Case should appear in the cases table
    await expect(repositoryPage.getTestCaseByName(caseName)).toBeVisible({
      timeout: 15000,
    });

    // Input should regain focus so the user can immediately type the next case
    await expect(nameInput).toBeFocused({ timeout: 5000 });

    // Duplicate-scan advisory check must have fired
    await duplicateScanPromise;
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

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);

    const nameInput = page.getByTestId("inline-case-name-input");
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    await nameInput.fill(caseName);

    await page.getByTestId("inline-add-case-button").click();
    await page.waitForLoadState("networkidle");

    await expect(repositoryPage.getTestCaseByName(caseName)).toBeVisible({
      timeout: 15000,
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

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);

    const nameInput = page.getByTestId("inline-case-name-input");
    await expect(nameInput).toBeVisible({ timeout: 10000 });

    // Submit first case
    await nameInput.fill(firstName);
    await page.keyboard.press("Enter");
    await expect(repositoryPage.getTestCaseByName(firstName)).toBeVisible({
      timeout: 15000,
    });

    // Input should be empty and focused — ready for the second case
    await expect(nameInput).toHaveValue("", { timeout: 5000 });
    await expect(nameInput).toBeFocused({ timeout: 5000 });

    // Submit second case without re-focusing
    await nameInput.fill(secondName);
    await page.keyboard.press("Enter");
    await expect(repositoryPage.getTestCaseByName(secondName)).toBeVisible({
      timeout: 15000,
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

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);

    // Open the Add Case modal via the toolbar button
    const addCaseButton = page.getByTestId("add-case-button");
    await expect(addCaseButton).toBeEnabled({ timeout: 10000 });
    await addCaseButton.click();

    const dialog = page.getByTestId("add-case-dialog");
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Wait for template and state dropdowns to populate
    const nameInput = dialog.getByTestId("case-name-input");
    await expect(nameInput).toBeVisible({ timeout: 10000 });

    await nameInput.fill(caseName);

    // Submit
    const submitButton = page.getByTestId("case-submit-button");
    await expect(submitButton).toBeEnabled({ timeout: 5000 });
    await submitButton.click();

    // Dialog closes on success
    await expect(dialog).not.toBeVisible({ timeout: 15000 });

    // Case must appear in the table
    await expect(repositoryPage.getTestCaseByName(caseName)).toBeVisible({
      timeout: 15000,
    });
  });

  test("Created case is navigable and shows correct name in detail view @smoke", async ({
    api,
    page,
  }) => {
    const { projectId, folderId } = await setupProjectAndFolder(api);
    const caseName = `Detail Case ${Date.now()}`;

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);

    const addCaseButton = page.getByTestId("add-case-button");
    await expect(addCaseButton).toBeEnabled({ timeout: 10000 });
    await addCaseButton.click();

    const dialog = page.getByTestId("add-case-dialog");
    await expect(dialog).toBeVisible({ timeout: 10000 });

    const nameInput = dialog.getByTestId("case-name-input");
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    await nameInput.fill(caseName);

    const submitButton = page.getByTestId("case-submit-button");
    await expect(submitButton).toBeEnabled({ timeout: 5000 });
    await submitButton.click();
    await expect(dialog).not.toBeVisible({ timeout: 15000 });

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

  test("Modal cancel does not create a case", async ({ api, page }) => {
    const { projectId, folderId } = await setupProjectAndFolder(api);
    const caseName = `Cancelled Case ${Date.now()}`;

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);

    const addCaseButton = page.getByTestId("add-case-button");
    await expect(addCaseButton).toBeEnabled({ timeout: 10000 });
    await addCaseButton.click();

    const dialog = page.getByTestId("add-case-dialog");
    await expect(dialog).toBeVisible({ timeout: 10000 });

    const nameInput = dialog.getByTestId("case-name-input");
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    await nameInput.fill(caseName);

    // Cancel instead of submitting
    await page.getByTestId("case-cancel-button").click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // The case must NOT appear in the table
    await expect(repositoryPage.getTestCaseByName(caseName)).not.toBeVisible({
      timeout: 3000,
    });
  });
});
