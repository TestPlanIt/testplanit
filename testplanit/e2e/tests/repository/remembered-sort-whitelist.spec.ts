import { expect, test } from "../../fixtures";

/**
 * Remembered-sort whitelist (Cases.tsx REPOSITORY_CASE_SORTABLE_SCALARS).
 *
 * The per-project sort is remembered in localStorage under a key SHARED by the
 * repository view and the run view, so it can hold column ids the repository
 * findMany cannot order by — run-only columns (status, assignedTo) and
 * UI-computed ones (latestResults, forecast, numeric custom-field ids). Before
 * the whitelist, one such id reached orderBy, the server rejected the whole
 * query, and the table rendered empty. These tests seed the poisoned key
 * directly and assert the table still renders rows via the fallback order.
 */
test.describe("Repository remembered-sort whitelist", () => {
  // "status" is a run-view-only column; "4711" simulates a numeric
  // custom-field id. Neither exists on RepositoryCases, so both must take the
  // whitelist fallback. (latestResults is deliberately NOT in this list — it
  // is a real repository sort with its own id-resolution path.)
  for (const poisoned of ["status", "4711"]) {
    test(`a remembered '${poisoned}' sort falls back instead of emptying the table`, async ({
      api,
      page,
    }) => {
      const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      let projectId: number | undefined;
      let folderId: number | undefined;
      let caseId: number | undefined;

      await test.step("Seed a project with one case", async () => {
        projectId = await api.createProject(`E2E SortWL ${poisoned} ${ts}`);
        folderId = await api.createFolder(projectId, `SortWL Folder ${ts}`);
        caseId = await api.createTestCase(
          projectId,
          folderId,
          `SortWL Case ${ts}`
        );
      });

      await test.step("Poison the remembered sort before the app loads", async () => {
        await page.addInitScript(
          ([key, value]) => {
            window.localStorage.setItem(key, value);
          },
          [
            `testplanit:columnSort:repository-cases:${projectId}`,
            JSON.stringify({ column: poisoned, direction: "desc" }),
          ]
        );
      });

      await test.step("Open the folder — rows must render, not an empty table", async () => {
        await page.goto(`/en-US/projects/repository/${projectId}`);
        const folderNode = page.getByTestId(`folder-node-${folderId}`).first();
        const row = page.locator(`[data-testid="case-row-${caseId}"]`).first();

        // Two stuck states need clearing between attempts: the page's async
        // folder auto-select can override an explicit click that lands first,
        // and a rows query that errors once renders as a silently-empty table
        // that never refetches for an unchanged key — only a reload recovers
        // that, so reload whenever an attempt comes up empty.
        await expect(async () => {
          try {
            await expect(folderNode).toBeVisible({ timeout: 10000 });
            await folderNode.click();
            await expect(row).toBeVisible({ timeout: 5000 });
          } catch (error) {
            await page.reload();
            throw error;
          }
        }).toPass({ timeout: 45_000 });
      });
    });
  }
});
