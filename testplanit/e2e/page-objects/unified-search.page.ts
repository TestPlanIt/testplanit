import { Page, Locator, expect } from "@playwright/test";
import { BasePage } from "./base.page";

/**
 * Page object for the Unified Search component (global search with Cmd/Ctrl+K)
 */
export class UnifiedSearchPage extends BasePage {
  // Locators
  private get searchDialog(): Locator {
    return this.page.locator('[role="dialog"]').filter({ hasText: /search/i });
  }

  private get searchInput(): Locator {
    return this.searchDialog.getByPlaceholder(/search/i);
  }

  private get resultsContainer(): Locator {
    return this.searchDialog.locator('[data-testid="search-results"]');
  }

  private get noResultsMessage(): Locator {
    return this.searchDialog.locator('text=/no results/i');
  }

  /**
   * Open the unified search dialog using keyboard shortcut
   */
  async open(): Promise<void> {
    const isMac = process.platform === "darwin";
    const modifier = isMac ? "Meta" : "Control";
    await this.page.keyboard.press(`${modifier}+KeyK`);
    await expect(this.searchDialog).toBeVisible({ timeout: 5000 });
  }

  /**
   * Close the search dialog
   */
  async close(): Promise<void> {
    await this.page.keyboard.press("Escape");
    await expect(this.searchDialog).not.toBeVisible({ timeout: 2000 });
  }

  /**
   * Search for a query
   */
  async search(query: string): Promise<void> {
    await this.searchInput.fill(query);
    // Wait for debounce and search to complete
    await this.page.waitForLoadState("networkidle");
    await this.page.waitForTimeout(500); // Additional wait for results to render
  }

  /**
   * Clear the search input
   */
  async clearSearch(): Promise<void> {
    await this.searchInput.clear();
    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Get all search result cards
   */
  getResults(): Locator {
    return this.searchDialog.locator('[class*="cursor-pointer"]').filter({
      has: this.page.locator('[class*="rounded"]'),
    });
  }

  /**
   * Get a specific result by name
   */
  getResultByName(name: string): Locator {
    return this.searchDialog.locator(`text="${name}"`).first();
  }

  /**
   * Click on a search result
   */
  async clickResult(name: string): Promise<void> {
    const result = this.getResultByName(name);
    await result.click();
  }

  /**
   * Check if a result contains highlighted text
   */
  async hasHighlight(resultName: string): Promise<boolean> {
    const resultCard = this.getResultByName(resultName)
      .locator("..")
      .locator("..")
      .locator("..");

    const highlights = resultCard.locator('.search-highlight, mark[class*="search-highlight"]');
    const count = await highlights.count();
    return count > 0;
  }

  /**
   * Get all highlighted text within a result
   */
  async getHighlightedTexts(resultName: string): Promise<string[]> {
    const resultCard = this.getResultByName(resultName)
      .locator("..")
      .locator("..")
      .locator("..");

    const highlights = resultCard.locator('.search-highlight, mark[class*="search-highlight"]');
    const count = await highlights.count();
    const texts: string[] = [];

    for (let i = 0; i < count; i++) {
      const text = await highlights.nth(i).textContent();
      if (text) {
        texts.push(text);
      }
    }

    return texts;
  }

  /**
   * Check if a step within a result has yellow highlight background
   */
  async hasStepHighlightBackground(resultName: string): Promise<boolean> {
    const resultCard = this.getResultByName(resultName)
      .locator("..")
      .locator("..")
      .locator("..");

    const yellowBackground = resultCard.locator('.bg-yellow-50, [class*="bg-yellow-50"]');
    const count = await yellowBackground.count();
    return count > 0;
  }

  /**
   * Wait for results to load
   */
  async waitForResults(): Promise<void> {
    await this.page.waitForLoadState("networkidle");
    // Wait for either results or no results message
    await Promise.race([
      expect(this.getResults().first()).toBeVisible({ timeout: 5000 }),
      expect(this.noResultsMessage).toBeVisible({ timeout: 5000 }),
    ]);
  }

  /**
   * Get the count of results
   */
  async getResultCount(): Promise<number> {
    try {
      await this.waitForResults();
      return await this.getResults().count();
    } catch {
      return 0;
    }
  }

  /**
   * Check if "no results" message is shown
   */
  async hasNoResults(): Promise<boolean> {
    try {
      await expect(this.noResultsMessage).toBeVisible({ timeout: 2000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Select entity type filter
   */
  async selectEntityType(entityType: string): Promise<void> {
    const entitySelector = this.searchDialog.getByRole("button").filter({
      hasText: /repository cases|shared steps|test runs|sessions|projects|issues|milestones/i,
    });

    await entitySelector.click();

    // Click on the desired entity type in the dropdown
    const option = this.page.getByText(entityType, { exact: false });
    await option.click();

    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Toggle "Current project only" filter
   */
  async toggleCurrentProjectOnly(): Promise<void> {
    const toggle = this.searchDialog.locator('text=/current project only/i').locator("..");
    await toggle.click();
    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Open advanced filters
   */
  async openAdvancedFilters(): Promise<void> {
    const filterButton = this.searchDialog.getByRole("button").filter({
      has: this.page.locator('svg.lucide-funnel'),
    });
    await filterButton.click();
    await expect(this.page.locator('[data-testid="faceted-filters"]')).toBeVisible();
  }

  /**
   * Verify that a result contains specific text in its highlights
   */
  async verifyHighlightContains(resultName: string, expectedText: string): Promise<void> {
    const highlights = await this.getHighlightedTexts(resultName);
    const hasExpectedText = highlights.some((text) =>
      text.toLowerCase().includes(expectedText.toLowerCase())
    );
    expect(hasExpectedText).toBe(true);
  }

  /**
   * Verify that a result has highlighted steps (yellow background)
   */
  async verifyStepHighlighting(resultName: string): Promise<void> {
    const hasBackground = await this.hasStepHighlightBackground(resultName);
    expect(hasBackground).toBe(true);
  }
}
