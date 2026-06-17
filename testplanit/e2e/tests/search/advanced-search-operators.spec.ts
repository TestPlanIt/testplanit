import { expect, test } from "../../fixtures";
import { RepositoryPage } from "../../page-objects/repository/repository.page";
import { UnifiedSearchPage } from "../../page-objects/unified-search.page";

/**
 * Advanced Search Operators Tests (Simplified)
 *
 * Test cases for advanced search operators in the unified search.
 * These tests use test case names only (no descriptions/steps) to avoid API fixture limitations.
 */
test.describe("Advanced Search Operators", () => {
  let unifiedSearch: UnifiedSearchPage;
  let repositoryPage: RepositoryPage;
  let projectId: number;

  test.beforeEach(async ({ page, api }) => {
    unifiedSearch = new UnifiedSearchPage(page);
    repositoryPage = new RepositoryPage(page);

    // Create a test project — combine timestamp + random suffix for uniqueness across parallel workers
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    projectId = await api.createProject(`Search Operators Test ${uniqueId}`);
  });

  test("Wildcard search with asterisk (*)", async ({ api, page }) => {
    const uniqueId = Date.now();
    let searchDialog: ReturnType<typeof page.locator> | undefined;

    await test.step("Create wildcard-matchable test cases", async () => {
      const folderId = await api.createFolder(
        projectId,
        "Wildcard Test Folder"
      );

      await api.createTestCase(projectId, folderId, `Alpha Test ${uniqueId}`);
      await api.createTestCase(
        projectId,
        folderId,
        `Alphabet Testing ${uniqueId}`
      );
      await api.createTestCase(projectId, folderId, `Beta Case ${uniqueId}`);
    });

    await test.step("Open repository and wait for indexing", async () => {
      await repositoryPage.goto(projectId);
      await page.waitForTimeout(2000); // Wait for indexing
    });

    await test.step('Search with wildcard "alph*"', async () => {
      await unifiedSearch.open();
      await unifiedSearch.search("alph*");

      // Get the search dialog for scoped queries
      searchDialog = page.locator('[role="dialog"]');
    });

    await test.step("Verify both Alpha and Alphabet match but Beta does not", async () => {
      // Should find both Alpha and Alphabet cases within the dialog
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`Alpha Test ${uniqueId}`),
        })
      ).toBeVisible({ timeout: 10000 });
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`Alphabet Testing ${uniqueId}`),
        })
      ).toBeVisible({ timeout: 5000 });

      // Should NOT find Beta case
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`Beta Case ${uniqueId}`),
        })
      ).not.toBeVisible();
    });
  });

  test("Wildcard search with question mark (?)", async ({ api, page }) => {
    const uniqueId = Date.now();
    let searchDialog: ReturnType<typeof page.locator> | undefined;

    await test.step("Create single-character wildcard test cases", async () => {
      const folderId = await api.createFolder(
        projectId,
        "Question Mark Wildcard Folder"
      );

      await api.createTestCase(projectId, folderId, `Test Case ${uniqueId}`);
      await api.createTestCase(projectId, folderId, `Text Case ${uniqueId}`);
      await api.createTestCase(projectId, folderId, `Testing Case ${uniqueId}`);
    });

    await test.step("Open repository and wait for indexing", async () => {
      await repositoryPage.goto(projectId);
      await page.waitForTimeout(2000);
    });

    await test.step('Search "te?t"', async () => {
      // Search "te?t" should match both "test" and "text"
      await unifiedSearch.open();
      await unifiedSearch.search("te?t");

      searchDialog = page.locator('[role="dialog"]');
    });

    await test.step("Verify both Test and Text cases match", async () => {
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`Test Case ${uniqueId}`),
        })
      ).toBeVisible({ timeout: 10000 });
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`Text Case ${uniqueId}`),
        })
      ).toBeVisible({ timeout: 5000 });
    });
  });

  test("Required terms with plus (+) operator", async ({ api, page }) => {
    const uniqueId = Date.now();
    let searchDialog: ReturnType<typeof page.locator> | undefined;

    await test.step("Create test cases with overlapping terms", async () => {
      const folderId = await api.createFolder(
        projectId,
        "Required Terms Folder"
      );

      await api.createTestCase(
        projectId,
        folderId,
        `Login Password Test ${uniqueId}`
      );
      await api.createTestCase(
        projectId,
        folderId,
        `Login OAuth Test ${uniqueId}`
      );
      await api.createTestCase(
        projectId,
        folderId,
        `Password Reset ${uniqueId}`
      );
    });

    await test.step("Open repository and wait for indexing", async () => {
      await repositoryPage.goto(projectId);
      await page.waitForTimeout(2000);
    });

    await test.step('Search "+login +password"', async () => {
      // Search "+login +password" should only match cases with BOTH terms
      await unifiedSearch.open();
      await unifiedSearch.search("+login +password");

      searchDialog = page.locator('[role="dialog"]');
    });

    await test.step("Verify only the case with both terms matches", async () => {
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`Login Password Test ${uniqueId}`),
        })
      ).toBeVisible({ timeout: 10000 });

      // Should not find cases with only one of the terms
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`Login OAuth Test ${uniqueId}`),
        })
      ).not.toBeVisible();
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`Password Reset ${uniqueId}`),
        })
      ).not.toBeVisible();
    });
  });

  test("Excluded terms with minus (-) operator", async ({ api, page }) => {
    const uniqueId = Date.now();
    let searchDialog: ReturnType<typeof page.locator> | undefined;

    await test.step("Create manual and automated login test cases", async () => {
      const folderId = await api.createFolder(
        projectId,
        "Excluded Terms Folder"
      );

      await api.createTestCase(
        projectId,
        folderId,
        `Manual Login Test ${uniqueId}`
      );
      await api.createTestCase(
        projectId,
        folderId,
        `Automated Login Test ${uniqueId}`
      );
      await api.createTestCase(
        projectId,
        folderId,
        `Login Automation ${uniqueId}`
      );
    });

    await test.step("Open repository and wait for indexing", async () => {
      await repositoryPage.goto(projectId);
      await page.waitForTimeout(2000);
    });

    await test.step('Search "login -automated"', async () => {
      // Search "login -automated" should exclude cases with "automated"
      await unifiedSearch.open();
      await unifiedSearch.search("login -automated");

      searchDialog = page.locator('[role="dialog"]');
    });

    await test.step("Verify automated cases are excluded", async () => {
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`Manual Login Test ${uniqueId}`),
        })
      ).toBeVisible({ timeout: 10000 });

      // Should not find cases with "automated" or "automation"
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`Automated Login Test ${uniqueId}`),
        })
      ).not.toBeVisible();
    });
  });

  test("Boolean AND operator", async ({ api, page }) => {
    const uniqueId = Date.now();
    let searchDialog: ReturnType<typeof page.locator> | undefined;

    await test.step("Create test cases for AND operator", async () => {
      const folderId = await api.createFolder(projectId, "Boolean AND Folder");

      await api.createTestCase(
        projectId,
        folderId,
        `API Authentication Test ${uniqueId}`
      );
      await api.createTestCase(projectId, folderId, `API Testing ${uniqueId}`);
      await api.createTestCase(
        projectId,
        folderId,
        `User Authentication ${uniqueId}`
      );
    });

    await test.step("Open repository and wait for indexing", async () => {
      await repositoryPage.goto(projectId);
      await page.waitForTimeout(2000);
    });

    await test.step('Search "api AND authentication"', async () => {
      // Search "api AND authentication" should only match cases with both
      await unifiedSearch.open();
      await unifiedSearch.search("api AND authentication");

      searchDialog = page.locator('[role="dialog"]');
    });

    await test.step("Verify only the case with both terms matches", async () => {
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`API Authentication Test ${uniqueId}`),
        })
      ).toBeVisible({ timeout: 10000 });

      // Should not find cases with only one term
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`API Testing ${uniqueId}`),
        })
      ).not.toBeVisible();
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`User Authentication ${uniqueId}`),
        })
      ).not.toBeVisible();
    });
  });

  test("Boolean OR operator", async ({ api, page }) => {
    const uniqueId = Date.now();
    let searchDialog: ReturnType<typeof page.locator> | undefined;

    await test.step("Create test cases for OR operator", async () => {
      const folderId = await api.createFolder(projectId, "Boolean OR Folder");

      await api.createTestCase(projectId, folderId, `Login Test ${uniqueId}`);
      await api.createTestCase(projectId, folderId, `Signin Test ${uniqueId}`);
      await api.createTestCase(
        projectId,
        folderId,
        `Registration Test ${uniqueId}`
      );
    });

    await test.step("Open repository and wait for indexing", async () => {
      await repositoryPage.goto(projectId);
      await page.waitForTimeout(2000);
    });

    await test.step('Search "login OR signin"', async () => {
      // Search "login OR signin" should match cases with either term
      await unifiedSearch.open();
      await unifiedSearch.search("login OR signin");

      searchDialog = page.locator('[role="dialog"]');
    });

    await test.step("Verify either-term cases match but registration does not", async () => {
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`Login Test ${uniqueId}`),
        })
      ).toBeVisible({ timeout: 10000 });
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`Signin Test ${uniqueId}`),
        })
      ).toBeVisible({ timeout: 5000 });

      // Should not find registration
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`Registration Test ${uniqueId}`),
        })
      ).not.toBeVisible();
    });
  });

  test("Boolean NOT operator", async ({ api, page }) => {
    const uniqueId = Date.now();
    let searchDialog: ReturnType<typeof page.locator> | undefined;

    await test.step("Create login and OAuth login test cases", async () => {
      const folderId = await api.createFolder(projectId, "Boolean NOT Folder");

      await api.createTestCase(projectId, folderId, `Login Test ${uniqueId}`);
      await api.createTestCase(projectId, folderId, `OAuth Login ${uniqueId}`);
    });

    await test.step("Open repository and wait for indexing", async () => {
      await repositoryPage.goto(projectId);
      await page.waitForTimeout(2000);
    });

    await test.step('Search "login NOT oauth"', async () => {
      // Search "login NOT oauth" should exclude oauth
      await unifiedSearch.open();
      await unifiedSearch.search("login NOT oauth");

      searchDialog = page.locator('[role="dialog"]');
    });

    await test.step("Verify oauth case is excluded", async () => {
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`Login Test ${uniqueId}`),
        })
      ).toBeVisible({ timeout: 10000 });
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`OAuth Login ${uniqueId}`),
        })
      ).not.toBeVisible();
    });
  });

  test("Grouped operators with parentheses", async ({ api, page }) => {
    const uniqueId = Date.now();
    let searchDialog: ReturnType<typeof page.locator> | undefined;

    await test.step("Create test cases for grouped operators", async () => {
      const folderId = await api.createFolder(
        projectId,
        "Grouped Operators Folder"
      );

      await api.createTestCase(
        projectId,
        folderId,
        `Login Password Test ${uniqueId}`
      );
      await api.createTestCase(
        projectId,
        folderId,
        `Signin Password Test ${uniqueId}`
      );
      await api.createTestCase(
        projectId,
        folderId,
        `Login OAuth Test ${uniqueId}`
      );
    });

    await test.step("Open repository and wait for indexing", async () => {
      await repositoryPage.goto(projectId);
      await page.waitForTimeout(2000);
    });

    await test.step('Search "(login OR signin) AND password"', async () => {
      await unifiedSearch.open();
      await unifiedSearch.search("(login OR signin) AND password");

      searchDialog = page.locator('[role="dialog"]');
    });

    await test.step("Verify grouped matches but OAuth login does not", async () => {
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`Login Password Test ${uniqueId}`),
        })
      ).toBeVisible({ timeout: 10000 });
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`Signin Password Test ${uniqueId}`),
        })
      ).toBeVisible({ timeout: 5000 });

      // Should not find OAuth login
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`Login OAuth Test ${uniqueId}`),
        })
      ).not.toBeVisible();
    });
  });

  test("Field-specific search with name: prefix", async ({ api, page }) => {
    const uniqueId = Date.now();
    let searchDialog: ReturnType<typeof page.locator> | undefined;

    await test.step("Create dashboard and other test cases", async () => {
      const folderId = await api.createFolder(
        projectId,
        "Field Specific Folder"
      );

      await api.createTestCase(
        projectId,
        folderId,
        `Dashboard Test ${uniqueId}`
      );
      await api.createTestCase(projectId, folderId, `Other Test ${uniqueId}`);
    });

    await test.step("Open repository and wait for indexing", async () => {
      await repositoryPage.goto(projectId);
      await page.waitForTimeout(2000);
    });

    await test.step('Search "name:dashboard"', async () => {
      // Search "name:dashboard" should only match in name field
      await unifiedSearch.open();
      await unifiedSearch.search("name:dashboard");

      searchDialog = page.locator('[role="dialog"]');
    });

    await test.step("Verify only the dashboard-named case matches", async () => {
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`Dashboard Test ${uniqueId}`),
        })
      ).toBeVisible({ timeout: 10000 });

      // Should not find case without "dashboard" in name
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`Other Test ${uniqueId}`),
        })
      ).not.toBeVisible();
    });
  });

  test("Fuzzy search with tilde (~) operator", async ({ api, page }) => {
    const uniqueId = Date.now();
    let searchDialog: ReturnType<typeof page.locator> | undefined;

    await test.step("Create authentication and authorization test cases", async () => {
      const folderId = await api.createFolder(projectId, "Fuzzy Search Folder");

      // Create a case with a word that might have typos
      await api.createTestCase(
        projectId,
        folderId,
        `Authentication Test ${uniqueId}`
      );
      await api.createTestCase(
        projectId,
        folderId,
        `Authorization Test ${uniqueId}`
      );
    });

    await test.step("Open repository and wait for indexing", async () => {
      await repositoryPage.goto(projectId);
      await page.waitForTimeout(2000);
    });

    await test.step('Search fuzzy "athentication~"', async () => {
      // Search with fuzzy "athentication~" (missing 'u') should still find "authentication"
      await unifiedSearch.open();
      await unifiedSearch.search("athentication~");

      searchDialog = page.locator('[role="dialog"]');
    });

    await test.step("Verify the case is found despite the typo", async () => {
      // Should find despite the typo
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`Authentication Test ${uniqueId}`),
        })
      ).toBeVisible({ timeout: 10000 });
    });
  });

  test("Combining multiple operators", async ({ api, page }) => {
    const uniqueId = Date.now();
    let searchDialog: ReturnType<typeof page.locator> | undefined;

    await test.step("Create test cases for combined operators", async () => {
      const folderId = await api.createFolder(
        projectId,
        "Combined Operators Folder"
      );

      await api.createTestCase(
        projectId,
        folderId,
        `Login Authentication Test ${uniqueId}`
      );
      await api.createTestCase(
        projectId,
        folderId,
        `Login Automated Test ${uniqueId}`
      );
      await api.createTestCase(projectId, folderId, `Signin Test ${uniqueId}`);
    });

    await test.step("Open repository and wait for indexing", async () => {
      await repositoryPage.goto(projectId);
      await page.waitForTimeout(2000);
    });

    await test.step("Search complex query '+\"login\" -automated name:*auth*'", async () => {
      // Complex query: '+"login" -automated name:*auth*'
      await unifiedSearch.open();
      await unifiedSearch.search('+"login" -automated name:*auth*');

      searchDialog = page.locator('[role="dialog"]');
    });

    await test.step("Verify only the manual login authentication test matches", async () => {
      // Should find the manual login authentication test
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`Login Authentication Test ${uniqueId}`),
        })
      ).toBeVisible({ timeout: 10000 });

      // Should not find automated login or signin
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`Login Automated Test ${uniqueId}`),
        })
      ).not.toBeVisible();
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`Signin Test ${uniqueId}`),
        })
      ).not.toBeVisible();
    });
  });

  test("Exact phrase matching with double quotes", async ({ api, page }) => {
    const uniqueId = Date.now();
    let searchDialog: ReturnType<typeof page.locator> | undefined;

    await test.step("Create exact and non-exact phrase test cases", async () => {
      const folderId = await api.createFolder(projectId, "Exact Phrase Folder");

      await api.createTestCase(
        projectId,
        folderId,
        `Test login flow case ${uniqueId}`
      );
      await api.createTestCase(
        projectId,
        folderId,
        `Test login and flow case ${uniqueId}`
      );
    });

    await test.step("Open repository and wait for indexing", async () => {
      await repositoryPage.goto(projectId);
      await page.waitForTimeout(2000);
    });

    await test.step('Search for exact phrase "login flow"', async () => {
      // Search for exact phrase "login flow"
      await unifiedSearch.open();
      await unifiedSearch.search('"login flow"');

      searchDialog = page.locator('[role="dialog"]');
    });

    await test.step("Verify only the exact-phrase case matches", async () => {
      // Should find only the case with exact phrase
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`Test login flow case ${uniqueId}`),
        })
      ).toBeVisible({ timeout: 10000 });

      // Should not find case without exact phrase
      await expect(
        searchDialog!.getByRole("heading", {
          name: new RegExp(`Test login and flow case ${uniqueId}`),
        })
      ).not.toBeVisible();
    });
  });
});
