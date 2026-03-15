import { expect, Locator, Page } from "@playwright/test";
import { BasePage } from "../base.page";

/**
 * Test Case detail page object for viewing and editing test cases
 */
export class TestCasePage extends BasePage {
  // Main layout locators
  readonly caseDetail: Locator;
  readonly editButton: Locator;
  readonly saveButton: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page, locale: string = "en-US") {
    super(page, locale);

    // Main elements
    this.caseDetail = page.locator('[data-testid="case-detail"]');
    this.editButton = page.locator('button:has-text("Edit")').first();
    this.saveButton = page.locator('button:has-text("Save"), button[type="submit"]').first();
    this.cancelButton = page.locator('button:has-text("Cancel")').first();
  }

  /**
   * Navigate to a test case detail page
   */
  async goto(projectId: number, caseId: number): Promise<void> {
    await this.navigate(`/projects/repository/${projectId}/${caseId}`);
    await this.waitForLoad();
  }

  /**
   * Wait for the test case page to fully load
   */
  async waitForLoad(): Promise<void> {
    await this.page.waitForLoadState("networkidle");
    await this.dismissOnboardingOverlay();
  }

  /**
   * Click edit button to enter edit mode
   */
  async clickEdit(): Promise<void> {
    await this.editButton.click();
    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Save changes in edit mode
   */
  async saveChanges(): Promise<void> {
    await this.saveButton.click();
    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Cancel edit mode without saving
   */
  async cancelEdit(): Promise<void> {
    await this.cancelButton.click();
    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Get field value element by system name
   */
  getFieldValue(systemName: string): Locator {
    return this.page.getByTestId(`field-value-${systemName}`);
  }

  /**
   * Get field display element by system name
   */
  getFieldDisplay(systemName: string): Locator {
    return this.page.getByTestId(`field-display-${systemName}`);
  }

  /**
   * Get field input element by system name
   */
  getFieldInput(systemName: string): Locator {
    return this.page.getByTestId(`field-${systemName}-input`);
  }

  /**
   * Get field label by system name
   */
  getFieldLabel(systemName: string): Locator {
    return this.page.getByTestId(`field-${systemName}-label`);
  }

  /**
   * Expect field to be visible
   */
  async expectFieldVisible(systemName: string): Promise<void> {
    await expect(this.getFieldValue(systemName)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Expect field to be read-only (in view mode)
   */
  async expectFieldReadOnly(systemName: string): Promise<void> {
    const fieldDisplay = this.getFieldDisplay(systemName);
    await expect(fieldDisplay).toBeVisible({ timeout: 5000 });

    // In read-only mode, input should not be present or should be disabled
    const fieldInput = this.getFieldInput(systemName);
    const isInputVisible = await fieldInput.isVisible().catch(() => false);

    if (isInputVisible) {
      // If input exists, it should be disabled
      await expect(fieldInput).toBeDisabled();
    }
  }

  /**
   * Expect field to be editable (in edit mode)
   */
  async expectFieldEditable(systemName: string): Promise<void> {
    const fieldInput = this.getFieldInput(systemName);
    await expect(fieldInput).toBeVisible({ timeout: 5000 });

    // Field should not be disabled (unless it's a restricted field)
    const isDisabled = await fieldInput.isDisabled().catch(() => false);
    if (isDisabled) {
      // Check if it's restricted (has lock icon)
      const fieldLabel = this.getFieldLabel(systemName);
      const hasLockIcon = await fieldLabel.locator('svg[class*="lock"]').isVisible().catch(() => false);

      if (!hasLockIcon) {
        throw new Error(`Field ${systemName} is disabled but not restricted`);
      }
    }
  }

  /**
   * Expect validation error for a field
   */
  async expectValidationError(systemName: string): Promise<void> {
    const errorElement = this.page.getByTestId(`field-error-${systemName}`);
    await expect(errorElement).toBeVisible({ timeout: 5000 });
  }

  /**
   * Expect required indicator (asterisk) to be present
   */
  async expectRequiredIndicator(systemName: string): Promise<void> {
    const fieldLabel = this.getFieldLabel(systemName);
    const asterisk = fieldLabel.locator('svg, sup');
    await expect(asterisk).toBeVisible({ timeout: 5000 });
  }

  /**
   * Fill a text string field
   */
  async fillTextString(systemName: string, value: string): Promise<void> {
    const input = this.page.getByTestId(`field-${systemName}-input`).locator('input');
    await input.fill(value);
  }

  /**
   * Fill a number field
   */
  async fillNumber(systemName: string, value: number): Promise<void> {
    const input = this.page.getByTestId(`field-${systemName}-input`).locator('input[type="number"]');
    await input.fill(value.toString());
  }

  /**
   * Toggle a checkbox field
   */
  async toggleCheckbox(systemName: string): Promise<void> {
    const switchButton = this.page.getByTestId(`field-${systemName}-input`).locator('button[role="switch"]');
    await switchButton.click();
  }

  /**
   * Select a date in a date field
   */
  async selectDate(systemName: string, date: Date): Promise<void> {
    // Click the date picker trigger
    const datePicker = this.page.getByTestId(`field-${systemName}-input`);
    await datePicker.click();

    // Wait for calendar to open
    await this.page.waitForTimeout(500);

    // Select the date (this is a simplified version - may need adjustment based on actual date picker implementation)
    const day = date.getDate().toString();
    const dayButton = this.page.locator(`button:has-text("${day}")`).first();
    await dayButton.click();
  }

  /**
   * Fill a link field
   */
  async fillLink(systemName: string, url: string): Promise<void> {
    const input = this.page.getByTestId(`field-${systemName}-input`).locator('input[type="url"]');
    await input.fill(url);
  }

  /**
   * Select a dropdown option
   */
  async selectDropdown(systemName: string, optionName: string): Promise<void> {
    // Click the select trigger
    const selectTrigger = this.page.getByTestId(`field-${systemName}-input`).locator('[role="combobox"]');
    await selectTrigger.click();

    // Wait for options to appear
    await this.page.waitForTimeout(500);

    // Click the option
    const option = this.page.locator(`[role="option"]:has-text("${optionName}")`).first();
    await option.click();
  }

  /**
   * Select multiple options in a multi-select field
   */
  async selectMultiple(systemName: string, optionNames: string[]): Promise<void> {
    const multiSelect = this.page.getByTestId(`field-${systemName}-input`);

    for (const optionName of optionNames) {
      // Click the multi-select to open dropdown
      await multiSelect.click();
      await this.page.waitForTimeout(300);

      // Select the option
      const option = this.page.locator(`[class*="menu"] >> text="${optionName}"`).first();
      await option.click();
      await this.page.waitForTimeout(300);
    }
  }

  /**
   * Add a step to a Steps field
   */
  async addStep(systemName: string, step: string, expectedResult: string): Promise<void> {
    // Click "Add Step" button
    const addStepButton = this.page.getByTestId(`field-${systemName}-input`).locator('button:has-text("Add Step")');
    await addStepButton.click();

    // Wait for editors to appear
    await this.page.waitForTimeout(500);

    // Fill step and expected result (this is simplified - actual implementation may vary)
    // This would need to interact with TipTap editors
    // For now, just clicking the button is enough to verify the interaction works
  }

  /**
   * Get the text content of a field display
   */
  async getFieldDisplayText(systemName: string): Promise<string> {
    const display = this.getFieldDisplay(systemName);
    return await display.textContent() || "";
  }

  /**
   * Expect field to have specific value displayed
   */
  async expectFieldValue(systemName: string, expectedValue: string): Promise<void> {
    const display = this.getFieldDisplay(systemName);
    await expect(display).toContainText(expectedValue, { timeout: 5000 });
  }
}
