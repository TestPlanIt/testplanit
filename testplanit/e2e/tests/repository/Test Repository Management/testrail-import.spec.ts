import { randomUUID } from "crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * TestRail suite XML import
 *
 * The repository Import wizard reads a TestRail suite export, turns its
 * sections into folders and its cases into test cases, and reports what the
 * file could not carry.
 */
test.describe("TestRail XML import", () => {
  test("imports sections as folders and cases with steps, a table and a parameter", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const repositoryPage = new RepositoryPage(page);
    const uid = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const projectId = await api.createProject(`E2E TestRail Import ${uid}`);
    const suiteFolder = `TestRail ${uid}`;
    const sectionName = `Checkout / Cards ${uid}`;
    const subsectionName = `Refunds ${uid}`;
    const caseName = `Pay by card ${uid}`;
    // The suite carries TestRail's default name, a section name holding a path
    // separator, an expected result typed into the step text, a variable, a
    // TestRail table and an image that points at the TestRail instance.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<suite>
  <id>S1</id>
  <name>Master</name>
  <description></description>
  <sections>
    <section>
      <name>${sectionName}</name>
      <description>Card payments</description>
      <cases>
        <case>
          <id>C1</id>
          <title>${caseName}</title>
          <template>Test Case (Steps)</template>
          <estimate></estimate>
          <references></references>
          <custom>
            <steps_separated>
              <step><index>1</index><content>Log in as %user%
Expected Result:
The dashboard opens</content></step>
              <step><index>2</index><content>Check the totals:

|||:Item|:Price
|| Book | 10</content><expected>Totals match ![](index.php?/attachments/get/abc-123)</expected><additional_info>Use card 4242</additional_info></step>
            </steps_separated>
          </custom>
        </case>
      </cases>
      <sections>
        <section>
          <name>${subsectionName}</name>
          <description></description>
          <cases>
            <case>
              <id>C2</id>
              <title>Refund ${uid}</title>
              <template>Test Case (Steps)</template>
              <estimate></estimate>
              <references></references>
            </case>
          </cases>
        </section>
      </sections>
    </section>
  </sections>
</suite>`;

    const importDialog = page.locator('[role="dialog"]').first();

    await test.step("Open the import wizard and choose the export", async () => {
      await repositoryPage.goto(projectId);
      await page.waitForLoadState("networkidle");
      await page
        .locator('button:has-text("Import Test Cases")')
        .first()
        .click();
      await expect(importDialog).toBeVisible({ timeout: 5000 });

      const fileInput = page.locator('input[type="file"]').first();
      await expect(fileInput).toBeAttached({ timeout: 5000 });
      await fileInput.setInputFiles({
        name: "suite.xml",
        mimeType: "text/xml",
        buffer: Buffer.from(xml, "utf-8"),
      });
    });

    await test.step("The first page describes the suite", async () => {
      const summary = importDialog.getByTestId("testrail-import-summary");
      await expect(summary).toBeVisible({ timeout: 10000 });
      await expect(summary).toContainText("2 test cases");
      // TestRail's default suite name is never shown.
      await expect(importDialog).not.toContainText("Master");
    });

    await test.step("Put the sections in a named folder and pick the template", async () => {
      await importDialog.locator("#testRailSuiteFolder").click();
      await importDialog
        .getByTestId("testrail-suite-folder-name")
        .fill(suiteFolder);

      await importDialog.getByTestId("template-select").click();
      await page
        .getByRole("option", { name: /Default Template/ })
        .first()
        .click();
      await importDialog.getByTestId("next-button").click();
    });

    await test.step("TestRail fields are matched to template fields", async () => {
      await expect(
        importDialog.getByTestId("import-column-mapping-Title")
      ).toContainText("Name", { timeout: 10000 });
      await expect(
        importDialog.getByTestId("import-column-mapping-Section")
      ).toContainText("Folder");
      await expect(
        importDialog.getByTestId("import-column-mapping-Steps")
      ).toContainText("Steps");
      await importDialog.getByTestId("next-button").click();
      await importDialog.getByTestId("next-button").click();
    });

    await test.step("The preview says what the file could not carry, then import", async () => {
      const notes = importDialog.getByTestId("testrail-import-notes");
      await expect(notes).toBeVisible({ timeout: 10000 });
      await expect(notes).toContainText("1 image");
      await expect(notes).toContainText("1 test case uses TestRail variables");

      await importDialog.getByTestId("import-button").click();
      await expect(importDialog).toBeHidden({ timeout: 30000 });
    });

    const findMany = async (model: string, args: unknown) => {
      const response = await request.get(
        `${baseURL}/api/model/${model}/findMany`,
        { params: { q: JSON.stringify(args) } }
      );
      expect(response.ok()).toBeTruthy();
      return (await response.json()).data as any[];
    };

    let importedCaseId = 0;

    await test.step("Sections became folders, with the section name kept whole", async () => {
      const folders = await findMany("repositoryFolders", {
        where: { projectId, isDeleted: false },
        select: { id: true, name: true, parentId: true, docs: true },
      });
      const top = folders.find((folder) => folder.name === suiteFolder);
      expect(top).toBeTruthy();
      const section = folders.find((folder) => folder.name === sectionName);
      expect(section?.parentId).toBe(top.id);
      expect(JSON.stringify(section.docs)).toContain("Card payments");
      const subsection = folders.find(
        (folder) => folder.name === subsectionName
      );
      expect(subsection?.parentId).toBe(section.id);

      const cases = await findMany("repositoryCases", {
        where: { projectId, isDeleted: false },
        select: { id: true, name: true, folderId: true },
      });
      expect(cases).toHaveLength(2);
      const imported = cases.find((item) => item.name === caseName);
      expect(imported?.folderId).toBe(section.id);
      importedCaseId = imported.id;
    });

    await test.step("Steps carry the expected result, the table, the marker and the parameter", async () => {
      const steps = await stepsOf(request, baseURL!, importedCaseId);
      expect(steps).toHaveLength(2);

      expect(steps[0].step).toContain('"parameterMention"');
      expect(steps[0].step).not.toContain("Expected Result:");
      expect(steps[0].expectedResult).toContain("The dashboard opens");

      expect(steps[1].step).toContain('"table"');
      expect(steps[1].step).toContain("Use card 4242");
      expect(steps[1].expectedResult).toContain("[image not imported]");
      expect(steps[1].expectedResult).not.toContain("attachments/get");

      const parameters = await findMany("testCaseParameter", {
        where: { testCaseId: importedCaseId, isDeleted: false },
        select: { name: true, type: true },
      });
      expect(parameters).toEqual([{ name: "user", type: "STRING" }]);
    });

    await test.step("The imported case shows the parameter chip and the table", async () => {
      await page.goto(
        `/en-US/projects/repository/${projectId}/${importedCaseId}`
      );
      await page.waitForLoadState("networkidle");
      await expect(page.locator(".parameter-ref-chip").first()).toContainText(
        "@user",
        { timeout: 15000 }
      );
      await expect(page.locator("table").first()).toContainText("Book");
    });
  });
});

/** The live steps of a case, with their rich text as JSON strings. */
async function stepsOf(
  request: APIRequestContext,
  baseURL: string,
  caseId: number
): Promise<{ step: string; expectedResult: string }[]> {
  const response = await request.get(`${baseURL}/api/model/steps/findMany`, {
    params: {
      q: JSON.stringify({
        where: { testCaseId: caseId, isDeleted: false },
        orderBy: { order: "asc" },
        select: { step: true, expectedResult: true },
      }),
    },
  });
  expect(response.ok()).toBeTruthy();
  const rows = (await response.json()).data as any[];
  const asText = (value: unknown) =>
    typeof value === "string" ? value : JSON.stringify(value);
  return rows.map((row) => ({
    step: asText(row.step),
    expectedResult: asText(row.expectedResult),
  }));
}
