import type { APIRequestContext, BrowserContext } from "@playwright/test";

import { expect, stubLiveStreams, test } from "../../fixtures";
import type { ApiHelper } from "../../fixtures/api.fixture";
import { signInSecondaryContext } from "../../utils/secondary-context-login";
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
 * Pending reviews on the home dashboard.
 *
 * The header badge and /reviews were the only places a review request
 * announced itself; the dashboard — the page people land on — now lists the
 * queue at the top of "Your Assignments". This spec codifies that surface:
 *
 *  - A pending request assigned to the viewer renders a row, and its presence
 *    alone is enough to keep the "nothing needs attention" empty state away
 *    (the reviewer has no runs or sessions of their own here).
 *  - The row links to the entity, where the decision cluster lives.
 *  - Deciding the request drops the row and the card falls back to the empty
 *    state.
 *  - Past five requests the list caps and defers to the inbox.
 *
 * Every test signs in as a purpose-built reviewer rather than the shared admin.
 * The dashboard queue is "every pending request assigned to me" with no project
 * scoping, so an admin-assigned request seeded by a concurrently running review
 * spec would land in the same list and make row-count assertions flaky.
 */

const REVIEWER_PASSWORD = "S3cure!password";

test.describe("Dashboard pending reviews", () => {
  const createdWorkflowIds: number[] = [];
  const createdReviewIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdRoleIds: number[] = [];
  const openedContexts: BrowserContext[] = [];

  test.afterEach(async ({ request, baseURL }) => {
    const url = baseURL!;
    while (openedContexts.length) {
      await openedContexts
        .pop()
        ?.close()
        .catch(() => {});
    }
    while (createdReviewIds.length) {
      const id = createdReviewIds.pop();
      if (id) await deleteReviewRequest(request, url, id);
    }
    while (createdWorkflowIds.length) {
      const id = createdWorkflowIds.pop();
      if (id) await softDeleteWorkflow(request, url, id);
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
    while (createdRoleIds.length) {
      const id = createdRoleIds.pop();
      if (id) {
        await request
          .patch(`${url}/api/model/roles/update`, {
            data: { where: { id }, data: { isDeleted: true } },
          })
          .catch(() => {});
      }
    }
  });

  /**
   * Build a review-gated project plus a reviewer who can act in it: a role
   * carrying canApprove on the repository area, a GLOBAL_ROLE project
   * permission (what makes the role count as project-eligible), and a plain
   * project assignment so the reviewer can read the cases they're reviewing.
   */
  async function setupReviewerAndProject(
    request: APIRequestContext,
    url: string,
    api: ApiHelper,
    label: string
  ) {
    const projectId = await api.createProject(`Reviews-Dash ${label}`);
    const stateIds = await getProjectWorkflowIds(
      request,
      url,
      projectId,
      "CASES",
      5
    );
    const currentStateId = stateIds[0];
    await setProjectReviewWorkflowEnabled(request, url, projectId, true);
    const gated = await createGatedTestWorkflow(
      request,
      url,
      projectId,
      "CASES"
    );
    createdWorkflowIds.push(gated.id);

    const roleId = await api.createRole(`Dash-Reviewer-${label}`);
    createdRoleIds.push(roleId);
    await api.setRolePermission({
      roleId,
      area: "TestCaseRepository",
      canApprove: true,
    });

    const email = `dash-reviewer-${label}@example.com`;
    const reviewer = await api.createUser({
      name: `Dash Reviewer ${label}`,
      email,
      password: REVIEWER_PASSWORD,
      access: "USER",
      roleId,
      isActive: true,
      emailVerified: true,
    });
    createdUserIds.push(reviewer.data.id);

    // Signup seeds a UserPreferences row with the first-run setup flag off, so
    // a fresh reviewer lands on the dashboard behind InitialPreferencesDialog.
    // Its overlay covers the card: assertions still resolve (the nodes are
    // rendered and visible) but every click is swallowed. Mark the setup done
    // so the test drives the dashboard rather than the onboarding modal.
    await request
      .patch(`${url}/api/model/userPreferences/update`, {
        data: {
          where: { userId: reviewer.data.id },
          data: { hasCompletedInitialPreferencesSetup: true },
        },
      })
      .catch(() => {});

    await request.post(`${url}/api/model/projectAssignment/create`, {
      data: {
        data: {
          project: { connect: { id: projectId } },
          user: { connect: { id: reviewer.data.id } },
        },
      },
    });
    await request.post(`${url}/api/model/userProjectPermission/create`, {
      data: {
        data: {
          projectId,
          userId: reviewer.data.id,
          accessType: "GLOBAL_ROLE",
        },
      },
    });

    const folderId = await api.createFolder(projectId, `Dash-Reviews ${label}`);

    return {
      projectId,
      currentStateId,
      gatedStateId: gated.id,
      folderId,
      reviewerId: reviewer.data.id,
      reviewerEmail: email,
    };
  }

  test("pending review shows on the dashboard, links to the entity, and clears once decided", async ({
    browser,
    request,
    baseURL,
    api,
    adminUserId,
  }) => {
    const url = baseURL!;
    const label = `${Date.now()}`;
    let ctx: BrowserContext | undefined;
    let projectId = 0;
    let caseId = 0;
    let reviewId = "";
    const caseName = `Dashboard review case ${label}`;

    await test.step("Seed a gated project, a reviewer, and a pending request", async () => {
      const setup = await setupReviewerAndProject(request, url, api, label);
      projectId = setup.projectId;

      caseId = await api.createTestCaseWithState(
        projectId,
        setup.folderId,
        caseName,
        setup.currentStateId
      );

      reviewId = await createReviewRequest(request, url, {
        projectId,
        entityType: "CASE",
        entityId: caseId,
        fromStateId: setup.currentStateId,
        toStateId: setup.gatedStateId,
        requestedByUserId: adminUserId,
        assigneeUserId: setup.reviewerId,
      });
      createdReviewIds.push(reviewId);

      ctx = await signInSecondaryContext(
        browser,
        url,
        setup.reviewerEmail,
        REVIEWER_PASSWORD
      );
      openedContexts.push(ctx);
    });

    const page = await ctx!.newPage();
    await stubLiveStreams(page);

    await test.step("Dashboard lists the request instead of the empty state", async () => {
      await page.goto(`${url}/en-US`);
      await page.waitForLoadState("networkidle");

      await expect(page.getByTestId("dashboard-pending-reviews")).toBeVisible({
        timeout: 15000,
      });
      // The reviewer owns no runs or sessions, so before this surface existed
      // the card rendered "nothing needs attention" and the request was
      // invisible here. That empty state must now be gone.
      await expect(page.getByTestId("no-items-message")).toHaveCount(0);
      await expect(
        page.getByTestId("dashboard-pending-reviews-count")
      ).toHaveText("1 Review");

      const row = page.getByTestId(`dashboard-pending-review-${reviewId}`);
      await expect(row).toBeVisible();
      await expect(row).toContainText(caseName);
      // Fewer than the cap, so no deferral to the inbox.
      await expect(
        page.getByTestId("dashboard-pending-reviews-view-all")
      ).toHaveCount(0);
    });

    await test.step("Row links to the case, where the decision cluster lives", async () => {
      await page
        .getByTestId(`dashboard-pending-review-${reviewId}`)
        .getByText(caseName)
        .click();

      await page.waitForURL(
        new RegExp(`/projects/repository/${projectId}/${caseId}`),
        { timeout: 15000 }
      );
      await expect(
        page.getByTestId("review-status-banner-pending")
      ).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId("review-approve-button")).toBeVisible();
    });

    await test.step("Deciding the request drops the row from the dashboard", async () => {
      await decideReviewRequest(
        request,
        url,
        reviewId,
        "APPROVED",
        "Looks good."
      );

      await page.goto(`${url}/en-US`);
      await page.waitForLoadState("networkidle");

      await expect(page.getByTestId("dashboard-pending-reviews")).toHaveCount(
        0,
        { timeout: 15000 }
      );
      await expect(page.getByTestId("no-items-message")).toBeVisible({
        timeout: 15000,
      });
    });

    await page.close();
  });

  test("queue caps at five rows and defers the rest to the inbox", async ({
    browser,
    request,
    baseURL,
    api,
    adminUserId,
  }) => {
    const url = baseURL!;
    const label = `cap-${Date.now()}`;
    let ctx: BrowserContext | undefined;

    await test.step("Seed seven pending requests for one reviewer", async () => {
      const setup = await setupReviewerAndProject(request, url, api, label);

      // One request per case — a second pending request on the same entity is
      // rejected by design, so each needs its own case.
      for (let i = 0; i < 7; i++) {
        const caseId = await api.createTestCaseWithState(
          setup.projectId,
          setup.folderId,
          `Dashboard cap case ${label}-${i}`,
          setup.currentStateId
        );
        const reviewId = await createReviewRequest(request, url, {
          projectId: setup.projectId,
          entityType: "CASE",
          entityId: caseId,
          fromStateId: setup.currentStateId,
          toStateId: setup.gatedStateId,
          requestedByUserId: adminUserId,
          assigneeUserId: setup.reviewerId,
        });
        createdReviewIds.push(reviewId);
      }

      ctx = await signInSecondaryContext(
        browser,
        url,
        setup.reviewerEmail,
        REVIEWER_PASSWORD
      );
      openedContexts.push(ctx);
    });

    const page = await ctx!.newPage();
    await stubLiveStreams(page);

    await test.step("Five rows render, the heading counts all seven, and View All points at the inbox", async () => {
      await page.goto(`${url}/en-US`);
      await page.waitForLoadState("networkidle");

      await expect(page.getByTestId("dashboard-pending-reviews")).toBeVisible({
        timeout: 15000,
      });
      await expect(
        page.getByTestId("dashboard-pending-reviews-count")
      ).toHaveText("7 Reviews");
      await expect(
        page.locator('[data-testid^="dashboard-pending-review-"]')
      ).toHaveCount(5);

      const viewAll = page.getByTestId("dashboard-pending-reviews-view-all");
      await expect(viewAll).toBeVisible();
      await viewAll.click();
      await page.waitForURL(/\/reviews/, { timeout: 15000 });
      await expect(page.getByTestId("reviews-inbox-page")).toBeVisible({
        timeout: 15000,
      });
    });

    await page.close();
  });
});
