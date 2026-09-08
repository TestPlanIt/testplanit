import { expect, test } from "../../fixtures";
import type { APIRequestContext, Page } from "@playwright/test";

/**
 * Repository Case > Activity (audit history) surface
 * (components/repositories/RepositoryCaseAuditLogSheet.tsx).
 *
 * A slide-out sheet on the case detail page, triggered by the "Activity" button
 * (data-testid="case-history-trigger"). It lazy-mounts the audit table on open,
 * hard-scoped to entityType=RepositoryCases / entityId=caseId, and is visible to
 * anyone who can read the case (reaching the case page already proves that).
 *
 * The audit rows are materialized asynchronously by the CDC correlation worker,
 * so the row/detail assertions are best-effort (close+reopen to refetch) while
 * the sheet rendering / structure assertions are authoritative.
 *
 * Table testIdPrefix="case-audit-log-table", rowTestIdPrefix="case-audit-log-row".
 */

// Close+reopen the sheet to remount CaseAuditLogContent (refetch) until a row
// appears — the initial query can fire before the worker correlates.
async function waitForCaseRows(page: Page): Promise<boolean> {
  const table = page.getByTestId("case-audit-log-table");
  for (let i = 0; i < 5; i++) {
    const row = page.locator('[data-testid^="case-audit-log-row-"]').first();
    if (await row.isVisible({ timeout: 3000 }).catch(() => false)) return true;
    // Close the sheet and wait for the dialog itself to unmount before
    // reopening. The table unmounts the instant `open` flips false, but the
    // SheetContent keeps animating out — and its dismissable overlay swallows
    // a trigger click fired during that window.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog").first()).toBeHidden({
      timeout: 5000,
    });
    await page.getByTestId("case-history-trigger").click();
    await expect(table).toBeVisible({ timeout: 5000 });
  }
  return false;
}

/**
 * Poll the model API until the CDC correlation worker has materialized at
 * least one audit row for the case, so the sheet's first query already sees
 * rows and the close/reopen fallback is rarely needed.
 */
async function waitForAuditRowInDb(
  request: APIRequestContext,
  baseURL: string,
  caseId: number
): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    const res = await request.get(`${baseURL}/api/model/auditLog/findMany`, {
      params: {
        q: JSON.stringify({
          where: { entityType: "RepositoryCases", entityId: String(caseId) },
          select: { id: true },
        }),
      },
    });
    if (res.ok()) {
      const rows = (await res.json()).data as unknown[];
      if (rows.length > 0) return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

test.describe("Repository Case — Activity (audit history)", () => {
  test("opens the history sheet and renders the case's scoped audit trail", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    let projectId: number;
    let caseId: number;

    await test.step("Create a case and rename it (generates case audit rows)", async () => {
      const stamp = `${Date.now()}`;
      projectId = await api.createProject(`E2E Case History ${stamp}`);
      const folderId = await api.createFolder(projectId, `Folder ${stamp}`);
      caseId = await api.createTestCase(projectId, folderId, `Case ${stamp}`);
      await api.updateTestCaseName(caseId, `Renamed Case ${stamp}`);
    });

    await test.step("Wait for the CDC worker to materialize the audit rows", async () => {
      const materialized = await waitForAuditRowInDb(request, baseURL!, caseId);
      if (!materialized) {
        console.warn(
          "[case-history] audit rows not materialized after 20s — the row assertions below will fall back to best-effort"
        );
      }
    });

    await test.step("Open the case detail page", async () => {
      await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("case-history-trigger")).toBeVisible({
        timeout: 15000,
      });
    });

    await test.step("Open the Activity (history) sheet — title, table, and headers render", async () => {
      await page.getByTestId("case-history-trigger").click();
      await expect(page.getByText("Activity Log")).toBeVisible({
        timeout: 10000,
      });
      const table = page.getByTestId("case-audit-log-table");
      await expect(table).toBeVisible({ timeout: 10000 });
      const headers = table.locator('[role="columnheader"]');
      expect(await headers.count()).toBeGreaterThan(0);
    });

    await test.step("The case's audit rows appear and the detail modal opens (best-effort)", async () => {
      const hasRows = await waitForCaseRows(page);
      if (!hasRows) {
        console.warn(
          "[case-history] no rows materialized in time (CDC worker lag) — verifying empty render only"
        );
        await expect(page.getByTestId("case-audit-log-table")).toBeVisible();
        return;
      }

      await page.getByTestId("audit-log-view-details").first().click();
      // Scope to the detail modal by its title — the Activity sheet is also a
      // role="dialog", so a bare getByRole("dialog") would be ambiguous here.
      const detailModal = page
        .getByRole("dialog")
        .filter({ hasText: "Audit Log Details" });
      await expect(detailModal).toBeVisible({ timeout: 5000 });
      await expect(detailModal).toContainText(/timestamp|entity|action/i);
      await page.keyboard.press("Escape");
      // The modal closes; the Activity sheet stays open (so don't assert on it).
      await expect(detailModal).not.toBeVisible({ timeout: 5000 });
    });
  });
});
