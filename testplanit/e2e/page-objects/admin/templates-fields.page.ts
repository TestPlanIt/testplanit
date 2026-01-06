import { Page, Locator, expect } from "@playwright/test";
import { BasePage } from "../base.page";

/**
 * Field types available for Case Fields
 */
export type CaseFieldType =
  | "Text String"
  | "Text Long"
  | "Number"
  | "Integer"
  | "Checkbox"
  | "Date"
  | "Link"
  | "Dropdown"
  | "Multi-Select"
  | "Steps";

/**
 * Field types available for Result Fields (excludes Steps)
 */
export type ResultFieldType = Exclude<CaseFieldType, "Steps">;

/**
 * Options for creating a dropdown/multi-select option
 */
export interface FieldOptionConfig {
  name: string;
  isDefault?: boolean;
  iconName?: string;
  colorName?: string;
  enabled?: boolean;
}

/**
 * Page object for Admin > Templates & Fields page
 */
export class TemplatesFieldsPage extends BasePage {
  // Main sections
  readonly templatesSection: Locator;
  readonly caseFieldsSection: Locator;
  readonly resultFieldsSection: Locator;

  // Templates table and buttons
  readonly templatesTable: Locator;
  readonly addTemplateButton: Locator;

  // Case Fields table and buttons
  readonly caseFieldsTable: Locator;
  readonly addCaseFieldButton: Locator;

  // Result Fields table and buttons
  readonly resultFieldsTable: Locator;
  readonly addResultFieldButton: Locator;

  // Dialog/Modal locators (shared across all forms)
  readonly dialog: Locator;
  readonly dialogTitle: Locator;
  readonly submitButton: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page, locale: string = "en-US") {
    super(page, locale);

    // Main sections - using test IDs
    this.templatesSection = page.getByTestId("templates-section");
    this.caseFieldsSection = page.getByTestId("case-fields-section");
    this.resultFieldsSection = page.getByTestId("result-fields-section");

    // Tables - inside each section
    this.templatesTable = this.templatesSection.locator('table').first();
    this.caseFieldsTable = this.caseFieldsSection.locator('table').first();
    this.resultFieldsTable = this.resultFieldsSection.locator('table').first();

    // Add buttons - using test IDs
    this.addTemplateButton = page.getByTestId("add-template-button");
    this.addCaseFieldButton = page.getByTestId("add-case-field-button");
    this.addResultFieldButton = page.getByTestId("add-result-field-button");

    // Dialog/Modal
    this.dialog = page.locator('[role="dialog"]');
    this.dialogTitle = this.dialog.locator('[role="dialog"] h2, [role="dialog"] [class*="DialogTitle"]').first();
    this.submitButton = this.dialog.locator('button[type="submit"], button:has-text("Submit")').first();
    this.cancelButton = this.dialog.locator('button:has-text("Cancel")').first();
  }

  // ============================================
  // Navigation
  // ============================================

  /**
   * Navigate to the Templates & Fields admin page
   */
  async goto(): Promise<void> {
    await this.navigate("/admin/fields");
    await this.waitForLoad();
  }

  /**
   * Wait for the page to fully load
   */
  async waitForLoad(): Promise<void> {
    await this.page.waitForLoadState("networkidle");
    // Wait for at least the Templates section to be visible
    await expect(this.addTemplateButton).toBeVisible({ timeout: 15000 });
  }

  // ============================================
  // Templates Section - CRUD Operations
  // ============================================

  /**
   * Click the Add Template button to open the add template dialog
   */
  async clickAddTemplate(): Promise<void> {
    await this.addTemplateButton.click();
    await expect(this.dialog).toBeVisible({ timeout: 5000 });
  }

  /**
   * Fill in the template name field
   */
  async fillTemplateName(name: string): Promise<void> {
    const nameInput = this.page.getByTestId("template-name-input");
    await nameInput.fill(name);
  }

  /**
   * Toggle the template Enabled switch
   */
  async toggleTemplateEnabled(enabled: boolean): Promise<void> {
    const enabledSwitch = this.page.getByTestId("template-enabled-switch");
    const currentState = await enabledSwitch.getAttribute("aria-checked") === "true";
    if (currentState !== enabled) {
      await enabledSwitch.click();
    }
  }

  /**
   * Toggle the template Default switch
   */
  async toggleTemplateDefault(isDefault: boolean): Promise<void> {
    const defaultSwitch = this.page.getByTestId("template-default-switch");
    const currentState = await defaultSwitch.getAttribute("aria-checked") === "true";
    if (currentState !== isDefault) {
      await defaultSwitch.click();
    }
  }

  /**
   * Select a case field to add to the template
   */
  async selectCaseField(fieldName: string): Promise<void> {
    // The SelectScrollable component has a test ID: add-case-field-select
    const fieldSelector = this.dialog.getByTestId("add-case-field-select");
    await fieldSelector.click();

    // Wait for dropdown to open and select the field
    await this.page.waitForSelector('[role="listbox"]', { timeout: 5000 });
    const option = this.page.locator('[role="option"]').filter({
      hasText: fieldName,
    }).first();
    await option.click();

    // Wait for the field to be added to the list
    await this.page.waitForTimeout(500);
  }

  /**
   * Select a result field to add to the template
   */
  async selectResultField(fieldName: string): Promise<void> {
    // The SelectScrollable component has a test ID: add-result-field-select
    const fieldSelector = this.dialog.getByTestId("add-result-field-select");
    await fieldSelector.click();

    // Wait for dropdown to open and select the field
    await this.page.waitForSelector('[role="listbox"]', { timeout: 5000 });
    const option = this.page.locator('[role="option"]').filter({
      hasText: fieldName,
    }).first();
    await option.click();

    // Wait for the field to be added to the list
    await this.page.waitForTimeout(500);
  }

  /**
   * Select a project to assign to the template
   */
  async selectProject(projectName: string): Promise<void> {
    // Find the projects multi-select
    const projectsLabel = this.dialog.locator('label:has-text("Projects")').first();
    const projectSelector = projectsLabel.locator('..').locator('[class*="select"], [class*="Select"]').first();
    await projectSelector.click();

    // Select the project from the dropdown
    const option = this.page.locator('[class*="option"], [role="option"]').filter({
      hasText: projectName,
    }).first();
    await option.click();

    // Click outside to close the dropdown
    await this.dialog.click({ position: { x: 10, y: 10 } });
  }

  /**
   * Click the Select All projects link
   */
  async selectAllProjects(): Promise<void> {
    const selectAllLink = this.page.getByTestId("select-all-projects");
    await selectAllLink.click();
  }

  /**
   * Submit the template form
   */
  async submitTemplate(): Promise<void> {
    const submitButton = this.page.getByTestId("template-submit-button");
    await submitButton.click();
    // Wait for dialog to close
    await expect(this.dialog).not.toBeVisible({ timeout: 10000 });
    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Click submit button without expecting dialog to close (for validation errors)
   */
  async clickSubmitTemplate(): Promise<void> {
    const submitButton = this.page.getByTestId("template-submit-button");
    await submitButton.click();
    // Just wait for any network activity to settle
    await this.page.waitForTimeout(500);
  }

  /**
   * Cancel the template form
   */
  async cancelTemplate(): Promise<void> {
    const cancelButton = this.page.getByTestId("template-cancel-button");
    await cancelButton.click();
    await expect(this.dialog).not.toBeVisible({ timeout: 5000 });
  }

  /**
   * Click the edit button for a template in the table
   */
  async clickEditTemplate(templateName: string): Promise<void> {
    const row = this.templatesTable.locator("tr").filter({ hasText: templateName }).first();
    const editButton = row.getByTestId("edit-template-button");
    await editButton.click();
    await expect(this.dialog).toBeVisible({ timeout: 5000 });
  }

  /**
   * Click the delete button for a template in the table
   */
  async clickDeleteTemplate(templateName: string): Promise<void> {
    const row = this.templatesTable.locator("tr").filter({ hasText: templateName }).first();
    const deleteButton = row.getByTestId("delete-template-button");
    await deleteButton.click();
  }

  /**
   * Confirm deletion in the alert dialog
   */
  async confirmDelete(): Promise<void> {
    const alertDialog = this.page.locator('[role="alertdialog"]');
    await expect(alertDialog).toBeVisible({ timeout: 5000 });
    const confirmButton = alertDialog.locator('button:has-text("Delete"), button:has-text("Confirm"), button:has-text("Yes")').first();
    await confirmButton.click();
    await expect(alertDialog).not.toBeVisible({ timeout: 10000 });
    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Toggle template enabled via the table switch
   */
  async toggleTemplateEnabledInTable(templateName: string): Promise<void> {
    const row = this.templatesTable.locator("tr").filter({ hasText: templateName }).first();
    // The enabled switch is typically in the 5th column (after Name, Case Fields, Result Fields, Projects)
    const enabledSwitch = row.locator('[role="switch"]').first();

    // Get current state before clicking
    const currentState = await enabledSwitch.getAttribute("aria-checked");
    const expectedState = currentState === "true" ? "false" : "true";

    await enabledSwitch.click();

    // Wait for the switch to change state
    await expect(enabledSwitch).toHaveAttribute("aria-checked", expectedState, { timeout: 5000 });
    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Toggle template default via the table switch
   */
  async toggleTemplateDefaultInTable(templateName: string): Promise<void> {
    const row = this.templatesTable.locator("tr").filter({ hasText: templateName }).first();
    // The default switch is typically the second switch in the row
    const defaultSwitch = row.locator('[role="switch"]').nth(1);
    await defaultSwitch.click();
    await this.page.waitForLoadState("networkidle");
  }

  // ============================================
  // Case Fields Section - CRUD Operations
  // ============================================

  /**
   * Click the Add Case Field button
   */
  async clickAddCaseField(): Promise<void> {
    await this.addCaseFieldButton.click();
    await expect(this.dialog).toBeVisible({ timeout: 5000 });
  }

  /**
   * Fill the case field display name
   */
  async fillCaseFieldDisplayName(name: string): Promise<void> {
    const displayNameInput = this.page.getByTestId("case-field-display-name");
    await displayNameInput.fill(name);
  }

  /**
   * Fill the case field system name
   */
  async fillCaseFieldSystemName(name: string): Promise<void> {
    const systemNameInput = this.dialog.locator('input[name="systemName"], input[placeholder*="System Name" i]').first();
    // Clear and fill
    await systemNameInput.clear();
    await systemNameInput.fill(name);
  }

  /**
   * Fill the case field hint
   */
  async fillCaseFieldHint(hint: string): Promise<void> {
    const hintInput = this.dialog.locator('input[name="hint"], textarea[name="hint"], input[placeholder*="Hint" i]').first();
    await hintInput.fill(hint);
  }

  /**
   * Select the field type from the dropdown
   */
  async selectCaseFieldType(type: CaseFieldType): Promise<void> {
    const typeSelector = this.page.getByTestId("case-field-type-select");
    await typeSelector.click();

    // Select the type from the dropdown
    const option = this.page.locator('[role="option"], [role="menuitem"]').filter({
      hasText: new RegExp(`^${type}$`, "i"),
    }).first();
    await option.click();
  }

  /**
   * Toggle case field enabled
   */
  async toggleCaseFieldEnabled(enabled: boolean): Promise<void> {
    const enabledLabel = this.dialog.locator('label:has-text("Enabled")').first();
    const enabledSwitch = enabledLabel.locator('..').locator('[role="switch"]').first();

    // Fallback: first switch
    const fallbackSwitch = this.dialog.locator('[role="switch"]').first();
    const targetSwitch = await enabledSwitch.isVisible() ? enabledSwitch : fallbackSwitch;

    const currentState = await targetSwitch.getAttribute("aria-checked") === "true";
    if (currentState !== enabled) {
      await targetSwitch.click();
    }
  }

  /**
   * Toggle case field required
   */
  async toggleCaseFieldRequired(required: boolean): Promise<void> {
    const requiredLabel = this.dialog.locator('label:has-text("Required")').first();
    const requiredSwitch = requiredLabel.locator('..').locator('[role="switch"]').first();

    const currentState = await requiredSwitch.getAttribute("aria-checked") === "true";
    if (currentState !== required) {
      await requiredSwitch.click();
    }
  }

  /**
   * Toggle case field restricted
   */
  async toggleCaseFieldRestricted(restricted: boolean): Promise<void> {
    const restrictedLabel = this.dialog.locator('label:has-text("Restricted")').first();
    const restrictedSwitch = restrictedLabel.locator('..').locator('[role="switch"]').first();

    const currentState = await restrictedSwitch.getAttribute("aria-checked") === "true";
    if (currentState !== restricted) {
      await restrictedSwitch.click();
    }
  }

  /**
   * Set the default value for text fields
   */
  async setCaseFieldDefaultValue(value: string): Promise<void> {
    const defaultValueInput = this.dialog.getByTestId("case-field-defaultValue");
    await defaultValueInput.fill(value);
  }

  /**
   * Set the minimum value for number fields
   */
  async setCaseFieldMinValue(value: number): Promise<void> {
    const minInput = this.dialog.getByTestId("case-field-minValue");
    await minInput.fill(value.toString());
  }

  /**
   * Set the maximum value for number fields
   */
  async setCaseFieldMaxValue(value: number): Promise<void> {
    const maxInput = this.dialog.getByTestId("case-field-maxValue");
    await maxInput.fill(value.toString());
  }

  /**
   * Set the initial height for text long fields
   */
  async setCaseFieldInitialHeight(height: number): Promise<void> {
    const heightInput = this.dialog.getByTestId("case-field-initialHeight");
    await heightInput.fill(height.toString());
  }

  /**
   * Set the minimum value for integer fields
   */
  async setCaseFieldMinIntegerValue(value: number): Promise<void> {
    const minInput = this.dialog.getByTestId("case-field-minIntegerValue");
    await minInput.fill(value.toString());
  }

  /**
   * Set the maximum value for integer fields
   */
  async setCaseFieldMaxIntegerValue(value: number): Promise<void> {
    const maxInput = this.dialog.getByTestId("case-field-maxIntegerValue");
    await maxInput.fill(value.toString());
  }

  /**
   * Set the default checked state for checkbox fields
   */
  async setCaseFieldDefaultChecked(checked: boolean): Promise<void> {
    const defaultLabel = this.dialog.locator('label:has-text("Default"), label:has-text("Checked")').first();
    const defaultSwitch = defaultLabel.locator('..').locator('[role="switch"], input[type="checkbox"]').first();

    const currentState = await defaultSwitch.getAttribute("aria-checked") === "true" ||
      await defaultSwitch.isChecked?.() === true;
    if (currentState !== checked) {
      await defaultSwitch.click();
    }
  }

  /**
   * Add a dropdown option
   */
  async addDropdownOption(name: string): Promise<void> {
    // Find the option input field with the test ID
    const optionInput = this.dialog.getByTestId("dropdown-option-input");

    // Type the option name and press Enter to add it
    await optionInput.fill(name);
    await optionInput.press("Enter");

    // Wait a moment for the option to be added
    await this.page.waitForTimeout(300);
  }

  /**
   * Set an option as the default for dropdown fields
   */
  async setDropdownOptionDefault(optionName: string): Promise<void> {
    // Find the option row by name - it's a div with class "cursor-ns-resize"
    const optionRow = this.dialog.locator('div.cursor-ns-resize').filter({
      hasText: optionName,
    }).first();

    // Find and click the radio button (role="radio") in that row
    const radioButton = optionRow.locator('button[role="radio"]').first();
    await radioButton.click();
    await this.page.waitForTimeout(200);
  }

  /**
   * Set the icon for a dropdown option
   */
  async setDropdownOptionIcon(optionName: string, iconName: string): Promise<void> {
    // Find the option row
    const optionRow = this.dialog.locator('[class*="option"], [class*="item"]').filter({
      hasText: optionName,
    }).first();

    // Click the icon picker button
    const iconButton = optionRow.locator('button').filter({
      has: this.page.locator('svg'),
    }).first();
    await iconButton.click();

    // Select the icon from the picker
    const iconOption = this.page.locator('[role="option"], [role="menuitem"], button').filter({
      has: this.page.locator(`svg[class*="${iconName}" i]`),
    }).first();
    await iconOption.click();
  }

  /**
   * Set the color for a dropdown option
   */
  async setDropdownOptionColor(optionName: string, colorName: string): Promise<void> {
    // Find the option row
    const optionRow = this.dialog.locator('[class*="option"], [class*="item"]').filter({
      hasText: optionName,
    }).first();

    // Click the color picker button
    const colorButton = optionRow.locator('button[class*="color" i], button[aria-label*="color" i]').first();
    await colorButton.click();

    // Select the color from the picker
    const colorOption = this.page.locator('[role="option"], button').filter({
      hasText: new RegExp(colorName, "i"),
    }).first();
    await colorOption.click();
  }

  /**
   * Toggle the enabled state of a dropdown option
   */
  async toggleDropdownOptionEnabled(optionName: string): Promise<void> {
    // Find the option row - it's a div with class "cursor-ns-resize"
    const optionRow = this.dialog.locator('div.cursor-ns-resize').filter({
      hasText: optionName,
    }).first();

    // Find and click the switch button (role="switch") in that row
    const switchButton = optionRow.locator('button[role="switch"]').first();
    await switchButton.click();
    await this.page.waitForTimeout(200);
  }

  /**
   * Remove a dropdown option
   */
  async removeDropdownOption(optionName: string): Promise<void> {
    // Find the option row - it's a div with class "cursor-ns-resize"
    const optionRow = this.dialog.locator('div.cursor-ns-resize').filter({
      hasText: optionName,
    }).first();

    // Click the remove button (the Trash2 icon button with destructive class)
    const removeButton = optionRow.locator('button.text-destructive').first();
    await removeButton.click();
    await this.page.waitForTimeout(200);
  }

  /**
   * Submit the case field form
   */
  async submitCaseField(): Promise<void> {
    const submitButton = this.page.getByTestId("case-field-submit-button");
    await submitButton.click();
    await expect(this.dialog).not.toBeVisible({ timeout: 10000 });
    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Click the submit button without expecting dialog to close
   * Useful for testing validation errors
   */
  async clickSubmitCaseField(): Promise<void> {
    const submitButton = this.page.getByTestId("case-field-submit-button");
    await submitButton.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Cancel the case field form
   */
  async cancelCaseField(): Promise<void> {
    const cancelButton = this.page.getByTestId("case-field-cancel-button");
    await cancelButton.click();
    await expect(this.dialog).not.toBeVisible({ timeout: 5000 });
  }

  /**
   * Click edit for a case field in the table
   */
  async clickEditCaseField(fieldName: string): Promise<void> {
    const row = this.caseFieldsTable.locator("tr").filter({ hasText: fieldName }).first();
    const editButton = row.getByTestId("edit-case-field-button");
    await editButton.click();
    await expect(this.dialog).toBeVisible({ timeout: 5000 });
  }

  /**
   * Click delete for a case field in the table
   */
  async clickDeleteCaseField(fieldName: string): Promise<void> {
    const row = this.caseFieldsTable.locator("tr").filter({ hasText: fieldName }).first();
    const deleteButton = row.getByTestId("delete-case-field-button");
    await deleteButton.click();
  }

  /**
   * Toggle case field enabled in the table
   */
  async toggleCaseFieldEnabledInTable(fieldName: string): Promise<void> {
    const row = this.caseFieldsTable.locator("tr").filter({ hasText: fieldName }).first();
    const enabledSwitch = row.locator('[role="switch"]').first();
    await enabledSwitch.click();
    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Toggle case field required in the table
   */
  async toggleCaseFieldRequiredInTable(fieldName: string): Promise<void> {
    const row = this.caseFieldsTable.locator("tr").filter({ hasText: fieldName }).first();
    const requiredSwitch = row.locator('[role="switch"]').nth(1);
    await requiredSwitch.click();
    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Toggle case field restricted in the table
   */
  async toggleCaseFieldRestrictedInTable(fieldName: string): Promise<void> {
    const row = this.caseFieldsTable.locator("tr").filter({ hasText: fieldName }).first();
    const restrictedSwitch = row.locator('[role="switch"]').nth(2);
    await restrictedSwitch.click();
    await this.page.waitForLoadState("networkidle");
  }

  // ============================================
  // Result Fields Section - CRUD Operations
  // ============================================

  /**
   * Click the Add Result Field button
   */
  async clickAddResultField(): Promise<void> {
    await this.addResultFieldButton.click();
    await expect(this.dialog).toBeVisible({ timeout: 5000 });
  }

  /**
   * Fill the result field display name
   */
  async fillResultFieldDisplayName(name: string): Promise<void> {
    const displayNameInput = this.page.getByTestId("result-field-display-name");
    await displayNameInput.fill(name);
  }

  /**
   * Fill the result field system name
   */
  async fillResultFieldSystemName(name: string): Promise<void> {
    await this.fillCaseFieldSystemName(name);
  }

  /**
   * Fill the result field hint
   */
  async fillResultFieldHint(hint: string): Promise<void> {
    await this.fillCaseFieldHint(hint);
  }

  /**
   * Select the result field type
   */
  async selectResultFieldType(type: ResultFieldType): Promise<void> {
    const typeSelector = this.page.getByTestId("result-field-type-select");
    await typeSelector.click();

    // Select the type from the dropdown
    const option = this.page.locator('[role="option"], [role="menuitem"]').filter({
      hasText: new RegExp(`^${type}$`, "i"),
    }).first();
    await option.click();
  }

  /**
   * Toggle result field enabled
   */
  async toggleResultFieldEnabled(enabled: boolean): Promise<void> {
    await this.toggleCaseFieldEnabled(enabled);
  }

  /**
   * Toggle result field required
   */
  async toggleResultFieldRequired(required: boolean): Promise<void> {
    await this.toggleCaseFieldRequired(required);
  }

  /**
   * Toggle result field restricted
   */
  async toggleResultFieldRestricted(restricted: boolean): Promise<void> {
    await this.toggleCaseFieldRestricted(restricted);
  }

  /**
   * Set result field default value
   */
  async setResultFieldDefaultValue(value: string): Promise<void> {
    const defaultValueInput = this.dialog.getByTestId("result-field-defaultValue");
    await defaultValueInput.fill(value);
  }

  /**
   * Set result field min value
   */
  async setResultFieldMinValue(value: number): Promise<void> {
    const minInput = this.dialog.getByTestId("result-field-minValue");
    await minInput.fill(value.toString());
  }

  /**
   * Set result field max value
   */
  async setResultFieldMaxValue(value: number): Promise<void> {
    const maxInput = this.dialog.getByTestId("result-field-maxValue");
    await maxInput.fill(value.toString());
  }

  /**
   * Set result field initial height
   */
  async setResultFieldInitialHeight(height: number): Promise<void> {
    const heightInput = this.dialog.getByTestId("result-field-initialHeight");
    await heightInput.fill(height.toString());
  }

  /**
   * Set the minimum value for integer result fields
   */
  async setResultFieldMinIntegerValue(value: number): Promise<void> {
    const minInput = this.dialog.getByTestId("result-field-minIntegerValue");
    await minInput.fill(value.toString());
  }

  /**
   * Set the maximum value for integer result fields
   */
  async setResultFieldMaxIntegerValue(value: number): Promise<void> {
    const maxInput = this.dialog.getByTestId("result-field-maxIntegerValue");
    await maxInput.fill(value.toString());
  }

  /**
   * Submit the result field form
   */
  async submitResultField(): Promise<void> {
    const submitButton = this.page.getByTestId("result-field-submit-button");
    await submitButton.click();
    await expect(this.dialog).not.toBeVisible({ timeout: 10000 });
    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Click the submit button without expecting dialog to close
   * Useful for testing validation errors
   */
  async clickSubmitResultField(): Promise<void> {
    const submitButton = this.page.getByTestId("result-field-submit-button");
    await submitButton.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Cancel the result field form
   */
  async cancelResultField(): Promise<void> {
    const cancelButton = this.page.getByTestId("result-field-cancel-button");
    await cancelButton.click();
    await expect(this.dialog).not.toBeVisible({ timeout: 5000 });
  }

  /**
   * Click edit for a result field in the table
   */
  async clickEditResultField(fieldName: string): Promise<void> {
    const row = this.resultFieldsTable.locator("tr").filter({ hasText: fieldName }).first();
    const editButton = row.getByTestId("edit-result-field-button");
    await editButton.click();
    await expect(this.dialog).toBeVisible({ timeout: 5000 });
  }

  /**
   * Click delete for a result field in the table
   */
  async clickDeleteResultField(fieldName: string): Promise<void> {
    const row = this.resultFieldsTable.locator("tr").filter({ hasText: fieldName }).first();
    const deleteButton = row.getByTestId("delete-result-field-button");
    await deleteButton.click();
  }

  /**
   * Toggle result field enabled in the table
   */
  async toggleResultFieldEnabledInTable(fieldName: string): Promise<void> {
    const row = this.resultFieldsTable.locator("tr").filter({ hasText: fieldName }).first();
    const enabledSwitch = row.locator('[role="switch"]').first();
    await enabledSwitch.click();
    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Toggle result field required in the table
   */
  async toggleResultFieldRequiredInTable(fieldName: string): Promise<void> {
    const row = this.resultFieldsTable.locator("tr").filter({ hasText: fieldName }).first();
    const requiredSwitch = row.locator('[role="switch"]').nth(1);
    await requiredSwitch.click();
    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Toggle result field restricted in the table
   */
  async toggleResultFieldRestrictedInTable(fieldName: string): Promise<void> {
    const row = this.resultFieldsTable.locator("tr").filter({ hasText: fieldName }).first();
    const restrictedSwitch = row.locator('[role="switch"]').nth(2);
    await restrictedSwitch.click();
    await this.page.waitForLoadState("networkidle");
  }

  // ============================================
  // Assertions
  // ============================================

  /**
   * Verify a template exists in the templates table
   */
  async expectTemplateInTable(name: string): Promise<void> {
    const row = this.templatesTable.locator("tr").filter({ hasText: name }).first();
    await expect(row).toBeVisible({ timeout: 10000 });
  }

  /**
   * Verify a template does not exist in the templates table
   */
  async expectTemplateNotInTable(name: string): Promise<void> {
    const row = this.templatesTable.locator("tr").filter({ hasText: name });
    await expect(row).not.toBeVisible({ timeout: 5000 });
  }

  /**
   * Verify a case field exists in the case fields table
   */
  async expectCaseFieldInTable(name: string): Promise<void> {
    const row = this.caseFieldsTable.locator("tr").filter({ hasText: name }).first();
    await expect(row).toBeVisible({ timeout: 10000 });
  }

  /**
   * Verify a case field does not exist in the case fields table
   */
  async expectCaseFieldNotInTable(name: string): Promise<void> {
    const row = this.caseFieldsTable.locator("tr").filter({ hasText: name });
    await expect(row).not.toBeVisible({ timeout: 5000 });
  }

  /**
   * Verify a result field exists in the result fields table
   */
  async expectResultFieldInTable(name: string): Promise<void> {
    const row = this.resultFieldsTable.locator("tr").filter({ hasText: name }).first();
    await expect(row).toBeVisible({ timeout: 10000 });
  }

  /**
   * Verify a result field does not exist in the result fields table
   */
  async expectResultFieldNotInTable(name: string): Promise<void> {
    const row = this.resultFieldsTable.locator("tr").filter({ hasText: name });
    await expect(row).not.toBeVisible({ timeout: 5000 });
  }

  /**
   * Verify a form error message is displayed
   */
  async expectFormError(message: string): Promise<void> {
    const errorElement = this.dialog.locator('[class*="error" i], [role="alert"], [class*="destructive"]').filter({
      hasText: message,
    }).first();
    await expect(errorElement).toBeVisible({ timeout: 5000 });
  }

  /**
   * Get the template row from the table
   */
  getTemplateRow(name: string): Locator {
    return this.templatesTable.locator("tr").filter({ hasText: name }).first();
  }

  /**
   * Get the case field row from the table
   */
  getCaseFieldRow(name: string): Locator {
    return this.caseFieldsTable.locator("tr").filter({ hasText: name }).first();
  }

  /**
   * Get the result field row from the table
   */
  getResultFieldRow(name: string): Locator {
    return this.resultFieldsTable.locator("tr").filter({ hasText: name }).first();
  }

  /**
   * Check if the Steps type is available in the field type dropdown
   */
  async isStepsTypeAvailable(): Promise<boolean> {
    // Open the type dropdown
    const typeSelector = this.dialog.locator('[role="combobox"]').first();
    await typeSelector.click();

    // Check if Steps option exists
    const stepsOption = this.page.locator('[role="option"]').filter({
      hasText: /^Steps$/i,
    }).first();
    const isVisible = await stepsOption.isVisible().catch(() => false);

    // Close dropdown
    await this.page.keyboard.press("Escape");

    return isVisible;
  }

  /**
   * Get the template's enabled state from the table
   */
  async isTemplateEnabled(name: string): Promise<boolean> {
    const row = this.getTemplateRow(name);
    const enabledSwitch = row.locator('[role="switch"]').first();
    return await enabledSwitch.getAttribute("aria-checked") === "true";
  }

  /**
   * Get the template's default state from the table
   */
  async isTemplateDefault(name: string): Promise<boolean> {
    const row = this.getTemplateRow(name);
    const defaultSwitch = row.locator('[role="switch"]').nth(1);
    return await defaultSwitch.getAttribute("aria-checked") === "true";
  }

  /**
   * Check if the delete button is disabled for a template
   */
  async isTemplateDeleteDisabled(name: string): Promise<boolean> {
    const row = this.getTemplateRow(name);
    const deleteButton = row.locator('button').filter({
      has: this.page.locator('svg[class*="trash" i], svg[class*="delete" i]'),
    }).first();
    const isDisabled = await deleteButton.isDisabled().catch(() => false);
    const isHidden = !(await deleteButton.isVisible().catch(() => false));
    return isDisabled || isHidden;
  }

  /**
   * Check if the enabled switch is disabled for a template
   */
  async isTemplateEnabledSwitchDisabled(name: string): Promise<boolean> {
    const row = this.getTemplateRow(name);
    const enabledSwitch = row.locator('[role="switch"]').first();
    return await enabledSwitch.isDisabled();
  }

  /**
   * Get the case fields count for a template
   */
  async getTemplateCaseFieldsCount(name: string): Promise<number> {
    const row = this.getTemplateRow(name);
    // The case fields column (2nd column, index 1) shows a button with count
    const caseFieldsCell = row.locator("td").nth(1);
    // The count is inside a button element
    const button = caseFieldsCell.locator("button").first();
    const buttonExists = await button.count() > 0;

    if (!buttonExists) {
      return 0;
    }

    const text = await button.textContent() || "";
    // Extract number from text
    const match = text.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  }

  /**
   * Get the result fields count for a template
   */
  async getTemplateResultFieldsCount(name: string): Promise<number> {
    const row = this.getTemplateRow(name);
    // The result fields column (3rd column, index 2) shows a button with count
    const resultFieldsCell = row.locator("td").nth(2);
    // The count is inside a button element
    const button = resultFieldsCell.locator("button").first();
    const buttonExists = await button.count() > 0;

    if (!buttonExists) {
      return 0;
    }

    const text = await button.textContent() || "";
    const match = text.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  }

  /**
   * Get the templates count for a case field
   */
  async getCaseFieldTemplatesCount(name: string): Promise<number> {
    const row = this.getCaseFieldRow(name);
    const templatesCell = row.locator("td").nth(3); // Assuming 4th column
    const text = await templatesCell.textContent() || "";
    const match = text.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  }

  /**
   * Get the templates count for a result field
   */
  async getResultFieldTemplatesCount(name: string): Promise<number> {
    const row = this.getResultFieldRow(name);
    const templatesCell = row.locator("td").nth(3); // Assuming 4th column
    const text = await templatesCell.textContent() || "";
    const match = text.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  }
}
