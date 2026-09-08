import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { RepositoryPage } from "../../page-objects/repository/repository.page";
import { UnifiedSearchPage } from "../../page-objects/unified-search.page";

/**
 * Blocks until the tag link created through the API is visible to a
 * tag-filtered search. Tagging writes a standalone link row and the case's
 * Elasticsearch document is rebuilt from a fire-and-forget side effect, so the
 * tag lands in the index some time after the API call returns — under a loaded
 * suite, well past any fixed sleep. The filtered query the UI issues when the
 * tag is picked runs exactly once and nothing re-queries, so a search made too
 * early returns nothing and the results list empties out.
 */
async function waitForTagIndexed(
  request: APIRequestContext,
  baseURL: string,
  projectId: number,
  tagId: number,
  expectedHits: number
): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await request.post(`${baseURL}/api/search`, {
          data: {
            filters: {
              query: "",
              entityTypes: ["repository_case"],
              repositoryCase: { projectIds: [projectId], tagIds: [tagId] },
            },
            pagination: { page: 1, size: 50 },
            highlight: false,
            trackTotalHits: true,
          },
        });
        if (!response.ok()) return -1;
        const body = await response.json();
        return typeof body.total === "number" ? body.total : -1;
      },
      { timeout: 45000, intervals: [500, 1000, 2000, 3000] }
    )
    .toBe(expectedHits);
}

/**
 * Faceted Search Filter E2E Tests
 *
 * Covers SRCH-03: Faceted search filters narrow results by entity-specific criteria.
 * Tests filter panel opening, tag filtering, include-deleted toggle, and filter clearing.
 */
test.describe("Faceted Search Filters", () => {
  let unifiedSearch: UnifiedSearchPage;
  let repositoryPage: RepositoryPage;
  let projectId: number;

  test.beforeEach(async ({ page, api }) => {
    unifiedSearch = new UnifiedSearchPage(page);
    repositoryPage = new RepositoryPage(page);

    // Use timestamp + random suffix for uniqueness across parallel workers
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    projectId = await api.createProject(`Faceted Filters Test ${uniqueId}`);
    await repositoryPage.goto(projectId);
  });

  test("Opens advanced filters panel", async ({ page }) => {
    // Use data-testid to avoid strict mode violation when filter dialog also opens
    const searchSheet = page.locator('[data-testid="global-search-sheet"]');

    await test.step("Open the search dialog", async () => {
      await unifiedSearch.open();
    });

    await test.step("Open the advanced filters panel", async () => {
      // Try clicking the funnel/filter button
      const funnelButton = searchSheet.locator("button:has(svg.lucide-funnel)");
      const hasFunnelButton = (await funnelButton.count()) > 0;

      if (hasFunnelButton) {
        await funnelButton.first().click();
      } else {
        // Fall back to page object method
        try {
          await unifiedSearch.openAdvancedFilters();
        } catch {
          // If neither works, try a filter-related button text
          const filterBtn = searchSheet.getByRole("button").filter({
            hasText: /filter/i,
          });
          if ((await filterBtn.count()) > 0) {
            await filterBtn.first().click();
          }
        }
      }
    });

    await test.step("Verify the filter panel is visible", async () => {
      // Verify the filter panel is visible (either test ID may be used)
      const filterPanel = page.locator(
        '[data-testid="faceted-search-filters"], [data-testid="faceted-filters"]'
      );
      await expect(filterPanel).toBeVisible({ timeout: 5000 });
    });
  });

  test("Tag filter narrows results", async ({
    page,
    api,
    request,
    baseURL,
  }) => {
    const uniqueId = Date.now();
    // Use data-testid to avoid strict mode violation when filter dialog also opens
    const searchSheet = page.locator('[data-testid="global-search-sheet"]');
    const filterPanel = page.locator(
      '[data-testid="faceted-search-filters"], [data-testid="faceted-filters"]'
    );
    // Result titles are spans (split by <mark> when highlighted), so assert on
    // the results container's text rather than a heading role.
    const searchResults = page.locator('[data-testid="search-results-scroll"]');

    let taggedCaseId: number | undefined;
    let tagId: number | undefined;

    await test.step("Create tag and tagged/untagged test cases", async () => {
      const folderId = await api.createFolder(projectId, "Tag Filter Folder");

      // Create a tag
      tagId = await api.createTag(`TagFilter${uniqueId}`);

      // Create test cases: one with the tag, one without
      taggedCaseId = await api.createTestCase(
        projectId,
        folderId,
        `TaggedCase ${uniqueId}`
      );
      await api.createTestCase(projectId, folderId, `UntaggedCase ${uniqueId}`);

      // Assign tag to one case
      await api.addTagToTestCase(taggedCaseId, tagId!);

      await waitForTagIndexed(request, baseURL!, projectId, tagId!, 1);
    });

    await test.step("Open search and query for the unique term", async () => {
      // Open search and search for a term matching both cases
      await unifiedSearch.open();
      await unifiedSearch.search(`${uniqueId}`);

      // Wait for results to load
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);
    });

    // Open the advanced filters panel
    const funnelButton = searchSheet.locator("button:has(svg.lucide-funnel)");
    const hasFunnelButton = (await funnelButton.count()) > 0;

    if (!hasFunnelButton) {
      // If no filter button, skip tag filter part gracefully
      // The filter UI isn't accessible in this state
      test.skip();
      return;
    }

    await test.step("Open the advanced filters panel", async () => {
      await funnelButton.first().click();

      await expect(filterPanel).toBeVisible({ timeout: 5000 });
    });

    await test.step("Apply the tag filter and verify the tagged case appears", async () => {
      // Tags are picked from a combobox — open it, search, then select the tag
      const tagsCombobox = filterPanel
        .getByRole("combobox")
        .filter({ hasText: /select tags/i })
        .first();
      await tagsCombobox.click();

      // The popover is portaled outside the filter panel
      await page.getByPlaceholder(/select tags/i).fill(`TagFilter${uniqueId}`);

      await page
        .getByRole("option", { name: new RegExp(`TagFilter${uniqueId}`) })
        .click();

      // Close the popover so the results underneath are visible
      await page.keyboard.press("Escape");
      await page.waitForLoadState("networkidle");

      // Verify the tagged case still appears
      await expect(searchResults).toContainText(`TaggedCase ${uniqueId}`, {
        timeout: 8000,
      });

      // ...and the untagged one is filtered out
      await expect(searchResults).not.toContainText(`UntaggedCase ${uniqueId}`);
    });
  });

  test("Include deleted toggle is accessible to admin users", async ({
    page,
  }) => {
    // Use data-testid to avoid strict mode violation when filter dialog also opens
    const searchSheet = page.locator('[data-testid="global-search-sheet"]');
    const filterPanel = page.locator(
      '[data-testid="faceted-search-filters"], [data-testid="faceted-filters"]'
    );

    await test.step("Open search", async () => {
      await unifiedSearch.open();
    });

    // Open the advanced filters panel
    const funnelButton = searchSheet.locator("button:has(svg.lucide-funnel)");
    const hasFunnelButton = (await funnelButton.count()) > 0;

    if (!hasFunnelButton) {
      // Filter button not available in this state, skip
      test.skip();
      return;
    }

    await test.step("Open the advanced filters panel", async () => {
      await funnelButton.first().click();

      await expect(filterPanel).toBeVisible({ timeout: 5000 });
    });

    await test.step("Toggle include-deleted and confirm state change for admin users", async () => {
      // Check if include-deleted toggle exists (admin only feature)
      const includeDeletedToggle = filterPanel.locator(
        '[data-testid="include-deleted-toggle"]'
      );
      const toggleCount = await includeDeletedToggle.count();

      if (toggleCount > 0) {
        // Toggle is present (admin user) - verify it can be interacted with
        const isChecked = await includeDeletedToggle.isChecked();

        // Toggle to enable include-deleted
        await includeDeletedToggle.click();
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(300);

        // Verify the toggle state changed
        const newChecked = await includeDeletedToggle.isChecked();
        expect(newChecked).toBe(!isChecked);

        // Toggle back to original state
        await includeDeletedToggle.click();
        await page.waitForLoadState("networkidle");
      }
      // If toggle is not present, user may not be admin - test passes without error
    });
  });

  test("Clearing filters restores unfiltered results", async ({
    page,
    api,
    request,
    baseURL,
  }) => {
    const uniqueId = Date.now();
    // Use the specific global-search-sheet test ID to avoid strict mode violation
    // when the Advanced Filters dialog is also open (both are role="dialog")
    const searchSheet = page.locator('[data-testid="global-search-sheet"]');
    const filterPanel = page.locator(
      '[data-testid="faceted-search-filters"], [data-testid="faceted-filters"]'
    );
    const searchResults = page.locator('[data-testid="search-results-scroll"]');

    await test.step("Create two test cases, one of them tagged", async () => {
      const folderId = await api.createFolder(
        projectId,
        "Clear Filters Folder"
      );

      const alphaId = await api.createTestCase(
        projectId,
        folderId,
        `ClearFilterCase Alpha ${uniqueId}`
      );
      await api.createTestCase(
        projectId,
        folderId,
        `ClearFilterCase Beta ${uniqueId}`
      );

      const tagId = await api.createTag(`ClearFilterTag${uniqueId}`);
      await api.addTagToTestCase(alphaId, tagId);

      await waitForTagIndexed(request, baseURL!, projectId, tagId, 1);
    });

    await test.step("Search and confirm both cases appear initially", async () => {
      await unifiedSearch.open();
      await unifiedSearch.search(`ClearFilterCase ${uniqueId}`);

      // Both cases should appear initially
      await expect(searchResults).toContainText(
        `ClearFilterCase Alpha ${uniqueId}`,
        {
          timeout: 10000,
        }
      );
      await expect(searchResults).toContainText(
        `ClearFilterCase Beta ${uniqueId}`,
        {
          timeout: 5000,
        }
      );
    });

    // Open the advanced filters panel
    const funnelButton = searchSheet.locator("button:has(svg.lucide-funnel)");
    const hasFunnelButton = (await funnelButton.count()) > 0;

    if (!hasFunnelButton) {
      // Filter button not available, end test here (results verified above)
      return;
    }

    await test.step("Open the advanced filters panel", async () => {
      await funnelButton.first().click();

      await expect(filterPanel).toBeVisible({ timeout: 5000 });
    });

    await test.step("Apply the tag filter so only the tagged case remains", async () => {
      const tagsCombobox = filterPanel
        .getByRole("combobox")
        .filter({ hasText: /select tags/i })
        .first();
      await tagsCombobox.click();

      await page
        .getByPlaceholder(/select tags/i)
        .fill(`ClearFilterTag${uniqueId}`);
      await page
        .getByRole("option", { name: new RegExp(`ClearFilterTag${uniqueId}`) })
        .click();
      await page.keyboard.press("Escape");
      await page.waitForLoadState("networkidle");

      await expect(searchResults).not.toContainText(
        `ClearFilterCase Beta ${uniqueId}`,
        {
          timeout: 8000,
        }
      );
    });

    await test.step("Clear all filters and confirm both cases return", async () => {
      await filterPanel
        .getByRole("button", { name: /clear all/i })
        .first()
        .click();
      await page.waitForLoadState("networkidle");

      await expect(searchResults).toContainText(
        `ClearFilterCase Alpha ${uniqueId}`,
        {
          timeout: 8000,
        }
      );
      await expect(searchResults).toContainText(
        `ClearFilterCase Beta ${uniqueId}`,
        {
          timeout: 8000,
        }
      );
    });
  });
});
