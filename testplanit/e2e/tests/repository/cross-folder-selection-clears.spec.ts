import { expect, test } from "../../fixtures/index";
import { RepositoryPage } from "../../page-objects/repository/repository.page";

/**
 * Repository case selection is scoped to the folder currently being viewed.
 * Switching folders must clear the bulk-edit selection so a bulk action can
 * never silently span cases the user can no longer see.
 *
 * Reproduces the reported inconsistency: "Select All" in one folder used to
 * leak into the next folder (count kept accumulating), while manually picking a
 * couple of cases did not. Both paths now behave the same — selection clears on
 * folder switch.
 *
 * The folder switch here goes through the TreeView (RepositoryPage.selectFolder),
 * which is a client-side navigation that keeps the Cases component mounted — the
 * exact path the in-component clear effect guards. A full page reload would
 * clear selection trivially and would not exercise the fix.
 *
 * Run protocol (CLAUDE.md mandatory):
 *   cd testplanit
 *   NODE_OPTIONS='--max-old-space-size=16382' pnpm build
 *   E2E_PROD=on pnpm test:e2e e2e/tests/repository/cross-folder-selection-clears.spec.ts
 */

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

let projectId: number;
let rootFolderId: number;
let folderAId: number;
let folderBId: number;
const folderACaseIds: number[] = [];
const folderBCaseIds: number[] = [];

test.describe("Repository cross-folder selection clears on folder switch", () => {
  test.afterAll(async ({ request, baseURL }) => {
    const ops: Array<Promise<unknown>> = [];
    const softDelete = (model: string, id: number) =>
      request
        .patch(`${baseURL}/api/model/${model}/update`, {
          data: { where: { id }, data: { isDeleted: true } },
        })
        .catch(() => {});

    for (const id of [...folderACaseIds, ...folderBCaseIds]) {
      if (id) ops.push(softDelete("repositoryCases", id));
    }
    for (const id of [folderAId, folderBId]) {
      if (id) ops.push(softDelete("repositoryFolders", id));
    }
    if (projectId) ops.push(softDelete("projects", projectId));
    await Promise.all(ops);
  });

  test("setup: project + two sibling folders + two cases in each", async ({
    api,
  }) => {
    const ts = Date.now();

    projectId = await api.createProject(`E2E CrossFolderSel ${ts}`);
    rootFolderId = await api.getRootFolderId(projectId);
    folderAId = await api.createFolder(projectId, `Folder A ${ts}`, rootFolderId);
    folderBId = await api.createFolder(projectId, `Folder B ${ts}`, rootFolderId);

    folderACaseIds.push(
      await api.createTestCase(projectId, folderAId, `A1 ${ts}`)
    );
    folderACaseIds.push(
      await api.createTestCase(projectId, folderAId, `A2 ${ts}`)
    );
    folderBCaseIds.push(
      await api.createTestCase(projectId, folderBId, `B1 ${ts}`)
    );
    folderBCaseIds.push(
      await api.createTestCase(projectId, folderBId, `B2 ${ts}`)
    );

    expect(projectId).toBeGreaterThan(0);
    expect(folderAId).toBeGreaterThan(0);
    expect(folderBId).toBeGreaterThan(0);
    expect(folderACaseIds.every((id) => id > 0)).toBe(true);
    expect(folderBCaseIds.every((id) => id > 0)).toBe(true);

    // Opt out of the api fixture's per-test auto-cleanup so the resources
    // outlive this setup test and into the scenario test below.
    api.untrackProject(projectId);
    folderACaseIds.forEach((id) => api.untrackCase(id));
    folderBCaseIds.forEach((id) => api.untrackCase(id));
  });

  test("Select All in Folder A does not leak into Folder B", async ({
    page,
  }) => {
    const repo = new RepositoryPage(page);
    const bulkEditButton = page.getByTestId("bulk-edit-button");
    const selectAll = page.getByTestId("select-all-cases-checkbox");

    await test.step("Open the repository and reveal the folder tree", async () => {
      await repo.goto(projectId);
      // Selecting the root loads the tree and reveals its child folders.
      await repo.selectFolder(rootFolderId);
    });

    await test.step("In Folder A, Select All -> 2 cases selected", async () => {
      await repo.selectFolder(folderAId);
      await page
        .locator(`[data-testid="case-row-${folderACaseIds[0]}"]`)
        .first()
        .waitFor({ state: "visible", timeout: 15_000 });

      await selectAll.click();
      await expect(bulkEditButton).toBeVisible();
      await expect(bulkEditButton).toContainText("(2)");
    });

    await test.step("Switch to Folder B -> selection is cleared", async () => {
      await repo.selectFolder(folderBId);
      await page
        .locator(`[data-testid="case-row-${folderBCaseIds[0]}"]`)
        .first()
        .waitFor({ state: "visible", timeout: 15_000 });

      // Folder A's selection must not carry over to Folder B.
      await expect(bulkEditButton).toHaveCount(0);
    });

    await test.step("Select All in Folder B -> only Folder B's 2 cases", async () => {
      await selectAll.click();
      await expect(bulkEditButton).toBeVisible();
      // 2, not 4 — proves the previous folder's selection did not persist.
      await expect(bulkEditButton).toContainText("(2)");
    });
  });
});
