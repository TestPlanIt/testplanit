import type { Page } from "@playwright/test";
import { expect, test } from "../../fixtures";

/**
 * Relative date ranges on saved and shared live reports.
 *
 * - A preset picked for a run travels with the saved report and is restored
 *   on reopen, with the picker naming it
 * - A live share keeps the range relative and says so; a share made with
 *   Fixed dates stores only the dates
 */
test.describe("Relative date ranges", () => {
  function reportUrl(projectId: number, extra: Record<string, string> = {}) {
    const params = new URLSearchParams({
      tab: "builder",
      reportType: "repository-stats",
      dimensions: "testCase",
      metrics: "testCaseCount",
      ...extra,
    });
    return `/en-US/projects/reports/${projectId}?${params.toString()}`;
  }

  async function runReport(page: Page) {
    const runButton = page.getByTestId("run-report-button");
    await expect(runButton).toBeEnabled({ timeout: 10000 });
    await runButton.click();
    await expect(page.getByTestId("report-results-summary")).toBeVisible({
      timeout: 15000,
    });
  }

  async function openShareDialog(page: Page) {
    await page.getByTestId("share-report-button").click();
    await expect(page.getByTestId("share-mode-public")).toBeVisible();
  }

  /** A share link's id and stored config, read as the signed-in owner. */
  async function readShare(page: Page, shareKey: string) {
    return page.evaluate(async (key) => {
      const q = encodeURIComponent(
        JSON.stringify({
          where: { shareKey: key },
          select: { id: true, entityConfig: true },
        })
      );
      const response = await fetch(`/api/model/shareLink/findFirst?q=${q}`);
      return (await response.json()).data as {
        id: string;
        entityConfig: Record<string, unknown>;
      };
    }, shareKey);
  }

  async function createPublicShare(page: Page, title: string) {
    await page.getByTestId("share-mode-public").click();
    await page.getByTestId("share-title-input").fill(title);
    await page.getByTestId("share-create-button").click();
    const shareUrlInput = page.getByTestId("share-url-input");
    await expect(shareUrlInput).toBeVisible({ timeout: 15000 });
    const shareUrl = await shareUrlInput.inputValue();
    await page.getByRole("button", { name: /done/i }).click();
    await page.keyboard.press("Escape");
    return shareUrl;
  }

  test("a preset is saved with the report and restored on reopen", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const name = `Relative saved report ${ts}`;
    const projectId = await api.createProject(`Relative Dates Saved ${ts}`);
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Case A ${ts}`);

    await test.step("Open the report on Last 7 days and run it", async () => {
      await page.goto(
        reportUrl(projectId, {
          dateRangePreset: "last7Days",
          dateRangeTimezone: "Etc/UTC",
        })
      );
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("date-range-button")).toContainText(
        "Last 7 days"
      );
      await expect(page.getByTestId("date-range-relative-hint")).toBeVisible();
      await runReport(page);
    });

    await test.step("Save it live with the relative range", async () => {
      await page.getByTestId("save-report-button").click();
      const dialog = page.getByTestId("save-report-dialog");
      await expect(dialog).toBeVisible();
      await page.getByTestId("save-report-name-input").fill(name);
      await page.getByTestId("report-data-mode-live").click();
      await expect(
        page.getByTestId("report-date-range-mode-relative")
      ).toBeVisible();
      await page.getByTestId("save-report-submit").click();
      await expect(dialog).toBeHidden({ timeout: 15000 });
      const saved = await page.evaluate(async (title) => {
        const q = encodeURIComponent(
          JSON.stringify({
            where: { title, entityType: "SAVED_REPORT", isDeleted: false },
            select: { id: true, entityConfig: true },
          })
        );
        const response = await fetch(`/api/model/shareLink/findFirst?q=${q}`);
        return (await response.json()).data as {
          id: string;
          entityConfig: Record<string, unknown>;
        } | null;
      }, name);
      expect(saved).toBeTruthy();
      api.trackShareLink(saved!.id);
      expect(saved!.entityConfig.dateRangePreset).toBe("last7Days");
      expect(saved!.entityConfig.dateRangeTimezone).toBe("Etc/UTC");
    });

    await test.step("Reopening restores the preset", async () => {
      await page.goto(`/en-US/projects/reports/${projectId}`);
      await page.getByTestId("saved-reports-trigger").click();
      await page
        .getByTestId("saved-report-item")
        .filter({ hasText: name })
        .click();
      await page.waitForURL(/dateRangePreset=last7Days/);
      await expect(page.getByTestId("date-range-button")).toContainText(
        "Last 7 days"
      );
      await expect(page.getByTestId("report-results-summary")).toBeVisible({
        timeout: 15000,
      });
    });
  });

  test("a live share keeps the range relative unless Fixed dates is chosen", async ({
    api,
    page,
    context,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`Relative Dates Share ${ts}`);
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Case A ${ts}`);

    await page.goto(
      reportUrl(projectId, {
        dateRangePreset: "last7Days",
        dateRangeTimezone: "Etc/UTC",
      })
    );
    await page.waitForLoadState("networkidle");
    await runReport(page);

    let relativeUrl = "";
    await test.step("Share with the relative range", async () => {
      await openShareDialog(page);
      await page.getByTestId("report-data-mode-live").click();
      await page.getByTestId("report-date-range-mode-relative").click();
      relativeUrl = await createPublicShare(page, `Relative share ${ts}`);
      const link = await readShare(page, relativeUrl.split("/share/")[1]);
      api.trackShareLink(link.id);
      expect(link.entityConfig.dateRangePreset).toBe("last7Days");
    });

    let fixedUrl = "";
    await test.step("Share with fixed dates", async () => {
      // A fresh page: the dialog keeps its created-link view until reopened
      // after a reload.
      await page.goto(
        reportUrl(projectId, {
          dateRangePreset: "last7Days",
          dateRangeTimezone: "Etc/UTC",
        })
      );
      await page.waitForLoadState("networkidle");
      await runReport(page);
      await openShareDialog(page);
      await page.getByTestId("report-data-mode-live").click();
      await page.getByTestId("report-date-range-mode-fixed").click();
      fixedUrl = await createPublicShare(page, `Fixed share ${ts}`);
      const link = await readShare(page, fixedUrl.split("/share/")[1]);
      api.trackShareLink(link.id);
      const config = link.entityConfig;
      expect(config.dateRangePreset).toBeUndefined();
      expect(typeof config.startDate).toBe("string");
    });

    await test.step("The viewer names the relative range but not the fixed one", async () => {
      const anonymous = await context.browser()!.newContext({
        storageState: { cookies: [], origins: [] },
      });
      const viewer = await anonymous.newPage();
      try {
        await viewer.goto(relativeUrl);
        const relativeRange = viewer.getByTestId("shared-report-date-range");
        await expect(relativeRange).toBeVisible({ timeout: 15000 });
        await expect(relativeRange).toContainText("Last 7 days");
        await expect(relativeRange).toContainText("Currently reporting");

        await viewer.goto(fixedUrl);
        const fixedRange = viewer.getByTestId("shared-report-date-range");
        await expect(fixedRange).toBeVisible({ timeout: 15000 });
        await expect(fixedRange).toContainText("Date range");
        await expect(fixedRange).not.toContainText("Currently reporting");
      } finally {
        await anonymous.close();
      }
    });
  });
});
