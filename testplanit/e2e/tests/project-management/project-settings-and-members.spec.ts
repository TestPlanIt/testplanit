import { expect, test } from "../../fixtures";

/**
 * Project Settings and Member Management E2E Tests (PROJ-02, PROJ-05)
 *
 * PROJ-02: Settings sub-pages for a project
 *   - /projects/settings/{id}/integrations
 *   - /projects/settings/{id}/ai-models
 *   - /projects/settings/{id}/shares
 *   - /projects/settings/{id}/quickscript
 *
 * PROJ-05: Member management via the admin project edit dialog
 *   - Edit project dialog opens from the admin projects table
 *   - Dialog has 3 tabs: Details, Users, Groups
 *   - Users tab: add user via AsyncCombobox, remove user, change role
 *   - Member changes are saved via form submit
 *
 * Notes:
 * - All settings pages require ADMIN or PROJECTADMIN access (test user is ADMIN)
 * - The integrations page shows "no integrations" if none are configured globally
 * - The AI models page shows "no models" if none are configured
 * - The quickscript page has a data-testid="quickscript-enabled-toggle" switch
 */

test.describe("Project Settings Pages", () => {
  let testProjectId: number;

  test.beforeEach(async ({ api }) => {
    testProjectId = await api.createProject(
      `E2E Settings ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
  });

  test("integrations settings page loads correctly", async ({ page }) => {
    await test.step("Open the integrations settings page", async () => {
      await page.goto(`/en-US/projects/settings/${testProjectId}/integrations`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the Issue Integrations title and main content render", async () => {
      // The page renders a Card with "Issue Integrations" title via tGlobal("admin.menu.integrations")
      // CardTitle renders as a <div>, not a heading element, so use getByText
      const pageTitle = page.getByText(/issue integrations/i);
      await expect(pageTitle.first()).toBeVisible({ timeout: 15000 });

      // The page content area should be visible
      const mainContent = page.locator("main");
      await expect(mainContent).toBeVisible({ timeout: 5000 });
    });
  });

  test("integrations page shows available integrations section", async ({
    page,
  }) => {
    await test.step("Open the integrations settings page", async () => {
      await page.goto(`/en-US/projects/settings/${testProjectId}/integrations`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the Available Issue Integrations card is shown", async () => {
      // The page always renders the "Available Issue Integrations" card
      // t("projects.settings.integrations.availableIntegrations") = "Available Issue Integrations"
      const availableSection = page.getByText(/available issue integrations/i);
      await expect(availableSection.first()).toBeVisible({ timeout: 15000 });
    });
  });

  test("AI models settings page loads correctly", async ({ page }) => {
    await test.step("Open the AI models settings page", async () => {
      await page.goto(`/en-US/projects/settings/${testProjectId}/ai-models`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify main content and the Project Default models card render", async () => {
      // Page renders with t("admin.menu.llm") title
      // The page has "Available Models" and "Prompt Configuration" cards
      const mainContent = page.locator("main");
      await expect(mainContent).toBeVisible({ timeout: 15000 });

      // The available models card should be visible (translation key "availableModels" = "Project Default")
      const modelsCard = page.getByText(/project default/i);
      await expect(modelsCard.first()).toBeVisible({ timeout: 10000 });
    });
  });

  test("AI models page shows prompt configuration section", async ({
    page,
  }) => {
    await test.step("Open the AI models settings page", async () => {
      await page.goto(`/en-US/projects/settings/${testProjectId}/ai-models`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the prompt configuration section is shown", async () => {
      // The prompt config card is always rendered
      const promptConfigSection = page.getByText(/prompt config/i);
      await expect(promptConfigSection.first()).toBeVisible({ timeout: 15000 });
    });
  });

  test("shares settings page loads correctly", async ({ page }) => {
    await test.step("Open the shares settings page", async () => {
      await page.goto(`/en-US/projects/settings/${testProjectId}/shares`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify main content and the Manage Shares title render", async () => {
      // Page renders with t("reports.shareDialog.manageShares.title") = "Manage Shares"
      const mainContent = page.locator("main");
      await expect(mainContent).toBeVisible({ timeout: 15000 });

      // The page shows "Manage Shares" via t("title") in a CardTitle (renders as <div>, not heading)
      const sharesTitle = page.getByText(/manage shares/i);
      await expect(sharesTitle.first()).toBeVisible({ timeout: 10000 });
    });
  });

  test("shares page displays the share link list component", async ({
    page,
  }) => {
    await test.step("Open the shares settings page", async () => {
      await page.goto(`/en-US/projects/settings/${testProjectId}/shares`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the share link list component renders", async () => {
      // ShareLinkList renders within the Card's CardContent area
      // Even with no shares, the component renders (empty state or table headers)
      // The shares page CardContent doesn't have space-y-6; use the main Card structure
      const cardContent = page
        .locator("main")
        .locator("[class*='p-6']")
        .first();
      await expect(cardContent).toBeVisible({ timeout: 15000 });
    });
  });

  test("quickscript settings page loads correctly", async ({ page }) => {
    await test.step("Open the quickscript settings page", async () => {
      await page.goto(`/en-US/projects/settings/${testProjectId}/quickscript`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the quickscript page main content renders", async () => {
      // Page renders with t("projects.settings.quickScript.title") heading
      const mainContent = page.locator("main");
      await expect(mainContent).toBeVisible({ timeout: 15000 });
    });
  });

  test("quickscript page shows enable/disable toggle", async ({ page }) => {
    await test.step("Open the quickscript settings page", async () => {
      await page.goto(`/en-US/projects/settings/${testProjectId}/quickscript`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the enable/disable toggle is shown", async () => {
      // The switch has data-testid="quickscript-enabled-toggle"
      const toggle = page.getByTestId("quickscript-enabled-toggle");
      await expect(toggle).toBeVisible({ timeout: 15000 });
    });
  });

  test("quickscript toggle can be clicked to change state", async ({
    page,
  }) => {
    const toggle = page.getByTestId("quickscript-enabled-toggle");

    await test.step("Open the quickscript page and confirm the toggle is visible", async () => {
      await page.goto(`/en-US/projects/settings/${testProjectId}/quickscript`);
      await page.waitForLoadState("networkidle");

      await expect(toggle).toBeVisible({ timeout: 15000 });
    });

    let initialChecked: boolean | undefined;
    await test.step("Record the initial state and click to toggle", async () => {
      // Record initial state and click to toggle
      initialChecked = await toggle.isChecked();
      await toggle.click();
    });

    await test.step("Verify the toggle state changed", async () => {
      // After click, state should change
      await expect(toggle).toHaveAttribute(
        "data-state",
        initialChecked ? "unchecked" : "checked",
        { timeout: 10000 }
      );
    });
  });

  test("navigating directly to settings page highlights correct menu item", async ({
    page,
  }) => {
    await test.step("Open the integrations settings page directly", async () => {
      await page.goto(`/en-US/projects/settings/${testProjectId}/integrations`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the settings menu section is expanded", async () => {
      // The settings menu section should be visible (accordion auto-expands for active page)
      const settingsSection = page.getByTestId("project-menu-section-settings");
      await expect(settingsSection).toBeVisible({ timeout: 15000 });
    });

    await test.step("Verify the integrations menu item is highlighted as active", async () => {
      // The integrations link should be active (has bg-primary and text-primary-foreground classes)
      // The link id="settings-integrations-link" is set on the <a> element
      const integrationsLink = page.locator("a#settings-integrations-link");
      await expect(integrationsLink).toBeVisible({ timeout: 10000 });
      await expect(integrationsLink).toHaveClass(/bg-primary/);
    });
  });
});

test.describe("Project Member Management", () => {
  let _testProjectId: number;
  const projectPrefix = "E2E Members";

  test.beforeEach(async ({ api }) => {
    _testProjectId = await api.createProject(`${projectPrefix} ${Date.now()}`);
  });

  /**
   * Navigate to admin projects page and filter for the test project.
   * The table uses server-side pagination, so the newly created project
   * may not appear on the first page without filtering.
   */
  async function navigateAndFindProject(page: import("@playwright/test").Page) {
    await page.goto("/en-US/admin/projects");
    await page.waitForLoadState("networkidle");

    // Use the Filter component's input (placeholder "Filter projects...")
    const filterInput = page.getByPlaceholder(/filter projects/i);
    await expect(filterInput).toBeVisible({ timeout: 10000 });
    await filterInput.fill(projectPrefix);

    // Wait for the debounced search to filter results
    const projectRow = page.getByRole("row").filter({
      hasText: new RegExp(projectPrefix, "i"),
    });
    await expect(projectRow.first()).toBeVisible({ timeout: 15000 });
    return projectRow.first();
  }

  /**
   * Open the edit dialog for the test project.
   * The actions column (pinned right) renders edit + delete buttons.
   * The edit button is a ghost variant Button with a SquarePen SVG icon.
   * Target the last <td> in the row (actions column) and click the first button.
   */
  async function openEditDialog(page: import("@playwright/test").Page) {
    const projectRow = await navigateAndFindProject(page);

    // The edit button is the first button in the last cell (actions column)
    const actionsCell = projectRow.getByRole("cell").last();
    const editButton = actionsCell.locator("button").first();
    await expect(editButton).toBeVisible({ timeout: 5000 });
    await editButton.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10000 });
    return dialog;
  }

  test("edit project dialog opens from admin projects table", async ({
    page,
  }) => {
    const dialog = await openEditDialog(page);
    await expect(dialog).toBeVisible();
  });

  test("edit project dialog has Details, Users, and Groups tabs", async ({
    page,
  }) => {
    const dialog = await openEditDialog(page);

    await test.step("Verify the Details, Users, and Groups tabs are present", async () => {
      // Verify the 3 tabs are present
      const detailsTab = dialog.getByRole("tab", { name: /details/i });
      const usersTab = dialog.getByRole("tab", { name: /users/i });
      const groupsTab = dialog.getByRole("tab", { name: /groups/i });

      await expect(detailsTab).toBeVisible({ timeout: 5000 });
      await expect(usersTab).toBeVisible({ timeout: 5000 });
      await expect(groupsTab).toBeVisible({ timeout: 5000 });
    });
  });

  test("Users tab shows user permissions table", async ({ page }) => {
    const dialog = await openEditDialog(page);

    await test.step("Open the Users tab", async () => {
      // Click Users tab
      const usersTab = dialog.getByRole("tab", { name: /users/i });
      await expect(usersTab).toBeVisible({ timeout: 5000 });
      await usersTab.click();
    });

    await test.step("Verify the user permissions table is shown", async () => {
      // Wait for Users tab content to appear
      // The ProjectUserPermissions renders a table with columns: User, Global Role, Project Access, Remove
      const userTable = dialog.locator("table").first();
      await expect(userTable).toBeVisible({ timeout: 10000 });
    });
  });

  test("Users tab has an Add User combobox", async ({ page }) => {
    const dialog = await openEditDialog(page);

    await test.step("Open the Users tab", async () => {
      const usersTab = dialog.getByRole("tab", { name: /users/i });
      await usersTab.click();
    });

    await test.step("Verify the Add User combobox is shown", async () => {
      // Wait for the tab content to render
      // The AsyncCombobox renders as a button[role="combobox"]
      const addUserCombobox = dialog.getByRole("combobox").first();
      await expect(addUserCombobox).toBeVisible({ timeout: 10000 });
    });
  });

  test("Groups tab shows group permissions table", async ({ page }) => {
    await test.step("Create a group so the tab renders its table", async () => {
      // The Groups tab renders "no groups found" (no <table>) when zero
      // groups exist (ProjectGroupPermissions.tsx), and neither the seed nor
      // this spec's setup creates any — the test only passed when unrelated
      // specs happened to have created groups first. Seed one explicitly.
      const createResponse = await page.request.post(
        `/api/model/groups/create`,
        {
          data: {
            data: { name: `E2E Members Group ${Date.now()}` },
          },
        }
      );
      expect(createResponse.ok()).toBe(true);
    });

    const dialog = await openEditDialog(page);

    await test.step("Open the Groups tab", async () => {
      // Click Groups tab
      const groupsTab = dialog.getByRole("tab", { name: /groups/i });
      await expect(groupsTab).toBeVisible({ timeout: 5000 });
      await groupsTab.click();
    });

    await test.step("Verify the group permissions table is shown", async () => {
      // Wait for Groups tab content — similar table structure
      await expect(dialog.locator("table").first()).toBeVisible({
        timeout: 10000,
      });
    });
  });

  test("edit project dialog can be saved with existing details", async ({
    page,
  }) => {
    const dialog = await openEditDialog(page);

    await test.step("Wait for the form and permissions data to load, then save", async () => {
      // Details tab is active by default — wait for form to fully load
      // The Members tab data (user/group permissions) must load before Save works
      const saveButton = dialog.getByRole("button", { name: /save/i });
      await expect(saveButton).toBeVisible({ timeout: 10000 });

      // The dialog keeps reflowing while its async data (permissions
      // queries) lands, so a one-shot click can be swallowed mid-re-render.
      // Click Save while the dialog is open and retry until it closes — a
      // persistent validation error would keep it open and still fail here.
      await expect(async () => {
        if (await dialog.isVisible()) {
          await saveButton.click({ timeout: 2000 });
        }
        await expect(dialog).not.toBeVisible({ timeout: 5000 });
      }).toPass({ timeout: 30000 });
    });
  });

  test("edit project dialog can be cancelled", async ({ page }) => {
    const dialog = await openEditDialog(page);

    await test.step("Cancel the dialog and verify it closes", async () => {
      // Close dialog via escape or close button
      await page.keyboard.press("Escape");

      await expect(dialog).not.toBeVisible({ timeout: 5000 });
    });
  });
});
