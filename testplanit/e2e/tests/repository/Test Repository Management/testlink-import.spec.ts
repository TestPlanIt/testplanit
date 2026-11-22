import { randomUUID } from "crypto";
import { expect, test } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * TestLink XML import
 *
 * The repository Import wizard reads a TestLink test specification export,
 * turns its test suites into folders and its test cases into test cases with
 * steps, tags and attached files, and reports what it leaves out.
 */
test.describe("TestLink XML import", () => {
  test("imports test suites as folders and cases with steps, keywords and attachments", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const repositoryPage = new RepositoryPage(page);
    const uid = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const projectId = await api.createProject(`E2E TestLink Import ${uid}`);
    const suiteName = `Checkout / Cards ${uid}`;
    const childSuiteName = `Refunds ${uid}`;
    const caseName = `Pay with a saved card ${uid}`;
    const keyword = `Smoke ${uid}`;
    // A whole-project export: an unnamed root suite, a suite name holding a
    // path separator, steps written out of order, a keyword, an embedded
    // attachment and a relation.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite id="" name="" >
<node_order><![CDATA[]]></node_order>
<details><![CDATA[]]></details>
<testsuite id="101" name="${suiteName}" >
<node_order><![CDATA[1]]></node_order>
<details><![CDATA[<p>Card payments</p>]]></details>
<testcase internalid="210" name="${caseName}">
	<node_order><![CDATA[1000]]></node_order>
	<externalid><![CDATA[1]]></externalid>
	<fullexternalid><![CDATA[SHOP-1]]></fullexternalid>
	<version><![CDATA[3]]></version>
	<summary><![CDATA[<p>A returning shopper pays with the card on file.</p>]]></summary>
	<preconditions><![CDATA[<p>A card is saved</p>]]></preconditions>
	<execution_type><![CDATA[1]]></execution_type>
	<importance><![CDATA[3]]></importance>
	<estimated_exec_duration>2.50</estimated_exec_duration>
	<status>7</status>
	<is_open>1</is_open>
	<active>1</active>
<steps>
<step>
	<step_number><![CDATA[2]]></step_number>
	<actions><![CDATA[<p>Choose the saved card and confirm</p>]]></actions>
	<expectedresults><![CDATA[<p>The receipt page shows the order total</p>]]></expectedresults>
	<execution_type><![CDATA[1]]></execution_type>
</step>
<step>
	<step_number><![CDATA[1]]></step_number>
	<actions><![CDATA[<p>Open the basket and select <strong>Pay</strong></p>]]></actions>
	<expectedresults><![CDATA[<p>The saved card is offered first</p>]]></expectedresults>
	<execution_type><![CDATA[1]]></execution_type>
</step>
</steps>
<keywords><keyword name="${keyword}"><notes><![CDATA[]]></notes></keyword></keywords>
	<attachments>
		<attachment>
			<id><![CDATA[12]]></id>
			<name><![CDATA[card-form.txt]]></name>
			<file_type><![CDATA[text/plain]]></file_type>
			<file_size><![CDATA[5]]></file_size>
			<title><![CDATA[]]></title>
			<date_added><![CDATA[2025-03-02 09:30:00]]></date_added>
			<content><![CDATA[aGVsbG8=]]></content>
		</attachment>
	</attachments>
</testcase>
<testsuite id="102" name="${childSuiteName}" >
<node_order><![CDATA[2]]></node_order>
<details><![CDATA[]]></details>
<testcase internalid="220" name="Refund ${uid}">
	<node_order><![CDATA[1000]]></node_order>
	<externalid><![CDATA[2]]></externalid>
	<fullexternalid><![CDATA[SHOP-2]]></fullexternalid>
	<version><![CDATA[1]]></version>
	<summary><![CDATA[]]></summary>
	<preconditions><![CDATA[]]></preconditions>
	<execution_type><![CDATA[2]]></execution_type>
	<importance><![CDATA[1]]></importance>
</testcase>
	<relation>
		<source version="1">SHOP-2</source>
		<destination version="3">SHOP-1</destination>
		<type>1</type>
	</relation>
</testsuite></testsuite></testsuite>`;

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
        name: "testproject.xml",
        mimeType: "text/xml",
        buffer: Buffer.from(xml, "utf-8"),
      });
    });

    await test.step("The first page describes the export and what it leaves out", async () => {
      const summary = importDialog.getByTestId("testlink-import-summary");
      await expect(summary).toBeVisible({ timeout: 10000 });
      await expect(summary).toContainText("2 test cases in 2 test suites");
      await expect(summary).toContainText("1 file attached to a test case");
      await expect(summary).toContainText("1 relation");
      await expect(
        importDialog.getByTestId("testrail-import-summary")
      ).toHaveCount(0);
    });

    await test.step("Pick the template", async () => {
      await importDialog.getByTestId("template-select").click();
      await page
        .getByRole("option", { name: /Default Template/ })
        .first()
        .click();
      await importDialog.getByTestId("next-button").click();
    });

    await test.step("TestLink fields are matched to template fields", async () => {
      await expect(
        importDialog.getByTestId("import-column-mapping-Name")
      ).toContainText("Name", { timeout: 10000 });
      await expect(
        importDialog.getByTestId("import-column-mapping-Test Suite")
      ).toContainText("Folder");
      await expect(
        importDialog.getByTestId("import-column-mapping-Steps")
      ).toContainText("Steps");
      await expect(
        importDialog.getByTestId("import-column-mapping-Keywords")
      ).toContainText("Tags");
      await expect(
        importDialog.getByTestId("import-column-mapping-Attachments")
      ).toContainText("Attachments");
      await importDialog.getByTestId("next-button").click();
      await importDialog.getByTestId("next-button").click();
    });

    await test.step("Import", async () => {
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

    await test.step("Test suites became folders, with the suite name kept whole", async () => {
      const folders = await findMany("repositoryFolders", {
        where: { projectId, isDeleted: false },
        select: { id: true, name: true, parentId: true, docs: true },
      });
      const suite = folders.find((folder) => folder.name === suiteName);
      expect(suite).toBeTruthy();
      expect(suite.parentId).toBeNull();
      expect(JSON.stringify(suite.docs)).toContain("Card payments");
      const childSuite = folders.find(
        (folder) => folder.name === childSuiteName
      );
      expect(childSuite?.parentId).toBe(suite.id);

      const cases = await findMany("repositoryCases", {
        where: { projectId, isDeleted: false },
        select: {
          id: true,
          name: true,
          folderId: true,
          automated: true,
          estimate: true,
          caseTags: { select: { tag: { select: { name: true } } } },
        },
      });
      expect(cases).toHaveLength(2);
      const imported = cases.find((item) => item.name === caseName);
      expect(imported?.folderId).toBe(suite.id);
      expect(imported.automated).toBe(false);
      expect(imported.estimate).toBe(150);
      expect(imported.caseTags).toEqual([{ tag: { name: keyword } }]);
      const refund = cases.find((item) => item.name === `Refund ${uid}`);
      expect(refund?.folderId).toBe(childSuite.id);
      expect(refund.automated).toBe(true);
      importedCaseId = imported.id;
    });

    await test.step("Steps are in step-number order with their expected results", async () => {
      const steps = await findMany("steps", {
        where: { testCaseId: importedCaseId, isDeleted: false },
        orderBy: { order: "asc" },
        select: { step: true, expectedResult: true },
      });
      const asText = (value: unknown) =>
        typeof value === "string" ? value : JSON.stringify(value);
      expect(steps).toHaveLength(2);
      expect(asText(steps[0].step)).toContain("Open the basket");
      expect(asText(steps[0].step)).toContain('"bold"');
      expect(asText(steps[0].expectedResult)).toContain(
        "The saved card is offered first"
      );
      expect(asText(steps[1].step)).toContain("Choose the saved card");
      expect(asText(steps[1].expectedResult)).toContain(
        "The receipt page shows the order total"
      );
    });

    await test.step("The embedded file is attached to the case and can be downloaded", async () => {
      const attachments = await findMany("attachments", {
        where: { testCaseId: importedCaseId, isDeleted: false },
        select: { name: true, mimeType: true, size: true, url: true },
      });
      expect(attachments).toHaveLength(1);
      expect(attachments[0].name).toBe("card-form.txt");
      expect(attachments[0].mimeType).toBe("text/plain");
      expect(Number(attachments[0].size)).toBe(5);
      expect(attachments[0].url).toContain("testlink-import");
    });

    await test.step("The imported case shows its steps and its attachment", async () => {
      await page.goto(
        `/en-US/projects/repository/${projectId}/${importedCaseId}`
      );
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("Open the basket and select")).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByText("card-form.txt").first()).toBeVisible();
    });
  });
});
