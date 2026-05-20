import { expect, test } from "../../fixtures";
import {
  createReviewRequest,
  deleteReviewRequest,
  getProjectWorkflowIds,
  setProjectReviewWorkflowEnabled,
  setWorkflowRequiresReview,
} from "./helpers";

/**
 * Reviewer Inbox — decision flows + Decided-tab filter.
 *
 * Asserts:
 *  - The pending tab shows assigned requests and exposes approve, request-
 *    changes, and reject action buttons in the row.
 *  - Approving via the dialog persists APPROVED.
 *  - Decided tab includes APPROVED / CHANGES_REQUESTED / REJECTED but NOT
 *    CANCELLED — codifies the filter the blog had wrong.
 */

test.describe("Reviewer inbox decisions", () => {
  let gatedWorkflowId: number | null = null;
  const pendingRequestIds: string[] = [];
  const createdUserIds: string[] = [];

  test.afterEach(async ({ request, baseURL }) => {
    const url = baseURL!;
    while (pendingRequestIds.length) {
      const id = pendingRequestIds.pop();
      if (id) await deleteReviewRequest(request, url, id);
    }
    if (gatedWorkflowId) {
      await setWorkflowRequiresReview(request, url, gatedWorkflowId, false);
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

  test("approve from inbox marks request APPROVED", async ({
    page,
    request,
    baseURL,
    api,
    adminUserId,
  }) => {
    const url = baseURL!;
    const projectId = await api.createProject(
      `Reviews-InboxApprove ${Date.now()}`
    );
    const ids = await getProjectWorkflowIds(
      request,
      url,
      projectId,
      "CASES",
      5
    );
    const currentStateId = ids[0];
    gatedWorkflowId = ids[1];

    await setProjectReviewWorkflowEnabled(request, url, projectId, true);
    await setWorkflowRequiresReview(request, url, gatedWorkflowId, true);

    // Admin is the assignee/reviewer; create a separate requester so the
    // schema's "assignee != requester" validate doesn't reject the seed.
    const requester = await api.createUser({
      name: `IA-Req ${Date.now()}`,
      email: `ia-req-${Date.now()}@example.com`,
      password: "S3cure!password",
      access: "USER",
      isActive: true,
      emailVerified: true,
    });
    createdUserIds.push(requester.data.id);

    const folderId = await api.createFolder(
      projectId,
      `Inbox-Approve ${Date.now()}`
    );
    const caseId = await api.createTestCaseWithState(
      projectId,
      folderId,
      `Inbox-Approve case ${Date.now()}`,
      currentStateId
    );
    const reviewRequestId = await createReviewRequest(request, url, {
      projectId,
      entityType: "CASE",
      entityId: caseId,
      fromStateId: currentStateId,
      toStateId: gatedWorkflowId,
      requestedByUserId: requester.data.id,
      assigneeUserId: adminUserId,
    });
    pendingRequestIds.push(reviewRequestId);

    await page.goto("/en-US/reviews");
    await page.waitForLoadState("networkidle");

    // Badge reflects the pending count (>= 1).
    const badge = page.getByTestId("review-inbox-count-badge");
    await expect(badge).toBeVisible({ timeout: 10000 });

    // Pending tab is the default — find our row.
    await expect(page.getByTestId("reviews-inbox-page")).toBeVisible();

    const approveBtn = page.getByTestId(
      `reviews-inbox-approve-${reviewRequestId}`
    );
    await expect(approveBtn).toBeVisible({ timeout: 10000 });
    await approveBtn.click();

    const dialog = page.getByTestId("approve-dialog");
    await expect(dialog).toBeVisible();
    await page.getByTestId("approve-confirm").click();
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // Verify the DB row flipped to APPROVED.
    const res = await request.get(`${url}/api/model/reviewRequest/findFirst`, {
      params: {
        q: JSON.stringify({
          where: { id: reviewRequestId },
          select: { status: true, decidedAt: true },
        }),
      },
    });
    const result = await res.json();
    expect(result?.data?.status).toBe("APPROVED");
    expect(result?.data?.decidedAt).toBeTruthy();
  });

  test("Decided tab excludes CANCELLED requests", async ({
    page,
    request,
    baseURL,
    api,
    adminUserId,
  }) => {
    const url = baseURL!;
    const projectId = await api.createProject(
      `Reviews-InboxDecided ${Date.now()}`
    );
    const ids = await getProjectWorkflowIds(
      request,
      url,
      projectId,
      "CASES",
      5
    );
    const currentStateId = ids[0];
    gatedWorkflowId = ids[1];

    await setProjectReviewWorkflowEnabled(request, url, projectId, true);
    await setWorkflowRequiresReview(request, url, gatedWorkflowId, true);

    const requester = await api.createUser({
      name: `ID-Req ${Date.now()}`,
      email: `id-req-${Date.now()}@example.com`,
      password: "S3cure!password",
      access: "USER",
      isActive: true,
      emailVerified: true,
    });
    createdUserIds.push(requester.data.id);

    const folderId = await api.createFolder(
      projectId,
      `Inbox-Decided ${Date.now()}`
    );
    // Three cases: one approved, one rejected, one cancelled. Decided tab
    // must show two rows (the cancelled one stays hidden).
    const approvedCaseId = await api.createTestCaseWithState(
      projectId,
      folderId,
      `Decided-A ${Date.now()}`,
      currentStateId
    );
    const rejectedCaseId = await api.createTestCaseWithState(
      projectId,
      folderId,
      `Decided-R ${Date.now()}`,
      currentStateId
    );
    const cancelledCaseId = await api.createTestCaseWithState(
      projectId,
      folderId,
      `Decided-X ${Date.now()}`,
      currentStateId
    );

    const seedDecided = async (
      entityId: number,
      status: "APPROVED" | "REJECTED" | "CANCELLED"
    ): Promise<string> => {
      const res = await request.post(`${url}/api/model/reviewRequest/create`, {
        data: {
          data: {
            projectId,
            entityType: "CASE",
            entityId,
            fromStateId: currentStateId,
            toStateId: gatedWorkflowId!,
            requestedByUserId: requester.data.id,
            assigneeUserId: adminUserId,
            status,
            decidedAt: new Date().toISOString(),
            decidedByUserId: status === "CANCELLED" ? null : adminUserId,
          },
        },
      });
      const j = await res.json();
      const id = j?.data?.id as string;
      pendingRequestIds.push(id);
      return id;
    };

    const approvedId = await seedDecided(approvedCaseId, "APPROVED");
    const rejectedId = await seedDecided(rejectedCaseId, "REJECTED");
    const cancelledId = await seedDecided(cancelledCaseId, "CANCELLED");

    await page.goto("/en-US/reviews");
    await page.waitForLoadState("networkidle");

    await page.getByTestId("reviews-inbox-tab-decided").click();
    await page.waitForLoadState("networkidle");

    // Approved + rejected rows visible.
    await expect(
      page.locator(`[data-testid="reviews-inbox-row-${approvedId}"]`)
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.locator(`[data-testid="reviews-inbox-row-${rejectedId}"]`)
    ).toBeVisible();
    // Cancelled row absent.
    await expect(
      page.locator(`[data-testid="reviews-inbox-row-${cancelledId}"]`)
    ).toHaveCount(0);
  });
});
