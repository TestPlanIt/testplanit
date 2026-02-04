import { test, expect } from "../../../fixtures";
import type { Page } from "@playwright/test";
import type { ApiHelper } from "../../../fixtures/api.fixture";

/**
 * Result Creation with Custom Fields E2E Tests
 *
 * Tests all 9 result field types in the Add Result modal:
 * - Text String, Text Long, Number, Integer, Checkbox
 * - Date, Link, Dropdown, Multi-Select
 *
 * Verifies:
 * - Field rendering in the Add Result form
 * - User input handling
 * - Validation (required fields, min/max)
 * - Default values
 * - Hint text display
 *
 * NOTE: These tests run serially to avoid database/React Query conflicts.
 * Restricted field tests are covered in case-creation-with-fields.spec.ts.
 */

test.describe.configure({ mode: "serial" });

/**
 * Helper to set up a result field + template + test case + test run,
 * then navigate to the Add Result modal.
 *
 * Returns the modal Locator and the field display name.
 */
async function setupAndOpenAddResultModal(
  page: Page,
  api: ApiHelper,
  projectId: number,
  fieldOptions: {
    displayName: string;
    systemName: string;
    typeName: string;
    isRequired?: boolean;
    isRestricted?: boolean;
    defaultValue?: string;
    hint?: string;
    minValue?: number;
    maxValue?: number;
    isChecked?: boolean;
  },
  extraSetup?: (params: {
    resultFieldId: number;
    templateId: number;
  }) => Promise<void>
) {
  // 1. Create result field
  const resultFieldId = await api.createResultField(fieldOptions);

  // 2. Create template and assign field
  const templateName = `Template ${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const templateId = await api.createTemplate({
    name: templateName,
    projectIds: [projectId],
  });
  await api.assignResultFieldToTemplate(templateId, resultFieldId);

  // Run any extra setup (e.g., creating field options for dropdowns)
  if (extraSetup) {
    await extraSetup({ resultFieldId, templateId });
  }

  // 3. Create test case with this template
  const caseName = `Test Case ${Date.now()}`;
  const folderId = await api.getRootFolderId(projectId);
  const caseId = await api.createTestCase(
    projectId,
    folderId,
    caseName,
    templateId
  );

  // 4. Create test run and add case
  const testRunId = await api.createTestRun(
    projectId,
    `Test Run ${Date.now()}`
  );
  await api.addTestCaseToTestRun(testRunId, caseId);

  // Small delay to ensure DB writes complete
  await page.waitForTimeout(500);

  // 5. Navigate to test run
  await page.goto(`/en-US/projects/runs/${projectId}/${testRunId}`);
  await page.waitForLoadState("networkidle");

  // 6. Click test case to open sidebar
  const testCaseLink = page.locator(`text=${caseName}`).first();
  await expect(testCaseLink).toBeVisible({ timeout: 10000 });
  await testCaseLink.click();
  await page.waitForLoadState("networkidle");

  // 7. Click "Add Result"
  const addResultButton = page
    .locator('button:has-text("Add Result")')
    .first();
  await expect(addResultButton).toBeVisible({ timeout: 15000 });
  await addResultButton.click();

  // 8. Wait for modal
  const modal = page.getByRole("dialog", { name: "Add Result" });
  await expect(modal).toBeVisible({ timeout: 10000 });

  return { modal, caseName };
}

/**
 * Helper to find a field's input element by display name within the modal.
 */
function getFieldInput(modal: ReturnType<Page["getByRole"]>, displayName: string) {
  const fieldLabel = modal.getByText(displayName).first();
  const formItem = fieldLabel.locator("..");
  return formItem.locator("input").first();
}

/**
 * Helper to submit the Add Result form and verify success (dialog closes).
 */
async function submitAndExpectSuccess(
  modal: ReturnType<Page["getByRole"]>
) {
  const saveButton = modal.getByRole("button", { name: "Save" });
  await saveButton.click();
  await expect(modal).not.toBeVisible({ timeout: 15000 });
}

// ──────────────────────────────────────────────────────────────
// Text String Fields
// ──────────────────────────────────────────────────────────────

test.describe("Result Creation - Text String Fields", () => {
  let projectId: number;

  test.beforeEach(async ({ api }) => {
    projectId = await api.createProject(`E2E Result Creation ${Date.now()}`);
  });

  test("Submit result with empty text string (optional field)", async ({
    page,
    api,
  }) => {
    const displayName = `Text Field ${Date.now()}`;
    const systemName = `result_text_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const { modal } = await setupAndOpenAddResultModal(page, api, projectId, {
      displayName,
      systemName,
      typeName: "Text String",
      isRequired: false,
    });

    // Verify field label is visible
    const fieldLabel = modal.getByText(displayName).first();
    await expect(fieldLabel).toBeVisible({ timeout: 5000 });

    // Leave field empty, submit
    await submitAndExpectSuccess(modal);
  });

  test("Submit result with text string value", async ({ page, api }) => {
    const displayName = `Text Field ${Date.now()}`;
    const systemName = `result_text_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const { modal } = await setupAndOpenAddResultModal(page, api, projectId, {
      displayName,
      systemName,
      typeName: "Text String",
      isRequired: false,
    });

    // Fill text field
    const fieldInput = getFieldInput(modal, displayName);
    await expect(fieldInput).toBeVisible({ timeout: 5000 });
    await fieldInput.fill("Test result value");

    await submitAndExpectSuccess(modal);
  });

  test("Default value auto-applied for text string", async ({
    page,
    api,
  }) => {
    const displayName = `Text Default ${Date.now()}`;
    const systemName = `result_text_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const defaultValue = "Default result text";

    const { modal } = await setupAndOpenAddResultModal(page, api, projectId, {
      displayName,
      systemName,
      typeName: "Text String",
      isRequired: false,
      defaultValue,
    });

    // Verify default value is pre-filled
    const fieldInput = getFieldInput(modal, displayName);
    await expect(fieldInput).toBeVisible({ timeout: 5000 });
    await expect(fieldInput).toHaveValue(defaultValue);
  });

  test("Required text string validation prevents submission", async ({
    page,
    api,
  }) => {
    const displayName = `Required Text ${Date.now()}`;
    const systemName = `result_text_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const { modal } = await setupAndOpenAddResultModal(page, api, projectId, {
      displayName,
      systemName,
      typeName: "Text String",
      isRequired: true,
    });

    // Leave required field empty, try to submit
    const saveButton = modal.getByRole("button", { name: "Save" });
    await saveButton.click();

    // Dialog should remain open (validation error)
    await expect(modal).toBeVisible();
    await page.waitForTimeout(500);
  });

  test("Hint text displays for text string field", async ({ page, api }) => {
    const displayName = `Hint Field ${Date.now()}`;
    const systemName = `result_text_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const hintText = "This is a helpful hint for the result field";

    const { modal } = await setupAndOpenAddResultModal(page, api, projectId, {
      displayName,
      systemName,
      typeName: "Text String",
      isRequired: false,
      hint: hintText,
    });

    // Verify hint text is visible within the field's form item
    const fieldLabel = modal.getByText(displayName).first();
    const formItem = fieldLabel.locator("..");
    const hintElement = formItem.locator("p.text-sm");
    await expect(hintElement).toBeVisible({ timeout: 5000 });
    await expect(hintElement).toContainText(hintText);
  });
});

// ──────────────────────────────────────────────────────────────
// Text Long Fields
// ──────────────────────────────────────────────────────────────

test.describe("Result Creation - Text Long Fields", () => {
  let projectId: number;

  test.beforeEach(async ({ api }) => {
    projectId = await api.createProject(`E2E Result Creation ${Date.now()}`);
  });

  test("Submit result with Text Long field", async ({ page, api }) => {
    const displayName = `Long Text ${Date.now()}`;
    const systemName = `result_long_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const { modal } = await setupAndOpenAddResultModal(page, api, projectId, {
      displayName,
      systemName,
      typeName: "Text Long",
      isRequired: false,
    });

    // Text Long renders as a TipTapEditor, not a plain input
    const fieldLabel = modal.getByText(displayName).first();
    await expect(fieldLabel).toBeVisible({ timeout: 5000 });

    // The TipTapEditor renders a contenteditable div with class "tiptap"
    const formItem = fieldLabel.locator("..");
    const editor = formItem.locator(".tiptap");
    await expect(editor).toBeVisible({ timeout: 5000 });

    // Type into the editor
    await editor.click();
    await page.keyboard.type("Rich text content for result");

    await submitAndExpectSuccess(modal);
  });

  test("Text Long field with default value", async ({ page, api }) => {
    const displayName = `Long Default ${Date.now()}`;
    const systemName = `result_long_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const { modal } = await setupAndOpenAddResultModal(page, api, projectId, {
      displayName,
      systemName,
      typeName: "Text Long",
      isRequired: false,
      defaultValue: "Default long text content",
    });

    // Verify the editor renders with default content
    const fieldLabel = modal.getByText(displayName).first();
    await expect(fieldLabel).toBeVisible({ timeout: 5000 });

    const formItem = fieldLabel.locator("..");
    const editor = formItem.locator(".tiptap");
    await expect(editor).toBeVisible({ timeout: 5000 });
    await expect(editor).toContainText("Default long text content");
  });
});

// ──────────────────────────────────────────────────────────────
// Number Fields
// ──────────────────────────────────────────────────────────────

test.describe("Result Creation - Number Fields", () => {
  let projectId: number;

  test.beforeEach(async ({ api }) => {
    projectId = await api.createProject(`E2E Result Creation ${Date.now()}`);
  });

  test("Submit result with number value", async ({ page, api }) => {
    const displayName = `Number Field ${Date.now()}`;
    const systemName = `result_num_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const { modal } = await setupAndOpenAddResultModal(page, api, projectId, {
      displayName,
      systemName,
      typeName: "Number",
      isRequired: false,
    });

    // Fill number field
    const fieldInput = getFieldInput(modal, displayName);
    await expect(fieldInput).toBeVisible({ timeout: 5000 });
    await fieldInput.fill("123.45");

    await submitAndExpectSuccess(modal);
  });

  test("Number min/max validation enforced", async ({ page, api }) => {
    const displayName = `Number Range ${Date.now()}`;
    const systemName = `result_num_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const { modal } = await setupAndOpenAddResultModal(page, api, projectId, {
      displayName,
      systemName,
      typeName: "Number",
      isRequired: false,
      minValue: 0,
      maxValue: 100,
    });

    // Fill with value outside range
    const fieldInput = getFieldInput(modal, displayName);
    await expect(fieldInput).toBeVisible({ timeout: 5000 });
    await fieldInput.fill("150");

    // Try to submit - validation should fail
    const saveButton = modal.getByRole("button", { name: "Save" });
    await saveButton.click();

    // Dialog should remain open due to validation error
    await expect(modal).toBeVisible();
    await page.waitForTimeout(500);
  });
});

// ──────────────────────────────────────────────────────────────
// Integer Fields
// ──────────────────────────────────────────────────────────────

test.describe("Result Creation - Integer Fields", () => {
  let projectId: number;

  test.beforeEach(async ({ api }) => {
    projectId = await api.createProject(`E2E Result Creation ${Date.now()}`);
  });

  test("Submit result with integer value", async ({ page, api }) => {
    const displayName = `Integer Field ${Date.now()}`;
    const systemName = `result_int_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const { modal } = await setupAndOpenAddResultModal(page, api, projectId, {
      displayName,
      systemName,
      typeName: "Integer",
      isRequired: false,
    });

    // Integer falls through to the default case and renders as a plain input
    const fieldInput = getFieldInput(modal, displayName);
    await expect(fieldInput).toBeVisible({ timeout: 5000 });
    await fieldInput.fill("42");

    await submitAndExpectSuccess(modal);
  });
});

// ──────────────────────────────────────────────────────────────
// Date Fields
// ──────────────────────────────────────────────────────────────

test.describe("Result Creation - Date Fields", () => {
  let projectId: number;

  test.beforeEach(async ({ api }) => {
    projectId = await api.createProject(`E2E Result Creation ${Date.now()}`);
  });

  test("Submit result with date value", async ({ page, api }) => {
    const displayName = `Date Field ${Date.now()}`;
    const systemName = `result_date_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const { modal } = await setupAndOpenAddResultModal(page, api, projectId, {
      displayName,
      systemName,
      typeName: "Date",
      isRequired: false,
    });

    // Date falls through to the default case and renders as a plain input
    const fieldInput = getFieldInput(modal, displayName);
    await expect(fieldInput).toBeVisible({ timeout: 5000 });
    await fieldInput.fill("2025-01-15");

    await submitAndExpectSuccess(modal);
  });
});

// ──────────────────────────────────────────────────────────────
// Link Fields
// ──────────────────────────────────────────────────────────────

test.describe("Result Creation - Link Fields", () => {
  let projectId: number;

  test.beforeEach(async ({ api }) => {
    projectId = await api.createProject(`E2E Result Creation ${Date.now()}`);
  });

  test("Submit result with link value", async ({ page, api }) => {
    const displayName = `Link Field ${Date.now()}`;
    const systemName = `result_link_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const { modal } = await setupAndOpenAddResultModal(page, api, projectId, {
      displayName,
      systemName,
      typeName: "Link",
      isRequired: false,
    });

    // Link falls through to the default case and renders as a plain input
    const fieldInput = getFieldInput(modal, displayName);
    await expect(fieldInput).toBeVisible({ timeout: 5000 });
    await fieldInput.fill("https://example.com/result");

    await submitAndExpectSuccess(modal);
  });
});

// ──────────────────────────────────────────────────────────────
// Dropdown Fields
// ──────────────────────────────────────────────────────────────

test.describe("Result Creation - Dropdown Fields", () => {
  let projectId: number;

  test.beforeEach(async ({ api }) => {
    projectId = await api.createProject(`E2E Result Creation ${Date.now()}`);
  });

  test("Submit result with dropdown selection", async ({ page, api }) => {
    const displayName = `Priority ${Date.now()}`;
    const systemName = `result_dd_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const { modal } = await setupAndOpenAddResultModal(
      page,
      api,
      projectId,
      {
        displayName,
        systemName,
        typeName: "Dropdown",
        isRequired: false,
      },
      async ({ resultFieldId }) => {
        // Create dropdown options linked to the result field
        await api.createFieldOption({
          name: "Low",
          resultFieldId,
          isDefault: false,
          order: 0,
        });
        await api.createFieldOption({
          name: "High",
          resultFieldId,
          isDefault: false,
          order: 1,
        });
      }
    );

    // Find the select trigger within the field's form item
    const fieldLabel = modal.getByText(displayName).first();
    const formItem = fieldLabel.locator("..");
    const selectTrigger = formItem.locator("button").first();
    await expect(selectTrigger).toBeVisible({ timeout: 5000 });
    await selectTrigger.click();

    // Select "High" from the dropdown options
    await page.waitForTimeout(500);
    const option = page.getByRole("option", { name: "High" });
    await option.click();

    await submitAndExpectSuccess(modal);
  });
});

// ──────────────────────────────────────────────────────────────
// Multi-Select Fields
// ──────────────────────────────────────────────────────────────

test.describe("Result Creation - Multi-Select Fields", () => {
  let projectId: number;

  test.beforeEach(async ({ api }) => {
    projectId = await api.createProject(`E2E Result Creation ${Date.now()}`);
  });

  test("Multi-Select field renders in result form", async ({ page, api }) => {
    const displayName = `MultiSelect ${Date.now()}`;
    const systemName = `result_ms_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const { modal } = await setupAndOpenAddResultModal(
      page,
      api,
      projectId,
      {
        displayName,
        systemName,
        typeName: "Multi-Select",
        isRequired: false,
      },
      async ({ resultFieldId }) => {
        await api.createFieldOption({
          name: "Browser",
          resultFieldId,
          isDefault: false,
          order: 0,
        });
        await api.createFieldOption({
          name: "Mobile",
          resultFieldId,
          isDefault: false,
          order: 1,
        });
        await api.createFieldOption({
          name: "API",
          resultFieldId,
          isDefault: false,
          order: 2,
        });
      }
    );

    // Multi-Select falls through to the default case and renders as a plain input
    const fieldLabel = modal.getByText(displayName, { exact: false }).first();
    await expect(fieldLabel).toBeVisible({ timeout: 5000 });

    await submitAndExpectSuccess(modal);
  });
});

// ──────────────────────────────────────────────────────────────
// Checkbox Fields
// ──────────────────────────────────────────────────────────────

test.describe("Result Creation - Checkbox Fields", () => {
  let projectId: number;

  test.beforeEach(async ({ api }) => {
    projectId = await api.createProject(`E2E Result Creation ${Date.now()}`);
  });

  test("Checkbox field renders in result form", async ({ page, api }) => {
    const displayName = `Checkbox Field ${Date.now()}`;
    const systemName = `result_cb_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const { modal } = await setupAndOpenAddResultModal(page, api, projectId, {
      displayName,
      systemName,
      typeName: "Checkbox",
      isRequired: false,
      isChecked: false,
    });

    // Checkbox falls through to the default case in renderDynamicField
    // and renders as a plain input element
    const fieldLabel = modal.getByText(displayName, { exact: false }).first();
    await expect(fieldLabel).toBeVisible({ timeout: 5000 });

    await submitAndExpectSuccess(modal);
  });
});
