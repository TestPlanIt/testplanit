import { expect, test } from "../../fixtures";

/**
 * Custom-field column rendering on the test-run detail page.
 *
 * Regression guard: run-mode cases once rendered custom-field values raw —
 * Dropdown/Multi-Select as their raw integer option ids and rich-text
 * (Text Long) as raw TipTap JSON — because the run-mode query fetched
 * caseFieldValues without the nested `field.type` the shared cell renderer
 * keys off. Repository mode fetched it, run mode did not, so the two query
 * paths had silently drifted. Both now share the same select fragments in
 * Cases.tsx (CASE_FIELD_VALUES_SELECT / CASE_TEMPLATE_SELECT).
 *
 * This test seeds one case carrying a Dropdown, a Multi-Select and a Text Long
 * value, adds it to a run, opens the run detail page, enables those columns,
 * and asserts each cell shows the formatted value (option label / rendered
 * text) and never the raw id or raw JSON. It fails against the pre-fix code.
 */

test("test-run detail renders custom-field columns formatted, not raw", async ({
  api,
  page,
  request,
  baseURL,
}) => {
  const ts = Date.now();

  const dropdownFieldName = `E2E Priority ${ts}`;
  const multiFieldName = `E2E Browsers ${ts}`;
  const textFieldName = `E2E Notes ${ts}`;

  // Digit-free labels so a `not.toContainText(<numericId>)` assertion is
  // unambiguous — the only way a raw id could appear is the pre-fix bug.
  const dropdownOptionLabel = "High Priority E2E";
  const multiOptionALabel = "Chrome E2E";
  const multiOptionBLabel = "Firefox E2E";
  const richText = "Rich text renders in run mode";

  let projectId!: number;
  let runId!: number;
  let caseId!: number;
  let dropdownFieldId!: number;
  let multiFieldId!: number;
  let textFieldId!: number;
  let dropdownOptionId!: number;
  let multiOptionAId!: number;
  let multiOptionBId!: number;

  await test.step("Seed Dropdown, Multi-Select and Text Long fields on a case in a run", async () => {
    projectId = await api.createProject(`E2E Run Field Columns ${ts}`);
    const folderId = await api.getRootFolderId(projectId);
    const templateId = await api.getTemplateId(projectId);

    // Dropdown field + one option.
    dropdownFieldId = await api.createCaseField({
      displayName: dropdownFieldName,
      typeName: "Dropdown",
    });
    dropdownOptionId = await api.createFieldOption({
      name: dropdownOptionLabel,
      caseFieldId: dropdownFieldId,
    });
    await api.assignCaseFieldToTemplate(templateId, dropdownFieldId);

    // Multi-Select field + two options.
    multiFieldId = await api.createCaseField({
      displayName: multiFieldName,
      typeName: "Multi-Select",
    });
    multiOptionAId = await api.createFieldOption({
      name: multiOptionALabel,
      caseFieldId: multiFieldId,
    });
    multiOptionBId = await api.createFieldOption({
      name: multiOptionBLabel,
      caseFieldId: multiFieldId,
    });
    await api.assignCaseFieldToTemplate(templateId, multiFieldId);

    // Rich-text (Text Long) field.
    textFieldId = await api.createCaseField({
      displayName: textFieldName,
      typeName: "Text Long",
    });
    await api.assignCaseFieldToTemplate(templateId, textFieldId);

    // Case carrying values for all three fields. Values are written with their
    // natural JSON types — a scalar option id, an array of option ids, and a
    // TipTap doc object — mirroring how the app persists these fields. (The
    // createTestCaseWithFieldValues helper JSON-stringifies every value, which
    // stores the Multi-Select array as a string and breaks its renderer, whose
    // id→label mapping requires an actual array via Array.isArray.)
    caseId = await api.createTestCase(
      projectId,
      folderId,
      `E2E Field Case ${ts}`
    );
    const setFieldValue = async (fieldId: number, value: unknown) => {
      const res = await request.post(
        `${baseURL ?? "http://localhost:3000"}/api/model/caseFieldValues/create`,
        { data: { data: { testCaseId: caseId, fieldId, value } } }
      );
      expect(res.ok(), `failed to set field ${fieldId}`).toBeTruthy();
    };
    await setFieldValue(dropdownFieldId, dropdownOptionId);
    await setFieldValue(multiFieldId, [multiOptionAId, multiOptionBId]);
    await setFieldValue(textFieldId, {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: richText }] },
      ],
    });

    runId = await api.createTestRun(projectId, `E2E Field Run ${ts}`);
    await api.addTestCaseToTestRun(runId, caseId, { order: 1 });
  });

  await test.step("Open the run detail page and wait for the case row", async () => {
    await page.goto(`/en-US/projects/runs/${projectId}/${runId}`);
    await page.waitForLoadState("load");
    await expect(page.locator(`[data-row-id="${caseId}"]`)).toBeVisible({
      timeout: 20000,
    });
  });

  await test.step("Enable the three custom-field columns", async () => {
    await page.getByTestId("column-selection-trigger").click();
    // Custom-field columns are hidden by default; the column id equals the
    // numeric field id (columns.tsx: `id: field.id.toString()`).
    for (const fieldId of [dropdownFieldId, multiFieldId, textFieldId]) {
      const checkbox = page.locator(`button[role="checkbox"][id="${fieldId}"]`);
      await expect(checkbox).toBeVisible({ timeout: 10000 });
      if ((await checkbox.getAttribute("aria-checked")) !== "true") {
        await checkbox.click();
      }
    }
    await page.keyboard.press("Escape");
  });

  const rowSelector = `[data-row-id="${caseId}"]`;

  await test.step("Dropdown cell shows the option label, not the raw id", async () => {
    const cell = page.locator(
      `${rowSelector} [data-column-id="${dropdownFieldId}"]`
    );
    await expect(cell).toContainText(dropdownOptionLabel);
    await expect(cell).not.toContainText(String(dropdownOptionId));
  });

  await test.step("Multi-Select cell shows all option labels, not raw ids", async () => {
    const cell = page.locator(
      `${rowSelector} [data-column-id="${multiFieldId}"]`
    );
    await expect(cell).toContainText(multiOptionALabel);
    await expect(cell).toContainText(multiOptionBLabel);
    await expect(cell).not.toContainText(String(multiOptionAId));
    await expect(cell).not.toContainText(String(multiOptionBId));
  });

  await test.step("Text Long cell shows rendered text, not raw TipTap JSON", async () => {
    const cell = page.locator(
      `${rowSelector} [data-column-id="${textFieldId}"]`
    );
    await expect(cell).toContainText(richText);
    await expect(cell).not.toContainText('{"type":"doc"');
  });
});
