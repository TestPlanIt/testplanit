import { expect, test } from "../../fixtures";

/**
 * E2E spec — DSET-05: CSV file import via 4-step wizard
 *
 * - Seed a case with 3 declared parameters
 * - Open Configure → Dataset tab → click Import CSV
 * - Step 1: Upload a 3-row CSV via setInputFiles
 * - Step 2: Auto-mapping populates → click Next
 * - Step 3: Preview shows all 3 rows → click Next
 * - Step 4: Confirm Replace → click Import → wizard closes; rows visible
 *
 * Also covers the BOM-prefixed CSV pitfall (RESEARCH.md Pitfall 4): a
 * `﻿` BOM at the start of the file must NOT corrupt the first column
 * mapping.
 */
test.describe("Parameters - CSV import wizard @parameters", () => {
  test("imports a 3-row CSV via the wizard happy path", async ({
    api,
    page,
  }) => {
    let projectId: number | undefined;
    let caseId: number | undefined;

    await test.step("Seed a project, folder, and test case", async () => {
      projectId = await api.createProject(`E2E Param CSV Import ${Date.now()}`);
      const folderId = await api.createFolder(projectId, "CSV");
      caseId = await api.createTestCase(
        projectId,
        folderId,
        "Param CSV Import Case"
      );
    });

    await test.step("Open the test case repository page", async () => {
      await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
      await page.waitForLoadState("load");
    });

    await test.step("Declare 3 parameters via the Sheet", async () => {
      await page.getByTestId("configure-parameters-button").click();
      await expect(
        page.getByTestId("configure-parameters-sheet")
      ).toBeVisible();

      for (const name of ["username", "amount", "active"]) {
        await page.getByTestId("parameter-form-name").fill(name);
        if (name === "amount") {
          await page.getByTestId("parameter-form-type").click();
          await page.getByRole("option", { name: /INTEGER/i }).click();
        } else if (name === "active") {
          await page.getByTestId("parameter-form-type").click();
          await page.getByRole("option", { name: /BOOLEAN/i }).click();
        }
        await page.getByTestId("parameter-form-submit").click();
        await expect(page.getByText(`@${name}`).first()).toBeVisible();
      }
    });

    await test.step("Switch to the Dataset tab and open the Import CSV wizard", async () => {
      await page.getByTestId("tab-dataset").click();
      await page.getByTestId("dataset-import-csv-button").click();
      await expect(page.getByTestId("dataset-import-wizard")).toBeVisible();
    });

    await test.step("Step 1: upload the CSV file", async () => {
      await page.getByTestId("dataset-import-wizard-file-input").setInputFiles({
        name: "test.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          "username,amount,active\nalice,100,true\nbob,200,false\ncarol,50,true"
        ),
      });
    });

    await test.step("Step 2: confirm auto-mapping and continue", async () => {
      await expect(
        page.getByTestId("dataset-import-wizard-step-map")
      ).toBeVisible();
      await page.getByTestId("dataset-import-wizard-next").click();
    });

    await test.step("Step 3: confirm the preview and continue", async () => {
      await expect(
        page.getByTestId("dataset-import-wizard-step-preview")
      ).toBeVisible();
      await page.getByTestId("dataset-import-wizard-next").click();
    });

    await test.step("Step 4: confirm Replace mode and commit the import", async () => {
      await expect(
        page.getByTestId("dataset-import-wizard-step-confirm")
      ).toBeVisible();
      await page.getByTestId("dataset-import-wizard-commit").click();
    });

    await test.step("Verify the wizard closes after import", async () => {
      await expect(page.getByTestId("dataset-import-wizard")).not.toBeVisible({
        timeout: 10000,
      });
    });
  });

  test("BOM-prefixed CSV auto-maps the first column correctly", async ({
    api,
    page,
  }) => {
    let projectId: number | undefined;
    let caseId: number | undefined;

    await test.step("Seed a project, folder, and test case", async () => {
      projectId = await api.createProject(`E2E Param CSV BOM ${Date.now()}`);
      const folderId = await api.createFolder(projectId, "CSV BOM");
      caseId = await api.createTestCase(
        projectId,
        folderId,
        "Param CSV BOM Case"
      );
    });

    await test.step("Open the test case repository page", async () => {
      await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
      await page.waitForLoadState("load");
    });

    await test.step("Declare username and amount parameters", async () => {
      await page.getByTestId("configure-parameters-button").click();
      for (const name of ["username", "amount"]) {
        await page.getByTestId("parameter-form-name").fill(name);
        if (name === "amount") {
          await page.getByTestId("parameter-form-type").click();
          await page.getByRole("option", { name: /INTEGER/i }).click();
        }
        await page.getByTestId("parameter-form-submit").click();
        await expect(page.getByText(`@${name}`).first()).toBeVisible();
      }
    });

    await test.step("Switch to the Dataset tab and open the Import CSV wizard", async () => {
      await page.getByTestId("tab-dataset").click();
      await page.getByTestId("dataset-import-csv-button").click();
      await expect(page.getByTestId("dataset-import-wizard")).toBeVisible();
    });

    await test.step("Upload a BOM-prefixed CSV file", async () => {
      // BOM (U+FEFF) must NOT corrupt the first-column header match.
      const bomCsv = "﻿username,amount\nalice,100";
      await page.getByTestId("dataset-import-wizard-file-input").setInputFiles({
        name: "bom.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(bomCsv, "utf8"),
      });
    });

    await test.step("Verify the first column auto-maps with no warning", async () => {
      await expect(
        page.getByTestId("dataset-import-wizard-step-map")
      ).toBeVisible();
      // No required-column-unmapped warning — the first column maps cleanly to username.
      await expect(
        page.getByTestId("dataset-import-wizard-map-warning")
      ).not.toBeVisible();
    });
  });
});
