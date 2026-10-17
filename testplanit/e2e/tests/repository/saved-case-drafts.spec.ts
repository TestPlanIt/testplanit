import { expect, test } from "../../fixtures";
import { RepositoryPage } from "../../page-objects/repository/repository.page";
import {
  clickOverflowAction,
  revealOverflowAction,
} from "../../utils/action-overflow";

/**
 * Saved drafts (issue #650): a case written in Add Case, saved privately,
 * listed under My Drafts, and created from the list in a batch.
 *
 * The draft check and the draft → case mapping are unit-tested in
 * `draftCaseCreation.test.ts`. What lives here is the path those cannot
 * reach: the form's Save Draft, the list reading the draft back through the
 * database, the bulk-create request from the list, the case table picking
 * the new case up, and the draft disappearing once created.
 */

async function setupProjectAndFolder(
  api: import("../../fixtures/api.fixture").ApiHelper
): Promise<{ projectId: number; folderId: number }> {
  const projectId = await api.createProject(
    `E2E Drafts ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  );
  const folderId = await api.createFolder(projectId, `Folder ${Date.now()}`);
  return { projectId, folderId };
}

test.describe("Saved case drafts", () => {
  test("saves two drafts from Add Case and creates them together from My Drafts @smoke", async ({
    api,
    page,
  }) => {
    const repositoryPage = new RepositoryPage(page);
    const { projectId, folderId } = await setupProjectAndFolder(api);
    const stamp = Date.now();
    const names = [`Draft one ${stamp}`, `Draft two ${stamp}`];

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);

    for (const name of names) {
      await test.step(`Write "${name}" and save it as a draft`, async () => {
        await repositoryPage.openAddCaseModal();
        const dialog = page.getByTestId("add-case-dialog");
        await dialog.getByTestId("case-name-input").fill(name);
        // A named case stages at once, under its own name, with no prompt.
        await page.getByTestId("case-save-draft-button").click();
        await expect(page.getByTestId("add-case-dialog")).toHaveCount(0, {
          timeout: 10_000,
        });
        await expect(page.getByTestId("save-draft-dialog")).toHaveCount(0);
      });
    }

    await test.step("My Drafts lists both drafts and can create them", async () => {
      const action = await revealOverflowAction(
        page,
        "staged-cases-button",
        "repository-actions-menu"
      );
      await expect(action).toContainText("2", { timeout: 10_000 });
      await action.click();
      const sheet = page.getByTestId("staged-cases-sheet");
      await expect(sheet).toBeVisible();
      await expect(sheet.locator("li")).toHaveCount(2);
      await expect(sheet.getByTestId("staged-cases-create-all")).toBeEnabled({
        timeout: 15_000,
      });
      await page.getByTestId("staged-cases-select-all").click();
      await expect(
        sheet.getByTestId("staged-cases-create-selected")
      ).toHaveText("Create 2 selected");
      await page.getByTestId("staged-cases-create-selected").click();
      await expect(page.getByTestId("staged-cases-empty")).toBeVisible({
        timeout: 20_000,
      });
    });

    await test.step("The cases exist and the drafts are gone", async () => {
      await page.keyboard.press("Escape");
      for (const name of names) {
        await repositoryPage.verifyTestCaseExists(name);
      }
      const action = await revealOverflowAction(
        page,
        "staged-cases-button",
        "repository-actions-menu"
      );
      await expect(action).not.toContainText("(");
      await page.keyboard.press("Escape");
    });
  });

  test("staging a case with no name asks for one and uses it as the case name", async ({
    api,
    page,
  }) => {
    const repositoryPage = new RepositoryPage(page);
    const { projectId, folderId } = await setupProjectAndFolder(api);
    const name = `Named while staging ${Date.now()}`;

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);

    await test.step("Stage Case with an empty name prompts for one", async () => {
      await repositoryPage.openAddCaseModal();
      await page.getByTestId("case-save-draft-button").click();
      const nameInput = page.getByTestId("save-draft-name");
      await expect(nameInput).toBeVisible();
      await expect(nameInput).toHaveValue("");
      await nameInput.fill(name);
      await page.getByTestId("save-draft-submit").click();
      await expect(page.getByTestId("add-case-dialog")).toHaveCount(0, {
        timeout: 10_000,
      });
    });

    await test.step("The staged case carries that name and creates under it", async () => {
      await clickOverflowAction(
        page,
        "staged-cases-button",
        "repository-actions-menu"
      );
      const sheet = page.getByTestId("staged-cases-sheet");
      const item = sheet.locator("li").filter({ hasText: name });
      await expect(item).toBeVisible();
      await expect(sheet.getByTestId("staged-cases-create-all")).toBeEnabled({
        timeout: 15_000,
      });
      await page.getByTestId("staged-cases-create-all").click();
      await expect(page.getByTestId("staged-cases-empty")).toBeVisible({
        timeout: 20_000,
      });
      await page.keyboard.press("Escape");
      await repositoryPage.verifyTestCaseExists(name);
    });
  });
});
