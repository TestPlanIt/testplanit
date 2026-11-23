import { expect, test } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Step layout preference test. The preference is stored on the admin account
 * every spec signs in as, so this runs once, after the parallel suite.
 */
test.describe("Steps Display - layout preference", () => {
  let _repositoryPage: RepositoryPage;

  // Dedicated project and template for this spec file - isolated from other tests
  let stepsDisplayProjectId: number | null = null;
  let stepsDisplayTemplateId: number | null = null;

  test.beforeAll(async ({ api }) => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Create a dedicated project for all steps-display tests FIRST
    stepsDisplayProjectId = await api.createProject(
      `E2E Step Layout Project ${uniqueId}`
    );

    // Get the standard case fields from the default template to use in our template
    // This ensures our template has all the necessary fields including Steps
    const standardCaseFields = await api.getStandardCaseFieldIds();
    const standardResultFields = await api.getStandardResultFieldIds();

    // Create a dedicated template for steps-display tests and assign it to the project
    // This template is NOT the default, so other tests won't affect it
    stepsDisplayTemplateId = await api.createTemplate({
      name: `E2E Step Layout Template ${uniqueId}`,
      isEnabled: true,
      isDefault: false, // Explicitly NOT the default
      caseFieldIds: standardCaseFields,
      resultFieldIds: standardResultFields,
      projectIds: [stepsDisplayProjectId], // Assign template to the project
    });
  });

  test.beforeEach(async ({ page }) => {
    _repositoryPage = new RepositoryPage(page);
  });

  function getTestProjectId(): number {
    if (!stepsDisplayProjectId) {
      throw new Error("Steps Display project not initialized");
    }
    return stepsDisplayProjectId;
  }

  function getTestTemplateId(): number {
    if (!stepsDisplayTemplateId) {
      throw new Error("Steps Display template not initialized");
    }
    return stepsDisplayTemplateId;
  }

  /**
   * Helper to expand the left panel if it's collapsed or too narrow
   * This is needed to make the test case details (including steps) visible
   */
  async function expandLeftPanelIfCollapsed(page: any) {
    // Wait a moment for the page to settle after navigation
    await page.waitForTimeout(500);

    try {
      // Find the resizable handle between the panels
      const resizeHandle = page.locator('[role="separator"]').first();

      // Wait for the handle to be visible
      await resizeHandle.waitFor({ state: "visible", timeout: 3000 });

      // Get the handle's bounding box to determine its position
      const handleBox = await resizeHandle.boundingBox();

      if (handleBox) {
        // If the handle is very close to the left (within 100px), the panel is likely collapsed/narrow
        // Drag it to the right to expand the left panel to about 60% of the viewport
        const viewportSize = page.viewportSize();
        const targetX = viewportSize.width * 0.6;

        if (handleBox.x < 100 || handleBox.x < targetX - 50) {
          console.log(
            `Expanding left panel by dragging handle from ${handleBox.x}px to ${targetX}px`
          );

          // Drag the handle to expand the left panel
          await resizeHandle.hover();
          await page.mouse.down();
          await page.mouse.move(targetX, handleBox.y, { steps: 10 });
          await page.mouse.up();

          // Wait for panel animation to complete
          await page.waitForTimeout(800);

          console.log("Left panel expanded successfully by dragging");
        } else {
          console.log(
            `Left panel is already wide enough (handle at ${handleBox.x}px)`
          );
        }
      }
    } catch (error) {
      console.log(
        "Could not expand panel by dragging - this may indicate a problem with the page load"
      );
      console.log("Error:", error);
    }
  }

  test("Step layout toggle puts expected results beside their steps and persists", async ({
    api,
    page,
  }) => {
    const projectId = getTestProjectId();
    const templateId = getTestTemplateId();
    const uniqueId = Date.now();
    const userId = await api.getCurrentUserId();

    const folderId = await api.createFolder(
      projectId,
      `Step Layout Folder ${uniqueId}`
    );
    const testCaseId = await api.createTestCase(
      projectId,
      folderId,
      `Step Layout Case ${uniqueId}`,
      templateId
    );
    await api.addStepsToTestCase(testCaseId, [
      {
        step: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Layout step one" }],
            },
          ],
        },
        expectedResult: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Layout expected one" }],
            },
          ],
        },
        order: 0,
      },
      {
        step: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Layout step two" }],
            },
          ],
        },
        expectedResult: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Layout expected two" }],
            },
          ],
        },
        order: 1,
      },
    ]);

    try {
      // Two readable columns need a wide steps container; the toggle hides
      // below that width because the layout stacks there regardless.
      await page.setViewportSize({ width: 1920, height: 1080 });

      await test.step("Steps start stacked", async () => {
        await page.goto(
          `/en-US/projects/repository/${projectId}/${testCaseId}`,
          { waitUntil: "networkidle" }
        );
        await expandLeftPanelIfCollapsed(page);
        await expect(page.locator("text=Layout step one")).toBeVisible({
          timeout: 15000,
        });
        await expect(page.getByTestId("steps-display")).toHaveAttribute(
          "data-step-layout",
          "STACKED"
        );

        const step = await page.getByTestId("step-badge-0").boundingBox();
        const expected = await page
          .getByTestId("expected-result-0")
          .boundingBox();
        expect(expected!.y).toBeGreaterThan(step!.y + step!.height);
      });

      await test.step("The toggle moves the expected result beside its step", async () => {
        const toggle = page.getByTestId("step-layout-toggle");
        await expect(toggle).toBeVisible();
        await expect(toggle).toHaveAttribute("aria-pressed", "false");
        await toggle.click();

        await expect(page.getByTestId("steps-display")).toHaveAttribute(
          "data-step-layout",
          "SIDE_BY_SIDE"
        );
        await expect(toggle).toHaveAttribute("aria-pressed", "true");

        const stepBlock = page
          .getByTestId("expected-result-0")
          .locator("xpath=preceding-sibling::div[1]");
        const step = await stepBlock.boundingBox();
        const expected = await page
          .getByTestId("expected-result-0")
          .boundingBox();
        expect(Math.abs(expected!.y - step!.y)).toBeLessThan(2);
        expect(expected!.x).toBeGreaterThan(step!.x + step!.width - 2);
      });

      await test.step("The choice survives a reload and reaches the editor", async () => {
        await page.reload({ waitUntil: "networkidle" });
        await expandLeftPanelIfCollapsed(page);
        await expect(page.locator("text=Layout step one")).toBeVisible({
          timeout: 15000,
        });
        await expect(page.getByTestId("steps-display")).toHaveAttribute(
          "data-step-layout",
          "SIDE_BY_SIDE"
        );

        await page.locator('button:has-text("Edit")').first().click();
        await expect(page.getByTestId("steps-form")).toHaveAttribute(
          "data-step-layout",
          "SIDE_BY_SIDE",
          { timeout: 15000 }
        );
        await expect(page.getByTestId("step-layout-toggle")).toHaveAttribute(
          "aria-pressed",
          "true"
        );
      });
    } finally {
      // The preference belongs to the shared E2E user, so put it back.
      await api.updateUserPreferences({ userId, stepLayout: "STACKED" });
    }
  });
});
