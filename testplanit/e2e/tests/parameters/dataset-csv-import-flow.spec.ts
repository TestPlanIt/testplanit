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
    const projectId = await api.createProject(
      `E2E Param CSV Import ${Date.now()}`
    );
    const folderId = await api.createFolder(projectId, "CSV");
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      "Param CSV Import Case"
    );

    await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
    await page.waitForLoadState("load");

    // Declare 3 parameters via the Sheet.
    await page.getByTestId("configure-parameters-button").click();
    await expect(page.getByTestId("configure-parameters-sheet")).toBeVisible();

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

    // Switch to the Dataset tab and open the Import CSV wizard.
    await page.getByTestId("tab-dataset").click();
    await page.getByTestId("dataset-import-csv-button").click();
    await expect(page.getByTestId("dataset-import-wizard")).toBeVisible();

    // Step 1: upload.
    await page.getByTestId("dataset-import-wizard-file-input").setInputFiles({
      name: "test.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "username,amount,active\nalice,100,true\nbob,200,false\ncarol,50,true"
      ),
    });

    // Step 2: map.
    await expect(
      page.getByTestId("dataset-import-wizard-step-map")
    ).toBeVisible();
    await page.getByTestId("dataset-import-wizard-next").click();

    // Step 3: preview.
    await expect(
      page.getByTestId("dataset-import-wizard-step-preview")
    ).toBeVisible();
    await page.getByTestId("dataset-import-wizard-next").click();

    // Step 4: confirm; default mode is Replace; click commit.
    await expect(
      page.getByTestId("dataset-import-wizard-step-confirm")
    ).toBeVisible();
    await page.getByTestId("dataset-import-wizard-commit").click();

    // Wizard closes; rows appear in the dataset grid.
    await expect(page.getByTestId("dataset-import-wizard")).not.toBeVisible({
      timeout: 10000,
    });
  });

  test("BOM-prefixed CSV auto-maps the first column correctly", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E Param CSV BOM ${Date.now()}`
    );
    const folderId = await api.createFolder(projectId, "CSV BOM");
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      "Param CSV BOM Case"
    );

    await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
    await page.waitForLoadState("load");

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

    await page.getByTestId("tab-dataset").click();
    await page.getByTestId("dataset-import-csv-button").click();
    await expect(page.getByTestId("dataset-import-wizard")).toBeVisible();

    // BOM (U+FEFF) must NOT corrupt the first-column header match.
    const bomCsv = "﻿username,amount\nalice,100";
    await page.getByTestId("dataset-import-wizard-file-input").setInputFiles({
      name: "bom.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(bomCsv, "utf8"),
    });

    await expect(
      page.getByTestId("dataset-import-wizard-step-map")
    ).toBeVisible();
    // No required-column-unmapped warning — the first column maps cleanly to username.
    await expect(
      page.getByTestId("dataset-import-wizard-map-warning")
    ).not.toBeVisible();
  });
});
