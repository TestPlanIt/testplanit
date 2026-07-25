import { expect, test } from "../../fixtures";
import type { Page } from "@playwright/test";

/**
 * Session > Activity (audit history) surface
 * (components/sessions/SessionAuditLogSheet.tsx → shared ScopedAuditLogSheet).
 *
 * A slide-out sheet on the session detail page, triggered by the "Activity"
 * button (data-testid="session-history-trigger"). It lazy-mounts the audit table
 * on open, hard-scoped to entityType=Sessions / entityId=sessionId, and is
 * visible to anyone who can read the session (reaching the page already proves
 * that).
 *
 * The audit rows are materialized asynchronously by the CDC correlation worker,
 * so the row/detail assertions are best-effort (close+reopen to refetch) while
 * the sheet rendering / structure assertions are authoritative.
 *
 * Table testIdPrefix="session-audit-log-table", rowTestIdPrefix="session-audit-log-row".
 */

// Close+reopen the sheet to remount the content (refetch) until a row appears —
// the initial query can fire before the worker correlates.
async function waitForSessionRows(page: Page): Promise<boolean> {
  for (let i = 0; i < 5; i++) {
    const row = page.locator('[data-testid^="session-audit-log-row-"]').first();
    if (await row.isVisible({ timeout: 3000 }).catch(() => false)) return true;
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Activity Log" }).first().click();
    await expect(page.getByTestId("session-audit-log-table")).toBeVisible({
      timeout: 5000,
    });
  }
  return false;
}

test.describe("Session — Activity (audit history)", () => {
  test("opens the history sheet and renders the session's scoped audit trail", async ({
    api,
    page,
  }) => {
    let projectId: number;
    let sessionId: number;

    await test.step("Create a session (generates session audit rows)", async () => {
      const stamp = `${Date.now()}`;
      projectId = await api.createProject(`E2E Session History ${stamp}`);
      sessionId = await api.createSession(projectId, `Session ${stamp}`);
    });

    await test.step("Open the session detail page", async () => {
      await page.goto(`/en-US/projects/sessions/${projectId}/${sessionId}`);
      await page.waitForLoadState("networkidle");
      await expect(
        page.getByRole("button", { name: "Activity Log" }).first()
      ).toBeVisible({
        timeout: 15000,
      });
    });

    await test.step("Open the Activity (history) sheet — title, table, and headers render", async () => {
      await page.getByRole("button", { name: "Activity Log" }).first().click();
      await expect(
        page.getByRole("heading", { name: "Activity Log" })
      ).toBeVisible({
        timeout: 10000,
      });
      const table = page.getByTestId("session-audit-log-table");
      await expect(table).toBeVisible({ timeout: 10000 });
      const headers = table.locator('[role="columnheader"]');
      expect(await headers.count()).toBeGreaterThan(0);
    });

    await test.step("The session's audit rows appear and the detail modal opens (best-effort)", async () => {
      const hasRows = await waitForSessionRows(page);
      if (!hasRows) {
        console.warn(
          "[session-history] no rows materialized in time (CDC worker lag) — verifying empty render only"
        );
        await expect(page.getByTestId("session-audit-log-table")).toBeVisible();
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
