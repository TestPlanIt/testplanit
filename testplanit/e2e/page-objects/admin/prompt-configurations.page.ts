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
    this.dialog = page.locator('[role="dialog"]').first();
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
    // The Filter component has a 300ms debounce, and the page adds another 500ms debounce
    // on the search string before it hits the API query. Wait for both plus network time.
    await this.page.waitForTimeout(1200);
    // Wait for any in-flight network requests to settle
    await this.page.waitForLoadState("networkidle");
  }

  async getTableRowCount(): Promise<number> {
    // Wait for the pagination info to appear, indicating data has loaded
    const paginationInfo = this.page.locator(
      'text=/Showing \\d+-\\d+ of \\d+ item|No items found/i'
    );
    await paginationInfo.first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});

    // Wait for any loading skeletons to disappear
    const skeleton = this.dataTable.locator('[data-slot="skeleton"]');
    await skeleton.first().waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});

    const rows = this.dataTable.locator("tbody tr");
    const count = await rows.count();

    // If the single row contains "No results" or similar empty state, return 0
    if (count === 1) {
      const text = await rows.first().textContent();
      if (text && /no.*results|no.*items|no.*data/i.test(text)) {
        return 0;
      }
    }
    return count;
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
    const editButton = row.locator('button:has(svg.lucide-square-pen), button:has(svg[class*="lucide-pencil"]), button:has(svg[class*="edit"])').first();
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
