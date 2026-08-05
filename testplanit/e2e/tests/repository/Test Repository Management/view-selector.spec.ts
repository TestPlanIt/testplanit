import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * View Selector Tests
 *
 * The ViewSelector is the repository's "View by" GROUPING control:
 * - Folders: Hierarchical folder structure (default)
 * - Template / State / Creator / Automation / Tag / Issue / dynamic fields
 *
 * Filtering itself lives in the FilterBar above the case table. Clicking an
 * option row in the sidebar TOGGLES a filter chip for that value
 * (`filter-chip-{dimension}-{operator}`) and writes a repeated `?f=` URL
 * param; the row highlights while its value sits in an active predicate.
 * Switching the grouping axis never seeds and never clears filters, so every
 * test that filters through a row asserts BOTH the resulting chip and the
 * filtered table — a row click that silently stopped filtering would
 * otherwise pass vacuously.
 */

const SEEDED_CASES_WORKFLOW_NAMES = [
  "Draft",
  "Under Review",
  "Rejected",
  "Active",
  "Done",
  "Archived",
];

interface ProjectState {
  id: number;
  name: string;
}

/**
 * The project's seeded case states with BOTH id and name — the sidebar rows
 * are addressed by name (they carry no test id) while the `?f=` param and the
 * chip editor's value options are keyed by id.
 */
async function getProjectStates(
  request: APIRequestContext,
  baseURL: string,
  projectId: number,
  count = 2
): Promise<ProjectState[]> {
  const response = await request.get(
    `${baseURL}/api/model/workflows/findMany`,
    {
      params: {
        q: JSON.stringify({
          where: {
            isDeleted: false,
            scope: "CASES",
            name: { in: SEEDED_CASES_WORKFLOW_NAMES },
            projects: { some: { projectId } },
          },
          orderBy: { order: "asc" },
          take: count,
        }),
      },
    }
  );

  if (!response.ok()) {
    throw new Error(`Failed to fetch project states: ${await response.text()}`);
  }

  const result = await response.json();
  if (!result.data?.length) {
    throw new Error("No case states found for project. Run seed first.");
  }
  return result.data.map((state: { id: number; name: string }) => ({
    id: state.id,
    name: state.name,
  }));
}

/**
 * A clickable ViewSelector option row, scoped to the left panel so the
 * FilterBar's own buttons (Add Filter, chip remove) can never match.
 */
function sidebarRow(page: Page, name: string | RegExp): Locator {
  return page
    .getByTestId("repository-left-panel")
    .locator('[role="button"]')
    .filter({ hasText: name })
    .first();
}

/** The `f` params currently serialized into the URL, form-decoded. */
function filterParams(page: Page): string[] {
  return new URL(page.url()).searchParams.getAll("f");
}

async function expectFilterParam(page: Page, pattern: RegExp): Promise<void> {
  await expect
    .poll(() => filterParams(page).join("|"), { timeout: 10000 })
    .toMatch(pattern);
}

async function expectNoFilterParams(page: Page): Promise<void> {
  await expect.poll(() => filterParams(page)).toEqual([]);
}

test.describe("View Selector - Repository Views", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  async function getTestProjectId(
    api: import("../../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    // Create a project for this test - tests should be self-contained
    return await api.createProject(
      `E2E View Selector ${Date.now()}-${Math.random().toString(36).substring(7)}`
    );
  }

  /**
   * Helper to open the view selector dropdown
   */
  async function openViewSelector(page: Page) {
    const viewSelector = page.locator('[data-testid="view-selector-trigger"]');
    await expect(viewSelector).toBeVisible({ timeout: 10000 });
    await viewSelector.click();
    return viewSelector;
  }

  /**
   * Helper to select a view option
   */
  async function selectView(page: Page, viewName: string) {
    await openViewSelector(page);
    const option = page
      .locator('[role="option"]')
      .filter({ hasText: new RegExp(`^${viewName}$`, "i") });
    await expect(option).toBeVisible({ timeout: 5000 });
    await option.click();
    await page.waitForLoadState("networkidle");
  }

  // ============================================================
  // CORE VIEW TESTS
  // ============================================================

  test("Folder view is the default view", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await test.step("Open the repository for a new project", async () => {
      await repositoryPage.goto(projectId);
    });

    await test.step("Verify the view selector defaults to Folders", async () => {
      const viewSelector = page.locator(
        '[data-testid="view-selector-trigger"]'
      );
      await expect(viewSelector).toBeVisible({ timeout: 10000 });
      await expect(viewSelector).toContainText(/Folders/i);
    });
  });

  test("Template view shows template filter options and seeds no filter", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    const caseName = `E2E Template Axis Case ${Date.now()}`;

    await test.step("Create a test case", async () => {
      const rootFolderId = await api.getRootFolderId(projectId);
      await api.createTestCase(projectId, rootFolderId, caseName);
    });

    await test.step("Open the repository and switch to the Template view", async () => {
      await repositoryPage.goto(projectId);
      await selectView(page, "Template");
    });

    await test.step("Verify the URL reflects the view change", async () => {
      await expect(page).toHaveURL(/view=templates/);
    });

    await test.step("Verify Template filter options appear", async () => {
      const allTemplates = page.locator(
        '[role="button"]:has-text("All Templates")'
      );
      await expect(allTemplates.first()).toBeVisible({ timeout: 10000 });
    });

    await test.step("Verify the axis switch seeded no filter", async () => {
      // The axis used to auto-select the first template; grouping and
      // filtering are now separate, so the table stays unfiltered.
      await expect(page.getByTestId("filter-bar")).toBeVisible({
        timeout: 10000,
      });
      await expect(
        page.getByTestId("filter-chip-templates-in")
      ).not.toBeVisible();
      await expectNoFilterParams(page);
      await expect(page.locator(`text="${caseName}"`).first()).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step("Verify the view selector shows Template", async () => {
      const viewSelector = page.locator(
        '[data-testid="view-selector-trigger"]'
      );
      await expect(viewSelector).toContainText(/Template/i);
    });
  });

  test("State view shows state filter options and seeds no filter", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    const caseName = `E2E State Axis Case ${Date.now()}`;

    await test.step("Create a test case", async () => {
      const rootFolderId = await api.getRootFolderId(projectId);
      await api.createTestCase(projectId, rootFolderId, caseName);
    });

    await test.step("Open the repository and switch to the State view", async () => {
      await repositoryPage.goto(projectId);
      await selectView(page, "State");
    });

    await test.step("Verify the URL reflects the view change", async () => {
      await expect(page).toHaveURL(/view=states/);
    });

    await test.step("Verify State filter options appear", async () => {
      const allStates = page.locator('[role="button"]:has-text("All States")');
      await expect(allStates.first()).toBeVisible({ timeout: 10000 });
    });

    await test.step("Verify the axis switch seeded no filter", async () => {
      await expect(page.getByTestId("filter-chip-states-in")).not.toBeVisible();
      await expectNoFilterParams(page);
      await expect(page.locator(`text="${caseName}"`).first()).toBeVisible({
        timeout: 10000,
      });
    });
  });

  test("Creator view shows creator filter options and seeds no filter", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    const caseName = `E2E Creator Axis Case ${Date.now()}`;

    await test.step("Create a test case", async () => {
      const rootFolderId = await api.getRootFolderId(projectId);
      await api.createTestCase(projectId, rootFolderId, caseName);
    });

    await test.step("Open the repository and switch to the Creator view", async () => {
      await repositoryPage.goto(projectId);
      await selectView(page, "Creator");
    });

    await test.step("Verify the URL reflects the view change", async () => {
      await expect(page).toHaveURL(/view=creators/);
    });

    await test.step("Verify Creator filter options appear", async () => {
      const allCreators = page.locator(
        '[role="button"]:has-text("All Creators")'
      );
      await expect(allCreators.first()).toBeVisible({ timeout: 10000 });
    });

    await test.step("Verify the axis switch seeded no filter", async () => {
      await expect(
        page.getByTestId("filter-chip-creators-in")
      ).not.toBeVisible();
      await expectNoFilterParams(page);
      await expect(page.locator(`text="${caseName}"`).first()).toBeVisible({
        timeout: 10000,
      });
    });
  });

  test("Automation view shows automation options and seeds no filter", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    const caseName = `E2E Automation Axis Case ${Date.now()}`;

    await test.step("Create a manual (not automated) test case", async () => {
      const rootFolderId = await api.getRootFolderId(projectId);
      await api.createTestCase(projectId, rootFolderId, caseName);
    });

    await test.step("Open the repository and switch to the Automation view", async () => {
      await repositoryPage.goto(projectId);
      await selectView(page, "Automation");
    });

    await test.step("Verify the URL reflects the view change", async () => {
      await expect(page).toHaveURL(/view=automated/);
    });

    await test.step("Verify Automation filter options appear", async () => {
      const allCases = page.locator('[role="button"]:has-text("All Cases")');
      await expect(allCases.first()).toBeVisible({ timeout: 10000 });
    });

    await test.step("Verify the axis switch seeded no automated filter", async () => {
      // The Automation axis used to seed `automated = true`, which hid every
      // manual case on switch. Grouping no longer filters, so the manual case
      // stays visible and no chip exists.
      await expect(
        page.getByTestId("filter-chip-automated-is")
      ).not.toBeVisible();
      await expectNoFilterParams(page);
      await expect(page.locator(`text="${caseName}"`).first()).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step("Verify the view selector shows Automation", async () => {
      const viewSelector = page.locator(
        '[data-testid="view-selector-trigger"]'
      );
      await expect(viewSelector).toContainText(/Automation/i);
    });
  });

  // ============================================================
  // TAG VIEW TESTS
  // ============================================================

  test("Tag view appears when test cases have tags", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await test.step("Create a tag and link it to a test case", async () => {
      const rootFolderId = await api.getRootFolderId(projectId);
      const tagId = await api.createTag(`E2E Tag View Test ${Date.now()}`);
      const caseId = await api.createTestCase(
        projectId,
        rootFolderId,
        `E2E Tag View Case ${Date.now()}`
      );
      await api.addTagToTestCase(caseId, tagId);
    });

    let tagOption: Locator | undefined;

    await test.step("Open the view selector and confirm the Tag option appears", async () => {
      await repositoryPage.goto(projectId);

      await openViewSelector(page);

      tagOption = page.locator('[role="option"]').filter({ hasText: /^Tag$/i });
      await expect(tagOption).toBeVisible({ timeout: 5000 });
    });

    await test.step("Select the Tag view", async () => {
      await tagOption!.click();
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the URL reflects the view change", async () => {
      await expect(page).toHaveURL(/view=tags/);
    });

    await test.step("Verify Tag filter options appear", async () => {
      await expect(sidebarRow(page, "Any Tag")).toBeVisible({ timeout: 10000 });
    });
  });

  test("Tag view shows Any Tag and No Tags options", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await test.step("Create a tagged case and an untagged case", async () => {
      const rootFolderId = await api.getRootFolderId(projectId);
      const tagId = await api.createTag(`E2E Tag Options Test ${Date.now()}`);
      const caseId = await api.createTestCase(
        projectId,
        rootFolderId,
        `E2E Tagged Case ${Date.now()}`
      );
      await api.addTagToTestCase(caseId, tagId);

      // Create a test case without any tags
      await api.createTestCase(
        projectId,
        rootFolderId,
        `E2E Untagged Case ${Date.now()}`
      );
    });

    await test.step("Open the repository and switch to the Tag view", async () => {
      await repositoryPage.goto(projectId);
      await selectView(page, "Tag");
    });

    await test.step("Verify the Any Tag and No Tags options appear", async () => {
      // Should show "Any Tag" option
      const anyTagOption = page.locator('[role="button"]:has-text("Any Tag")');
      await expect(anyTagOption.first()).toBeVisible({ timeout: 10000 });

      // Should show "No Tags" option
      const noTagsOption = page.locator('[role="button"]:has-text("No Tags")');
      await expect(noTagsOption.first()).toBeVisible({ timeout: 5000 });
    });
  });

  test("Tag row click adds a tag chip and filters the table", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    const rootFolderId = await api.getRootFolderId(projectId);

    const uniqueId = Date.now();
    const tag1Name = `E2E Tag1 ${uniqueId}`;
    const tag2Name = `E2E Tag2 ${uniqueId}`;
    const case1Name = `E2E Case With Tag1 ${uniqueId}`;
    const case2Name = `E2E Case With Tag2 ${uniqueId}`;

    await test.step("Create two tags and two cases, each with a different tag", async () => {
      const tag1Id = await api.createTag(tag1Name);
      const tag2Id = await api.createTag(tag2Name);

      const case1Id = await api.createTestCase(
        projectId,
        rootFolderId,
        case1Name
      );
      const case2Id = await api.createTestCase(
        projectId,
        rootFolderId,
        case2Name
      );

      await api.addTagToTestCase(case1Id, tag1Id);
      await api.addTagToTestCase(case2Id, tag2Id);
    });

    await test.step("Open the repository and switch to the Tag view", async () => {
      await repositoryPage.goto(projectId);
      await selectView(page, "Tag");
    });

    await test.step("Verify both cases are initially visible", async () => {
      await expect(page.locator(`text="${case1Name}"`).first()).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator(`text="${case2Name}"`).first()).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step("Filter by the first tag", async () => {
      const tag1Filter = sidebarRow(page, tag1Name);
      await expect(tag1Filter).toBeVisible({ timeout: 10000 });
      await tag1Filter.click();
    });

    await test.step("Verify a tags chip is created and serialized to the URL", async () => {
      // Tag rows toggle the dimension's `any` predicate (tags has no `in`).
      const chip = page.getByTestId("filter-chip-tags-any");
      await expect(chip).toBeVisible({ timeout: 10000 });
      await expect(chip).toContainText(tag1Name);
      await expectFilterParam(page, /tags:any:\d+/);
    });

    await test.step("Verify only the case with the first tag remains visible", async () => {
      // Wait for the filter to be applied - case2 should disappear
      await expect(page.locator(`text="${case2Name}"`)).not.toBeVisible({
        timeout: 5000,
      });

      // Only case with Tag1 should be visible
      await expect(page.locator(`text="${case1Name}"`).first()).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step("Verify the row highlights while its value is filtered", async () => {
      await expect(async () => {
        const highlighted = await sidebarRow(page, tag1Name).evaluate((el) =>
          el.className.includes("bg-primary")
        );
        expect(highlighted).toBe(true);
      }).toPass({ timeout: 10000 });
    });

    await test.step("Click the same row again to remove the chip", async () => {
      await sidebarRow(page, tag1Name).click();

      await expect(page.getByTestId("filter-chip-tags-any")).not.toBeVisible({
        timeout: 10000,
      });
      await expectNoFilterParams(page);
      await expect(page.locator(`text="${case2Name}"`).first()).toBeVisible({
        timeout: 10000,
      });
    });
  });

  // ============================================================
  // ISSUE VIEW TESTS
  // ============================================================

  test("Issue view appears when test cases have issues", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    await test.step("Create an issue and link it to a test case", async () => {
      const rootFolderId = await api.getRootFolderId(projectId);
      const issueId = await api.createIssue(
        projectId,
        `ISSUE-${Date.now()}`,
        `E2E Issue View Test ${Date.now()}`
      );
      const caseId = await api.createTestCase(
        projectId,
        rootFolderId,
        `E2E Issue View Case ${Date.now()}`
      );
      await api.linkIssueToTestCase(issueId, caseId);
    });

    let issueOption: Locator | undefined;

    await test.step("Open the view selector and confirm the Issue option appears", async () => {
      await repositoryPage.goto(projectId);

      await openViewSelector(page);

      issueOption = page
        .locator('[role="option"]')
        .filter({ hasText: /^Issue$/i });
      await expect(issueOption).toBeVisible({ timeout: 5000 });
    });

    await test.step("Select the Issue view", async () => {
      await issueOption!.click();
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the URL reflects the view change", async () => {
      await expect(page).toHaveURL(/view=issues/);
    });

    await test.step("Verify Issue filter options appear", async () => {
      await expect(sidebarRow(page, "Any Issue")).toBeVisible({
        timeout: 10000,
      });
    });
  });

  test("Issue view shows Any Issue and No Issues options", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    await test.step("Create a linked case and an unlinked case", async () => {
      const rootFolderId = await api.getRootFolderId(projectId);
      const issueId = await api.createIssue(
        projectId,
        `ISSUE-${Date.now()}`,
        `E2E Issue Options Test ${Date.now()}`
      );
      const caseId = await api.createTestCase(
        projectId,
        rootFolderId,
        `E2E Linked Case ${Date.now()}`
      );
      await api.linkIssueToTestCase(issueId, caseId);

      // Create a test case without any issues
      await api.createTestCase(
        projectId,
        rootFolderId,
        `E2E Unlinked Case ${Date.now()}`
      );
    });

    await test.step("Open the repository and switch to the Issue view", async () => {
      await repositoryPage.goto(projectId);
      await selectView(page, "Issue");
    });

    await test.step("Verify the Any Issue and No Issues options appear", async () => {
      // Should show "Any Issue" option
      const anyIssueOption = page.locator(
        '[role="button"]:has-text("Any Issue")'
      );
      await expect(anyIssueOption.first()).toBeVisible({ timeout: 10000 });

      // Should show "No Issues" option
      const noIssuesOption = page.locator(
        '[role="button"]:has-text("No Issues")'
      );
      await expect(noIssuesOption.first()).toBeVisible({ timeout: 5000 });
    });
  });

  test("Any Issue row click adds a bare issues chip and filters the table", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    const rootFolderId = await api.getRootFolderId(projectId);

    const uniqueId = Date.now();
    const linkedCaseName = `E2E Linked Issue Case ${uniqueId}`;
    const unlinkedCaseName = `E2E Unlinked Issue Case ${uniqueId}`;

    await test.step("Create an issue and link it to one of two cases", async () => {
      const issueId = await api.createIssue(
        projectId,
        `ISSUE-${uniqueId}`,
        `E2E Any Issue Test ${uniqueId}`
      );

      const linkedCaseId = await api.createTestCase(
        projectId,
        rootFolderId,
        linkedCaseName
      );
      await api.createTestCase(projectId, rootFolderId, unlinkedCaseName);
      await api.linkIssueToTestCase(issueId, linkedCaseId);
    });

    await test.step("Open the repository and switch to the Issue view", async () => {
      await repositoryPage.goto(projectId);
      await selectView(page, "Issue");
    });

    await test.step("Verify both cases are initially visible", async () => {
      await expect(
        page.locator(`text="${linkedCaseName}"`).first()
      ).toBeVisible({
        timeout: 10000,
      });
      await expect(
        page.locator(`text="${unlinkedCaseName}"`).first()
      ).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step("Filter by Any Issue", async () => {
      const anyIssueFilter = sidebarRow(page, "Any Issue");
      await expect(anyIssueFilter).toBeVisible({ timeout: 10000 });
      await anyIssueFilter.click();
    });

    await test.step("Verify a bare has-value issues chip is created", async () => {
      const chip = page.getByTestId("filter-chip-issues-any");
      await expect(chip).toBeVisible({ timeout: 10000 });
      // Bare `any` renders as "has value" — no value list on the chip.
      await expect(chip).toContainText(/Has value/i);
      await expectFilterParam(page, /issues:any(\||$)/);
    });

    await test.step("Verify only the linked case remains visible", async () => {
      // Wait for the filter to be applied - unlinked case should disappear
      await expect(page.locator(`text="${unlinkedCaseName}"`)).not.toBeVisible({
        timeout: 5000,
      });

      // Only case with issue should be visible
      await expect(
        page.locator(`text="${linkedCaseName}"`).first()
      ).toBeVisible({
        timeout: 10000,
      });
    });
  });

  test("No Issues row click adds a bare none chip and filters the table", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    const rootFolderId = await api.getRootFolderId(projectId);

    const uniqueId = Date.now();
    const linkedCaseName = `E2E Has Issue Case ${uniqueId}`;
    const unlinkedCaseName = `E2E No Issue Case ${uniqueId}`;

    await test.step("Create an issue, link it to one of two cases, and wait for indexing", async () => {
      const issueId = await api.createIssue(
        projectId,
        `ISSUE-${uniqueId}`,
        `E2E No Issues Test ${uniqueId}`
      );

      const linkedCaseId = await api.createTestCase(
        projectId,
        rootFolderId,
        linkedCaseName
      );
      await api.createTestCase(projectId, rootFolderId, unlinkedCaseName);
      await api.linkIssueToTestCase(issueId, linkedCaseId);

      // Wait for search index to update (Elasticsearch needs time to index the issue link)
      await page.waitForTimeout(2000);
    });

    const noIssuesFilter = page.locator(
      '[role="button"]:has-text("No Issues")'
    );
    const tableBody = page.locator("table tbody");

    await test.step("Open the Issue view and wait for the No Issues filter and table to load", async () => {
      await repositoryPage.goto(projectId);
      await selectView(page, "Issue");

      // Wait for the Issue view to fully load - the "No Issues" filter should be visible
      await expect(noIssuesFilter.first()).toBeVisible({ timeout: 10000 });

      // Wait for initial data to load in the table before clicking filter
      await expect(tableBody).toBeVisible({ timeout: 10000 });
    });

    await test.step("Filter by No Issues", async () => {
      await noIssuesFilter.first().click();
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify a bare is-empty issues chip is created", async () => {
      const chip = page.getByTestId("filter-chip-issues-none");
      await expect(chip).toBeVisible({ timeout: 10000 });
      await expect(chip).toContainText(/Is empty/i);
      await expectFilterParam(page, /issues:none(\||$)/);
    });

    await test.step("Verify the No Issues filter is highlighted as selected", async () => {
      // The row highlights from predicate state (bg-primary/20).
      await expect(async () => {
        const hasSelectedClass = await noIssuesFilter.first().evaluate((el) => {
          return el.className.includes("bg-primary");
        });
        expect(hasSelectedClass).toBe(true);
      }).toPass({ timeout: 10000 });
    });

    await test.step("Verify only the unlinked case appears in the table", async () => {
      // Now check the table: only the unlinked case should be visible
      await expect(async () => {
        const rows = tableBody.locator("tr");
        const rowCount = await rows.count();

        if (rowCount === 0) {
          // Table might still be loading - fail to retry
          expect(rowCount).toBeGreaterThan(0);
        }

        // The unlinked case (no issues) should be visible
        const unlinkedCount = await rows
          .filter({ hasText: unlinkedCaseName })
          .count();
        expect(unlinkedCount).toBeGreaterThan(0);

        // The linked case (has issue) should NOT be visible
        const linkedCount = await rows
          .filter({ hasText: linkedCaseName })
          .count();
        expect(linkedCount).toBe(0);
      }).toPass({ timeout: 15000 });
    });
  });

  test("Specific issue row click adds a valued issues chip", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    const rootFolderId = await api.getRootFolderId(projectId);

    const uniqueId = Date.now();
    const issueName = `ISSUE-${uniqueId}`;
    const linkedCaseName = `E2E Case With Issue ${uniqueId}`;
    const unlinkedCaseName = `E2E Case Without Issue ${uniqueId}`;

    await test.step("Create one issue and link it to one of two cases", async () => {
      const issueId = await api.createIssue(
        projectId,
        issueName,
        `E2E Specific Issue ${uniqueId}`
      );

      const linkedCaseId = await api.createTestCase(
        projectId,
        rootFolderId,
        linkedCaseName
      );
      await api.createTestCase(projectId, rootFolderId, unlinkedCaseName);

      await api.linkIssueToTestCase(issueId, linkedCaseId);
    });

    const issueFilter = sidebarRow(page, issueName);
    const tableBody = page.locator("table tbody");

    await test.step("Open the Issue view and wait for the issue filter and table to load", async () => {
      await repositoryPage.goto(projectId);
      await selectView(page, "Issue");

      // Wait for the Issue view to fully load and show filter options
      await expect(issueFilter).toBeVisible({ timeout: 15000 });

      // Wait for initial data to load in the table
      await expect(tableBody).toBeVisible({ timeout: 10000 });
    });

    await test.step("Filter by the specific issue", async () => {
      await issueFilter.click();
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the chip carries the issue and the URL its id", async () => {
      const chip = page.getByTestId("filter-chip-issues-any");
      await expect(chip).toBeVisible({ timeout: 10000 });
      await expect(chip).toContainText(issueName);
      await expectFilterParam(page, /issues:any:\d+/);
    });

    await test.step("Verify the issue filter is highlighted as selected", async () => {
      await expect(async () => {
        const hasSelectedClass = await issueFilter.evaluate((el) => {
          return el.className.includes("bg-primary");
        });
        expect(hasSelectedClass).toBe(true);
      }).toPass({ timeout: 10000 });
    });

    await test.step("Verify only the linked case appears in the table", async () => {
      // After clicking the specific issue filter, only the linked case should appear
      await expect(async () => {
        // The linked case should be visible in the table
        const linkedCount = await tableBody
          .locator("tr")
          .filter({ hasText: linkedCaseName })
          .count();
        expect(linkedCount).toBeGreaterThan(0);

        // The unlinked case should NOT be visible in the table
        const unlinkedCount = await tableBody
          .locator("tr")
          .filter({ hasText: unlinkedCaseName })
          .count();
        expect(unlinkedCount).toBe(0);
      }).toPass({ timeout: 15000 });
    });
  });

  // ============================================================
  // VIEW SELECTOR UI TESTS
  // ============================================================

  test("View selector shows counts for filter options", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    await test.step("Create multiple test cases to produce counts", async () => {
      const rootFolderId = await api.getRootFolderId(projectId);
      await api.createTestCase(
        projectId,
        rootFolderId,
        `E2E Count Test 1 ${Date.now()}`
      );
      await api.createTestCase(
        projectId,
        rootFolderId,
        `E2E Count Test 2 ${Date.now()}`
      );
    });

    await test.step("Open the repository and switch to the Template view", async () => {
      await repositoryPage.goto(projectId);
      await selectView(page, "Template");
    });

    await test.step("Verify at least one filter option shows a count", async () => {
      // Filter options should show counts (numbers)
      const filterButtons = page
        .getByTestId("repository-left-panel")
        .locator('[role="button"]');
      const buttonCount = await filterButtons.count();

      let hasCount = false;
      for (let i = 0; i < buttonCount; i++) {
        const button = filterButtons.nth(i);
        const text = await button.textContent();
        if (text && /\d+/.test(text)) {
          hasCount = true;
          break;
        }
      }

      expect(hasCount).toBe(true);
    });
  });

  test("Switching views updates URL and keeps active filters", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const projectId = await getTestProjectId(api);
    let states: ProjectState[] = [];

    await test.step("Create a case in the first state", async () => {
      states = await getProjectStates(request, baseURL!, projectId, 2);
      const rootFolderId = await api.getRootFolderId(projectId);
      await api.createTestCaseWithState(
        projectId,
        rootFolderId,
        `E2E Axis Persist Case ${Date.now()}`,
        states[0].id
      );
    });

    await test.step("Open the repository", async () => {
      await repositoryPage.goto(projectId);
    });

    await test.step("Switch to Template view and verify the URL", async () => {
      await selectView(page, "Template");
      await expect(page).toHaveURL(/view=templates/);
    });

    await test.step("Switch to State view and verify the URL", async () => {
      await selectView(page, "State");
      await expect(page).toHaveURL(/view=states/);
    });

    await test.step("Apply a state filter through the sidebar row", async () => {
      await sidebarRow(page, states[0].name).click();
      const chip = page.getByTestId("filter-chip-states-in");
      await expect(chip).toBeVisible({ timeout: 10000 });
      await expect(chip).toContainText(states[0].name);
      await expectFilterParam(page, new RegExp(`states:in:${states[0].id}`));
    });

    await test.step("Switch to Creator view and verify the filter survives", async () => {
      // Axis switches used to clear the active filter; they no longer touch
      // predicates, so the chip and its `f` param must both survive.
      await selectView(page, "Creator");
      await expect(page).toHaveURL(/view=creators/);
      await expect(page.getByTestId("filter-chip-states-in")).toBeVisible({
        timeout: 10000,
      });
      await expectFilterParam(page, new RegExp(`states:in:${states[0].id}`));
    });

    await test.step("Switch back to Folders view and verify the filter still survives", async () => {
      await selectView(page, "Folders");
      const viewSelector = page.locator(
        '[data-testid="view-selector-trigger"]'
      );
      await expect(viewSelector).toContainText(/Folders/i);
      await expect(page.getByTestId("filter-chip-states-in")).toBeVisible({
        timeout: 10000,
      });
      await expectFilterParam(page, new RegExp(`states:in:${states[0].id}`));
    });
  });

  test("Direct URL navigation to view works and loads unfiltered", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    const caseName = `E2E Direct View Case ${Date.now()}`;

    await test.step("Create a test case", async () => {
      const rootFolderId = await api.getRootFolderId(projectId);
      await api.createTestCase(projectId, rootFolderId, caseName);
    });

    await test.step("Navigate directly to the templates view URL", async () => {
      await page.goto(`/en-US/projects/repository/${projectId}?view=templates`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the view selector shows Template", async () => {
      const viewSelector = page.locator(
        '[data-testid="view-selector-trigger"]'
      );
      await expect(viewSelector).toBeVisible({ timeout: 10000 });
      await expect(viewSelector).toContainText(/Template/i);
    });

    await test.step("Verify Template filter options are visible", async () => {
      const allTemplates = page.locator(
        '[role="button"]:has-text("All Templates")'
      );
      await expect(allTemplates.first()).toBeVisible({ timeout: 10000 });
    });

    await test.step("Verify a bookmarked view carries no filter", async () => {
      // A `?view=` bookmark never implied a filter and must not create one.
      await expect(
        page.getByTestId("filter-chip-templates-in")
      ).not.toBeVisible();
      await expectNoFilterParams(page);
      await expect(page.locator(`text="${caseName}"`).first()).toBeVisible({
        timeout: 10000,
      });
    });
  });

  test("Clicking two state rows ORs both values into one chip", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();
    const case1Name = `E2E OR State1 ${uniqueId}`;
    const case2Name = `E2E OR State2 ${uniqueId}`;
    let states: ProjectState[] = [];

    await test.step("Create two test cases with different states", async () => {
      states = await getProjectStates(request, baseURL!, projectId, 2);
      const rootFolderId = await api.getRootFolderId(projectId);

      await api.createTestCaseWithState(
        projectId,
        rootFolderId,
        case1Name,
        states[0].id
      );
      await api.createTestCaseWithState(
        projectId,
        rootFolderId,
        case2Name,
        states[1].id
      );
    });

    await test.step("Open the State view", async () => {
      await repositoryPage.goto(projectId);
      await selectView(page, "State");
    });

    await test.step("Click the first state row and verify it filters alone", async () => {
      // Cmd/Ctrl multi-select is gone: plain clicks accumulate values in the
      // dimension's single `in` predicate (OR within a dimension).
      await sidebarRow(page, states[0].name).click();

      const chip = page.getByTestId("filter-chip-states-in");
      await expect(chip).toBeVisible({ timeout: 10000 });
      await expect(chip).toContainText(states[0].name);
      await expectFilterParam(page, new RegExp(`^states:in:${states[0].id}$`));

      await expect(page.locator(`text="${case1Name}"`).first()).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator(`text="${case2Name}"`)).not.toBeVisible({
        timeout: 5000,
      });
    });

    await test.step("Click the second state row and verify both values are in the chip", async () => {
      await sidebarRow(page, states[1].name).click();

      const chip = page.getByTestId("filter-chip-states-in");
      await expect(chip).toContainText(states[0].name, { timeout: 10000 });
      await expect(chip).toContainText(states[1].name);
      await expectFilterParam(
        page,
        new RegExp(`states:in:${states[0].id},${states[1].id}`)
      );

      await expect(page.locator(`text="${case1Name}"`).first()).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator(`text="${case2Name}"`).first()).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step("Click the first state row again to drop just that value", async () => {
      await sidebarRow(page, states[0].name).click();

      const chip = page.getByTestId("filter-chip-states-in");
      await expect(chip).toContainText(states[1].name, { timeout: 10000 });
      await expect(chip).not.toContainText(states[0].name);
      await expectFilterParam(page, new RegExp(`^states:in:${states[1].id}$`));

      await expect(page.locator(`text="${case2Name}"`).first()).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator(`text="${case1Name}"`)).not.toBeVisible({
        timeout: 5000,
      });
    });
  });

  test("Selecting 'All' option removes the dimension's chip", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const projectId = await getTestProjectId(api);

    const uniqueId = Date.now();
    const case1Name = `E2E Reset Case1 ${uniqueId}`;
    const case2Name = `E2E Reset Case2 ${uniqueId}`;
    let states: ProjectState[] = [];

    await test.step("Create two test cases with different states", async () => {
      states = await getProjectStates(request, baseURL!, projectId, 2);
      const rootFolderId = await api.getRootFolderId(projectId);

      await api.createTestCaseWithState(
        projectId,
        rootFolderId,
        case1Name,
        states[0].id
      );
      await api.createTestCaseWithState(
        projectId,
        rootFolderId,
        case2Name,
        states[1].id
      );
    });

    await test.step("Open the State view and click a specific state filter", async () => {
      await repositoryPage.goto(projectId);
      await selectView(page, "State");

      await sidebarRow(page, states[0].name).click();

      await expect(page.getByTestId("filter-chip-states-in")).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator(`text="${case2Name}"`)).not.toBeVisible({
        timeout: 5000,
      });
    });

    await test.step("Select All States and verify the chip and filter are gone", async () => {
      const allStates = sidebarRow(page, "All States");
      await allStates.click();

      await expect(page.getByTestId("filter-chip-states-in")).not.toBeVisible({
        timeout: 10000,
      });
      await expectNoFilterParams(page);

      // Both cases return to the table.
      await expect(page.locator(`text="${case1Name}"`).first()).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator(`text="${case2Name}"`).first()).toBeVisible({
        timeout: 10000,
      });

      // The "All" row is the unfiltered-dimension indicator.
      await expect(allStates).toHaveClass(/bg-primary/);
    });
  });

  // ============================================================
  // EDGE CASES
  // ============================================================

  test("Issue view does not appear when no test cases have issues", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    await test.step("Create a test case without any issues", async () => {
      const rootFolderId = await api.getRootFolderId(projectId);
      await api.createTestCase(
        projectId,
        rootFolderId,
        `E2E No Issue Case ${Date.now()}`
      );
    });

    await test.step("Open the view selector and verify the Issue option is absent", async () => {
      await repositoryPage.goto(projectId);

      await openViewSelector(page);

      // Wait for options to be loaded by checking that at least one option is visible
      const foldersOption = page
        .locator('[role="option"]')
        .filter({ hasText: /^Folders$/i });
      await expect(foldersOption).toBeVisible({ timeout: 5000 });

      // Issue option should NOT be visible (no cases with issues in this project)
      const issueOption = page
        .locator('[role="option"]')
        .filter({ hasText: /^Issue$/i });
      await expect(issueOption).not.toBeVisible({ timeout: 3000 });

      // Close the selector
      await page.keyboard.press("Escape");
    });
  });

  test("Tag view is available with no tags and seeds no filter", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    const caseName = `E2E No Tag Case ${Date.now()}`;

    await test.step("Create a test case without any tags", async () => {
      const rootFolderId = await api.getRootFolderId(projectId);
      await api.createTestCase(projectId, rootFolderId, caseName);
    });

    await test.step("Open the repository and switch to the Tag view", async () => {
      // The Tag axis is always offered (grouping is independent of data).
      await repositoryPage.goto(projectId);
      await selectView(page, "Tag");
      await expect(page).toHaveURL(/view=tags/);
    });

    await test.step("Verify the untagged case is still listed and no chip exists", async () => {
      // The Tag axis used to seed `tags any`, which hid every untagged case.
      await expect(page.getByTestId("filter-chip-tags-any")).not.toBeVisible();
      await expectNoFilterParams(page);
      await expect(page.locator(`text="${caseName}"`).first()).toBeVisible({
        timeout: 10000,
      });
    });
  });
});

test.describe("View Selector - Filter Persistence", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  async function getTestProjectId(
    api: import("../../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    // Create a project for this test - tests should be self-contained
    return await api.createProject(
      `E2E View Selector ${Date.now()}-${Math.random().toString(36).substring(7)}`
    );
  }

  test("Filter selection creates a chip, a URL param and a filtered table", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();
    const matchingCaseName = `E2E Persist Filter ${uniqueId}`;
    const otherCaseName = `E2E Persist Other ${uniqueId}`;
    let states: ProjectState[] = [];

    await test.step("Create a test case in each of two states", async () => {
      states = await getProjectStates(request, baseURL!, projectId, 2);
      const rootFolderId = await api.getRootFolderId(projectId);

      await api.createTestCaseWithState(
        projectId,
        rootFolderId,
        matchingCaseName,
        states[0].id
      );
      await api.createTestCaseWithState(
        projectId,
        rootFolderId,
        otherCaseName,
        states[1].id
      );
    });

    await test.step("Open the repository and switch to the State view", async () => {
      await repositoryPage.goto(projectId);

      const viewSelector = page.locator(
        '[data-testid="view-selector-trigger"]'
      );
      await expect(viewSelector).toBeVisible({ timeout: 10000 });
      await viewSelector.click();

      const statesOption = page
        .locator('[role="option"]')
        .filter({ hasText: /^State$/i });
      await statesOption.click();
      await page.waitForLoadState("networkidle");
    });

    await test.step("Click on a specific state filter", async () => {
      await sidebarRow(page, states[0].name).click();
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the chip, the URL and the filtered table", async () => {
      const chip = page.getByTestId("filter-chip-states-in");
      await expect(chip).toBeVisible({ timeout: 10000 });
      await expect(chip).toContainText(states[0].name);
      await expectFilterParam(page, new RegExp(`states:in:${states[0].id}`));

      await expect(
        page.locator(`text="${matchingCaseName}"`).first()
      ).toBeVisible({ timeout: 10000 });
      await expect(page.locator(`text="${otherCaseName}"`)).not.toBeVisible({
        timeout: 5000,
      });
    });

    await test.step("Remove the chip and verify the table is unfiltered again", async () => {
      await page.getByTestId("filter-chip-states-in-remove").click();

      await expect(page.getByTestId("filter-chip-states-in")).not.toBeVisible({
        timeout: 10000,
      });
      await expectNoFilterParams(page);
      await expect(page.locator(`text="${otherCaseName}"`).first()).toBeVisible(
        { timeout: 10000 }
      );
    });
  });

  test("Name filter composes with an active filter chip", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const projectId = await getTestProjectId(api);
    const rootFolderId = await api.getRootFolderId(projectId);

    const uniqueId = Date.now();
    const searchableName = `UniqueSearchable${uniqueId}`;
    const otherName = `OtherCase${uniqueId}`;
    const wrongStateName = `UniqueSearchableWrongState${uniqueId}`;
    let states: ProjectState[] = [];

    await test.step("Create cases across two states", async () => {
      states = await getProjectStates(request, baseURL!, projectId, 2);
      await api.createTestCaseWithState(
        projectId,
        rootFolderId,
        searchableName,
        states[0].id
      );
      await api.createTestCaseWithState(
        projectId,
        rootFolderId,
        otherName,
        states[0].id
      );
      await api.createTestCaseWithState(
        projectId,
        rootFolderId,
        wrongStateName,
        states[1].id
      );
    });

    await test.step("Open the repository and switch to the State view", async () => {
      await repositoryPage.goto(projectId);

      const viewSelector = page.locator(
        '[data-testid="view-selector-trigger"]'
      );
      await expect(viewSelector).toBeVisible({ timeout: 10000 });
      await viewSelector.click();

      const statesOption = page
        .locator('[role="option"]')
        .filter({ hasText: /^State$/i });
      await statesOption.click();
      await page.waitForLoadState("networkidle");
    });

    await test.step("Apply the state filter chip", async () => {
      await sidebarRow(page, states[0].name).click();
      await expect(page.getByTestId("filter-chip-states-in")).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator(`text="${wrongStateName}"`)).not.toBeVisible({
        timeout: 5000,
      });
    });

    await test.step("Apply the in-table name filter", async () => {
      // The in-table name filter is a separate, always-AND'd condition — it
      // is not the Elasticsearch box and never serializes to the URL.
      const searchInput = page.getByTestId("search-input");
      await expect(searchInput).toBeVisible({ timeout: 5000 });
      await searchInput.fill(searchableName);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify only the case matching BOTH conditions is visible", async () => {
      await expect(
        page.locator(`text="${searchableName}"`).first()
      ).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator(`text="${otherName}"`)).not.toBeVisible({
        timeout: 3000,
      });
      await expect(page.locator(`text="${wrongStateName}"`)).not.toBeVisible({
        timeout: 3000,
      });

      // The chip is still active and still serialized.
      await expect(page.getByTestId("filter-chip-states-in")).toBeVisible();
      await expectFilterParam(page, new RegExp(`states:in:${states[0].id}`));
    });
  });
});
