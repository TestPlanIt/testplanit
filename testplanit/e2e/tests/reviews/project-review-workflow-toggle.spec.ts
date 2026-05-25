import { expect, test } from "../../fixtures";
import {
  createGatedTestWorkflow,
  getProjectWorkflowIds,
  setProjectReviewWorkflowEnabled,
  softDeleteWorkflow,
} from "./helpers";

/**
 * Project Settings — Review Workflow toggle.
 *
 * Asserts:
 *  - Flipping the per-project Review Workflow toggle OFF hides the
 *    `request-review-button` on a case in that project, even though the
 *    target workflow is still marked requires-review.
 *  - Flipping it back ON restores the button.
 */

test.describe("Project review-workflow toggle", () => {
  let gatedWorkflowId: number | null = null;

  test.afterEach(async ({ request, baseURL }) => {
    const url = baseURL!;
    if (gatedWorkflowId) {
      await softDeleteWorkflow(request, url, gatedWorkflowId);
      gatedWorkflowId = null;
    }
  });

  test("toggling Review Workflow OFF hides Request review on cases", async ({
    page,
    request,
    baseURL,
    api,
  }) => {
    const url = baseURL!;
    const projectId = await api.createProject(`Reviews-Toggle ${Date.now()}`);

    const ids = await getProjectWorkflowIds(
      request,
      url,
      projectId,
      "CASES",
      5
    );
    expect(ids.length).toBeGreaterThanOrEqual(1);
    const currentStateId = ids[0];

    await setProjectReviewWorkflowEnabled(request, url, projectId, true);
    const gated = await createGatedTestWorkflow(
      request,
      url,
      projectId,
      "CASES"
    );
    gatedWorkflowId = gated.id;

    const folderId = await api.createFolder(
      projectId,
      `Toggle-folder ${Date.now()}`
    );
    const caseId = await api.createTestCaseWithState(
      projectId,
      folderId,
      `Toggle case ${Date.now()}`,
      currentStateId
    );

    // Toggle ON path — request-review button visible on the case.
    await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("request-review-button")).toBeVisible({
      timeout: 10000,
    });

    // Flip OFF via the UI to verify the wire-up (not just the DB write).
    await page.goto(`/en-US/projects/settings/${projectId}/advanced`);
    await page.waitForLoadState("networkidle");
    const toggle = page.getByTestId("review-workflow-toggle");
    await expect(toggle).toBeVisible();
    // Default is checked; flip it OFF.
    await expect(toggle).toHaveAttribute("data-state", "checked");
    await toggle.click();
    await expect(toggle).toHaveAttribute("data-state", "unchecked");

    // The case page should no longer surface the request-review button.
    await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("request-review-button")).toHaveCount(0);

    // Flip back ON via the UI.
    await page.goto(`/en-US/projects/settings/${projectId}/advanced`);
    await page.waitForLoadState("networkidle");
    const toggleAgain = page.getByTestId("review-workflow-toggle");
    await toggleAgain.click();
    await expect(toggleAgain).toHaveAttribute("data-state", "checked");

    await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("request-review-button")).toBeVisible({
      timeout: 10000,
    });
  });
});
