import { expect, test } from "../../fixtures";
import {
  createGatedTestWorkflow,
  createReviewRequest,
  deleteReviewRequest,
  getProjectWorkflowIds,
  setProjectReviewWorkflowEnabled,
  softDeleteWorkflow,
} from "./helpers";

/**
 * Reverting a review decision.
 *
 * Asserts:
 *  - Reverting a consumed approval returns the request to PENDING, clears the
 *    decision fields, un-consumes it, and rolls the entity back to the state
 *    it held before the approval.
 *  - A second decision after a revert is possible and `revertCount` persists.
 *  - Reverting a rejection flips the status without touching the entity.
 *  - The revert is refused, changing nothing, when a newer PENDING request
 *    already exists for the same entity.
 */

async function readReview(
  request: Parameters<typeof deleteReviewRequest>[0],
  url: string,
  id: string,
  select: Record<string, boolean>
) {
  const res = await request.get(`${url}/api/model/reviewRequest/findFirst`, {
    params: { q: JSON.stringify({ where: { id }, select }) },
  });
  return (await res.json())?.data;
}

async function readCaseState(
  request: Parameters<typeof deleteReviewRequest>[0],
  url: string,
  caseId: number
) {
  const res = await request.get(`${url}/api/model/repositoryCases/findFirst`, {
    params: {
      q: JSON.stringify({ where: { id: caseId }, select: { stateId: true } }),
    },
  });
  return (await res.json())?.data?.stateId as number | undefined;
}

test.describe("Revert a review decision", () => {
  let gatedWorkflowId: number | null = null;
  let originWorkflowId: number | null = null;
  const pendingRequestIds: string[] = [];
  const createdUserIds: string[] = [];

  test.afterEach(async ({ request, baseURL }) => {
    const url = baseURL!;
    while (pendingRequestIds.length) {
      const id = pendingRequestIds.pop();
      if (id) await deleteReviewRequest(request, url, id);
    }
    if (gatedWorkflowId) {
      await softDeleteWorkflow(request, url, gatedWorkflowId);
      gatedWorkflowId = null;
    }
    if (originWorkflowId) {
      await softDeleteWorkflow(request, url, originWorkflowId);
      originWorkflowId = null;
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

  test("reverting a consumed approval rolls the case back and allows deciding again", async ({
    page,
    request,
    baseURL,
    api,
    adminUserId,
  }) => {
    const url = baseURL!;
    let originalStateId: number | undefined;
    let reviewRequestId: string | undefined;
    let caseId: number | undefined;

    await test.step("Create a gated project with a pending request", async () => {
      const projectId = await api.createProject(`Reviews-Revert ${Date.now()}`);

      await setProjectReviewWorkflowEnabled(request, url, projectId, true);

      // This is the only test here that asserts the approval MOVES the case,
      // so its transition path has to contain exactly one gate — its own.
      // `assertReviewGatePasses` collects gated CASES states across the whole
      // install, and the suite is fullyParallel, so any gate another spec
      // creates at an order inside this path blocks the move and the case
      // silently stays put. Rather than share the `orderOffset: 1` slot that
      // the sibling tests and reviewer-inbox-decisions.spec.ts also use, this
      // test builds its own ungated start state directly below its own gate
      // at a high random offset: the window is one unit wide and well clear
      // of the offsets other specs use (1, 1000, 1500, 2000).
      const baseOffset = 5000 + Math.floor(Math.random() * 3000);
      const origin = await createGatedTestWorkflow(
        request,
        url,
        projectId,
        "CASES",
        { orderOffset: baseOffset, requiresReview: false }
      );
      originWorkflowId = origin.id;
      originalStateId = origin.id;

      const gated = await createGatedTestWorkflow(
        request,
        url,
        projectId,
        "CASES",
        { orderOffset: baseOffset + 1 }
      );
      gatedWorkflowId = gated.id;

      const requester = await api.createUser({
        name: `Revert-Req ${Date.now()}`,
        email: `revert-req-${Date.now()}@example.com`,
        password: "S3cure!password",
        access: "USER",
        isActive: true,
        emailVerified: true,
      });
      createdUserIds.push(requester.data.id);

      const folderId = await api.createFolder(
        projectId,
        `Revert ${Date.now()}`
      );
      caseId = await api.createTestCaseWithState(
        projectId,
        folderId,
        `Revert case ${Date.now()}`,
        originalStateId!
      );
      reviewRequestId = await createReviewRequest(request, url, {
        projectId,
        entityType: "CASE",
        entityId: caseId,
        fromStateId: originalStateId!,
        toStateId: gatedWorkflowId,
        requestedByUserId: requester.data.id,
        assigneeUserId: adminUserId,
      });
      pendingRequestIds.push(reviewRequestId!);
    });

    await test.step("Approve it so the case moves and the approval is consumed", async () => {
      await page.goto("/en-US/reviews");
      await page.waitForLoadState("networkidle");

      const approveBtn = page.getByTestId(
        `reviews-inbox-approve-${reviewRequestId}`
      );
      await expect(approveBtn).toBeVisible({ timeout: 10000 });
      await approveBtn.click();

      const dialog = page.getByTestId("approve-dialog");
      await expect(dialog).toBeVisible();
      await page.getByTestId("approve-confirm").click();
      await expect(dialog).not.toBeVisible({ timeout: 10000 });

      expect(await readCaseState(request, url, caseId!)).toBe(gatedWorkflowId);
      const row = await readReview(request, url, reviewRequestId!, {
        status: true,
        consumedAt: true,
      });
      expect(row?.status).toBe("APPROVED");
      expect(row?.consumedAt).toBeTruthy();
    });

    await test.step("Revert the approval from the Decided tab", async () => {
      await page.goto("/en-US/reviews?tab=decided");
      await page.waitForLoadState("networkidle");

      const revertBtn = page.getByTestId(
        `reviews-inbox-revert-${reviewRequestId}`
      );
      await expect(revertBtn).toBeVisible({ timeout: 10000 });
      await revertBtn.click();

      const dialog = page.getByTestId("reviews-inbox-revert-dialog");
      await expect(dialog).toBeVisible();
      await page.getByTestId("reviews-inbox-revert-confirm").click();
      await expect(dialog).not.toBeVisible({ timeout: 10000 });
    });

    await test.step("The request is pending again and the case is back where it started", async () => {
      const row = await readReview(request, url, reviewRequestId!, {
        status: true,
        decidedAt: true,
        decidedByUserId: true,
        decisionComment: true,
        consumedAt: true,
        revertedAt: true,
        revertedByUserId: true,
        revertCount: true,
      });
      expect(row?.status).toBe("PENDING");
      expect(row?.decidedAt).toBeNull();
      expect(row?.decidedByUserId).toBeNull();
      expect(row?.decisionComment).toBeNull();
      expect(row?.consumedAt).toBeNull();
      expect(row?.revertedAt).toBeTruthy();
      expect(row?.revertedByUserId).toBe(adminUserId);
      expect(row?.revertCount).toBe(1);

      expect(await readCaseState(request, url, caseId!)).toBe(originalStateId);
    });

    await test.step("Deciding again works and the revert count persists", async () => {
      await page.goto("/en-US/reviews");
      await page.waitForLoadState("networkidle");

      const approveBtn = page.getByTestId(
        `reviews-inbox-approve-${reviewRequestId}`
      );
      await expect(approveBtn).toBeVisible({ timeout: 10000 });
      await approveBtn.click();
      await page.getByTestId("approve-confirm").click();
      await expect(page.getByTestId("approve-dialog")).not.toBeVisible({
        timeout: 10000,
      });

      const row = await readReview(request, url, reviewRequestId!, {
        status: true,
        consumedAt: true,
        revertCount: true,
      });
      expect(row?.status).toBe("APPROVED");
      expect(row?.consumedAt).toBeTruthy();
      expect(row?.revertCount).toBe(1);
      expect(await readCaseState(request, url, caseId!)).toBe(gatedWorkflowId);
    });
  });

  test("reverting a rejection leaves the case untouched", async ({
    page,
    request,
    baseURL,
    api,
    adminUserId,
  }) => {
    const url = baseURL!;
    let originalStateId: number | undefined;
    let reviewRequestId: string | undefined;
    let caseId: number | undefined;

    await test.step("Create a gated project with a pending request", async () => {
      const projectId = await api.createProject(
        `Reviews-RevertReject ${Date.now()}`
      );
      const ids = await getProjectWorkflowIds(
        request,
        url,
        projectId,
        "CASES",
        5
      );
      originalStateId = ids[0];

      await setProjectReviewWorkflowEnabled(request, url, projectId, true);
      const gated = await createGatedTestWorkflow(
        request,
        url,
        projectId,
        "CASES",
        { orderOffset: 1 }
      );
      gatedWorkflowId = gated.id;

      const requester = await api.createUser({
        name: `RevertRej-Req ${Date.now()}`,
        email: `revertrej-req-${Date.now()}@example.com`,
        password: "S3cure!password",
        access: "USER",
        isActive: true,
        emailVerified: true,
      });
      createdUserIds.push(requester.data.id);

      const folderId = await api.createFolder(
        projectId,
        `RevertReject ${Date.now()}`
      );
      caseId = await api.createTestCaseWithState(
        projectId,
        folderId,
        `RevertReject case ${Date.now()}`,
        originalStateId!
      );
      reviewRequestId = await createReviewRequest(request, url, {
        projectId,
        entityType: "CASE",
        entityId: caseId,
        fromStateId: originalStateId!,
        toStateId: gatedWorkflowId,
        requestedByUserId: requester.data.id,
        assigneeUserId: adminUserId,
      });
      pendingRequestIds.push(reviewRequestId!);
    });

    await test.step("Reject it", async () => {
      await page.goto("/en-US/reviews");
      await page.waitForLoadState("networkidle");

      const rejectBtn = page.getByTestId(
        `reviews-inbox-reject-${reviewRequestId}`
      );
      await expect(rejectBtn).toBeVisible({ timeout: 10000 });
      await rejectBtn.click();

      const dialog = page.getByTestId("reject-dialog");
      await expect(dialog).toBeVisible();
      await page
        .getByTestId("reject-comment-input")
        .fill("E2E — rejecting so the revert can undo it");
      await page.getByTestId("reject-confirm").click();
      await expect(dialog).not.toBeVisible({ timeout: 10000 });

      expect(await readCaseState(request, url, caseId!)).toBe(originalStateId);
    });

    await test.step("Revert the rejection", async () => {
      await page.goto("/en-US/reviews?tab=decided");
      await page.waitForLoadState("networkidle");

      const revertBtn = page.getByTestId(
        `reviews-inbox-revert-${reviewRequestId}`
      );
      await expect(revertBtn).toBeVisible({ timeout: 10000 });
      await revertBtn.click();
      await page.getByTestId("reviews-inbox-revert-confirm").click();
      await expect(
        page.getByTestId("reviews-inbox-revert-dialog")
      ).not.toBeVisible({ timeout: 10000 });

      const row = await readReview(request, url, reviewRequestId!, {
        status: true,
        decidedByUserId: true,
        revertCount: true,
      });
      expect(row?.status).toBe("PENDING");
      expect(row?.decidedByUserId).toBeNull();
      expect(row?.revertCount).toBe(1);

      // A rejection never moved the case, so nothing to roll back.
      expect(await readCaseState(request, url, caseId!)).toBe(originalStateId);
    });
  });

  test("revert is refused when a newer request already exists", async ({
    page,
    request,
    baseURL,
    api,
    adminUserId,
  }) => {
    const url = baseURL!;
    let originalStateId: number | undefined;
    let decidedRequestId: string | undefined;
    let newerRequestId: string | undefined;
    let caseId: number | undefined;

    await test.step("Create a decided request, then a newer pending one", async () => {
      const projectId = await api.createProject(
        `Reviews-RevertSuperseded ${Date.now()}`
      );
      const ids = await getProjectWorkflowIds(
        request,
        url,
        projectId,
        "CASES",
        5
      );
      originalStateId = ids[0];

      await setProjectReviewWorkflowEnabled(request, url, projectId, true);
      const gated = await createGatedTestWorkflow(
        request,
        url,
        projectId,
        "CASES",
        { orderOffset: 1 }
      );
      gatedWorkflowId = gated.id;

      const requester = await api.createUser({
        name: `RevertSup-Req ${Date.now()}`,
        email: `revertsup-req-${Date.now()}@example.com`,
        password: "S3cure!password",
        access: "USER",
        isActive: true,
        emailVerified: true,
      });
      createdUserIds.push(requester.data.id);

      const folderId = await api.createFolder(
        projectId,
        `RevertSuperseded ${Date.now()}`
      );
      caseId = await api.createTestCaseWithState(
        projectId,
        folderId,
        `RevertSuperseded case ${Date.now()}`,
        originalStateId!
      );

      decidedRequestId = await createReviewRequest(request, url, {
        projectId,
        entityType: "CASE",
        entityId: caseId,
        fromStateId: originalStateId!,
        toStateId: gatedWorkflowId,
        requestedByUserId: requester.data.id,
        assigneeUserId: adminUserId,
      });
      pendingRequestIds.push(decidedRequestId!);

      // Reject it so the entity stays put and the partial unique index on
      // (entityType, entityId) WHERE status='PENDING' is free for the next one.
      await page.goto("/en-US/reviews");
      await page.waitForLoadState("networkidle");
      await page
        .getByTestId(`reviews-inbox-reject-${decidedRequestId}`)
        .click();
      await expect(page.getByTestId("reject-dialog")).toBeVisible();
      await page
        .getByTestId("reject-comment-input")
        .fill("E2E — superseded test");
      await page.getByTestId("reject-confirm").click();
      await expect(page.getByTestId("reject-dialog")).not.toBeVisible({
        timeout: 10000,
      });

      newerRequestId = await createReviewRequest(request, url, {
        projectId,
        entityType: "CASE",
        entityId: caseId,
        fromStateId: originalStateId!,
        toStateId: gatedWorkflowId,
        requestedByUserId: requester.data.id,
        assigneeUserId: adminUserId,
      });
      pendingRequestIds.push(newerRequestId!);
    });

    await test.step("Reverting the older decision is declined", async () => {
      await page.goto("/en-US/reviews?tab=decided");
      await page.waitForLoadState("networkidle");

      const revertBtn = page.getByTestId(
        `reviews-inbox-revert-${decidedRequestId}`
      );
      await expect(revertBtn).toBeVisible({ timeout: 10000 });
      await revertBtn.click();
      await page.getByTestId("reviews-inbox-revert-confirm").click();

      // The guard refuses and nothing changes.
      await expect
        .poll(
          async () => {
            const row = await readReview(request, url, decidedRequestId!, {
              status: true,
            });
            return row?.status;
          },
          { timeout: 10000 }
        )
        .toBe("REJECTED");

      const row = await readReview(request, url, decidedRequestId!, {
        status: true,
        revertCount: true,
        revertedAt: true,
      });
      expect(row?.status).toBe("REJECTED");
      expect(row?.revertCount).toBe(0);
      expect(row?.revertedAt).toBeNull();
    });
  });
});
