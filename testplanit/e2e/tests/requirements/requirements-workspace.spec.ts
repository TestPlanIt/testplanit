import { expect, test } from "../../fixtures";

/**
 * Requirements workspace
 *
 * Requirements are locally authored Issues flagged `isRequirement`, shown as a
 * tree at /projects/requirements/:projectId behind a per-project opt-in.
 *
 * Covered here:
 *  - the per-project gate (disabled notice, nav item, empty workspace)
 *  - creating a root and a child from the tree
 *  - the list filter
 *  - editing a title from the detail pane and the version history it leaves
 *  - deleting a subtree from the row menu
 *  - the full-page route and its not-found state
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function createFromDialog(
  page: import("@playwright/test").Page,
  title: string
): Promise<string> {
  const dialog = page.getByTestId("create-requirement-dialog");
  await expect(dialog).toBeVisible({ timeout: 10000 });
  await dialog.getByTestId("create-requirement-name-input").fill(title);
  await dialog.getByTestId("create-requirement-submit").click();
  await expect(dialog).toBeHidden({ timeout: 15000 });

  // The workspace selects the new requirement in the URL on success.
  await expect(page).toHaveURL(/[?&]requirement=\d+/, { timeout: 15000 });
  return new URL(page.url()).searchParams.get("requirement")!;
}

test.describe("Requirements workspace", () => {
  test("is gated per project until requirements are enabled", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(`E2E Req Gate ${uid()}`);
    const folderId = await api.getRootFolderId(projectId);
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `Gated case ${uid()}`
    );

    await test.step("A project without the flag shows the disabled notice and no nav item", async () => {
      await page.goto(`/en-US/projects/requirements/${projectId}`);
      await expect(
        page.getByTestId("requirements-disabled-notice")
      ).toBeVisible({ timeout: 15000 });
      await expect(page.locator("#project-requirements-link")).toHaveCount(0);
    });

    // The case-side Linked Requirements panel is the feature's only surface
    // outside this workspace, so it answers to the same flag -- it shipped
    // ungated and put an empty, unfillable card on every case of every
    // project that never turned Requirements on.
    await test.step("A case in that project carries no Linked Requirements panel", async () => {
      await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
      // #result-history renders BELOW where the panel would be, so waiting
      // on it proves the panel's own region has already rendered rather
      // than asserting absence against a half-loaded page.
      await expect(page.locator("#result-history")).toBeVisible({
        timeout: 20000,
      });
      await expect(page.getByTestId("case-linked-requirements")).toHaveCount(0);
    });

    await test.step("Enabling the flag renders the empty workspace and the nav item", async () => {
      await api.enableRequirements(projectId);
      await page.goto(`/en-US/projects/requirements/${projectId}`);
      await expect(page.getByTestId("requirements-page-header")).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByTestId("requirements-tree-empty")).toBeVisible();
      await expect(page.locator("#project-requirements-link")).toBeVisible();
    });

    await test.step("...and the same case now carries the panel", async () => {
      await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
      await expect(page.getByTestId("case-linked-requirements")).toBeVisible({
        timeout: 20000,
      });
    });
  });

  test.describe("with requirements enabled", () => {
    let projectId: number;

    test.beforeEach(async ({ api }) => {
      projectId = await api.createProject(`E2E Requirements ${uid()}`);
      await api.enableRequirements(projectId);
    });

    test("creates a root requirement and a child beneath it", async ({
      page,
    }) => {
      const rootTitle = `Root requirement ${uid()}`;
      const childTitle = `Child requirement ${uid()}`;
      let rootId = "";

      await test.step("Create a root requirement from the empty state", async () => {
        await page.goto(`/en-US/projects/requirements/${projectId}`);
        await expect(page.getByTestId("requirements-tree-empty")).toBeVisible({
          timeout: 15000,
        });
        await page.getByTestId("requirements-tree-empty-add-root").click();
        rootId = await createFromDialog(page, rootTitle);
        await expect(
          page.getByTestId(`requirement-row-${rootId}`)
        ).toContainText(rootTitle, { timeout: 15000 });
      });

      await test.step("Add a child from the row's actions menu", async () => {
        const row = page.getByTestId(`requirement-row-${rootId}`);
        await row.hover();
        await page.getByTestId(`requirement-actions-trigger-${rootId}`).click();
        await page
          .getByTestId(`requirement-action-add-child-${rootId}`)
          .click();
        const childId = await createFromDialog(page, childTitle);

        // Children render only under an expanded parent: reload to a clean
        // tree and open the root, then the child row must be there.
        await page.goto(`/en-US/projects/requirements/${projectId}`);
        await expect(page.getByTestId(`requirement-row-${rootId}`)).toBeVisible(
          {
            timeout: 15000,
          }
        );
        await page.getByTestId(`requirement-chevron-${rootId}`).click();
        const childRow = page.getByTestId(`requirement-row-${childId}`);
        await expect(childRow).toBeVisible({ timeout: 15000 });
        await expect(childRow).toContainText(childTitle);
      });
    });

    test("filters the tree by title", async ({ api, page }) => {
      const ts = uid();
      const alphaId = await api.createRequirement(
        projectId,
        `REQ-A-${ts}`,
        `Alpha requirement ${ts}`
      );
      const betaId = await api.createRequirement(
        projectId,
        `REQ-B-${ts}`,
        `Beta requirement ${ts}`
      );

      await page.goto(`/en-US/projects/requirements/${projectId}`);
      await expect(page.getByTestId(`requirement-row-${alphaId}`)).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByTestId(`requirement-row-${betaId}`)).toBeVisible();

      await test.step("Typing a title narrows the list to matching rows", async () => {
        await page
          .getByTestId("requirements-filter-input")
          .fill("Beta requirement");
        await expect(page.getByTestId(`requirement-row-${betaId}`)).toBeVisible(
          {
            timeout: 15000,
          }
        );
        await expect(page.getByTestId(`requirement-row-${alphaId}`)).toBeHidden(
          {
            timeout: 15000,
          }
        );
      });

      await test.step("Clearing the filter restores every row", async () => {
        await page.getByTestId("requirements-filter-clear").click();
        await expect(
          page.getByTestId(`requirement-row-${alphaId}`)
        ).toBeVisible({
          timeout: 15000,
        });
        await expect(
          page.getByTestId(`requirement-row-${betaId}`)
        ).toBeVisible();
      });
    });

    test("edits the title from the detail pane and records a version", async ({
      api,
      page,
      request,
      baseURL,
    }) => {
      const ts = uid();
      const name = `REQ-${ts}`;
      const requirementId = await api.createRequirement(
        projectId,
        name,
        `Original title ${ts}`
      );
      const updatedTitle = `Updated title ${ts}`;

      await test.step("Open the requirement and switch the detail pane to edit mode", async () => {
        await page.goto(
          `/en-US/projects/requirements/${projectId}?requirement=${requirementId}`
        );
        const panel = page.getByTestId("requirement-detail-panel");
        await expect(panel).toBeVisible({ timeout: 15000 });
        await expect(
          panel.getByTestId("requirement-detail-header")
        ).toContainText(name);
        await expect(
          panel.getByTestId("requirement-version-history-empty")
        ).toBeVisible({ timeout: 15000 });
        await panel.getByTestId("requirement-detail-edit").click();
      });

      await test.step("Save a new title and leave edit mode", async () => {
        const panel = page.getByTestId("requirement-detail-panel");
        const titleField = panel.getByTestId("requirement-field-title");
        await expect(titleField).toBeVisible({ timeout: 10000 });
        await titleField.clear();
        await titleField.fill(updatedTitle);
        await panel.getByTestId("requirement-detail-save").click();
        await expect(panel.getByTestId("requirement-detail-edit")).toBeVisible({
          timeout: 15000,
        });
        await expect
          .poll(
            async () => {
              const res = await request.get(
                `${baseURL}/api/model/issue/findFirst`,
                {
                  params: {
                    q: JSON.stringify({
                      where: { id: requirementId },
                      select: { title: true },
                    }),
                  },
                }
              );
              return (await res.json()).data?.title;
            },
            { timeout: 15000 }
          )
          .toBe(updatedTitle);
      });

      await test.step("The previous content is kept as version 1", async () => {
        // The DB trigger captures the pre-update content, so the history now
        // carries the original title as version 1 without a reload.
        const history = page.getByTestId("requirement-version-history");
        await expect(history).toBeVisible({ timeout: 15000 });
        await expect(history.getByTestId("requirement-version-1")).toBeVisible({
          timeout: 15000,
        });
      });
    });

    test("deletes a requirement together with its children", async ({
      api,
      page,
      request,
      baseURL,
    }) => {
      const ts = uid();
      const parentId = await api.createRequirement(
        projectId,
        `REQ-P-${ts}`,
        `Parent to delete ${ts}`
      );
      const childId = await api.createRequirement(
        projectId,
        `REQ-C-${ts}`,
        `Child to delete ${ts}`,
        { parentId }
      );

      await page.goto(`/en-US/projects/requirements/${projectId}`);
      const parentRow = page.getByTestId(`requirement-row-${parentId}`);
      await expect(parentRow).toBeVisible({ timeout: 15000 });

      await test.step("Delete the parent from its actions menu", async () => {
        await parentRow.hover();
        await page
          .getByTestId(`requirement-actions-trigger-${parentId}`)
          .click();
        await page.getByTestId(`requirement-action-delete-${parentId}`).click();
        const dialog = page.getByTestId("delete-requirement-dialog");
        await expect(dialog).toBeVisible({ timeout: 10000 });
        await dialog.getByTestId("delete-requirement-confirm").click();
        await expect(dialog).toBeHidden({ timeout: 15000 });
      });

      await test.step("Both rows are gone and the child is soft-deleted", async () => {
        await expect(parentRow).toBeHidden({ timeout: 15000 });
        await expect(
          page.getByTestId(`requirement-row-${childId}`)
        ).toHaveCount(0);
        const res = await request.get(`${baseURL}/api/model/issue/findFirst`, {
          params: {
            q: JSON.stringify({
              where: { id: childId },
              select: { isDeleted: true },
            }),
          },
        });
        expect((await res.json()).data?.isDeleted).toBe(true);
      });
    });

    test("serves a requirement on its full page and rejects an unknown id", async ({
      api,
      page,
    }) => {
      const ts = uid();
      const name = `REQ-FULL-${ts}`;
      const requirementId = await api.createRequirement(
        projectId,
        name,
        `Full page requirement ${ts}`
      );

      await test.step("The full-page route renders the requirement", async () => {
        await page.goto(
          `/en-US/projects/requirements/${projectId}/${requirementId}`
        );
        const fullPage = page.getByTestId("requirement-details-page");
        await expect(fullPage).toBeVisible({ timeout: 15000 });
        await expect(
          fullPage.getByTestId("requirement-detail-header")
        ).toContainText(name, { timeout: 15000 });
      });

      await test.step("An unknown id shows the not-found state", async () => {
        await page.goto(`/en-US/projects/requirements/${projectId}/999999999`);
        await expect(page.getByTestId("requirement-not-found")).toBeVisible({
          timeout: 15000,
        });
      });
    });
  });
});
