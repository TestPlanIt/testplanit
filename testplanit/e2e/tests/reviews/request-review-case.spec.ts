import { expect, test } from "../../fixtures";
import {
  deleteReviewRequest,
  getProjectWorkflowIds,
  setProjectReviewWorkflowEnabled,
  setWorkflowRequiresReview,
} from "./helpers";

/**
 * Request Review — single-entity flow (test case).
 *
 * Asserts:
 *  - Opening RequestReviewSheet on a case lets a user pick the gated target
 *    state and an assignee, submits, and shows the pending banner.
 *  - A second request for the same case+target is rejected with the
 *    "ALREADY_PENDING" surface (the sheet refuses to open or shows the
 *    error toast).
 */

test.describe("Request review on a case", () => {
  let gatedWorkflowId: number | null = null;
  let createdReviewRequestId: string | null = null;
  const createdUserIds: string[] = [];

  test.afterEach(async ({ request, baseURL }) => {
    const url = baseURL!;
    if (createdReviewRequestId) {
      await deleteReviewRequest(request, url, createdReviewRequestId);
      createdReviewRequestId = null;
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

  test("requester submits a review request and sees the pending banner", async ({
    page,
    request,
    baseURL,
    api,
  }) => {
    const url = baseURL!;
    const projectId = await api.createProject(`Reviews-Req ${Date.now()}`);
    // Need a separate reviewer — schema validates assignee != requester.
    const reviewer = await api.createUser({
      name: `RR-Reviewer ${Date.now()}`,
      email: `rr-reviewer-${Date.now()}@example.com`,
      password: "S3cure!password",
      access: "USER",
      isActive: true,
      emailVerified: true,
    });
    createdUserIds.push(reviewer.data.id);
    await request.post(`${url}/api/model/projectAssignment/create`, {
      data: {
        data: {
          project: { connect: { id: projectId } },
          user: { connect: { id: reviewer.data.id } },
        },
      },
    });
    const reviewerId = reviewer.data.id;
    const ids = await getProjectWorkflowIds(
      request,
      url,
      projectId,
      "CASES",
      5
    );
    expect(ids.length).toBeGreaterThanOrEqual(2);
    const currentStateId = ids[0];
    gatedWorkflowId = ids[1];

    await setProjectReviewWorkflowEnabled(request, url, projectId, true);
    await setWorkflowRequiresReview(request, url, gatedWorkflowId, true);

    // Look up the gated workflow's name — we click the target-state option by
    // visible text rather than by id, because leftover gated workflows from
    // prior runs can co-occur in the picker and make id-targeting fragile.
    const wfRes = await request.get(`${url}/api/model/workflows/findFirst`, {
      params: {
        q: JSON.stringify({
          where: { id: gatedWorkflowId },
          select: { name: true },
        }),
      },
    });
    const gatedName = (await wfRes.json())?.data?.name as string;
    expect(gatedName).toBeTruthy();

    const folderId = await api.createFolder(
      projectId,
      `Req-Review ${Date.now()}`
    );
    const caseId = await api.createTestCaseWithState(
      projectId,
      folderId,
      `Req-Review case ${Date.now()}`,
      currentStateId
    );

    await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
    await page.waitForLoadState("networkidle");

    const requestBtn = page.getByTestId("request-review-button");
    await expect(requestBtn).toBeVisible({ timeout: 10000 });
    await requestBtn.click();

    const sheet = page.getByTestId("request-review-sheet");
    await expect(sheet).toBeVisible();

    // Target state — pick the gated workflow by its visible name.
    const targetTrigger = page.getByTestId("request-review-target-state");
    await targetTrigger.click();
    await page
      .getByRole("option", { name: new RegExp(`^${gatedName}$`, "i") })
      .first()
      .click();

    // Assign to the separate reviewer (assignee != requester). The combobox
    // paginates project-eligible users alphabetically — type the prefix so
    // our reviewer is on page 0 instead of buried alphabetically.
    const assignee = page.getByTestId("assignee-combobox");
    await assignee.click();
    await page.keyboard.type("RR-Reviewer");
    const assigneeOption = page.getByTestId(
      `assignee-option-user-${reviewerId}`
    );
    await expect(assigneeOption).toBeVisible({ timeout: 10000 });
    await assigneeOption.click();

    await page
      .getByTestId("request-review-comment")
      .fill("Please approve this transition for E2E coverage.");

    // Capture the new ReviewRequest id from the network response so the
    // cleanup hook can clear it.
    const submitPromise = page.waitForResponse(
      (r) =>
        r.url().includes("/api/model/reviewRequest") || // ZenStack fallback
        r.url().endsWith("/actions/reviews") ||
        r.url().includes("/api/reviews/")
    );
    await page.getByTestId("request-review-submit").click();
    await submitPromise.catch(() => null);

    // The pending banner must surface on the case detail page.
    await expect(page.getByTestId("review-status-banner-pending")).toBeVisible({
      timeout: 10000,
    });

    // Look up the created request so afterEach can clean it.
    const find = await request.get(`${url}/api/model/reviewRequest/findFirst`, {
      params: {
        q: JSON.stringify({
          where: {
            entityType: "CASE",
            entityId: caseId,
            status: "PENDING",
          },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        }),
      },
    });
    const found = await find.json();
    createdReviewRequestId = found?.data?.id ?? null;
    expect(createdReviewRequestId).toBeTruthy();
  });

  test("second request for the same case+target is blocked", async ({
    page,
    request,
    baseURL,
    api,
    adminUserId,
  }) => {
    const url = baseURL!;
    const projectId = await api.createProject(`Reviews-Dup ${Date.now()}`);
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

    // Need a separate reviewer — schema validates assignee != requester.
    const reviewer = await api.createUser({
      name: `Dup-Reviewer ${Date.now()}`,
      email: `dup-reviewer-${Date.now()}@example.com`,
      password: "S3cure!password",
      access: "USER",
      isActive: true,
      emailVerified: true,
    });
    createdUserIds.push(reviewer.data.id);

    const folderId = await api.createFolder(projectId, `Dup-Req ${Date.now()}`);
    const caseId = await api.createTestCaseWithState(
      projectId,
      folderId,
      `Dup-Req case ${Date.now()}`,
      currentStateId
    );

    // Seed a pending request directly.
    const seedRes = await request.post(
      `${url}/api/model/reviewRequest/create`,
      {
        data: {
          data: {
            projectId,
            entityType: "CASE",
            entityId: caseId,
            fromStateId: currentStateId,
            toStateId: gatedWorkflowId,
            requestedByUserId: adminUserId,
            assigneeUserId: reviewer.data.id,
            status: "PENDING",
          },
        },
      }
    );
    const seed = await seedRes.json();
    createdReviewRequestId = seed?.data?.id ?? null;
    expect(createdReviewRequestId).toBeTruthy();

    // On the case page, the request-review button should now be replaced
    // with the "Request review again"/cancel affordance, since a pending
    // request already exists.
    await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("review-status-banner-pending")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId("request-review-button")).toHaveCount(0);
  });
});
