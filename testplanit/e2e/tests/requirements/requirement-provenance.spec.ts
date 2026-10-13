import { expect, test } from "../../fixtures";

/**
 * Tracker-facing requirement flows, with a fabricated Jira integration:
 * synced requirements are locked until detached, an "exclude" override sends
 * one back to the issues list, and an issue is promoted into a requirement
 * from the issues list and from the create dialog's Promote tab.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test.describe("Requirement provenance and promotion", () => {
  let projectId: number;
  let integrationId: number;

  test.beforeEach(async ({ api }) => {
    projectId = await api.createProject(`E2E Req Provenance ${uid()}`);
    await api.enableRequirements(projectId);
    integrationId = await api.createIssueIntegration("JIRA");
    await api.assignIssueIntegrationToProject(projectId, integrationId);
  });

  test("a synced requirement is locked until it is detached", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const ts = uid();
    const requirementId = await api.createSyncedIssue(
      projectId,
      integrationId,
      {
        name: `PROJ-${ts.slice(-4)}`,
        title: `Synced requirement ${ts}`,
        isRequirement: true,
      }
    );

    await test.step("The badge reads synced and the title is locked in edit mode", async () => {
      await page.goto(
        `/en-US/projects/requirements/${projectId}?requirement=${requirementId}`
      );
      const panel = page.getByTestId("requirement-detail-panel");
      await expect(panel).toBeVisible({ timeout: 15000 });
      await expect(
        panel.getByTestId("requirement-provenance-locked")
      ).toBeVisible({
        timeout: 15000,
      });
      await panel.getByTestId("requirement-detail-edit").click();
      await expect(panel.getByTestId("requirement-field-title")).toBeDisabled();
      await panel.getByTestId("requirement-detail-cancel").click();
    });

    await test.step("Detach from the provenance menu", async () => {
      const panel = page.getByTestId("requirement-detail-panel");
      await panel.getByTestId("requirement-provenance-locked").click();
      await page.getByTestId("requirement-provenance-menu-detach").click();
      await page.getByTestId("requirement-provenance-detach-confirm").click();
      await expect(
        panel.getByTestId("requirement-provenance-detached")
      ).toBeVisible({
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
                    select: { requirementDetachedAt: true },
                  }),
                },
              }
            );
            return (await res.json()).data?.requirementDetachedAt ?? null;
          },
          { timeout: 15000 }
        )
        .not.toBeNull();
    });

    await test.step("The title is editable once detached", async () => {
      const panel = page.getByTestId("requirement-detail-panel");
      await panel.getByTestId("requirement-detail-edit").click();
      await expect(panel.getByTestId("requirement-field-title")).toBeEnabled({
        timeout: 10000,
      });
      await panel.getByTestId("requirement-detail-cancel").click();
    });
  });

  test("excluding a synced requirement returns it to the issues list", async ({
    api,
    page,
  }) => {
    const ts = uid();
    const requirementId = await api.createSyncedIssue(
      projectId,
      integrationId,
      {
        name: `EXCL-${ts.slice(-4)}`,
        title: `Excluded requirement ${ts}`,
        isRequirement: true,
      }
    );

    await page.goto(
      `/en-US/projects/requirements/${projectId}?requirement=${requirementId}`
    );
    const panel = page.getByTestId("requirement-detail-panel");
    await expect(
      panel.getByTestId("requirement-provenance-locked")
    ).toBeVisible({
      timeout: 15000,
    });
    await panel.getByTestId("requirement-provenance-locked").click();
    await page.getByTestId("requirement-provenance-menu-exclude").click();
    await page.getByTestId("requirement-override-confirm").click();
    await expect(
      page.getByTestId(`requirement-row-${requirementId}`)
    ).toBeHidden({
      timeout: 15000,
    });

    await page.goto(`/en-US/projects/issues/${projectId}`);
    const row = page.getByTestId(`issue-row-${requirementId}`);
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.getByTestId("issue-row-actions").click();
    await expect(
      page.getByTestId("issue-requirement-override-reset")
    ).toBeVisible();
  });

  test("promotes a synced issue from the issues list", async ({
    api,
    page,
  }) => {
    const ts = uid();
    const issueId = await api.createSyncedIssue(projectId, integrationId, {
      name: `PROM-${ts.slice(-4)}`,
      title: `Promoted from list ${ts}`,
    });

    await page.goto(`/en-US/projects/issues/${projectId}`);
    const row = page.getByTestId(`issue-row-${issueId}`);
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.getByTestId("issue-row-actions").click();
    await page.getByTestId("issue-use-as-requirement").click();
    await page.getByTestId("requirement-override-confirm").click();
    await expect(row).toBeHidden({ timeout: 15000 });

    await page.goto(`/en-US/projects/requirements/${projectId}`);
    await expect(page.getByTestId(`requirement-row-${issueId}`)).toBeVisible({
      timeout: 15000,
    });
  });

  test("promotes a synced issue from the create dialog", async ({
    api,
    page,
  }) => {
    const ts = uid();
    const name = `PICK-${ts.slice(-4)}`;
    const issueId = await api.createSyncedIssue(projectId, integrationId, {
      name,
      title: `Promoted from dialog ${ts}`,
    });

    await page.goto(`/en-US/projects/requirements/${projectId}`);
    await page.getByTestId("requirements-tree-empty-add-root").click();
    const dialog = page.getByTestId("create-requirement-dialog");
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await dialog.getByTestId("create-requirement-mode-promote").click();
    await dialog.getByTestId("create-requirement-promote-pick").click();
    // The search dialog has no root test id; it opens on top of the create
    // dialog, so it is the last open dialog.
    const search = page.getByRole("dialog").last();
    await expect(
      search.getByTestId("create-requirement-promote-target")
    ).toHaveCount(0);
    await search.getByRole("textbox").first().fill(name);
    await search.getByText(name, { exact: false }).first().click();
    await expect(
      dialog.getByTestId("create-requirement-promote-target")
    ).toContainText(name, { timeout: 10000 });
    await dialog.getByTestId("create-requirement-submit").click();
    await page.getByTestId("requirement-override-confirm").click();
    await expect(page.getByTestId(`requirement-row-${issueId}`)).toBeVisible({
      timeout: 15000,
    });
  });
});
