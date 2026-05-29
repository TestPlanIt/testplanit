import { expect, test } from "../../fixtures";

/**
 * Regression guard for the milestone details page edit action.
 *
 * The header action buttons live inside the milestone <form>. Clicking "Edit"
 * swaps the trigger for the edit-mode "Save" (type=submit) button at the same
 * position, which previously let the browser activate that submit button and
 * fire a stray no-op update — the page would flash into edit mode and
 * immediately save back to view mode. The form now guards against submits
 * fired while in view mode and remounts on the mode switch; these tests lock
 * that behavior in.
 */
test.describe("Milestone details — Edit action", () => {
  const isMilestoneUpdate = (url: string, method: string) =>
    method === "PUT" && url.includes("/api/model/milestones/update");

  test("clicking Edit enters edit mode without submitting the form", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`MilestoneEditGuard ${ts}`);
    const milestoneId = await api.createMilestone(
      projectId,
      `Edit Guard ${ts}`
    );

    await page.goto(`/en-US/projects/milestones/${projectId}/${milestoneId}`);
    await page.waitForLoadState("networkidle");

    // Count any milestone update calls triggered by clicking Edit.
    let updateCount = 0;
    page.on("request", (req) => {
      if (isMilestoneUpdate(req.url(), req.method())) updateCount++;
    });

    await page.getByTestId("milestone-edit").click();

    // We should be in edit mode (Save visible) and NO update should have fired.
    await expect(page.getByTestId("milestone-save")).toBeVisible();
    expect(updateCount).toBe(0);
  });

  test("saving in edit mode persists via exactly one update", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`MilestoneEditSave ${ts}`);
    const milestoneId = await api.createMilestone(projectId, `Save ${ts}`);

    await page.goto(`/en-US/projects/milestones/${projectId}/${milestoneId}`);
    await page.waitForLoadState("networkidle");

    await page.getByTestId("milestone-edit").click();
    await expect(page.getByTestId("milestone-save")).toBeVisible();

    let updateCount = 0;
    page.on("request", (req) => {
      if (isMilestoneUpdate(req.url(), req.method())) updateCount++;
    });

    await page.getByTestId("milestone-save").click();

    // Returns to view mode (Edit visible again) after exactly one update.
    await expect(page.getByTestId("milestone-edit")).toBeVisible();
    expect(updateCount).toBe(1);
  });
});
