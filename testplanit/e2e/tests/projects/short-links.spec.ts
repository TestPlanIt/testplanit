import { expect, test } from "../../fixtures";

/**
 * Project-less permalinks.
 *
 * /case/:id, /milestone/:id and /requirement/:id resolve the owning project
 * and redirect to the project-scoped page, so surfaces that only know an id
 * (notifications, the case-side Linked Requirements panel) can still link to
 * the record. A missing record renders an empty state instead of redirecting.
 */
test.describe("Short links", () => {
  let projectId: number;
  let folderId: number;

  test.beforeEach(async ({ api }) => {
    projectId = await api.createProject(
      `E2E Short Links ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    folderId = await api.getRootFolderId(projectId);
  });

  test("/case/:id redirects to the case inside its project", async ({
    api,
    page,
  }) => {
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `Short Link Case ${Date.now()}`
    );

    await page.goto(`/en-US/case/${caseId}`);

    await expect(page).toHaveURL(
      new RegExp(`/projects/repository/${projectId}/${caseId}(?:[?#]|$)`),
      { timeout: 15000 }
    );
  });

  test("/milestone/:id redirects to the milestone inside its project", async ({
    api,
    page,
  }) => {
    const milestoneId = await api.createMilestone(
      projectId,
      `Short Link Milestone ${Date.now()}`
    );

    await page.goto(`/en-US/milestone/${milestoneId}`);

    await expect(page).toHaveURL(
      new RegExp(`/projects/milestones/${projectId}/${milestoneId}(?:[?#]|$)`),
      { timeout: 15000 }
    );
  });

  test("/requirement/:id opens the requirement in its project's workspace", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const requirementId = await api.createRequirement(
      projectId,
      `REQ-${ts}`,
      `Short Link Requirement ${ts}`
    );

    await page.goto(`/en-US/requirement/${requirementId}`);

    await expect(page).toHaveURL(
      new RegExp(
        `/projects/requirements/${projectId}\\?requirement=${requirementId}(?:[&#]|$)`
      ),
      { timeout: 15000 }
    );
  });

  test("/requirement/:id refuses a plain issue that is not a requirement", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const issueId = await api.createIssue(
      projectId,
      `ISS-${ts}`,
      `Plain issue ${ts}`
    );

    await page.goto(`/en-US/requirement/${issueId}`);

    // The permalink is scoped to requirements, so a defect id must not be
    // routed into the requirements feature.
    await expect(page.getByTestId("requirement-not-found")).toBeVisible({
      timeout: 15000,
    });
    await expect(page).toHaveURL(new RegExp(`/requirement/${issueId}$`));
  });

  test("/case/:id for a deleted case shows the empty state instead of redirecting", async ({
    api,
    page,
  }) => {
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `Short Link Deleted Case ${Date.now()}`
    );
    await api.deleteTestCase(caseId);

    await page.goto(`/en-US/case/${caseId}`);

    await expect(page.getByText("No test case found")).toBeVisible({
      timeout: 15000,
    });
    await expect(page).toHaveURL(new RegExp(`/case/${caseId}$`));
  });
});
