import { Page, Locator, expect } from "@playwright/test";
import { BasePage } from "../base.page";

/**
 * Repository page object for test case management
 */
export class RepositoryPage extends BasePage {
  // Main layout locators
  readonly layout: Locator;
  readonly leftPanel: Locator;
  readonly rightPanelHeader: Locator;

  // Folder tree locators
  readonly folderTree: Locator;
  readonly addFolderButton: Locator;

  // Add folder modal locators
  readonly folderNameInput: Locator;
  readonly folderParentSelect: Locator;
  readonly folderSubmitButton: Locator;
  readonly folderCancelButton: Locator;

  // Cases table locators
  readonly casesTable: Locator;
  readonly addCaseButton: Locator;
  readonly searchInput: Locator;

  constructor(page: Page, locale: string = "en-US") {
    super(page, locale);

    // Main layout
    this.layout = page.getByTestId("repository-layout");
    this.leftPanel = page.getByTestId("repository-left-panel");
    this.rightPanelHeader = page.getByTestId("repository-right-panel-header");

    // Folder tree
    this.folderTree = this.leftPanel;
    this.addFolderButton = page.getByTestId("add-folder-button");

    // Add folder modal (visible when modal is open)
    this.folderNameInput = page.getByTestId("folder-name-input");
    this.folderParentSelect = page.getByTestId("folder-parent-select");
    this.folderSubmitButton = page.getByTestId("folder-submit-button");
    this.folderCancelButton = page.getByTestId("folder-cancel-button");

    // Cases table
    this.casesTable = page.locator('[data-testid="cases-table"], table').first();
    this.addCaseButton = page.getByTestId("add-case-button").or(
      page.locator('button:has-text("Add Case")').first()
    );
    this.searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="Filter"]').first();
  }

  /**
   * Navigate to the repository page for a project
   */
  async goto(projectId: number | string): Promise<void> {
    await this.navigate(`/projects/repository/${projectId}`);
    await this.waitForRepositoryLoad();
  }

  /**
   * Wait for repository page to fully load
   */
  async waitForRepositoryLoad(): Promise<void> {
    await this.page.waitForLoadState("networkidle");
    // Wait for the layout to be visible
    await expect(this.layout).toBeVisible({ timeout: 15000 });
    // Dismiss any onboarding overlays that may be blocking interactions
    await this.dismissOnboardingOverlay();
  }

  /**
   * Get a folder node by ID
   */
  getFolderById(folderId: number): Locator {
    return this.page.getByTestId(`folder-node-${folderId}`);
  }

  /**
   * Get a folder node by name
   */
  getFolderByName(name: string): Locator {
    // Match folder nodes in the tree - use data-testid which is more specific
    // and avoid matching nested elements by targeting only direct folder nodes
    return this.leftPanel.locator('[data-testid^="folder-node-"]').filter({
      hasText: name,
    });
  }

  /**
   * Select a folder in the tree
   */
  async selectFolder(folderId: number): Promise<void> {
    const folder = this.getFolderById(folderId);
    await folder.click();
    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Select a folder by name
   */
  async selectFolderByName(name: string): Promise<void> {
    const folder = this.getFolderByName(name);
    await folder.click();
    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Expand a folder in the tree
   */
  async expandFolder(folderId: number): Promise<void> {
    const folder = this.getFolderById(folderId);
    // Look for the expand button - it's a Button with ChevronRight svg inside
    // The button has class containing "h-6 w-6" and the svg has class "w-4 h-4"
    const expandButton = folder.locator('button').filter({ has: this.page.locator('svg.lucide-chevron-right, svg[class*="lucide-chevron"]') }).first();
    await expect(expandButton).toBeVisible({ timeout: 5000 });
    await expandButton.click();
    // Wait for children to be visible (animation complete)
    await this.page.waitForLoadState("networkidle");
    // Give tree a moment to render children
    await this.page.waitForTimeout(300);
  }

  /**
   * Open the folder context menu (dropdown menu with Edit/Delete options)
   * The menu button appears on hover over the folder row
   */
  async openFolderContextMenu(folderId: number): Promise<void> {
    const folder = this.getFolderById(folderId);
    // Hover to make the menu button visible
    await folder.hover();
    // Find the "more" button (MoreVertical icon) - it's a button inside the folder row
    const moreButton = folder.locator('button').filter({
      has: this.page.locator('svg.lucide-more-vertical, svg[class*="lucide-ellipsis"]')
    }).first();
    // If the specific icon isn't found, try a more generic approach - look for any button that's not the expand button
    const menuButton = await moreButton.isVisible()
      ? moreButton
      : folder.locator('button').last();
    await menuButton.click();
    // Wait for dropdown menu to appear
    await this.page.locator('[role="menu"], [data-radix-menu-content]').waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Open folder context menu by folder name
   */
  async openFolderContextMenuByName(name: string): Promise<void> {
    const folder = this.getFolderByName(name).first();
    // Hover to make the menu button visible
    await folder.hover();
    // Find the "more" button (MoreVertical icon)
    const moreButton = folder.locator('button').filter({
      has: this.page.locator('svg.lucide-more-vertical, svg[class*="lucide-ellipsis"]')
    }).first();
    const menuButton = await moreButton.isVisible()
      ? moreButton
      : folder.locator('button').last();
    await menuButton.click();
    // Wait for dropdown menu to appear
    await this.page.locator('[role="menu"], [data-radix-menu-content]').waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Click on a menu item in the folder context menu
   */
  async clickFolderMenuItem(itemText: string): Promise<void> {
    const menuItem = this.page.locator('[role="menuitem"]').filter({ hasText: itemText }).first();
    await menuItem.click();
  }

  /**
   * Open the add folder modal
   */
  async openAddFolderModal(): Promise<void> {
    await this.addFolderButton.click();
    await expect(this.folderNameInput).toBeVisible({ timeout: 5000 });
  }

  /**
   * Create a new folder at root level
   */
  async createFolder(name: string): Promise<void> {
    await this.openAddFolderModal();

    // If a parent folder is shown, click the X button to create at root level instead
    // This ensures the folder is visible without needing to expand a parent
    // Wait for the parent folder query to load and display the button
    const removeParentButton = this.page.getByTestId('remove-parent-folder-button');
    try {
      await removeParentButton.waitFor({ state: 'visible', timeout: 3000 });
      await removeParentButton.click();
      // Wait for "Root folder" text to appear (indicates parent was removed)
      await this.page.getByText('Root folder').first().waitFor({ state: 'visible', timeout: 2000 });
    } catch {
      // No parent folder shown, creating at root level
    }

    // Fill in the folder name
    await this.folderNameInput.fill(name);

    // Wait for submit button to be enabled and click
    await expect(this.folderSubmitButton).toBeEnabled({ timeout: 5000 });

    // Click submit and wait for the API call to complete
    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes("/api/model/repositoryFolders") &&
        response.request().method() === "POST",
      { timeout: 15000 }
    );

    await this.folderSubmitButton.click();

    // Wait for the API response
    const response = await responsePromise;
    if (!response.ok()) {
      const text = await response.text();
      throw new Error(`Folder creation failed: ${response.status()} - ${text}`);
    }

    // Wait for modal to close (indicates success)
    await expect(this.folderNameInput).not.toBeVisible({ timeout: 10000 });

    // Wait for network to settle after folder creation (includes query invalidation refetch)
    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Create a nested folder under a parent
   */
  async createNestedFolder(name: string, parentFolderId: number): Promise<void> {
    // First select the parent folder
    await this.selectFolder(parentFolderId);
    // Open the add folder modal from context or button
    await this.openAddFolderModal();
    await this.folderNameInput.fill(name);
    await this.folderSubmitButton.click();
    await expect(this.folderNameInput).not.toBeVisible({ timeout: 10000 });
    // Wait for network to settle after folder creation
    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Verify a folder exists in the tree
   */
  async verifyFolderExists(name: string): Promise<void> {
    // Wait for the folder to be visible first, then scroll if needed
    const folder = this.getFolderByName(name).first();
    await expect(folder).toBeVisible({ timeout: 10000 });
    // Only try to scroll if already visible (avoid race conditions)
    try {
      await folder.scrollIntoViewIfNeeded({ timeout: 3000 });
    } catch {
      // Ignore scroll errors - the element is already verified as visible
    }
  }

  /**
   * Verify a folder does not exist in the tree
   */
  async verifyFolderNotExists(name: string): Promise<void> {
    await expect(this.getFolderByName(name)).not.toBeVisible();
  }

  /**
   * Get a test case row by name
   */
  getTestCaseByName(name: string): Locator {
    return this.casesTable.locator("tr").filter({ hasText: name });
  }

  /**
   * Verify a test case exists in the table
   */
  async verifyTestCaseExists(name: string): Promise<void> {
    await expect(this.getTestCaseByName(name)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Search for test cases
   */
  async searchTestCases(query: string): Promise<void> {
    await this.searchInput.fill(query);
    // Wait for the search API call to complete (debounced input triggers API request)
    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Open add case modal
   */
  async openAddCaseModal(): Promise<void> {
    await this.addCaseButton.click();
    // Wait for modal to be visible
    await expect(
      this.page.locator('[role="dialog"]')
    ).toBeVisible({ timeout: 5000 });
  }

  /**
   * Create a new test case via UI
   */
  async createTestCase(name: string): Promise<void> {
    await this.openAddCaseModal();

    // Fill in the test case name
    const nameInput = this.page.getByTestId("case-name-input").or(
      this.page.locator('[role="dialog"] input[name="name"], [role="dialog"] input[placeholder*="name" i]').first()
    );
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.fill(name);

    // Submit the form
    const submitButton = this.page.getByTestId("case-submit-button").or(
      this.page.locator('[role="dialog"] button[type="submit"], [role="dialog"] button:has-text("Create"), [role="dialog"] button:has-text("Save")').first()
    );
    await expect(submitButton).toBeEnabled({ timeout: 5000 });

    // Wait for the API call to complete
    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes("/api/model/repositoryCases") &&
        response.request().method() === "POST",
      { timeout: 15000 }
    );

    await submitButton.click();

    // Wait for the API response
    const response = await responsePromise;
    if (!response.ok()) {
      const text = await response.text();
      throw new Error(`Test case creation failed: ${response.status()} - ${text}`);
    }

    // Wait for modal to close (indicates success)
    await expect(this.page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 10000 });

    // Wait for network to settle after creation
    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Get the count of test cases displayed
   */
  async getDisplayedCaseCount(): Promise<number> {
    const rows = this.casesTable.locator("tbody tr");
    return await rows.count();
  }

  /**
   * Check if the page is in a loading state
   */
  async isLoading(): Promise<boolean> {
    const loadingIndicator = this.page.locator(
      '[data-loading="true"], .animate-spin, [role="progressbar"]'
    );
    return await loadingIndicator.isVisible();
  }

  /**
   * Delete a folder via context menu
   */
  async deleteFolder(folderId: number): Promise<void> {
    const folder = this.getFolderById(folderId);
    // Right-click to open context menu
    await folder.click({ button: "right" });
    // Click delete option
    await this.page.locator('[role="menuitem"]:has-text("Delete")').click();
    // Confirm deletion
    const confirmButton = this.page.locator(
      '[role="alertdialog"] button:has-text("Delete"), button:has-text("Confirm")'
    ).first();
    await confirmButton.click();
    await this.waitForToast();
  }
}
