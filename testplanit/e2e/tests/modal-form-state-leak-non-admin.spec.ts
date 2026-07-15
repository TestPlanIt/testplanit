import { Locator, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { RepositoryPage } from "../page-objects/repository/repository.page";

/**
 * Regression tests for the modal form-state-leak bug class on non-admin
 * pages. See modal-form-state-leak.spec.ts for the admin-surface suite
 * and the background on the bug.
 *
 * This suite covers approach-B modals reachable from project-scoped
 * pages rather than /admin/*:
 *
 *   - Project Repository: AddFolder, AddCase
 *   - Project Milestones: AddMilestone
 *   - Project Sessions: AddSessionModal
 *   - Project Test Runs: AddTestRunModal
 *
 * Each test creates an isolated project via the api fixture (cleaned up
 * automatically on test teardown) so no test depends on shared seed state.
 * Every modal is always cancelled — no records are actually created.
 *
 * Not covered here (and the reason why):
 *
 *   - DeleteCase / DeleteFolder / DeleteMilestone / DeleteSession /
 *     DeleteTestRun: these are approach-B, but their confirmation
 *     messages are generic ("Are you sure you want to delete this
 *     folder?") with no {name} interpolation, so there's nothing for a
 *     row-switching assertion to observe. The parent-owns-row-state
 *     pattern is already validated structurally by the admin Edit
 *     row-switch tests in the sibling spec file.
 *
 *   - EditResultModal: approach-B, but needs a test run + result row
 *     to be clicked open, which requires more fixture setup than the
 *     cost/benefit justifies. The structural guarantee (conditional
 *     mount from TestResultHistory) is equivalent to the other edit
 *     modals that are covered.
 */

// ---- Shared helpers (mirrors modal-form-state-leak.spec.ts) --------------

/**
 * Default name-field locator: the first real text input inside the dialog,
 * excluding react-select comboboxes, checkboxes, password fields, file
 * inputs, hidden fields, and search inputs. Matches shadcn's
 * `<Input {...field} />` pattern which omits the type attribute and so
 * won't match a naive `input[type="text"]` selector.
 */
function defaultNameField(dialog: Locator): Locator {
  return dialog
    .locator(
      'input:not([role="combobox"]):not([type="checkbox"]):not([type="hidden"]):not([type="password"]):not([type="file"]):not([type="search"])'
    )
    .first();
}

/**
 * Close an open dialog via its Cancel button, falling back to Escape.
 * Waits for the dialog to be gone.
 */
async function closeDialog(page: Page) {
  const cancelButton = page.getByRole("button", { name: /^cancel$/i }).last();
  if (await cancelButton.isVisible().catch(() => false)) {
    await cancelButton.click();
  } else {
    await page.keyboard.press("Escape");
  }
  await expect(
    page.locator('[role="dialog"], [role="alertdialog"]')
  ).toHaveCount(0, { timeout: 5000 });
}

// ---- Repository: AddFolder -----------------------------------------------

test("Repository AddFolder modal resets between opens", async ({
  page,
  api,
}) => {
  // Create an isolated project so this test is independent of seed state.
  const projectId = await api.createProject(
    `E2E Modal Reset Folder ${Date.now()}-${Math.random().toString(36).substring(7)}`
  );
  const repositoryPage = new RepositoryPage(page);

  const addFolderButton = page.getByTestId("add-folder-button");
  const folderNameInput = page.getByTestId("folder-name-input");
  const folderCancelButton = page.getByTestId("folder-cancel-button");

  await test.step("Open the project repository", async () => {
    await repositoryPage.goto(projectId);
    await expect(addFolderButton).toBeVisible({ timeout: 10000 });
  });

  await test.step("Fill the Add Folder name field and cancel", async () => {
    await addFolderButton.click();
    await expect(folderNameInput).toBeVisible({ timeout: 5000 });

    const uniqueName = `Leak Folder ${Date.now()}`;
    await folderNameInput.fill(uniqueName);
    await expect(folderNameInput).toHaveValue(uniqueName);

    await folderCancelButton.click();
    await expect(folderNameInput).not.toBeVisible({ timeout: 5000 });
  });

  await test.step("Reopen Add Folder and verify the name field is empty", async () => {
    await addFolderButton.click();
    await expect(folderNameInput).toBeVisible({ timeout: 5000 });
    await expect(folderNameInput).toHaveValue("");

    await folderCancelButton.click();
  });
});

// ---- Repository: AddCase -------------------------------------------------

test("Repository AddCase modal resets between opens", async ({ page, api }) => {
  // AddCase needs a folder to live in. Create a project + folder first.
  const projectId = await api.createProject(
    `E2E Modal Reset Case ${Date.now()}-${Math.random().toString(36).substring(7)}`
  );

  const repositoryPage = new RepositoryPage(page);

  const addCaseButton = page.getByTestId("add-case-button");
  const dialog = page.getByTestId("add-case-dialog");
  const caseNameInput = dialog.getByTestId("case-name-input");
  const caseCancelButton = page.getByTestId("case-cancel-button");

  await test.step("Create a folder and open the project repository", async () => {
    await api.createFolder(projectId, `Leak Case Folder ${Date.now()}`);
    await repositoryPage.goto(projectId);
    await expect(addCaseButton).toBeEnabled({ timeout: 10000 });
  });

  await test.step("Fill the Add Case name field and cancel", async () => {
    await addCaseButton.click();
    await expect(caseNameInput).toBeVisible({ timeout: 5000 });

    const uniqueName = `Leak Case ${Date.now()}`;
    await caseNameInput.fill(uniqueName);
    await expect(caseNameInput).toHaveValue(uniqueName);

    await caseCancelButton.click();
    await expect(caseNameInput).not.toBeVisible({ timeout: 5000 });
  });

  await test.step("Reopen Add Case and verify the name field is empty", async () => {
    await addCaseButton.click();
    await expect(caseNameInput).toBeVisible({ timeout: 5000 });
    await expect(caseNameInput).toHaveValue("");

    await caseCancelButton.click();
  });
});

// ---- Project Milestones: AddMilestone ------------------------------------

test("Project Milestones AddMilestone modal resets between opens", async ({
  page,
  api,
}) => {
  const projectId = await api.createProject(
    `E2E Modal Reset Milestone ${Date.now()}-${Math.random().toString(36).substring(7)}`
  );

  const addMilestoneButton = page.getByTestId("new-milestone-button");
  let dialog: Locator | undefined;

  await test.step("Open the project milestones page", async () => {
    await page.goto(`/en-US/projects/milestones/${projectId}`);
    await page.waitForLoadState("load");
    await expect(addMilestoneButton).toBeVisible({ timeout: 10000 });
  });

  await test.step("Fill the Add Milestone name field and cancel", async () => {
    await addMilestoneButton.click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const firstField = defaultNameField(dialog);
    await expect(firstField).toBeVisible({ timeout: 5000 });

    const uniqueValue = `Leak Milestone ${Date.now()}`;
    await firstField.fill(uniqueValue);
    await expect(firstField).toHaveValue(uniqueValue);

    await closeDialog(page);
  });

  await test.step("Reopen Add Milestone and verify the name field is empty", async () => {
    await addMilestoneButton.click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const firstFieldAgain = defaultNameField(dialog);
    await expect(firstFieldAgain).toBeVisible({ timeout: 5000 });
    await expect(firstFieldAgain).toHaveValue("");

    await closeDialog(page);
  });
});

// ---- Project Sessions: AddSessionModal -----------------------------------

test("Project Sessions AddSessionModal resets between opens", async ({
  page,
  api,
}) => {
  const projectId = await api.createProject(
    `E2E Modal Reset Session ${Date.now()}-${Math.random().toString(36).substring(7)}`
  );

  const addSessionButton = page.getByTestId("new-session-button");
  let dialog: Locator | undefined;

  await test.step("Open the project sessions page", async () => {
    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");
    await expect(addSessionButton).toBeVisible({ timeout: 10000 });
  });

  await test.step("Fill the Add Session name field and cancel", async () => {
    await addSessionButton.click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const firstField = defaultNameField(dialog);
    await expect(firstField).toBeVisible({ timeout: 5000 });

    const uniqueValue = `Leak Session ${Date.now()}`;
    await firstField.fill(uniqueValue);
    await expect(firstField).toHaveValue(uniqueValue);

    await closeDialog(page);
  });

  await test.step("Reopen Add Session and verify the name field is empty", async () => {
    await addSessionButton.click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const firstFieldAgain = defaultNameField(dialog);
    await expect(firstFieldAgain).toBeVisible({ timeout: 5000 });
    await expect(firstFieldAgain).toHaveValue("");

    await closeDialog(page);
  });
});

// ---- Project Test Runs: AddTestRunModal ----------------------------------

test("Project Test Runs AddTestRunModal resets between opens", async ({
  page,
  api,
}) => {
  const projectId = await api.createProject(
    `E2E Modal Reset Run ${Date.now()}-${Math.random().toString(36).substring(7)}`
  );

  const addRunButton = page.getByTestId("new-run-button");

  // AddTestRunModal uses a dedicated testid for its name field; prefer it
  // over the defaultNameField helper since the run dialog has many inputs.
  const nameInput = page.getByTestId("run-name-input");
  let dialog: Locator | undefined;

  await test.step("Open the project test runs page", async () => {
    await page.goto(`/en-US/projects/runs/${projectId}`);
    await page.waitForLoadState("load");
    await expect(addRunButton).toBeVisible({ timeout: 10000 });
  });

  await test.step("Fill the Add Test Run name field and cancel", async () => {
    await addRunButton.click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(nameInput).toBeVisible({ timeout: 5000 });

    const uniqueValue = `Leak Run ${Date.now()}`;
    await nameInput.fill(uniqueValue);
    await expect(nameInput).toHaveValue(uniqueValue);

    await closeDialog(page);
  });

  await test.step("Reopen Add Test Run and verify the name field is empty", async () => {
    await addRunButton.click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await expect(nameInput).toHaveValue("");

    await closeDialog(page);
  });
});
