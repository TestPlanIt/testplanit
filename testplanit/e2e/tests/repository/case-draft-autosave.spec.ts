import { expect, test } from "../../fixtures";
import { RepositoryPage } from "../../page-objects/repository/repository.page";

/**
 * Draft auto-save for the test case editors (issue #601).
 *
 * Deliberately only two tests. The debounce, retry, digest, restore-selection
 * and cache-eviction logic all have direct unit coverage in
 * `hooks/useCaseDraft.test.tsx`, and re-asserting them through a browser would
 * buy nothing but runtime and flake surface. What lives here is the pair of
 * failures a unit test cannot reach:
 *
 *   1. A child that owns its editing state and seeds from a prop at mount
 *      (TipTapEditor's document, StepsForm's field array) cannot be driven by
 *      the parent's `form.reset()`. That shipped broken — the form value was
 *      correct while the editor rendered the old document, so the screen lied
 *      about what had been recovered. Catching it in jsdom would mean rendering
 *      the real host, the real field renderer and ProseMirror, whose
 *      contenteditable barely works there.
 *
 *   2. The dialog unmounts on create and remounts on reopen. The eviction of
 *      the cached restore query is unit-tested, but that unmount/remount
 *      lifecycle across a real React Query cache is not something jsdom
 *      reproduces faithfully — and it is exactly where the "it offered back a
 *      case I already saved" bug lived.
 */

const DRAFT_STATUS = "case-draft-status";
const RESTORE_DIALOG = "restore-case-draft-dialog";
const RESTORE_BUTTON = "restore-case-draft-restore";
const NAME_INPUT = "case-name-input";

async function setupProjectAndFolder(
  api: import("../../fixtures/api.fixture").ApiHelper
): Promise<{ projectId: number; folderId: number }> {
  const projectId = await api.createProject(
    `E2E Draft ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  );
  const folderId = await api.createFolder(projectId, `Folder ${Date.now()}`);
  return { projectId, folderId };
}

test.describe("Case draft auto-save", () => {
  test("creating the case clears its draft, so reopening starts clean @smoke", async ({
    api,
    page,
  }) => {
    const repositoryPage = new RepositoryPage(page);
    const { projectId, folderId } = await setupProjectAndFolder(api);
    const caseName = `Promoted draft ${Date.now()}`;

    await test.step("Open Add Case — it must not claim unsaved work on open", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);
      await repositoryPage.openAddCaseModal();
      await expect(page.getByTestId(DRAFT_STATUS)).toHaveCount(0);
      await expect(page.getByTestId(RESTORE_DIALOG)).toHaveCount(0);
    });

    await test.step("Type and let it auto-save", async () => {
      await page.getByTestId(NAME_INPUT).fill(caseName);
      await expect(page.getByTestId(DRAFT_STATUS)).toHaveAttribute(
        "data-status",
        "saved",
        { timeout: 15000 }
      );
    });

    await test.step("Create the case", async () => {
      await page.getByTestId("case-submit-button").click();
      await expect(page.getByTestId("add-case-dialog")).toHaveCount(0, {
        timeout: 20000,
      });
    });

    await test.step("Reopening offers nothing and starts empty", async () => {
      await repositoryPage.openAddCaseModal();
      await expect(page.getByTestId(RESTORE_DIALOG)).toHaveCount(0);
      await expect(page.getByTestId(NAME_INPUT)).toHaveValue("");
      await expect(page.getByTestId(DRAFT_STATUS)).toHaveCount(0);
    });
  });

  test("restoring a draft brings back rich text, not just the plain fields", async ({
    api,
    page,
  }) => {
    const { projectId, folderId } = await setupProjectAndFolder(api);
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `Rich text draft ${Date.now()}`
    );
    const newName = `Renamed ${Date.now()}`;
    const richText = `Recovered rich text ${Date.now()}`;

    await test.step("Edit both a plain field and a rich-text field", async () => {
      await page.goto(
        `/en-US/projects/repository/${projectId}/${caseId}?edit=true`
      );
      await page.locator('textarea[name="name"]').fill(newName);

      const editor = page
        .locator('.ProseMirror[contenteditable="true"]')
        .first();
      await editor.click();
      await editor.pressSequentially(richText);

      await expect(page.getByTestId(DRAFT_STATUS)).toHaveAttribute(
        "data-status",
        "saved",
        { timeout: 15000 }
      );
    });

    await test.step("Reload, as though the browser had crashed", async () => {
      await page.reload();
      await expect(page.getByTestId(RESTORE_DIALOG)).toBeVisible({
        timeout: 15000,
      });
    });

    await test.step("Restoring returns BOTH fields", async () => {
      await page.getByTestId(RESTORE_BUTTON).click();
      await expect(page.locator('textarea[name="name"]')).toHaveValue(newName);
      await expect(
        page.locator('.ProseMirror[contenteditable="true"]').first()
      ).toContainText(richText);
    });
  });
});
