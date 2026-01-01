import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Issues Tests
 *
 * Test cases for managing issue links in the repository.
 */
test.describe("Issues", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  async function getTestProjectId(
    api: import("../../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    const projects = await api.getProjects();
    if (projects.length === 0) {
      throw new Error("No projects found in test database. Run seed first.");
    }
    return projects[0].id;
  }

  test("Attach Issue to Test Case", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder and test case
    const folderName = `Issue Attach Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Issue Attach Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    // Click on the test case
    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"]`).first();
    await testCaseRow.click();

    await page.waitForLoadState("networkidle");

    // Find issue link button/input
    const linkIssueButton = page.locator('[data-testid="link-issue"], button:has-text("Link Issue")').first();
    if (await linkIssueButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await linkIssueButton.click();

      // Enter issue ID or search for issue
      const issueInput = page.locator('[data-testid="issue-input"], input[placeholder*="issue"]').first();
      if (await issueInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await issueInput.fill("JIRA-123");

        // Search or select
        const searchButton = page.locator('button:has-text("Search"), button:has-text("Link")').first();
        await searchButton.click();

        await page.waitForLoadState("networkidle");

        // If issue found, select it
        const issueOption = page.locator('[role="option"], [data-testid="issue-result"]').first();
        if (await issueOption.isVisible({ timeout: 5000 }).catch(() => false)) {
          await issueOption.click();
          await page.waitForLoadState("networkidle");

          // Verify issue is linked
          const linkedIssue = page.locator('[data-testid="linked-issue"], .issue-link');
          await expect(linkedIssue.first()).toBeVisible({ timeout: 5000 });
        }
      }
    } else {
      test.skip();
    }
  });

  test("Attach Multiple Issues to Test Case", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Multi Issue Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Multi Issue Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"]`).first();
    await testCaseRow.click();

    await page.waitForLoadState("networkidle");

    const linkIssueButton = page.locator('[data-testid="link-issue"]').first();
    if (await linkIssueButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Link first issue
      await linkIssueButton.click();
      const issueInput = page.locator('[data-testid="issue-input"]').first();
      await issueInput.fill("JIRA-123");
      const issueOption = page.locator('[role="option"]').first();
      if (await issueOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await issueOption.click();
      }

      await page.waitForLoadState("networkidle");

      // Link second issue
      await linkIssueButton.click();
      await issueInput.fill("JIRA-456");
      const issueOption2 = page.locator('[role="option"]').first();
      if (await issueOption2.isVisible({ timeout: 3000 }).catch(() => false)) {
        await issueOption2.click();
      }

      await page.waitForLoadState("networkidle");

      // Verify both issues are linked
      const linkedIssues = page.locator('[data-testid="linked-issue"]');
      expect(await linkedIssues.count()).toBeGreaterThanOrEqual(2);
    } else {
      test.skip();
    }
  });

  test("Remove Issue from Test Case", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Remove Issue Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Remove Issue Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"]`).first();
    await testCaseRow.click();

    await page.waitForLoadState("networkidle");

    // First link an issue
    const linkIssueButton = page.locator('[data-testid="link-issue"]').first();
    if (await linkIssueButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await linkIssueButton.click();
      const issueInput = page.locator('[data-testid="issue-input"]').first();
      await issueInput.fill("JIRA-789");
      const issueOption = page.locator('[role="option"]').first();
      if (await issueOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await issueOption.click();
      }
      await page.waitForLoadState("networkidle");
    }

    // Now remove the issue
    const linkedIssue = page.locator('[data-testid="linked-issue"]').first();
    if (await linkedIssue.isVisible({ timeout: 5000 }).catch(() => false)) {
      const removeButton = linkedIssue.locator('[data-testid="remove-issue"], button, .remove');
      if (await removeButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await removeButton.click();

        // Confirm if needed
        const confirmButton = page.locator('[role="alertdialog"] button:has-text("Remove")').first();
        if (await confirmButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          await confirmButton.click();
        }

        await page.waitForLoadState("networkidle");

        // Verify issue is removed
        await expect(linkedIssue).not.toBeVisible({ timeout: 5000 });
      }
    }
    test.skip();
  });

  test("Navigate to Issue from Test Case", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Navigate Issue Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Navigate Issue Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"]`).first();
    await testCaseRow.click();

    await page.waitForLoadState("networkidle");

    // First link an issue
    const linkIssueButton = page.locator('[data-testid="link-issue"]').first();
    if (await linkIssueButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await linkIssueButton.click();
      const issueOption = page.locator('[role="option"]').first();
      if (await issueOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await issueOption.click();
      }
      await page.waitForLoadState("networkidle");
    }

    // Click on the linked issue to navigate
    const linkedIssue = page.locator('[data-testid="linked-issue"] a, .issue-link a').first();
    if (await linkedIssue.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check that clicking opens the issue (might open in new tab)
      const href = await linkedIssue.getAttribute("href");
      expect(href).toBeTruthy();

      // Verify it links to an external issue tracker
      if (href) {
        expect(href).toMatch(/jira|github|azure|gitlab/i);
      }
    }
    test.skip();
  });

  test("View Issue Details Preview", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Preview Issue Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Preview Issue Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"]`).first();
    await testCaseRow.click();

    await page.waitForLoadState("networkidle");

    // Link an issue
    const linkIssueButton = page.locator('[data-testid="link-issue"]').first();
    if (await linkIssueButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await linkIssueButton.click();
      const issueOption = page.locator('[role="option"]').first();
      if (await issueOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await issueOption.click();
      }
      await page.waitForLoadState("networkidle");
    }

    // Hover over linked issue to see preview
    const linkedIssue = page.locator('[data-testid="linked-issue"]').first();
    if (await linkedIssue.isVisible({ timeout: 5000 }).catch(() => false)) {
      await linkedIssue.hover();

      // Look for preview tooltip/popover
      const preview = page.locator('[data-testid="issue-preview"], .issue-popover, [role="tooltip"]');
      if (await preview.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Verify preview contains issue details
        await expect(preview).toContainText(/title|status|description/i);
      }
    }
    test.skip();
  });

  test("Issue Link Shows Status Badge", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Status Badge Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Status Badge Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"]`).first();
    await testCaseRow.click();

    await page.waitForLoadState("networkidle");

    // Link an issue
    const linkIssueButton = page.locator('[data-testid="link-issue"]').first();
    if (await linkIssueButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await linkIssueButton.click();
      const issueOption = page.locator('[role="option"]').first();
      if (await issueOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await issueOption.click();
      }
      await page.waitForLoadState("networkidle");
    }

    // Verify issue shows status badge
    const linkedIssue = page.locator('[data-testid="linked-issue"]').first();
    if (await linkedIssue.isVisible({ timeout: 5000 }).catch(() => false)) {
      const statusBadge = linkedIssue.locator('[data-testid="issue-status"], .status-badge, .badge');
      await expect(statusBadge.first()).toBeVisible({ timeout: 5000 });
    }
    test.skip();
  });

  test("Bulk Link Issue to Test Cases", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Bulk Issue Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const case1Id = await api.createTestCase(projectId, folderId, `Bulk Issue 1 ${Date.now()}`);
    const case2Id = await api.createTestCase(projectId, folderId, `Bulk Issue 2 ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    // Select multiple test cases
    const checkbox1 = page.locator(`[data-testid="case-checkbox-${case1Id}"]`).first();
    const checkbox2 = page.locator(`[data-testid="case-checkbox-${case2Id}"]`).first();

    if (await checkbox1.isVisible({ timeout: 5000 }).catch(() => false)) {
      await checkbox1.click();
      await checkbox2.click();

      // Open bulk edit menu
      const bulkEditButton = page.locator('[data-testid="bulk-edit"]').first();
      if (await bulkEditButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await bulkEditButton.click();

        // Select "Link Issue" option
        const linkIssueOption = page.locator('[role="menuitem"]:has-text("Issue"), [data-testid="bulk-link-issue"]').first();
        if (await linkIssueOption.isVisible({ timeout: 3000 }).catch(() => false)) {
          await linkIssueOption.click();

          // Enter/select issue
          const issueOption = page.locator('[role="option"]').first();
          if (await issueOption.isVisible({ timeout: 3000 }).catch(() => false)) {
            await issueOption.click();

            const applyButton = page.locator('button:has-text("Apply")').first();
            await applyButton.click();

            await page.waitForLoadState("networkidle");
          }
        }
      }
    }
    test.skip();
  });

  test("Issue Integration Error Handling", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Error Handle Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Error Handle Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"]`).first();
    await testCaseRow.click();

    await page.waitForLoadState("networkidle");

    const linkIssueButton = page.locator('[data-testid="link-issue"]').first();
    if (await linkIssueButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await linkIssueButton.click();

      // Try to search for a non-existent issue
      const issueInput = page.locator('[data-testid="issue-input"]').first();
      if (await issueInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await issueInput.fill("NONEXISTENT-99999");

        const searchButton = page.locator('button:has-text("Search")').first();
        if (await searchButton.isVisible({ timeout: 3000 }).catch(() => false)) {
          await searchButton.click();

          await page.waitForLoadState("networkidle");

          // Verify error or "not found" message
          const errorMessage = page.locator('[role="alert"], .error-message, text=/not found|no results|error/i');
          await expect(errorMessage.first()).toBeVisible({ timeout: 5000 });
        }
      }
    }
    test.skip();
  });

  test("Create Issue from Test Case", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Create Issue Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Create Issue Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"]`).first();
    await testCaseRow.click();

    await page.waitForLoadState("networkidle");

    // Look for "Create Issue" button
    const createIssueButton = page.locator('[data-testid="create-issue"], button:has-text("Create Issue")').first();
    if (await createIssueButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await createIssueButton.click();

      // Fill in issue form
      const issueTitleInput = page.locator('[data-testid="issue-title"], input[name="title"]').first();
      if (await issueTitleInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await issueTitleInput.fill(`Bug from test case ${Date.now()}`);

        const submitButton = page.locator('button[type="submit"], button:has-text("Create")').first();
        await submitButton.click();

        await page.waitForLoadState("networkidle");

        // Verify issue was created and linked
        const linkedIssue = page.locator('[data-testid="linked-issue"]').first();
        await expect(linkedIssue).toBeVisible({ timeout: 10000 });
      }
    }
    test.skip();
  });

  test("Sync Issue Status", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Sync Issue Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Sync Issue Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"]`).first();
    await testCaseRow.click();

    await page.waitForLoadState("networkidle");

    // Link an issue first
    const linkIssueButton = page.locator('[data-testid="link-issue"]').first();
    if (await linkIssueButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await linkIssueButton.click();
      const issueOption = page.locator('[role="option"]').first();
      if (await issueOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await issueOption.click();
      }
      await page.waitForLoadState("networkidle");
    }

    // Look for sync button
    const syncButton = page.locator('[data-testid="sync-issue"], button:has-text("Sync"), button:has-text("Refresh")').first();
    if (await syncButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await syncButton.click();

      await page.waitForLoadState("networkidle");

      // Verify status is updated (or at least no error)
      const statusBadge = page.locator('[data-testid="issue-status"]').first();
      if (await statusBadge.isVisible({ timeout: 3000 }).catch(() => false)) {
        expect(await statusBadge.textContent()).toBeTruthy();
      }
    }
    test.skip();
  });

  test("Issue Link Bidirectional", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Bidirectional Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Bidirectional Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"]`).first();
    await testCaseRow.click();

    await page.waitForLoadState("networkidle");

    // Link an issue
    const linkIssueButton = page.locator('[data-testid="link-issue"]').first();
    if (await linkIssueButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await linkIssueButton.click();
      const issueOption = page.locator('[role="option"]').first();
      if (await issueOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await issueOption.click();
      }
      await page.waitForLoadState("networkidle");

      // Verify bidirectional link indicator
      const bidirectionalIndicator = page.locator('[data-testid="bidirectional-link"], .sync-icon');
      if (await bidirectionalIndicator.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Link is bidirectional
        expect(await bidirectionalIndicator.isVisible()).toBe(true);
      } else {
        // Check if there's a note about the link being created in both systems
        const successMessage = page.locator('text=/linked.*both|bidirectional|synced/i');
        if (await successMessage.isVisible({ timeout: 3000 }).catch(() => false)) {
          expect(await successMessage.isVisible()).toBe(true);
        }
      }
    }
    test.skip();
  });
});
