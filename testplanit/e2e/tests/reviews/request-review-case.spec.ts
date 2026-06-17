import { expect, test } from "../../fixtures";
import {
  createGatedTestWorkflow,
  deleteReviewRequest,
  getProjectWorkflowIds,
  setProjectReviewWorkflowEnabled,
  softDeleteWorkflow,
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

  test("requester submits a review request and sees the pending banner", async ({
    page,
    request,
    baseURL,
    api,
  }) => {
    const url = baseURL!;
    let projectId: number | undefined;
    let reviewerId: string | undefined;
    let currentStateId: number | undefined;
    let caseId: number | undefined;

    await test.step("Create project and a separate reviewer assigned to it", async () => {
      projectId = await api.createProject(`Reviews-Req ${Date.now()}`);
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
      reviewerId = reviewer.data.id;
    });

    await test.step("Enable review workflow and create a gated workflow and test case", async () => {
      const ids = await getProjectWorkflowIds(
        request,
        url,
        projectId!,
        "CASES",
        5
      );
      expect(ids.length).toBeGreaterThanOrEqual(2);
      currentStateId = ids[0];

      await setProjectReviewWorkflowEnabled(request, url, projectId!, true);
      // Each test gets its own gated workflow to avoid racing
      // Workflows.requiresReview (global column) with parallel review specs.
      const gated = await createGatedTestWorkflow(
        request,
        url,
        projectId!,
        "CASES"
      );
      gatedWorkflowId = gated.id;

      const folderId = await api.createFolder(
        projectId!,
        `Req-Review ${Date.now()}`
      );
      caseId = await api.createTestCaseWithState(
        projectId!,
        folderId,
        `Req-Review case ${Date.now()}`,
        currentStateId!
      );
    });

    await test.step("Open the request review sheet on the case", async () => {
      await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
      await page.waitForLoadState("networkidle");

      const requestBtn = page.getByTestId("request-review-button");
      await expect(requestBtn).toBeVisible({ timeout: 10000 });
      await requestBtn.click();

      const sheet = page.getByTestId("request-review-sheet");
      await expect(sheet).toBeVisible();
    });

    await test.step("Pick the gated target state, assign the reviewer, and add a comment", async () => {
      // Target the option by its per-state testid — the visible label now
      // includes a "Requires review" badge (aria-label on the gated glyph),
      // so name-based matching no longer works.
      const targetTrigger = page.getByTestId("request-review-target-state");
      await targetTrigger.click();
      await page
        .getByTestId(`request-review-target-state-option-${gatedWorkflowId}`)
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
    });

    await test.step("Submit the request and verify the pending banner appears", async () => {
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
      await expect(
        page.getByTestId("review-status-banner-pending")
      ).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step("Look up the created review request for cleanup", async () => {
      // Look up the created request so afterEach can clean it.
      const find = await request.get(
        `${url}/api/model/reviewRequest/findFirst`,
        {
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
        }
      );
      const found = await find.json();
      createdReviewRequestId = found?.data?.id ?? null;
      expect(createdReviewRequestId).toBeTruthy();
    });
  });

  test("second request for the same case+target is blocked", async ({
    page,
    request,
    baseURL,
    api,
    adminUserId,
  }) => {
    const url = baseURL!;
    let projectId: number | undefined;
    let currentStateId: number | undefined;
    let reviewerUserId: string | undefined;
    let caseId: number | undefined;

    await test.step("Create project, gated workflow, reviewer, and a test case", async () => {
      projectId = await api.createProject(`Reviews-Dup ${Date.now()}`);
      const ids = await getProjectWorkflowIds(
        request,
        url,
        projectId,
        "CASES",
        5
      );
      currentStateId = ids[0];

      await setProjectReviewWorkflowEnabled(request, url, projectId, true);
      const dupGated = await createGatedTestWorkflow(
        request,
        url,
        projectId,
        "CASES"
      );
      gatedWorkflowId = dupGated.id;

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
      reviewerUserId = reviewer.data.id;

      const folderId = await api.createFolder(
        projectId,
        `Dup-Req ${Date.now()}`
      );
      caseId = await api.createTestCaseWithState(
        projectId,
        folderId,
        `Dup-Req case ${Date.now()}`,
        currentStateId!
      );
    });

    await test.step("Seed a pending review request directly", async () => {
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
              assigneeUserId: reviewerUserId,
              status: "PENDING",
            },
          },
        }
      );
      const seed = await seedRes.json();
      createdReviewRequestId = seed?.data?.id ?? null;
      expect(createdReviewRequestId).toBeTruthy();
    });

    await test.step("Verify the case page blocks a second request", async () => {
      // On the case page, the request-review button should now be replaced
      // with the "Request review again"/cancel affordance, since a pending
      // request already exists.
      await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
      await page.waitForLoadState("networkidle");
      await expect(
        page.getByTestId("review-status-banner-pending")
      ).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByTestId("request-review-button")).toHaveCount(0);
    });
  });
});
