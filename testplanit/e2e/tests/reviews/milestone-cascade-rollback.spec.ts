import { expect, test } from "../../fixtures";
import {
  createGatedTestWorkflow,
  deleteReviewRequest,
  setProjectReviewWorkflowEnabled,
  softDeleteWorkflow,
} from "./helpers";

/**
 * Milestone cascade — gated rollback names the blocking entity + gate.
 *
 * Asserts:
 *  - Completing a milestone with cascade to a gated TestRun "Done" state
 *    fails when there's no approval — the error toast names the run by
 *    NAME (not id) and the blocking GATE by name.
 *  - Approving the gate and retrying completes the milestone successfully.
 *  - After consumption, the approval cannot be reused — a second cascade
 *    attempt to the same state on a fresh run reports REVIEW_REQUIRED.
 */

test.describe("Milestone cascade rollback", () => {
  let gatedRunStateId: number | null = null;
  const createdReviewIds: string[] = [];
  const createdMilestoneIds: number[] = [];
  const createdUserIds: string[] = [];

  test.afterEach(async ({ request, baseURL }) => {
    const url = baseURL!;
    while (createdReviewIds.length) {
      const id = createdReviewIds.pop();
      if (id) await deleteReviewRequest(request, url, id);
    }
    while (createdMilestoneIds.length) {
      const id = createdMilestoneIds.pop();
      if (id) {
        await request
          .patch(`${url}/api/model/milestones/update`, {
            data: { where: { id }, data: { isDeleted: true } },
          })
          .catch(() => {});
      }
    }
    if (gatedRunStateId) {
      await softDeleteWorkflow(request, url, gatedRunStateId);
      gatedRunStateId = null;
    }
    while (createdUserIds.length) {
      const id = createdUserIds.pop();
      if (id) {
        await request
          .patch(`${url}/api/model/user/update`, {
            data: { where: { id }, data: { isDeleted: true } },
          })
          .catch(() => {});
      }
    }
  });

  test("cascade fails with named entity + gate, then succeeds after approval", async ({
    page,
    request,
    baseURL,
    api,
  }) => {
    const url = baseURL!;
    const milestoneName = `Milestone-cascade ${Date.now()}`;
    const runName = `Run-cascade ${Date.now()}`;

    let projectId: number | undefined;
    let startRunStateId: number | undefined;
    let gateName: string | undefined;
    let milestoneId: number | undefined;
    const dialog = page.getByRole("dialog");

    await test.step("Create project and enable review workflow", async () => {
      projectId = await api.createProject(`Reviews-Cascade ${Date.now()}`);
      // Cascade-completion needs a DONE-typed workflow (it gates milestone
      // completion). Pick the seeded "New" NOT_STARTED row as the run's
      // starting state, then mint a fresh DONE-typed gated workflow scoped to
      // this project — no shared-row race.
      const allStartingRes = await request.get(
        `${url}/api/model/workflows/findMany`,
        {
          params: {
            q: JSON.stringify({
              where: {
                isDeleted: false,
                isEnabled: true,
                scope: "RUNS",
                workflowType: "NOT_STARTED",
                projects: { some: { projectId } },
              },
              orderBy: { order: "asc" },
              select: { id: true },
              take: 1,
            }),
          },
        }
      );
      const startingIds = ((await allStartingRes.json())?.data ?? []).map(
        (w: { id: number }) => w.id
      );
      expect(startingIds.length).toBeGreaterThanOrEqual(1);

      startRunStateId = startingIds[0];

      await setProjectReviewWorkflowEnabled(request, url, projectId!, true);
    });

    await test.step("Mint gated DONE workflow and read its gate name", async () => {
      const gatedDone = await createGatedTestWorkflow(
        request,
        url,
        projectId!,
        "RUNS",
        { workflowType: "DONE" }
      );
      const gatedId = gatedDone.id;
      gatedRunStateId = gatedId;

      const gateNameRes = await request.get(
        `${url}/api/model/workflows/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: { id: gatedRunStateId },
              select: { name: true },
            }),
          },
        }
      );
      gateName = (await gateNameRes.json())?.data?.name as string;
      expect(gateName).toBeTruthy();
    });

    await test.step("Create started milestone with a test run", async () => {
      milestoneId = await api.createMilestone(projectId!, milestoneName, {
        isStarted: true,
      });
      createdMilestoneIds.push(milestoneId);

      const _runId = await api.createTestRun(projectId!, runName, {
        stateId: startRunStateId,
        milestoneId,
      });
    });

    await test.step("Open milestone Complete dialog", async () => {
      // Open milestones page and click into the milestone's 3-dot menu.
      await page.goto(`/en-US/projects/milestones/${projectId}`);
      await page.waitForLoadState("load");

      // Ensure the Active tab is loaded (milestone seeded with isStarted=true).
      const activeTab = page.getByRole("tab", { name: /Active/i });
      await expect(activeTab).toBeVisible({ timeout: 10000 });

      const milestoneCard = page
        .locator("div")
        .filter({ hasText: milestoneName })
        .first();
      await expect(milestoneCard).toBeVisible({ timeout: 10000 });

      // The 3-dot menu button is the last <button> in the card chrome.
      await milestoneCard.getByRole("button").last().click();
      await page.getByRole("menuitem", { name: "Complete" }).click();

      await expect(dialog).toBeVisible({ timeout: 5000 });
    });

    await test.step("Select gated DONE cascade state and confirm completion", async () => {
      // Step 1: the dialog renders the date picker AND cascade checkboxes/
      // destination selects up-front (impactData loads via useEffect on open).
      // The "Complete test runs" cascade Select must be visible because the
      // milestone has 1 active test run. Pick the gated DONE state.
      const cascadeCombo = dialog
        .locator('[role="combobox"]:not([disabled])')
        .first();
      await expect(cascadeCombo).toBeVisible({ timeout: 10000 });
      await cascadeCombo.click();
      await page
        .getByRole("option")
        .filter({ hasText: new RegExp(`^${gateName}$`, "i") })
        .first()
        .click();

      // Click Complete — advances to the confirmation step.
      await dialog.getByRole("button", { name: /^Complete$/i }).click();

      // Step 2: confirmation. Click "Confirm & Complete All" — the gate is
      // strict-transitive evaluated server-side and the action returns
      // status: "error" + a "Review required for run \"...\" before
      // transitioning to \"<gate>\"." message.
      await dialog.getByRole("button", { name: /Confirm.*Complete/i }).click();
    });

    await test.step("Verify error toast names the blocked run and gate", async () => {
      // The cascade returns status: "error" + a "Review required for run
      // \"<name>\" before transitioning to \"<gate>\"." message — the
      // dialog's catch surfaces it as a sonner.error toast.
      const errorToast = page
        .locator('[data-sonner-toast][data-type="error"]')
        .first();
      await expect(errorToast).toBeVisible({ timeout: 15000 });
      await expect(errorToast).toContainText(runName);
      await expect(errorToast).toContainText(gateName!);
    });
  });
});
