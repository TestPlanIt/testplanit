import { expect, test } from "../../fixtures";
import { clickOverflowAction } from "../../utils/action-overflow";

/**
 * Context images in the AI generation wizard.
 *
 * Intercepts the REAL two-phase endpoints (/outline + /expand) — the older
 * spec in ai-test-case-generation.spec.ts mocks the legacy sync route,
 * which the wizard no longer calls. Asserts:
 *  - the issue tab's image picker renders from the context-images listing
 *    and a deselection is reflected in the outline request body
 *  - the review step renders the vision-skip alert and the included/skipped
 *    summaries from the enrichment envelope
 */

const OUTLINE_RESPONSE = {
  outlines: [{ title: "Login form validates input", summary: "Checks." }],
  enrichment: {
    comments: [],
    linkedIssues: [],
    droppedLinkedIssues: [],
    contextImages: {
      contextId: undefined,
      included: [
        {
          id: "jira-attachment:1",
          source: "jira-attachment",
          filename: "mockup.png",
          byteSize: 2048,
        },
      ],
      skipped: [{ filename: "huge.png", reason: "too-large" }],
      imagesOmittedForVision: 2,
    },
  },
};

const EXPAND_SSE = [
  `data: ${JSON.stringify({
    type: "done",
    finishReason: "stop",
    testCase: {
      id: "gen-1",
      name: "Login form validates input",
      fieldValues: [],
    },
  })}`,
  "",
  "",
].join("\n");

test.describe("AI generation context images", () => {
  test("issue picker selection reaches the outline body; review shows notices", async ({
    page,
    api,
  }) => {
    const ts = Date.now();
    let projectId: number | undefined;

    await test.step("Seed project + LLM integration", async () => {
      projectId = await api.createProject(`E2E CtxImages ${ts}`);
      const llmId = await api.createLlmIntegration(`E2E LLM Ctx ${ts}`);
      await api.linkLlmToProject(projectId, llmId);
      const folderId = await api.createFolder(projectId, `Ctx Folder ${ts}`);
      await api.createTestCase(projectId, folderId, `Existing ${ts}`);
    });

    let outlineBody: Record<string, unknown> | null = null;

    await test.step("Intercept generation + listing endpoints", async () => {
      // Image-attachment listing for the picker (no live tracker in E2E).
      await page.route(
        "**/api/llm/generate-test-cases/context-images",
        async (route) => {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              attachments: [
                {
                  id: "att-1",
                  filename: "mockup.png",
                  byteSize: 2048,
                  tooLarge: false,
                },
                {
                  id: "att-2",
                  filename: "flow.png",
                  byteSize: 4096,
                  tooLarge: false,
                },
                {
                  id: "att-3",
                  filename: "huge.png",
                  byteSize: 9 * 1024 * 1024,
                  tooLarge: true,
                },
              ],
              visionSupported: true,
              maxImages: 5,
              maxImageBytes: 4 * 1024 * 1024,
            }),
          });
        }
      );
      // Issue search (the wizard's issue picker).
      await page.route("**/api/integrations/*/search**", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            issues: [
              {
                id: "1001",
                key: "PROJ-7",
                title: "Add login form",
                description: "Login form with proposed layout.",
                status: "Open",
                isExternal: true,
              },
            ],
            total: 1,
          }),
        });
      });
      await page.route(
        "**/api/llm/generate-test-cases/outline",
        async (route) => {
          outlineBody = route.request().postDataJSON();
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(OUTLINE_RESPONSE),
          });
        }
      );
      await page.route(
        "**/api/llm/generate-test-cases/expand",
        async (route) => {
          await route.fulfill({
            status: 200,
            contentType: "text/event-stream",
            body: EXPAND_SSE,
          });
        }
      );
      // Linked-issue preview fetch — irrelevant here, keep it quiet.
      await page.route("**/api/integrations/linked-issues**", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ refs: [] }),
        });
      });
    });

    await test.step("Open wizard and select the issue", async () => {
      await page.goto(`/en-US/projects/repository/${projectId!}`);
      await page.waitForLoadState("load");
      const folderNode = page.locator('[data-testid^="folder-node-"]').first();
      await expect(folderNode).toBeVisible({ timeout: 15000 });
      await folderNode.click();

      await clickOverflowAction(
        page,
        "generate-cases-button",
        "repository-actions-menu"
      );
      const dialog = page.locator('[role="dialog"]').first();
      await expect(dialog).toBeVisible({ timeout: 10000 });

      // Open issue search and pick the mocked issue.
      await dialog.getByTestId("search-issues-button").click();
      const searchDialog = page.locator('[role="dialog"]').last();
      await searchDialog.getByRole("textbox").first().fill("login");
      await expect(searchDialog.getByText("PROJ-7").first()).toBeVisible({
        timeout: 10000,
      });
      await searchDialog.getByText("PROJ-7").first().click();
    });

    await test.step("Picker renders; deselect one image", async () => {
      const picker = page.getByTestId("context-images-picker");
      await expect(picker).toBeVisible({ timeout: 10000 });
      await expect(picker.getByText("mockup.png")).toBeVisible();
      // Oversized entries are disabled.
      await expect(picker.locator("#context-image-att-3")).toBeDisabled();
      // Uncheck the second image.
      await picker.locator("#context-image-att-2").click();
    });

    await test.step("Generate and assert the outline body", async () => {
      const dialog = page.locator('[role="dialog"]').first();
      // Advance: issue → template → notes → generate. The Next button
      // label/flow matches the existing generation spec.
      for (let i = 0; i < 3; i++) {
        const next = dialog.getByRole("button", { name: /next|generate/i });
        await next.first().click();
      }

      await expect.poll(() => outlineBody, { timeout: 15000 }).not.toBeNull();
      const contextImages = (outlineBody as any).contextImages;
      expect(contextImages.attachmentIds).toEqual(["att-1"]);
    });

    await test.step("Review step shows vision-skip alert and summaries", async () => {
      await expect(
        page.getByTestId("context-images-vision-skipped")
      ).toBeVisible({ timeout: 15000 });
      const summary = page.getByTestId("context-images-summary");
      await expect(summary).toBeVisible();
      await expect(summary).toContainText("mockup.png");
      await expect(summary).toContainText("huge.png");
    });
  });
});
