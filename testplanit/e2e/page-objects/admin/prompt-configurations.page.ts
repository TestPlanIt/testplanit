import { expect, Locator, Page } from "@playwright/test";
import { BasePage } from "../base.page";

/**
 * Page object for Admin > Prompt Configurations page
 */
export class PromptConfigurationsPage extends BasePage {
  // Page elements
  readonly pageTitle: Locator;
  readonly addButton: Locator;
  readonly filterInput: Locator;
  readonly dataTable: Locator;

  // Add/Edit dialog elements
  readonly dialog: Locator;
  readonly nameInput: Locator;
  readonly descriptionInput: Locator;
  readonly isDefaultSwitch: Locator;
  readonly isActiveSwitch: Locator;
  readonly submitButton: Locator;
  readonly cancelButton: Locator;

  // Delete dialog
  readonly deleteDialog: Locator;
  readonly deleteConfirmButton: Locator;

  constructor(page: Page) {
    super(page);
    this.pageTitle = page.getByTestId("prompts-admin-page-title");
    this.addButton = page.locator("button", {
      hasText: "Add Prompt Configuration",
    });
    this.filterInput = page.getByPlaceholder(
      "Filter prompt configurations..."
    );
    this.dataTable = page.locator("table");

    // Dialog elements
    this.dialog = page.locator('[role="dialog"]');
    this.nameInput = this.dialog.getByLabel("Name", { exact: true });
    this.descriptionInput = this.dialog.getByLabel("Description");
    this.isDefaultSwitch = this.dialog
      .locator("label", { hasText: "Default" })
      .locator("..");
    this.isActiveSwitch = this.dialog
      .locator("label", { hasText: "Active" })
      .locator("..");
    this.submitButton = this.dialog.locator(
      'button[type="submit"], button:has-text("Save")'
    );
    this.cancelButton = this.dialog.locator('button:has-text("Cancel")');

    // Delete dialog
    this.deleteDialog = page.locator('[role="alertdialog"]');
    this.deleteConfirmButton = this.deleteDialog.locator(
      'button:has-text("Delete")'
    );
  }

  async goto(): Promise<void> {
    await this.navigate("/admin/prompts");
    await this.waitForPageLoad();
  }

  async clickAdd(): Promise<void> {
    await this.addButton.click();
    await expect(this.dialog).toBeVisible();
  }

  async fillName(name: string): Promise<void> {
    await this.nameInput.clear();
    await this.nameInput.fill(name);
  }

  async fillDescription(description: string): Promise<void> {
    await this.descriptionInput.clear();
    await this.descriptionInput.fill(description);
  }

  async submitForm(): Promise<void> {
    await this.submitButton.click();
  }

  async filterByText(text: string): Promise<void> {
    await this.filterInput.clear();
    await this.filterInput.fill(text);
    // Wait for debounce
    await this.page.waitForTimeout(600);
  }

  async getTableRowCount(): Promise<number> {
    await this.page.waitForTimeout(500);
    const rows = this.dataTable.locator("tbody tr");
    return rows.count();
  }

  async expectConfigInTable(name: string): Promise<void> {
    const row = this.dataTable.locator("tbody tr", { hasText: name });
    await expect(row.first()).toBeVisible({ timeout: 10000 });
  }

  async expectConfigNotInTable(name: string): Promise<void> {
    const row = this.dataTable.locator("tbody tr", { hasText: name });
    await expect(row).not.toBeVisible({ timeout: 5000 });
  }

  async clickEditOnRow(name: string): Promise<void> {
    const row = this.dataTable.locator("tbody tr", { hasText: name });
    const editButton = row.locator('button:has([class*="lucide-pencil"])');
    await editButton.click();
    await expect(this.dialog).toBeVisible();
  }

  async clickDeleteOnRow(name: string): Promise<void> {
    const row = this.dataTable.locator("tbody tr", { hasText: name });
    const deleteButton = row.locator('button:has([class*="lucide-trash"])');
    await deleteButton.click();
    await expect(this.deleteDialog).toBeVisible();
  }

  async confirmDelete(): Promise<void> {
    await this.deleteConfirmButton.click();
  }
}
