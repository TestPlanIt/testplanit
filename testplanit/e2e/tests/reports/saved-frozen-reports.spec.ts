import type { Page } from "@playwright/test";
import { expect, test } from "../../fixtures";

/**
 * Saved Reports and frozen (captured) report data.
 *
 * - Saving a live report and reopening, renaming, and deleting it
 * - A frozen report keeps its numbers after the data changes
 * - Frozen share links in Public and Password Protected modes
 */
test.describe("Saved and frozen reports", () => {
  const REPORT_PARAMS = new URLSearchParams({
    tab: "builder",
    reportType: "repository-stats",
    dimensions: "testCase",
    metrics: "testCaseCount",
  });

  async function runRepositoryStatsReport(page: Page, projectId: number) {
    await page.goto(
      `/en-US/projects/reports/${projectId}?${REPORT_PARAMS.toString()}`
    );
    await page.waitForLoadState("networkidle");
    const runButton = page.getByTestId("run-report-button");
    await expect(runButton).toBeEnabled({ timeout: 10000 });
    await runButton.click();
    await expect(page.getByTestId("report-results-summary")).toBeVisible({
      timeout: 15000,
    });
  }

  async function saveReport(
    page: Page,
    name: string,
    mode: "live" | "frozen",
    description = ""
  ) {
    await page.getByTestId("save-report-button").click();
    const dialog = page.getByTestId("save-report-dialog");
    await expect(dialog).toBeVisible();
    await page.getByTestId("save-report-name-input").fill(name);
    if (description) {
      await page.getByTestId("save-report-description-input").fill(description);
    }
    await page.getByTestId(`report-data-mode-${mode}`).click();
    await page.getByTestId("save-report-submit").click();
    await expect(dialog).toBeHidden({ timeout: 15000 });
  }

  /** The saved report's share link, read as the signed-in owner. */
  async function findSavedReport(page: Page, title: string) {
    return page.evaluate(async (reportTitle) => {
      const q = encodeURIComponent(
        JSON.stringify({
          where: {
            title: reportTitle,
            entityType: "SAVED_REPORT",
            isDeleted: false,
          },
          select: { id: true, shareKey: true },
        })
      );
      const response = await fetch(`/api/model/shareLink/findFirst?q=${q}`);
      const body = await response.json();
      return body.data as { id: string; shareKey: string } | null;
    }, title);
  }

  function savedReportItem(page: Page, name: string) {
    return page.getByTestId("saved-report-item").filter({ hasText: name });
  }

  test("save a live report, reopen, rename, and delete it", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const name = `Live saved report ${ts}`;
    const renamed = `${name} (renamed)`;
    const projectId = await api.createProject(`Saved Report Live ${ts}`);
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Case A ${ts}`);

    await test.step("Save the report as live", async () => {
      await runRepositoryStatsReport(page, projectId);
      await saveReport(page, name, "live", "Weekly check");
      const saved = await findSavedReport(page, name);
      expect(saved).toBeTruthy();
      api.trackShareLink(saved!.id);
    });

    await test.step("Reopen it from Saved Reports", async () => {
      await page.goto(`/en-US/projects/reports/${projectId}`);
      await page.getByTestId("saved-reports-trigger").click();
      await savedReportItem(page, name).click();
      await page.waitForURL(/savedReport=/);
      const context = page.getByTestId("saved-report-context");
      await expect(context).toContainText(name);
      await expect(context).toContainText("Weekly check");
      await expect(page.getByTestId("report-results-summary")).toBeVisible({
        timeout: 15000,
      });
      expect(page.url()).toContain("reportType=repository-stats");
    });

    await test.step("Rename it", async () => {
      await page.getByTestId("saved-reports-trigger").click();
      await page.getByTestId("saved-report-rename").first().click();
      await page.getByTestId("saved-report-rename-input").fill(renamed);
      await page.getByTestId("saved-report-rename-submit").click();
      await page.getByTestId("saved-reports-trigger").click();
      await expect(savedReportItem(page, renamed)).toBeVisible();
      await page.keyboard.press("Escape");
    });

    await test.step("Delete it", async () => {
      await page.getByTestId("saved-reports-trigger").click();
      await page.getByTestId("saved-report-delete").first().click();
      await page.getByTestId("saved-report-delete-confirm").click();
      await expect(page.getByTestId("saved-report-context")).toBeHidden();
      await page.getByTestId("saved-reports-trigger").click();
      await expect(page.getByTestId("saved-reports-empty")).toBeVisible();
    });
  });

  test("a frozen report keeps its numbers after the data changes", async ({
    api,
    page,
    context,
  }) => {
    const ts = Date.now();
    const name = `Frozen saved report ${ts}`;
    const projectId = await api.createProject(`Saved Report Frozen ${ts}`);
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Case A ${ts}`);
    await api.createTestCase(projectId, rootFolderId, `Case B ${ts}`);

    let shareKey = "";

    await test.step("Freeze the report with two cases", async () => {
      await runRepositoryStatsReport(page, projectId);
      await expect(page.getByTestId("report-results-summary")).toContainText(
        "2"
      );
      await saveReport(page, name, "frozen");
      const saved = await findSavedReport(page, name);
      expect(saved).toBeTruthy();
      api.trackShareLink(saved!.id);
      shareKey = saved!.shareKey;
    });

    await test.step("Add a third case", async () => {
      await api.createTestCase(projectId, rootFolderId, `Case C ${ts}`);
    });

    await test.step("The frozen report still shows two rows", async () => {
      await page.goto(`/en-US/projects/reports/${projectId}`);
      await page.getByTestId("saved-reports-trigger").click();
      const [frozenPage] = await Promise.all([
        context.waitForEvent("page"),
        savedReportItem(page, name).click(),
      ]);
      await frozenPage.waitForLoadState("networkidle");
      expect(frozenPage.url()).toContain(`/share/${shareKey}`);
      await expect(frozenPage.getByTestId("frozen-report-banner")).toBeVisible({
        timeout: 15000,
      });
      await expect(
        frozenPage.getByTestId("report-results-summary")
      ).toContainText("2 of 2");
      await expect(frozenPage.getByText(`Case C ${ts}`)).toHaveCount(0);
      await frozenPage.close();
    });

    await test.step("The live report shows three rows", async () => {
      await runRepositoryStatsReport(page, projectId);
      await expect(page.getByTestId("report-results-summary")).toContainText(
        "3 of 3"
      );
    });
  });

  test("a frozen public share shows the stored data to anyone", async ({
    api,
    page,
    context,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`Frozen Public Share ${ts}`);
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Case A ${ts}`);

    await runRepositoryStatsReport(page, projectId);

    await page.getByTestId("share-report-button").click();
    await page.getByTestId("report-data-mode-frozen").click();
    await page.getByTestId("share-mode-public").click();
    await page.getByTestId("share-title-input").fill(`Frozen public ${ts}`);
    await page.getByTestId("share-create-button").click();

    const shareUrlInput = page.getByTestId("share-url-input");
    await expect(shareUrlInput).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("share-created-data-mode")).toBeVisible();
    const shareUrl = await shareUrlInput.inputValue();
    const shareKey = shareUrl.split("/share/")[1];
    const shareLink = await api.getShareLinkByKey(shareKey);
    expect(shareLink?.mode).toBe("PUBLIC");
    api.trackShareLink(shareLink!.id);

    await test.step("My Shares marks the link as frozen", async () => {
      await page.getByRole("button", { name: /done/i }).click();
      await page.getByTestId("share-tab-list").click();
      const row = page.locator("tr").filter({ hasText: `Frozen public ${ts}` });
      await expect(row.getByTestId("share-data-frozen")).toBeVisible();
      await page.keyboard.press("Escape");
    });

    await test.step("An anonymous viewer sees the frozen report", async () => {
      const anonymous = await context.browser()!.newContext({
        storageState: { cookies: [], origins: [] },
      });
      const viewer = await anonymous.newPage();
      try {
        await viewer.goto(shareUrl);
        await expect(viewer.getByTestId("frozen-report-banner")).toBeVisible({
          timeout: 15000,
        });
        await expect(viewer.getByTestId("shared-report-viewer")).toContainText(
          `Case A ${ts}`
        );
      } finally {
        await anonymous.close();
      }
    });
  });

  test("a frozen password share needs the password, not the share key", async ({
    api,
    page,
    context,
  }) => {
    const ts = Date.now();
    const password = `FrozenPass123-${ts}`;
    const projectId = await api.createProject(`Frozen Password Share ${ts}`);
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Case A ${ts}`);

    await runRepositoryStatsReport(page, projectId);

    await page.getByTestId("share-report-button").click();
    await page.getByTestId("report-data-mode-frozen").click();
    await page.getByTestId("share-mode-password").click();
    await page.getByTestId("share-password-input").fill(password);
    await page.getByTestId("share-confirm-password-input").fill(password);
    await page.getByTestId("share-title-input").fill(`Frozen password ${ts}`);
    await page.getByTestId("share-create-button").click();

    const shareUrlInput = page.getByTestId("share-url-input");
    await expect(shareUrlInput).toBeVisible({ timeout: 15000 });
    const shareUrl = await shareUrlInput.inputValue();
    const shareKey = shareUrl.split("/share/")[1];
    const shareLink = await api.getShareLinkByKey(shareKey);
    api.trackShareLink(shareLink!.id);

    await test.step("The share key is not accepted as a token", async () => {
      const anonymous = await context.browser()!.newContext({
        storageState: { cookies: [], origins: [] },
      });
      const origin = new URL(shareUrl).origin;
      try {
        const noToken = await anonymous.request.get(
          `${origin}/api/share/${shareKey}/report`
        );
        expect(noToken.status()).toBe(401);
        const keyAsToken = await anonymous.request.get(
          `${origin}/api/share/${shareKey}/report?token=${shareKey}`
        );
        expect(keyAsToken.status()).toBe(401);
      } finally {
        await anonymous.close();
      }
    });

    await test.step("The password unlocks the frozen report", async () => {
      const anonymous = await context.browser()!.newContext({
        storageState: { cookies: [], origins: [] },
      });
      const viewer = await anonymous.newPage();
      try {
        await viewer.goto(shareUrl);
        await viewer.getByPlaceholder(/password/i).fill(password);
        await viewer.getByRole("button", { name: /submit/i }).click();
        await expect(viewer.getByTestId("frozen-report-banner")).toBeVisible({
          timeout: 15000,
        });
        await expect(viewer.getByTestId("shared-report-viewer")).toContainText(
          `Case A ${ts}`
        );
      } finally {
        await anonymous.close();
      }
    });
  });
});
