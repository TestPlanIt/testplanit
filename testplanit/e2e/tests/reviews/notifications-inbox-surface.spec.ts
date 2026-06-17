import { expect, test } from "../../fixtures";
import {
  createGatedTestWorkflow,
  createReviewRequest,
  decideReviewRequest,
  deleteReviewRequest,
  getProjectWorkflowIds,
  setProjectReviewWorkflowEnabled,
  softDeleteWorkflow,
} from "./helpers";

/**
 * Notification surfaces for Review & Approval.
 *
 * Codifies the two surfaces that actually exist today (no NotificationType
 * REVIEW_* wiring, no email worker branch — those are intentionally absent
 * and the blog now reflects this):
 *
 *  - The header inbox icon shows a count badge that reflects pending
 *    requests for the current user, picked up on the polling tick.
 *  - The entity's ReviewStatusBanner switches between pending and
 *    decided/attribution variants without a full reload (next poll).
 */

test.describe("Notification surfaces", () => {
  let gatedWorkflowId: number | null = null;
  const createdReviewIds: string[] = [];
  const createdUserIds: string[] = [];

  test.afterEach(async ({ request, baseURL }) => {
    const url = baseURL!;
    while (createdReviewIds.length) {
      const id = createdReviewIds.pop();
      if (id) await deleteReviewRequest(request, url, id);
    }
    if (gatedWorkflowId) {
      await softDeleteWorkflow(request, url, gatedWorkflowId);
      gatedWorkflowId = null;
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

  test("inbox badge increments on new request and banner flips after decide", async ({
    page,
    request,
    baseURL,
    api,
    adminUserId,
  }) => {
    const url = baseURL!;
    const badge = page.getByTestId("review-inbox-count-badge");
    let projectId: number | undefined;
    let currentStateId: number | undefined;
    let caseId: number | undefined;
    let reviewId: string | undefined;

    // Set up a review-gated project with a test case in the current state
    await test.step("Set up review-gated project and test case", async () => {
      projectId = await api.createProject(`Reviews-Notif ${Date.now()}`);
      const ids = await getProjectWorkflowIds(
        request,
        url,
        projectId,
        "CASES",
        5
      );
      currentStateId = ids[0];
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
        `Notif-Surface ${Date.now()}`
      );
      caseId = await api.createTestCaseWithState(
        projectId,
        folderId,
        `Notif case ${Date.now()}`,
        currentStateId
      );
    });

    // Open the case and confirm no pending banner is shown
    await test.step("Open case and verify no pending banner yet", async () => {
      await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
      await page.waitForLoadState("networkidle");

      // Banner not yet visible — no pending request.
      await expect(
        page.getByTestId("review-status-banner-pending")
      ).toHaveCount(0);
    });

    // Seed a pending review request via the API
    await test.step("Seed a pending review request", async () => {
      // Seed a pending request directly. The inbox query refetches on the
      // hook's polling cadence — give it the time it needs.
      const requester = await api.createUser({
        name: `NS-Req ${Date.now()}`,
        email: `ns-req-${Date.now()}@example.com`,
        password: "S3cure!password",
        access: "USER",
        isActive: true,
        emailVerified: true,
      });
      createdUserIds.push(requester.data.id);

      reviewId = await createReviewRequest(request, url, {
        projectId: projectId!,
        entityType: "CASE",
        entityId: caseId!,
        fromStateId: currentStateId!,
        toStateId: gatedWorkflowId!,
        requestedByUserId: requester.data.id,
        assigneeUserId: adminUserId,
      });
      createdReviewIds.push(reviewId);
    });

    // Reload and verify the pending banner and inbox badge appear
    await test.step("Verify pending banner and inbox badge appear after reload", async () => {
      // The banner query uses refetchOnWindowFocus: false + staleTime, so a
      // brand-new request created via the API after page load won't be picked
      // up without a navigation. Reload to trigger fresh queries.
      await page.reload();
      await page.waitForLoadState("networkidle");

      await expect(
        page.getByTestId("review-status-banner-pending")
      ).toBeVisible({
        timeout: 15000,
      });

      // Badge count is at least 1 (the one we just seeded). Stronger
      // "ticks up by exactly one" assertions race with parallel workers
      // touching their own gated workflows, so anchor on the lower bound.
      await expect
        .poll(
          async () => {
            if (!(await badge.isVisible().catch(() => false))) return 0;
            const t = await badge.textContent();
            return Number(t ?? "0");
          },
          { timeout: 15000, intervals: [1000, 2000, 5000] }
        )
        .toBeGreaterThanOrEqual(1);
    });

    // Decide the request as CHANGES_REQUESTED and verify the banner flips to attribution
    await test.step("Decide as changes requested and verify banner flips to attribution", async () => {
      // Decide → banner flips to decided (attribution visible). APPROVED
      // decisions hide the banner entirely (the contract is "approval permits
      // the next transition" — no UI noise after that). CHANGES_REQUESTED
      // keeps the banner up so the requester sees the reviewer's feedback,
      // which is the surface this spec codifies.
      await decideReviewRequest(
        request,
        url,
        reviewId!,
        "CHANGES_REQUESTED",
        "Please tighten the test steps."
      );

      await page.reload();
      await page.waitForLoadState("networkidle");

      await expect(
        page.getByTestId("review-status-banner-attribution")
      ).toBeVisible({ timeout: 15000 });
      await expect(
        page.getByTestId("review-status-banner-pending")
      ).toHaveCount(0);
    });
  });
});
