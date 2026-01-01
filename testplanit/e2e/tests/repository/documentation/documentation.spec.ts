import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Documentation Tests
 *
 * Test cases for managing documentation pages in the repository.
 */
test.describe("Documentation", () => {
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

  test("Create Documentation Page", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Navigate to documentation section
    const docsNav = page.locator('[data-testid="docs-nav"], a:has-text("Docs"), a:has-text("Documentation")').first();
    await expect(docsNav).toBeVisible({ timeout: 5000 });
    await docsNav.click();
    await page.waitForLoadState("networkidle");

    // Click add page button
    const addPageButton = page.locator('[data-testid="add-doc-page"], button:has-text("New Page"), button:has-text("Add Page")').first();
    await expect(addPageButton).toBeVisible({ timeout: 5000 });
    await addPageButton.click();

    // Fill in page title
    const titleInput = page.locator('[data-testid="doc-title-input"], input[placeholder*="title"]').first();
    await expect(titleInput).toBeVisible({ timeout: 5000 });

    const pageTitle = `Doc Page ${Date.now()}`;
    await titleInput.fill(pageTitle);

    // Add some content
    const contentEditor = page.locator('[data-testid="doc-editor"], .tiptap, .ProseMirror').first();
    await expect(contentEditor).toBeVisible({ timeout: 3000 });
    await contentEditor.click();
    await page.keyboard.type("This is documentation content.");

    // Save the page
    const saveButton = page.locator('button:has-text("Save"), button:has-text("Create")').first();
    await saveButton.click();

    await page.waitForLoadState("networkidle");

    // Verify page was created
    await expect(page.locator(`text="${pageTitle}"`).first()).toBeVisible({ timeout: 10000 });
  });

  test("Create Documentation Page in Folder", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const docsNav = page.locator('[data-testid="docs-nav"]').first();
    await expect(docsNav).toBeVisible({ timeout: 5000 });
    await docsNav.click();
    await page.waitForLoadState("networkidle");

    // First create a folder for docs
    const addFolderButton = page.locator('[data-testid="add-doc-folder"]').first();
    await expect(addFolderButton).toBeVisible({ timeout: 5000 });
    await addFolderButton.click();

    const folderNameInput = page.locator('[data-testid="folder-name-input"]').first();
    const folderName = `Doc Folder ${Date.now()}`;
    await folderNameInput.fill(folderName);

    const createFolderButton = page.locator('button:has-text("Create")').first();
    await createFolderButton.click();

    await page.waitForLoadState("networkidle");

    // Now create page in that folder
    const folder = page.locator(`text="${folderName}"`).first();
    await folder.click({ button: "right" });

    const addPageOption = page.locator('[role="menuitem"]:has-text("Add Page")').first();
    await expect(addPageOption).toBeVisible({ timeout: 3000 });
    await addPageOption.click();

    const titleInput = page.locator('[data-testid="doc-title-input"]').first();
    const pageTitle = `Nested Page ${Date.now()}`;
    await titleInput.fill(pageTitle);

    const saveButton = page.locator('button:has-text("Save")').first();
    await saveButton.click();

    await page.waitForLoadState("networkidle");

    // Verify page was created in folder
    await expect(page.locator(`text="${pageTitle}"`).first()).toBeVisible({ timeout: 10000 });
  });

  test("Edit Documentation Page Content", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const docsNav = page.locator('[data-testid="docs-nav"]').first();
    await expect(docsNav).toBeVisible({ timeout: 5000 });
    await docsNav.click();
    await page.waitForLoadState("networkidle");

    // Select an existing page
    const docPage = page.locator('[data-testid="doc-page-item"]').first();
    await expect(docPage).toBeVisible({ timeout: 5000 });
    await docPage.click();
    await page.waitForLoadState("networkidle");

    // Edit the content
    const contentEditor = page.locator('[data-testid="doc-editor"], .tiptap, .ProseMirror').first();
    await expect(contentEditor).toBeVisible({ timeout: 5000 });
    await contentEditor.click();
    await page.keyboard.press("End");
    await page.keyboard.type(` Updated content ${Date.now()}`);

    // Save changes
    const saveButton = page.locator('button:has-text("Save")').first();
    await expect(saveButton).toBeVisible({ timeout: 3000 });
    await saveButton.click();
    await page.waitForLoadState("networkidle");
  });

  test("Edit Documentation Page Title", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const docsNav = page.locator('[data-testid="docs-nav"]').first();
    await expect(docsNav).toBeVisible({ timeout: 5000 });
    await docsNav.click();
    await page.waitForLoadState("networkidle");

    const docPage = page.locator('[data-testid="doc-page-item"]').first();
    await expect(docPage).toBeVisible({ timeout: 5000 });
    await docPage.click();
    await page.waitForLoadState("networkidle");

    // Find and edit title
    const titleInput = page.locator('[data-testid="doc-title-input"], h1[contenteditable="true"]').first();
    await expect(titleInput).toBeVisible({ timeout: 5000 });
    await titleInput.clear();
    const newTitle = `Updated Title ${Date.now()}`;
    await titleInput.fill(newTitle);

    // Save
    const saveButton = page.locator('button:has-text("Save")').first();
    await expect(saveButton).toBeVisible({ timeout: 3000 });
    await saveButton.click();
    await page.waitForLoadState("networkidle");

    await expect(page.locator(`text="${newTitle}"`).first()).toBeVisible({ timeout: 5000 });
  });

  test("Delete Documentation Page", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const docsNav = page.locator('[data-testid="docs-nav"]').first();
    await expect(docsNav).toBeVisible({ timeout: 5000 });
    await docsNav.click();
    await page.waitForLoadState("networkidle");

    const docPage = page.locator('[data-testid="doc-page-item"]').first();
    await expect(docPage).toBeVisible({ timeout: 5000 });
    const pageTitle = await docPage.textContent();

    // Right-click to delete
    await docPage.click({ button: "right" });

    const deleteOption = page.locator('[role="menuitem"]:has-text("Delete")').first();
    await expect(deleteOption).toBeVisible({ timeout: 3000 });
    await deleteOption.click();

    // Confirm
    const confirmButton = page.locator('[role="alertdialog"] button:has-text("Delete")').first();
    await confirmButton.click();

    await page.waitForLoadState("networkidle");

    // Verify page is deleted
    if (pageTitle) {
      await expect(page.locator(`text="${pageTitle}"`)).not.toBeVisible({ timeout: 5000 });
    }
  });

  test("Delete Documentation Folder with Pages", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const docsNav = page.locator('[data-testid="docs-nav"]').first();
    await expect(docsNav).toBeVisible({ timeout: 5000 });
    await docsNav.click();
    await page.waitForLoadState("networkidle");

    const docFolder = page.locator('[data-testid="doc-folder-item"]').first();
    await expect(docFolder).toBeVisible({ timeout: 5000 });
    const folderName = await docFolder.textContent();

    await docFolder.click({ button: "right" });

    const deleteOption = page.locator('[role="menuitem"]:has-text("Delete")').first();
    await expect(deleteOption).toBeVisible({ timeout: 3000 });
    await deleteOption.click();

    // Should warn about contained pages
    const dialog = page.locator('[role="alertdialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const confirmButton = dialog.locator('button:has-text("Delete")').first();
    await confirmButton.click();

    await page.waitForLoadState("networkidle");

    if (folderName) {
      await expect(page.locator(`text="${folderName}"`)).not.toBeVisible({ timeout: 5000 });
    }
  });

  test("Rich Text Formatting in Documentation", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const docsNav = page.locator('[data-testid="docs-nav"]').first();
    await expect(docsNav).toBeVisible({ timeout: 5000 });
    await docsNav.click();
    await page.waitForLoadState("networkidle");

    const docPage = page.locator('[data-testid="doc-page-item"]').first();
    await expect(docPage).toBeVisible({ timeout: 5000 });
    await docPage.click();
    await page.waitForLoadState("networkidle");

    const contentEditor = page.locator('[data-testid="doc-editor"], .tiptap').first();
    await expect(contentEditor).toBeVisible({ timeout: 5000 });
    await contentEditor.click();

    // Type and format text
    await page.keyboard.type("Bold text ");

    // Select and make bold
    await page.keyboard.down("Shift");
    for (let i = 0; i < 9; i++) await page.keyboard.press("ArrowLeft");
    await page.keyboard.up("Shift");

    // Use toolbar or keyboard shortcut
    await page.keyboard.press("Control+b");

    // Verify bold formatting
    const boldText = contentEditor.locator("strong, b");
    await expect(boldText.first()).toBeVisible({ timeout: 5000 });
  });

  test("Add Images to Documentation", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const docsNav = page.locator('[data-testid="docs-nav"]').first();
    await expect(docsNav).toBeVisible({ timeout: 5000 });
    await docsNav.click();
    await page.waitForLoadState("networkidle");

    const docPage = page.locator('[data-testid="doc-page-item"]').first();
    await expect(docPage).toBeVisible({ timeout: 5000 });
    await docPage.click();
    await page.waitForLoadState("networkidle");

    // Look for image upload button
    const imageButton = page.locator('[data-testid="add-image"], button[aria-label*="image"]').first();
    await expect(imageButton).toBeVisible({ timeout: 5000 });
    await imageButton.click();

    // Modal or file picker should appear
    const imageInput = page.locator('input[type="file"]');
    expect(await imageInput.count()).toBeGreaterThan(0);
  });

  test("Add Links to Documentation", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const docsNav = page.locator('[data-testid="docs-nav"]').first();
    await expect(docsNav).toBeVisible({ timeout: 5000 });
    await docsNav.click();
    await page.waitForLoadState("networkidle");

    const docPage = page.locator('[data-testid="doc-page-item"]').first();
    await expect(docPage).toBeVisible({ timeout: 5000 });
    await docPage.click();
    await page.waitForLoadState("networkidle");

    const contentEditor = page.locator('.tiptap').first();
    await expect(contentEditor).toBeVisible({ timeout: 5000 });
    await contentEditor.click();
    await page.keyboard.type("Click here");

    // Select text
    await page.keyboard.down("Shift");
    for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowLeft");
    await page.keyboard.up("Shift");

    // Add link
    await page.keyboard.press("Control+k");

    const linkInput = page.locator('input[placeholder*="URL"], input[type="url"]').first();
    await expect(linkInput).toBeVisible({ timeout: 5000 });
    await linkInput.fill("https://example.com");
    await page.keyboard.press("Enter");

    // Verify link was added
    const link = contentEditor.locator('a[href="https://example.com"]');
    await expect(link.first()).toBeVisible({ timeout: 5000 });
  });

  test("Add Code Blocks to Documentation", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const docsNav = page.locator('[data-testid="docs-nav"]').first();
    await expect(docsNav).toBeVisible({ timeout: 5000 });
    await docsNav.click();
    await page.waitForLoadState("networkidle");

    const docPage = page.locator('[data-testid="doc-page-item"]').first();
    await expect(docPage).toBeVisible({ timeout: 5000 });
    await docPage.click();
    await page.waitForLoadState("networkidle");

    const contentEditor = page.locator('.tiptap').first();
    await expect(contentEditor).toBeVisible({ timeout: 5000 });
    await contentEditor.click();

    // Try to insert code block via slash command or toolbar
    await page.keyboard.type("/code");
    await page.waitForTimeout(500);
    await page.keyboard.press("Enter");

    // Verify code block was added
    const codeBlock = contentEditor.locator("pre, code");
    await expect(codeBlock.first()).toBeVisible({ timeout: 5000 });
  });

  test("Add Tables to Documentation", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const docsNav = page.locator('[data-testid="docs-nav"]').first();
    await expect(docsNav).toBeVisible({ timeout: 5000 });
    await docsNav.click();
    await page.waitForLoadState("networkidle");

    const docPage = page.locator('[data-testid="doc-page-item"]').first();
    await expect(docPage).toBeVisible({ timeout: 5000 });
    await docPage.click();
    await page.waitForLoadState("networkidle");

    const contentEditor = page.locator('.tiptap').first();
    await expect(contentEditor).toBeVisible({ timeout: 5000 });
    await contentEditor.click();

    // Insert table via slash command
    await page.keyboard.type("/table");
    await page.waitForTimeout(500);
    await page.keyboard.press("Enter");

    // Verify table was added
    const table = contentEditor.locator("table");
    await expect(table.first()).toBeVisible({ timeout: 5000 });
  });

  test("Link to Test Case from Documentation", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const docsNav = page.locator('[data-testid="docs-nav"]').first();
    await expect(docsNav).toBeVisible({ timeout: 5000 });
    await docsNav.click();
    await page.waitForLoadState("networkidle");

    const docPage = page.locator('[data-testid="doc-page-item"]').first();
    await expect(docPage).toBeVisible({ timeout: 5000 });
    await docPage.click();
    await page.waitForLoadState("networkidle");

    // Look for "Link Test Case" button
    const linkCaseButton = page.locator('[data-testid="link-test-case"]').first();
    await expect(linkCaseButton).toBeVisible({ timeout: 5000 });
    await linkCaseButton.click();

    // Search for test case
    const caseOption = page.locator('[role="option"]').first();
    await expect(caseOption).toBeVisible({ timeout: 3000 });
    await caseOption.click();
    await page.waitForLoadState("networkidle");
  });

  test("Link Between Documentation Pages", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const docsNav = page.locator('[data-testid="docs-nav"]').first();
    await expect(docsNav).toBeVisible({ timeout: 5000 });
    await docsNav.click();
    await page.waitForLoadState("networkidle");

    const docPage = page.locator('[data-testid="doc-page-item"]').first();
    await expect(docPage).toBeVisible({ timeout: 5000 });
    await docPage.click();
    await page.waitForLoadState("networkidle");

    const contentEditor = page.locator('.tiptap').first();
    await expect(contentEditor).toBeVisible({ timeout: 5000 });
    await contentEditor.click();

    // Use @ or [[ to link to another page
    await page.keyboard.type("[[");

    const pageSuggestions = page.locator('[data-testid="page-suggestions"]').first();
    await expect(pageSuggestions).toBeVisible({ timeout: 3000 });
    const suggestion = pageSuggestions.locator('[role="option"]').first();
    await suggestion.click();
  });

  test("Documentation Table of Contents", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const docsNav = page.locator('[data-testid="docs-nav"]').first();
    await expect(docsNav).toBeVisible({ timeout: 5000 });
    await docsNav.click();
    await page.waitForLoadState("networkidle");

    const docPage = page.locator('[data-testid="doc-page-item"]').first();
    await expect(docPage).toBeVisible({ timeout: 5000 });
    await docPage.click();
    await page.waitForLoadState("networkidle");

    // Look for table of contents
    const toc = page.locator('[data-testid="doc-toc"], .table-of-contents');
    await expect(toc).toBeVisible({ timeout: 5000 });

    // Verify TOC contains links
    const tocLinks = toc.locator("a");
    expect(await tocLinks.count()).toBeGreaterThan(0);
  });

  test("Reorder Documentation Pages", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const docsNav = page.locator('[data-testid="docs-nav"]').first();
    await expect(docsNav).toBeVisible({ timeout: 5000 });
    await docsNav.click();
    await page.waitForLoadState("networkidle");

    const pages = page.locator('[data-testid="doc-page-item"]');
    expect(await pages.count()).toBeGreaterThanOrEqual(2);

    // Drag first page to second position
    const firstPage = pages.nth(0);
    const secondPage = pages.nth(1);

    const firstBox = await firstPage.boundingBox();
    const secondBox = await secondPage.boundingBox();

    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();

    await page.mouse.move(firstBox!.x + firstBox!.width / 2, firstBox!.y + firstBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(secondBox!.x + secondBox!.width / 2, secondBox!.y + secondBox!.height + 10);
    await page.mouse.up();

    await page.waitForLoadState("networkidle");
  });

  test("Move Documentation Page to Different Folder", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const docsNav = page.locator('[data-testid="docs-nav"]').first();
    await expect(docsNav).toBeVisible({ timeout: 5000 });
    await docsNav.click();
    await page.waitForLoadState("networkidle");

    const docPage = page.locator('[data-testid="doc-page-item"]').first();
    await expect(docPage).toBeVisible({ timeout: 5000 });
    await docPage.click({ button: "right" });

    const moveOption = page.locator('[role="menuitem"]:has-text("Move")').first();
    await expect(moveOption).toBeVisible({ timeout: 3000 });
    await moveOption.click();

    // Select destination folder
    const folderOption = page.locator('[role="option"]').first();
    await expect(folderOption).toBeVisible({ timeout: 3000 });
    await folderOption.click();
    await page.waitForLoadState("networkidle");
  });

  test("Documentation Page Version History", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const docsNav = page.locator('[data-testid="docs-nav"]').first();
    await expect(docsNav).toBeVisible({ timeout: 5000 });
    await docsNav.click();
    await page.waitForLoadState("networkidle");

    const docPage = page.locator('[data-testid="doc-page-item"]').first();
    await expect(docPage).toBeVisible({ timeout: 5000 });
    await docPage.click();
    await page.waitForLoadState("networkidle");

    // Open version history
    const historyButton = page.locator('[data-testid="doc-history"], button:has-text("History")').first();
    await expect(historyButton).toBeVisible({ timeout: 5000 });
    await historyButton.click();

    // Verify history panel opens
    const historyPanel = page.locator('[data-testid="history-panel"]');
    await expect(historyPanel.first()).toBeVisible({ timeout: 5000 });
  });

  test("Restore Documentation Page Version", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const docsNav = page.locator('[data-testid="docs-nav"]').first();
    await expect(docsNav).toBeVisible({ timeout: 5000 });
    await docsNav.click();
    await page.waitForLoadState("networkidle");

    const docPage = page.locator('[data-testid="doc-page-item"]').first();
    await expect(docPage).toBeVisible({ timeout: 5000 });
    await docPage.click();
    await page.waitForLoadState("networkidle");

    const historyButton = page.locator('[data-testid="doc-history"]').first();
    await expect(historyButton).toBeVisible({ timeout: 5000 });
    await historyButton.click();

    // Select a previous version
    const versionItem = page.locator('[data-testid="version-item"]').first();
    await expect(versionItem).toBeVisible({ timeout: 3000 });
    await versionItem.click();

    // Restore
    const restoreButton = page.locator('button:has-text("Restore")').first();
    await expect(restoreButton).toBeVisible({ timeout: 3000 });
    await restoreButton.click();
    await page.waitForLoadState("networkidle");
  });

  test("Documentation Page Print/Export", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const docsNav = page.locator('[data-testid="docs-nav"]').first();
    await expect(docsNav).toBeVisible({ timeout: 5000 });
    await docsNav.click();
    await page.waitForLoadState("networkidle");

    const docPage = page.locator('[data-testid="doc-page-item"]').first();
    await expect(docPage).toBeVisible({ timeout: 5000 });
    await docPage.click();
    await page.waitForLoadState("networkidle");

    // Look for print/export button
    const exportButton = page.locator('[data-testid="doc-export"], button:has-text("Export"), button:has-text("Print")').first();
    await expect(exportButton).toBeVisible({ timeout: 5000 });
    await exportButton.click();

    // Verify export options
    const exportDialog = page.locator('[role="dialog"]');
    await expect(exportDialog.first()).toBeVisible({ timeout: 5000 });
  });

  test("Documentation Emoji and Special Characters", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const docsNav = page.locator('[data-testid="docs-nav"]').first();
    await expect(docsNav).toBeVisible({ timeout: 5000 });
    await docsNav.click();
    await page.waitForLoadState("networkidle");

    const docPage = page.locator('[data-testid="doc-page-item"]').first();
    await expect(docPage).toBeVisible({ timeout: 5000 });
    await docPage.click();
    await page.waitForLoadState("networkidle");

    const contentEditor = page.locator('.tiptap').first();
    await expect(contentEditor).toBeVisible({ timeout: 5000 });
    await contentEditor.click();

    // Type emoji and special characters
    await page.keyboard.type("Test 🎉 with émojis & spëcial çharacters");

    // Verify content was saved correctly
    await expect(contentEditor).toContainText("🎉");
    await expect(contentEditor).toContainText("émojis");
  });

  test("Documentation Page Slug/URL", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const docsNav = page.locator('[data-testid="docs-nav"]').first();
    await expect(docsNav).toBeVisible({ timeout: 5000 });
    await docsNav.click();
    await page.waitForLoadState("networkidle");

    const docPage = page.locator('[data-testid="doc-page-item"]').first();
    await expect(docPage).toBeVisible({ timeout: 5000 });
    await docPage.click();
    await page.waitForLoadState("networkidle");

    // Verify URL contains slug
    const url = page.url();
    expect(url).toMatch(/\/docs\/|\/documentation\//);
  });

  test("Documentation Draft Mode", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const docsNav = page.locator('[data-testid="docs-nav"]').first();
    await expect(docsNav).toBeVisible({ timeout: 5000 });
    await docsNav.click();
    await page.waitForLoadState("networkidle");

    // Create a new page as draft
    const addPageButton = page.locator('[data-testid="add-doc-page"]').first();
    await expect(addPageButton).toBeVisible({ timeout: 5000 });
    await addPageButton.click();

    // Look for draft toggle
    const draftToggle = page.locator('[data-testid="draft-toggle"]').first();
    await expect(draftToggle).toBeVisible({ timeout: 3000 });
    await draftToggle.click();
  });

  test("Documentation Page Comments", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const docsNav = page.locator('[data-testid="docs-nav"]').first();
    await expect(docsNav).toBeVisible({ timeout: 5000 });
    await docsNav.click();
    await page.waitForLoadState("networkidle");

    const docPage = page.locator('[data-testid="doc-page-item"]').first();
    await expect(docPage).toBeVisible({ timeout: 5000 });
    await docPage.click();
    await page.waitForLoadState("networkidle");

    // Look for comments section
    const commentsSection = page.locator('[data-testid="doc-comments"]').first();
    await expect(commentsSection).toBeVisible({ timeout: 5000 });

    // Add a comment
    const commentInput = commentsSection.locator('textarea, input').first();
    await commentInput.fill("Test comment");

    const submitComment = commentsSection.locator('button:has-text("Post"), button:has-text("Comment")').first();
    await submitComment.click();

    await page.waitForLoadState("networkidle");
  });

  test("Documentation Keyboard Shortcuts", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const docsNav = page.locator('[data-testid="docs-nav"]').first();
    await expect(docsNav).toBeVisible({ timeout: 5000 });
    await docsNav.click();
    await page.waitForLoadState("networkidle");

    const docPage = page.locator('[data-testid="doc-page-item"]').first();
    await expect(docPage).toBeVisible({ timeout: 5000 });
    await docPage.click();
    await page.waitForLoadState("networkidle");

    const contentEditor = page.locator('.tiptap').first();
    await expect(contentEditor).toBeVisible({ timeout: 5000 });
    await contentEditor.click();

    // Test Ctrl+S to save
    await page.keyboard.press("Control+s");

    // Verify save was triggered (or save indicator shown)
    const saveIndicator = page.locator('[data-testid="save-indicator"], text=/saved/i');
    await expect(saveIndicator).toBeVisible({ timeout: 3000 });
  });

  test("Documentation Autosave", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const docsNav = page.locator('[data-testid="docs-nav"]').first();
    await expect(docsNav).toBeVisible({ timeout: 5000 });
    await docsNav.click();
    await page.waitForLoadState("networkidle");

    const docPage = page.locator('[data-testid="doc-page-item"]').first();
    await expect(docPage).toBeVisible({ timeout: 5000 });
    await docPage.click();
    await page.waitForLoadState("networkidle");

    const contentEditor = page.locator('.tiptap').first();
    await expect(contentEditor).toBeVisible({ timeout: 5000 });
    await contentEditor.click();
    await page.keyboard.type("Autosave test content");

    // Wait for autosave
    await page.waitForTimeout(3000);

    // Verify autosave indicator
    const autosaveIndicator = page.locator('[data-testid="autosave-indicator"], text=/saving|saved/i');
    await expect(autosaveIndicator).toBeVisible({ timeout: 5000 });
  });
});
