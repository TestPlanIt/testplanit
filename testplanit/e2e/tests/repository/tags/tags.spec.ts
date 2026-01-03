import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Tags Tests
 *
 * Test cases for managing tags in the repository.
 */
test.describe("Tags", () => {
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

  test("Create Tag", async ({ page }) => {
    // Navigate to admin tags page where tags are created
    await page.goto("/en-US/admin/tags");
    await page.waitForLoadState("networkidle");

    // Verify we're on the tags page
    await expect(page.locator('[data-testid="tags-page-title"]')).toBeVisible({
      timeout: 10000,
    });

    // Click the add tag button (CirclePlus icon button)
    const addTagButton = page
      .locator("button:has(svg.lucide-circle-plus)")
      .first();
    await expect(addTagButton).toBeVisible({ timeout: 5000 });
    await addTagButton.click();

    // Wait for the dialog to open
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Fill in the tag name
    const tagName = `E2ETestTag${Date.now()}`;
    const tagNameInput = dialog.locator("input[placeholder]").first();
    await expect(tagNameInput).toBeVisible({ timeout: 3000 });
    await tagNameInput.fill(tagName);

    // Submit the form
    const submitButton = dialog.locator('button[type="submit"]');
    await submitButton.click();

    // Wait for the dialog to close (indicates success)
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // Use the filter to find the tag (since pagination may hide it)
    const filterInput = page.locator('input[placeholder*="Filter"]').first();
    await filterInput.fill(tagName);
    await page.waitForLoadState("networkidle");

    // Verify the tag appears in the filtered list
    await expect(page.locator(`text="${tagName}"`).first()).toBeVisible({
      timeout: 10000,
    });
  });

  // NOTE: Tags don't have a color field in the schema - this test is removed

  test("Apply Existing Tag to Test Case", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // First create a tag that we'll apply
    const tagName = `ApplyTag${Date.now()}`;
    await api.createTag(tagName);

    // Create a folder and test case
    const folderName = `Tag Apply Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(
      projectId,
      folderId,
      `Tag Apply Case ${Date.now()}`
    );

    // Navigate directly to the test case detail page
    await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}`);
    await page.waitForLoadState("networkidle");

    // The page opens in view mode - we need to click Edit to access the tag selector
    const editButton = page.locator('button:has-text("Edit")').first();
    await expect(editButton).toBeVisible({ timeout: 10000 });
    await editButton.click();
    await page.waitForLoadState("networkidle");

    // Find the tags section - ManageTags uses react-select
    // The react-select input is inside a div with min-w-[200px] class
    const tagSelectInput = page.locator(".min-w-\\[200px\\] input").first();
    await expect(tagSelectInput).toBeVisible({ timeout: 10000 });

    // Click to focus and open the dropdown
    await tagSelectInput.click();

    // Type the tag name to filter
    await tagSelectInput.fill(tagName);

    // Wait for and click the option
    const tagOption = page
      .locator(`[role="option"]:has-text("${tagName}")`)
      .first();
    await expect(tagOption).toBeVisible({ timeout: 5000 });
    await tagOption.click();

    // Click Save to persist the tag assignment
    const saveButton = page
      .locator('button[type="submit"]:has(svg.lucide-save)')
      .first();
    await expect(saveButton).toBeVisible({ timeout: 5000 });
    await saveButton.click();

    // Wait for save to complete - Edit button reappears when back in view mode
    await expect(editButton).toBeVisible({ timeout: 15000 });
    await page.waitForLoadState("networkidle");

    // Verify the tag appears in view mode (tags section with id="tags-display")
    const tagsDisplaySection = page.locator("#tags-display").first();
    await expect(tagsDisplaySection).toBeVisible({ timeout: 10000 });

    // Verify our tag name is displayed
    await expect(page.locator(`text="${tagName}"`).first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("Apply Multiple Tags to Test Case", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    // Create two tags that we'll apply
    const tagName1 = `MultiTag1_${uniqueId}`;
    const tagName2 = `MultiTag2_${uniqueId}`;
    await api.createTag(tagName1);
    await api.createTag(tagName2);

    // Create a folder and test case
    const folderName = `Multi Tag Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(
      projectId,
      folderId,
      `Multi Tag Case ${uniqueId}`
    );

    // Navigate directly to the test case detail page
    await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}`);
    await page.waitForLoadState("networkidle");

    // Click Edit to enter edit mode
    const editButton = page.locator('button:has-text("Edit")').first();
    await expect(editButton).toBeVisible({ timeout: 10000 });
    await editButton.click();
    await page.waitForLoadState("networkidle");

    // Find the tags section - ManageTags uses react-select
    const tagSelectInput = page.locator(".min-w-\\[200px\\] input").first();
    await expect(tagSelectInput).toBeVisible({ timeout: 10000 });

    // Add first tag
    await tagSelectInput.click();
    await tagSelectInput.fill(tagName1);
    const tagOption1 = page
      .locator(`[role="option"]:has-text("${tagName1}")`)
      .first();
    await expect(tagOption1).toBeVisible({ timeout: 5000 });
    await tagOption1.click();

    // Add second tag
    await tagSelectInput.click();
    await tagSelectInput.fill(tagName2);
    const tagOption2 = page
      .locator(`[role="option"]:has-text("${tagName2}")`)
      .first();
    await expect(tagOption2).toBeVisible({ timeout: 5000 });
    await tagOption2.click();

    // Click Save to persist the tag assignments
    const saveButton = page
      .locator('button[type="submit"]:has(svg.lucide-save)')
      .first();
    await expect(saveButton).toBeVisible({ timeout: 5000 });
    await saveButton.click();

    // Wait for save to complete - Edit button reappears when back in view mode
    await expect(editButton).toBeVisible({ timeout: 15000 });
    await page.waitForLoadState("networkidle");

    // Verify both tags appear in view mode
    const tagsDisplaySection = page.locator("#tags-display").first();
    await expect(tagsDisplaySection).toBeVisible({ timeout: 10000 });

    // Verify both tag names are displayed
    await expect(page.locator(`text="${tagName1}"`).first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator(`text="${tagName2}"`).first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("Remove Tag from Test Case", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    // Create a tag
    const tagName = `RemoveTag${uniqueId}`;
    const tagId = await api.createTag(tagName);

    // Create a folder and test case
    const folderName = `Remove Tag Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(
      projectId,
      folderId,
      `Remove Tag Case ${uniqueId}`
    );

    // Apply the tag to the test case via API (so we start with it attached)
    await api.addTagToTestCase(testCaseId, tagId);

    // Navigate to the test case detail page
    await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}`);
    await page.waitForLoadState("networkidle");

    // Verify the tag appears in view mode first
    const tagsDisplaySection = page.locator("#tags-display").first();
    await expect(tagsDisplaySection).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`text="${tagName}"`).first()).toBeVisible({
      timeout: 5000,
    });

    // Click Edit to enter edit mode
    const editButton = page.locator('button:has-text("Edit")').first();
    await expect(editButton).toBeVisible({ timeout: 10000 });
    await editButton.click();
    await page.waitForLoadState("networkidle");

    // Find the tag in the react-select and remove it
    // React-select shows selected tags with an "x" button to remove them
    const selectedTagRemoveButton = page
      .locator(
        `.min-w-\\[200px\\] [class*="multiValue"] [class*="Remove"], .min-w-\\[200px\\] svg[class*="css"]`
      )
      .first();
    await expect(selectedTagRemoveButton).toBeVisible({ timeout: 5000 });
    await selectedTagRemoveButton.click();

    // Click Save to persist the removal and wait for the API response
    const saveButton = page
      .locator('button[type="submit"]:has(svg.lucide-save)')
      .first();
    await expect(saveButton).toBeVisible({ timeout: 5000 });

    // Wait for the PUT/PATCH API call to complete
    const saveResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/model/repositoryCases") &&
        (response.request().method() === "PUT" ||
          response.request().method() === "PATCH") &&
        response.ok(),
      { timeout: 15000 }
    );

    await saveButton.click();
    await saveResponsePromise;

    // Wait for save to complete - Edit button reappears when back in view mode
    await expect(editButton).toBeVisible({ timeout: 15000 });
    await page.waitForLoadState("networkidle");

    // Verify the tag is no longer displayed in view mode
    // The tags section should either not be visible or not contain our tag
    await expect(page.locator(`text="${tagName}"`)).not.toBeVisible({
      timeout: 5000,
    });
  });

  test("Edit Tag Name", async ({ api, page }) => {
    // First create a tag to edit
    const originalName = `EditTestTag${Date.now()}`;
    await api.createTag(originalName);

    // Navigate to admin tags page
    await page.goto("/en-US/admin/tags");
    await page.waitForLoadState("networkidle");

    // Verify we're on the tags page
    await expect(page.locator('[data-testid="tags-page-title"]')).toBeVisible({
      timeout: 10000,
    });

    // Use filter to find the tag (since pagination may hide it)
    const filterInput = page.locator('input[placeholder*="Filter"]').first();
    await filterInput.fill(originalName);
    await page.waitForLoadState("networkidle");

    // Find the row with our tag
    const tagRow = page.locator(`tr:has-text("${originalName}")`).first();
    await expect(tagRow).toBeVisible({ timeout: 5000 });

    // Click the edit button (SquarePen icon) in that row
    const editButton = tagRow.locator("button:has(svg.lucide-square-pen)");
    await expect(editButton).toBeVisible({ timeout: 3000 });
    await editButton.click();

    // Wait for the dialog to open
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Edit the name
    const newName = `EditedTag${Date.now()}`;
    const nameInput = dialog.locator("input").first();
    await nameInput.clear();
    await nameInput.fill(newName);

    // Submit the form
    const submitButton = dialog.locator('button[type="submit"]');
    await submitButton.click();

    // Wait for the dialog to close
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // Filter for the new name to verify it was updated
    await filterInput.clear();
    await filterInput.fill(newName);
    await page.waitForLoadState("networkidle");

    // Verify the new name appears in the list
    await expect(page.locator(`text="${newName}"`).first()).toBeVisible({
      timeout: 10000,
    });
  });

  // NOTE: Tags don't have a color field in the schema - "Edit Tag Color" test removed

  test("Delete Tag", async ({ api, page }) => {
    // First create a tag to delete
    const tagName = `DeleteTestTag${Date.now()}`;
    await api.createTag(tagName);

    // Navigate to admin tags page
    await page.goto("/en-US/admin/tags");
    await page.waitForLoadState("networkidle");

    // Verify we're on the tags page
    await expect(page.locator('[data-testid="tags-page-title"]')).toBeVisible({
      timeout: 10000,
    });

    // Use filter to find the tag (since pagination may hide it)
    const filterInput = page.locator('input[placeholder*="Filter"]').first();
    await filterInput.fill(tagName);
    await page.waitForLoadState("networkidle");

    // Find the row with our tag
    const tagRow = page.locator(`tr:has-text("${tagName}")`).first();
    await expect(tagRow).toBeVisible({ timeout: 5000 });

    // Click the delete button (Trash2 icon) in that row
    const deleteButton = tagRow.locator("button:has(svg.lucide-trash-2)");
    await expect(deleteButton).toBeVisible({ timeout: 3000 });
    await deleteButton.click();

    // Wait for the alert dialog to open
    const alertDialog = page.locator('[role="alertdialog"]');
    await expect(alertDialog).toBeVisible({ timeout: 5000 });

    // Confirm deletion by clicking the delete button in the dialog
    const confirmButton = alertDialog.locator('button:has-text("Delete")');
    await confirmButton.click();

    // Wait for the dialog to close
    await expect(alertDialog).not.toBeVisible({ timeout: 10000 });

    // Verify tag is no longer visible in the filtered list
    await expect(page.locator(`tr:has-text("${tagName}")`)).not.toBeVisible({
      timeout: 5000,
    });
  });

  test("Tags Display in Test Case List", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    // Create a folder and test case
    const folderName = `Display Tags Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseName = `Display Tags Case ${uniqueId}`;
    const testCaseId = await api.createTestCase(
      projectId,
      folderId,
      testCaseName
    );

    // Create a tag and assign it to the test case
    const tagName = `E2ETag${uniqueId}`;
    const tagId = await api.createTag(tagName);
    await api.addTagToTestCase(testCaseId, tagId);

    await repositoryPage.goto(projectId);

    // Select the folder to see the test case list
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Verify the test case is visible in the list
    const testCaseRow = page.locator(`[data-row-id="${testCaseId}"]`).first();
    await expect(testCaseRow).toBeVisible({ timeout: 10000 });

    // The Tags column shows a count - click it to open the tag list popover
    // The cell contains a clickable div with the count
    const tagCountCell = testCaseRow.locator("td").nth(7);
    await expect(tagCountCell).toContainText("1");
    await tagCountCell.click();

    // Verify the tag name appears in the popover
    const tagNameInPopover = page.locator(`text="${tagName}"`).first();
    await expect(tagNameInPopover).toBeVisible({ timeout: 5000 });
  });

  test("Bulk Remove Tags from Test Cases", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    // Create a tag and apply it to test cases via API
    const tagName = `BulkRemoveTag${uniqueId}`;
    const tagId = await api.createTag(tagName);

    // Create a folder and two test cases
    const folderName = `Bulk Remove Tags ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const case1Id = await api.createTestCase(
      projectId,
      folderId,
      `Bulk Remove 1 ${uniqueId}`
    );
    const case2Id = await api.createTestCase(
      projectId,
      folderId,
      `Bulk Remove 2 ${uniqueId}`
    );

    // Apply the tag to both test cases via API
    await api.addTagToTestCase(case1Id, tagId);
    await api.addTagToTestCase(case2Id, tagId);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Wait for the test case rows to appear
    const row1 = page.locator(`[data-row-id="${case1Id}"]`).first();
    const row2 = page.locator(`[data-row-id="${case2Id}"]`).first();
    await expect(row1).toBeVisible({ timeout: 10000 });
    await expect(row2).toBeVisible({ timeout: 10000 });

    // Select the test cases by clicking the checkboxes
    const checkbox1 = row1.locator('button[role="checkbox"]').first();
    const checkbox2 = row2.locator('button[role="checkbox"]').first();
    await checkbox1.click();
    await checkbox2.click();

    // Wait for and click bulk edit button
    const bulkEditButton = page
      .locator('[data-testid="bulk-edit-button"]')
      .first();
    await expect(bulkEditButton).toBeVisible({ timeout: 5000 });
    await bulkEditButton.click();

    // Wait for the bulk edit modal to open
    const bulkEditModal = page.locator('[role="dialog"]');
    await expect(bulkEditModal).toBeVisible({ timeout: 5000 });

    // Check the "Tags" field checkbox to enable editing
    const tagsCheckbox = bulkEditModal
      .locator('input[id="edit-tags"], [id="edit-tags"]')
      .first();
    await expect(tagsCheckbox).toBeVisible({ timeout: 3000 });
    await tagsCheckbox.click();

    // The tag should be shown as selected - remove it by clicking the remove button
    // Wait for the tag to appear in the multiselect (it shows as a chip with an x)
    const tagChip = bulkEditModal.locator(`text="${tagName}"`).first();
    await expect(tagChip).toBeVisible({ timeout: 5000 });

    // Click the remove button (X) on the tag chip - it's an SVG or element right after the tag text
    // The x button in react-select has role="button" or is a sibling element
    const tagRemoveButton = bulkEditModal
      .locator(`.min-w-\\[200px\\]`)
      .locator(`[class*="multiValue"]`)
      .first()
      .locator('svg, [role="button"]')
      .first();
    await tagRemoveButton.click();

    // Verify the tag was removed from the selector (tag text no longer visible in the field)
    await expect(
      bulkEditModal.locator(`.min-w-\\[200px\\]`).locator(`text="${tagName}"`)
    ).not.toBeVisible({ timeout: 3000 });

    // Click Save in the modal
    const saveButton = bulkEditModal.locator('button:has-text("Save")').first();
    await expect(saveButton).toBeVisible({ timeout: 3000 });
    await saveButton.click();

    // Wait for modal to close
    await expect(bulkEditModal).not.toBeVisible({ timeout: 10000 });

    // Verify by navigating to first test case and checking tag is removed
    await page.goto(`/en-US/projects/repository/${projectId}/${case1Id}`);
    await page.waitForLoadState("networkidle");

    // Wait for page to load
    const editButton = page.locator('button:has-text("Edit")').first();
    await expect(editButton).toBeVisible({ timeout: 10000 });

    // Verify tag is no longer displayed
    await expect(page.locator(`text="${tagName}"`)).not.toBeVisible({
      timeout: 5000,
    });
  });

  test("Bulk Edit - Assign Tags", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    // Create a tag to assign
    const tagName = `AssignTag${uniqueId}`;
    await api.createTag(tagName);

    // Create a folder and two test cases
    const folderName = `Bulk Assign Tags ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const case1Id = await api.createTestCase(
      projectId,
      folderId,
      `Assign 1 ${uniqueId}`
    );
    const case2Id = await api.createTestCase(
      projectId,
      folderId,
      `Assign 2 ${uniqueId}`
    );

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Wait for the test case rows to appear
    const row1 = page.locator(`[data-row-id="${case1Id}"]`).first();
    const row2 = page.locator(`[data-row-id="${case2Id}"]`).first();
    await expect(row1).toBeVisible({ timeout: 10000 });
    await expect(row2).toBeVisible({ timeout: 10000 });

    // Select both test cases
    const checkbox1 = row1.locator('button[role="checkbox"]').first();
    const checkbox2 = row2.locator('button[role="checkbox"]').first();
    await checkbox1.click();
    await checkbox2.click();

    // Click bulk edit button
    const bulkEditButton = page
      .locator('[data-testid="bulk-edit-button"]')
      .first();
    await expect(bulkEditButton).toBeVisible({ timeout: 5000 });
    await bulkEditButton.click();

    // Wait for the bulk edit modal
    const bulkEditModal = page.locator('[role="dialog"]');
    await expect(bulkEditModal).toBeVisible({ timeout: 5000 });

    // Enable editing of the Tags field
    const tagsCheckbox = bulkEditModal
      .locator('input[id="edit-tags"], [id="edit-tags"]')
      .first();
    await expect(tagsCheckbox).toBeVisible({ timeout: 3000 });
    await tagsCheckbox.click();

    // Add the tag
    const tagSelectInput = bulkEditModal
      .locator(".min-w-\\[200px\\] input")
      .first();
    await expect(tagSelectInput).toBeVisible({ timeout: 5000 });
    await tagSelectInput.click();
    await tagSelectInput.fill(tagName);

    const tagOption = page
      .locator(`[role="option"]:has-text("${tagName}")`)
      .first();
    await expect(tagOption).toBeVisible({ timeout: 5000 });
    await tagOption.click();

    // Save
    const saveButton = bulkEditModal.locator('button:has-text("Save")').first();
    await saveButton.click();
    await expect(bulkEditModal).not.toBeVisible({ timeout: 10000 });

    // Verify tag was assigned to both test cases by checking each one
    await page.goto(`/en-US/projects/repository/${projectId}/${case1Id}`);
    await page.waitForLoadState("networkidle");

    const tagsDisplaySection1 = page.locator("#tags-display").first();
    await expect(tagsDisplaySection1).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`text="${tagName}"`).first()).toBeVisible({
      timeout: 5000,
    });

    // Also verify on second test case
    await page.goto(`/en-US/projects/repository/${projectId}/${case2Id}`);
    await page.waitForLoadState("networkidle");

    const tagsDisplaySection2 = page.locator("#tags-display").first();
    await expect(tagsDisplaySection2).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`text="${tagName}"`).first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("Tag Autocomplete Suggestions", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    // Create some tags that will appear in autocomplete
    const tagPrefix = `AutoTag${uniqueId}`;
    await api.createTag(`${tagPrefix}_Alpha`);
    await api.createTag(`${tagPrefix}_Beta`);
    await api.createTag(`${tagPrefix}_Gamma`);

    // Create a folder and test case
    const folderName = `Autocomplete Tag ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(
      projectId,
      folderId,
      `Autocomplete Case ${uniqueId}`
    );

    // Navigate to the test case detail page
    await page.goto(`/en-US/projects/repository/${projectId}/${testCaseId}`);
    await page.waitForLoadState("networkidle");

    // Click Edit to access the tag selector
    const editButton = page.locator('button:has-text("Edit")').first();
    await expect(editButton).toBeVisible({ timeout: 10000 });
    await editButton.click();
    await page.waitForLoadState("networkidle");

    // Find the tag select input
    const tagSelectInput = page.locator(".min-w-\\[200px\\] input").first();
    await expect(tagSelectInput).toBeVisible({ timeout: 10000 });

    // Click to focus and type partial tag name to trigger autocomplete
    await tagSelectInput.click();
    await tagSelectInput.fill(tagPrefix);

    // Verify autocomplete suggestions appear with our tags
    const alphaOption = page
      .locator(`[role="option"]:has-text("${tagPrefix}_Alpha")`)
      .first();
    const betaOption = page
      .locator(`[role="option"]:has-text("${tagPrefix}_Beta")`)
      .first();
    const gammaOption = page
      .locator(`[role="option"]:has-text("${tagPrefix}_Gamma")`)
      .first();

    await expect(alphaOption).toBeVisible({ timeout: 5000 });
    await expect(betaOption).toBeVisible({ timeout: 5000 });
    await expect(gammaOption).toBeVisible({ timeout: 5000 });

    // Select one option to confirm autocomplete works
    await alphaOption.click();

    // Verify the tag was selected (appears as a chip in the select)
    const selectedTag = page
      .locator(`.min-w-\\[200px\\]`)
      .getByText(`${tagPrefix}_Alpha`)
      .first();
    await expect(selectedTag).toBeVisible({ timeout: 5000 });
  });

  test("Tags Are Visible Across Projects", async ({ api, page }) => {
    // Tags are global in the system - verify a tag created globally is visible across projects
    const projects = await api.getProjects();

    if (projects.length < 2) {
      throw new Error(
        "Need at least 2 projects for cross-project tag test. Check e2e setup."
      );
    }

    // Use the second project
    const project2Id = projects[1].id;
    const uniqueId = Date.now();

    // Create a unique tag via API (tags are global, not project-scoped)
    const globalTagName = `GlobalTag${uniqueId}`;
    await api.createTag(globalTagName);

    // Create test data in PROJECT 2
    const folderName = `Cross Project Tag Folder ${uniqueId}`;
    const folderId = await api.createFolder(project2Id, folderName);
    const testCaseId = await api.createTestCase(
      project2Id,
      folderId,
      `Cross Project Tag Case ${uniqueId}`
    );

    // Navigate to the test case detail page in PROJECT 2
    await page.goto(`/en-US/projects/repository/${project2Id}/${testCaseId}`);
    await page.waitForLoadState("networkidle");

    // Click Edit to access the tag selector
    const editButton = page.locator('button:has-text("Edit")').first();
    await expect(editButton).toBeVisible({ timeout: 10000 });
    await editButton.click();
    await page.waitForLoadState("networkidle");

    // Find the tag select input
    const tagSelectInput = page.locator(".min-w-\\[200px\\] input").first();
    await expect(tagSelectInput).toBeVisible({ timeout: 10000 });

    // Type the global tag name to search for it
    await tagSelectInput.click();
    await tagSelectInput.fill(globalTagName);

    // Verify the globally created tag appears in the options
    const tagOption = page
      .locator(`[role="option"]:has-text("${globalTagName}")`)
      .first();
    await expect(tagOption).toBeVisible({ timeout: 5000 });

    // Select it
    await tagOption.click();

    // Save the test case
    const saveButton = page
      .locator('button[type="submit"]:has(svg.lucide-save)')
      .first();
    await saveButton.click();

    // Wait for view mode
    await expect(editButton).toBeVisible({ timeout: 15000 });
    await page.waitForLoadState("networkidle");

    // Verify the global tag is now displayed on the test case
    const tagsDisplaySection = page.locator("#tags-display").first();
    await expect(tagsDisplaySection).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`text="${globalTagName}"`).first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("Tag Case Insensitivity", async ({ page }) => {
    const uniqueId = Date.now();

    // Create a tag with lowercase via the admin page
    const lowerCaseTagName = `casesensitive${uniqueId}`;
    const upperCaseTagName = `CASESENSITIVE${uniqueId}`;

    // Navigate to admin tags page
    await page.goto("/en-US/admin/tags");
    await page.waitForLoadState("networkidle");

    // Verify we're on the tags page
    await expect(page.locator('[data-testid="tags-page-title"]')).toBeVisible({
      timeout: 10000,
    });

    // Click the add tag button
    const addTagButton = page
      .locator("button:has(svg.lucide-circle-plus)")
      .first();
    await expect(addTagButton).toBeVisible({ timeout: 5000 });
    await addTagButton.click();

    // Wait for the dialog
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Fill and create lowercase tag
    const tagNameInput = dialog.locator("input[placeholder]").first();
    await tagNameInput.fill(lowerCaseTagName);
    const submitButton = dialog.locator('button[type="submit"]');
    await submitButton.click();

    // Wait for dialog to close - this MUST succeed
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // Verify the lowercase tag appears
    const filterInput = page.locator('input[placeholder*="Filter"]').first();
    await filterInput.fill(lowerCaseTagName);
    await page.waitForLoadState("networkidle");
    await expect(
      page.locator(`text="${lowerCaseTagName}"`).first()
    ).toBeVisible({ timeout: 5000 });

    // Now try to create the uppercase version - the system is case-insensitive so it should fail
    await addTagButton.click();
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const tagNameInput2 = dialog.locator("input[placeholder]").first();
    await tagNameInput2.fill(upperCaseTagName);
    const submitButton2 = dialog.locator('button[type="submit"]');
    await submitButton2.click();

    // Dialog should stay open with an error message because tag already exists (case-insensitive)
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Verify error message is shown
    const errorMessage = dialog.locator("text=/already exists|Name is taken/i");
    await expect(errorMessage).toBeVisible({ timeout: 5000 });

    // Close the dialog
    const cancelButton = dialog.locator('button:has-text("Cancel")');
    await cancelButton.click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Verify only the original lowercase tag exists
    await filterInput.clear();
    await filterInput.fill(lowerCaseTagName);
    await page.waitForLoadState("networkidle");
    await expect(
      page.locator(`text="${lowerCaseTagName}"`).first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("Restore Soft-Deleted Tag on Create", async ({ api, page }) => {
    const uniqueId = Date.now();
    const tagName = `restoretag${uniqueId}`;

    // Create a tag via API and then soft-delete it
    const tagId = await api.createTag(tagName);
    await api.deleteTag(tagId);

    // Navigate to admin tags page
    await page.goto("/en-US/admin/tags");
    await page.waitForLoadState("networkidle");

    // Verify the deleted tag is NOT visible in the list
    const filterInput = page.locator('input[placeholder*="Filter"]').first();
    await filterInput.fill(tagName);
    await page.waitForLoadState("networkidle");
    await expect(page.locator(`text="${tagName}"`)).not.toBeVisible({
      timeout: 3000,
    });
    await filterInput.clear();

    // Now try to create a tag with the same name - it should restore the deleted one
    const addTagButton = page
      .locator("button:has(svg.lucide-circle-plus)")
      .first();
    await addTagButton.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const tagNameInput = dialog.locator("input[placeholder]").first();
    await tagNameInput.fill(tagName);
    const submitButton = dialog.locator('button[type="submit"]');
    await submitButton.click();

    // Dialog should close successfully (tag was restored)
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // Verify the tag is now visible in the list (restored)
    await filterInput.fill(tagName);
    await page.waitForLoadState("networkidle");
    await expect(page.locator(`text="${tagName}"`).first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("Edit Tag to Soft-Deleted Tag Name", async ({ api, page }) => {
    const uniqueId = Date.now();
    const activeTagName = `activetag${uniqueId}`;
    const deletedTagName = `deletedtag${uniqueId}`;

    // Create two tags - one active and one that will be deleted
    await api.createTag(activeTagName);
    const deletedTagId = await api.createTag(deletedTagName);
    await api.deleteTag(deletedTagId);

    // Navigate to admin tags page
    await page.goto("/en-US/admin/tags");
    await page.waitForLoadState("networkidle");

    // Find and click edit on the active tag
    const filterInput = page.locator('input[placeholder*="Filter"]').first();
    await filterInput.fill(activeTagName);
    await page.waitForLoadState("networkidle");

    // Click the edit button for this tag
    const editButton = page.locator("button:has(svg.lucide-square-pen)").first();
    await expect(editButton).toBeVisible({ timeout: 5000 });
    await editButton.click();

    // Wait for the edit dialog
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Change the name to the deleted tag's name
    const tagNameInput = dialog.locator("input").first();
    await tagNameInput.clear();
    await tagNameInput.fill(deletedTagName);

    const submitButton = dialog.locator('button[type="submit"]');
    await submitButton.click();

    // Dialog should close successfully (deleted tag was renamed to allow this)
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // Verify the tag now has the new name
    await filterInput.clear();
    await filterInput.fill(deletedTagName);
    await page.waitForLoadState("networkidle");
    await expect(page.locator(`text="${deletedTagName}"`).first()).toBeVisible({
      timeout: 5000,
    });

    // The old name should no longer exist as an active tag
    await filterInput.clear();
    await filterInput.fill(activeTagName);
    await page.waitForLoadState("networkidle");
    await expect(page.locator(`text="${activeTagName}"`)).not.toBeVisible({
      timeout: 3000,
    });
  });

  test("Tag with Special Characters", async ({ page }) => {
    const uniqueId = Date.now();

    // Navigate to admin tags page
    await page.goto("/en-US/admin/tags");
    await page.waitForLoadState("networkidle");

    // Verify we're on the tags page
    await expect(page.locator('[data-testid="tags-page-title"]')).toBeVisible({
      timeout: 10000,
    });

    // Click the add tag button
    const addTagButton = page
      .locator("button:has(svg.lucide-circle-plus)")
      .first();
    await expect(addTagButton).toBeVisible({ timeout: 5000 });
    await addTagButton.click();

    // Wait for the dialog
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Create a tag with special characters (hyphen and underscore are allowed)
    const specialTag = `Tag-with_special${uniqueId}`;
    const tagNameInput = dialog.locator("input[placeholder]").first();
    await tagNameInput.fill(specialTag);

    const submitButton = dialog.locator('button[type="submit"]');
    await submitButton.click();

    // Wait for dialog to close - this should succeed
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // Verify the tag was created and appears in the list
    const filterInput = page.locator('input[placeholder*="Filter"]').first();
    await filterInput.fill(specialTag);
    await page.waitForLoadState("networkidle");
    await expect(page.locator(`text="${specialTag}"`).first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("Tag Usage Count", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    // Create a tag
    const tagName = `UsageCountTag${uniqueId}`;
    const tagId = await api.createTag(tagName);

    // Create a folder and test cases to apply the tag to
    const folderName = `Usage Count Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const case1Id = await api.createTestCase(
      projectId,
      folderId,
      `Usage Count Case 1 ${uniqueId}`
    );
    const case2Id = await api.createTestCase(
      projectId,
      folderId,
      `Usage Count Case 2 ${uniqueId}`
    );

    // Apply the tag to both test cases via API
    await api.addTagToTestCase(case1Id, tagId);
    await api.addTagToTestCase(case2Id, tagId);

    // Navigate to admin tags page
    await page.goto("/en-US/admin/tags");
    await page.waitForLoadState("networkidle");

    // Verify we're on the tags page
    await expect(page.locator('[data-testid="tags-page-title"]')).toBeVisible({
      timeout: 10000,
    });

    // Filter to find our tag
    const filterInput = page.locator('input[placeholder*="Filter"]').first();
    await filterInput.fill(tagName);
    await page.waitForLoadState("networkidle");

    // Find the row with our tag
    const tagRow = page.locator(`tr:has-text("${tagName}")`).first();
    await expect(tagRow).toBeVisible({ timeout: 5000 });

    // The "Test Cases" column shows the usage count
    // Looking at columns.tsx, test cases count is in the "cases" column
    // The cell contains CasesListDisplay with a count
    const testCasesCell = tagRow.locator("td").nth(1); // Second column (after name) is "cases"

    // The count should show "2" since we applied the tag to 2 test cases
    // Click on the cell to open the popover with cases
    await testCasesCell.click();

    // Wait a moment for the popover/count to be interactive
    await page.waitForTimeout(500);

    // Verify the count displays (the column shows a count that when clicked opens a list)
    // The text should contain "2" or similar
    const cellText = await testCasesCell.textContent();
    expect(cellText).toContain("2");
  });
});
