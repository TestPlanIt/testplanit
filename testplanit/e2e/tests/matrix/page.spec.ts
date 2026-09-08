import { expect, test } from "../../fixtures";
import type { APIResponse } from "@playwright/test";

/**
 * E2E spec — Matrix view.
 *
 * The standalone `/projects/{id}/matrix` page was removed when the
 * Iteration Matrix moved into the Report Builder as a preset. The
 * happy-path / popover / filter UI flows that used to live here are
 * now covered by the MatrixReportPreset + MatrixFilterPanel unit
 * tests + the broader Report Builder coverage. The CSV export route
 * is still production-API surface and is verified below.
 */
test.describe("Matrix view — happy path @matrix", () => {
  test("Export CSV download contains bare parameter columns", async ({
    api,
    request,
    baseURL,
  }) => {
    let projectId: number | undefined;
    let exportRes: APIResponse | undefined;

    // Seed a project, case, configuration, and test run for the export
    await test.step("Seed project, case, configuration, and test run", async () => {
      projectId = await api.createProject(`E2E Matrix Export ${Date.now()}`);
      const folderId = await api.createFolder(projectId, "Export");
      const caseId = await api.createTestCase(
        projectId,
        folderId,
        "Export Case"
      );
      const configId = await api.createConfiguration(
        `Matrix-Export-Cfg-${Date.now()}`,
        projectId
      );
      const testRunId = await api.createTestRun(
        projectId,
        "Matrix Export Run",
        {
          configId,
        }
      );
      await api.addTestCaseToTestRun(testRunId, caseId, { order: 0 });
    });

    // Request the matrix CSV export and verify the response headers
    await test.step("Request CSV export and verify response headers", async () => {
      // Hit the export endpoint directly — Playwright's `request` carries the
      // auth cookie from storageState, so the route's read-gate accepts.
      exportRes = await request.get(
        `${baseURL}/api/projects/${projectId!}/matrix/export`
      );
      expect(exportRes.status()).toBe(200);
      expect(exportRes.headers()["content-type"]).toBe(
        "text/csv; charset=utf-8"
      );
      const cd = exportRes.headers()["content-disposition"] ?? "";
      expect(cd).toContain("attachment");
      expect(cd).toMatch(/filename="matrix-\d+-\d{4}-\d{2}-\d{2}\.csv"/);
    });

    // Verify the CSV header row contains the bare parameter columns
    await test.step("Verify CSV header row columns", async () => {
      const body = await exportRes!.text();
      // Header row contains the static columns.
      const firstLine = body.replace(/^﻿/, "").split("\n")[0];
      expect(firstLine).toContain("Case");
      expect(firstLine).toContain("Configuration");
      expect(firstLine).toContain("Parameter row label");
      expect(firstLine).toContain("Status");
      expect(firstLine).toContain("Recorded at");
      expect(firstLine).toContain("Run name");
      expect(firstLine).toContain("Run id");
      // Lock B regression guard: NEVER `param.<name>` prefix.
      expect(firstLine).not.toMatch(/(^|,)"?param\./);
    });
  });
});
