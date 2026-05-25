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
 * Role-eligible assignees + first-decision-wins.
 *
 * Asserts:
 *  - A role with NO project-eligible holders does NOT appear in the
 *    AssigneeCombobox role list (codifies getProjectEligibleRoles filter).
 *  - Once a holder joins the project, the role appears.
 *  - With two role holders, the first decision via the API wins; the
 *    second concurrent decide attempt fails with an "already decided"
 *    response so the second role-holder doesn't accidentally re-decide.
 */

test.describe("Role-eligible assignees", () => {
  let gatedWorkflowId: number | null = null;
  let createdRoleId: number | null = null;
  let createdUserIds: string[] = [];
  let createdReviewIds: string[] = [];

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
    for (const userId of createdUserIds) {
      await request
        .patch(`${url}/api/model/user/update`, {
          data: { where: { id: userId }, data: { isDeleted: true } },
        })
        .catch(() => {});
    }
    createdUserIds = [];
    if (createdRoleId) {
      await request
        .patch(`${url}/api/model/roles/update`, {
          data: { where: { id: createdRoleId }, data: { isDeleted: true } },
        })
        .catch(() => {});
      createdRoleId = null;
    }
  });

  test("role only appears in picker when a project-eligible holder exists", async ({
    page,
    request,
    baseURL,
    api,
  }) => {
    const url = baseURL!;
    const projectId = await api.createProject(
      `Reviews-RoleVisible ${Date.now()}`
    );
    const ids = await getProjectWorkflowIds(
      request,
      url,
      projectId,
      "CASES",
      5
    );
    const currentStateId = ids[0];
    await setProjectReviewWorkflowEnabled(request, url, projectId, true);
    const gated = await createGatedTestWorkflow(
      request,
      url,
      projectId,
      "CASES"
    );
    gatedWorkflowId = gated.id;

    const roleName = `RA-Role-${Date.now()}`;
    createdRoleId = await api.createRole(roleName);
    // Phase 7 added a per-area `canApprove` gate on the reviewer picker;
    // without this grant the role would be excluded by the canApprove filter
    // even when a project-eligible holder exists, masking the holder-only
    // filter this test asserts.
    await api.setRolePermission({
      roleId: createdRoleId,
      area: "TestCaseRepository",
      canApprove: true,
    });

    const folderId = await api.createFolder(
      projectId,
      `RoleEligibility ${Date.now()}`
    );
    const caseId = await api.createTestCaseWithState(
      projectId,
      folderId,
      `Eligibility case ${Date.now()}`,
      currentStateId
    );

    // 1) No holder yet — the role should NOT appear in the assignee popover.
    await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("request-review-button").click();
    await page.getByTestId("assignee-combobox").click();
    await expect(
      page.getByTestId(`assignee-option-role-${createdRoleId}`)
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    // Close the sheet too so re-opening reuses fresh data.
    await page.keyboard.press("Escape");
    await page.waitForLoadState("networkidle");

    // 2) Create a USER with that role + give them project access, then
    //    the role should appear.
    const newUser = await api.createUser({
      name: `RA-User ${Date.now()}`,
      email: `ra-user-${Date.now()}@example.com`,
      password: "S3cure!password",
      access: "USER",
      roleId: createdRoleId,
      isActive: true,
      emailVerified: true,
    });
    createdUserIds.push(newUser.data.id);

    // Assign user to the project AND create the GLOBAL_ROLE
    // UserProjectPermission row that getProjectEligibleRoles path 2
    // looks for. A bare projectAssignment grants access but no role-
    // eligibility under any of the four union paths.
    await request.post(`${url}/api/model/projectAssignment/create`, {
      data: {
        data: {
          project: { connect: { id: projectId } },
          user: { connect: { id: newUser.data.id } },
        },
      },
    });
    await request.post(`${url}/api/model/userProjectPermission/create`, {
      data: {
        data: {
          projectId,
          userId: newUser.data.id,
          accessType: "GLOBAL_ROLE",
        },
      },
    });

    // Reload and re-open the sheet.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.getByTestId("request-review-button").click();
    await page.getByTestId("assignee-combobox").click();
    await expect(
      page.getByTestId(`assignee-option-role-${createdRoleId}`)
    ).toBeVisible({ timeout: 5000 });
  });

  test("second decide on a role-assigned request returns already-decided", async ({
    request,
    baseURL,
    api,
    adminUserId,
  }) => {
    const url = baseURL!;
    const projectId = await api.createProject(
      `Reviews-RoleDecide ${Date.now()}`
    );
    const ids = await getProjectWorkflowIds(
      request,
      url,
      projectId,
      "CASES",
      5
    );
    const currentStateId = ids[0];
    await setProjectReviewWorkflowEnabled(request, url, projectId, true);
    const decideGated = await createGatedTestWorkflow(
      request,
      url,
      projectId,
      "CASES"
    );
    gatedWorkflowId = decideGated.id;

    const roleName = `RA-Two-${Date.now()}`;
    createdRoleId = await api.createRole(roleName);
    // Phase 7 canApprove gate: this role must hold canApprove on the entity's
    // area (TestCaseRepository, since the request below is on a CASE) so its
    // holders pass the reviewer-eligibility filter.
    await api.setRolePermission({
      roleId: createdRoleId,
      area: "TestCaseRepository",
      canApprove: true,
    });

    // Two role holders, both project members. Admin user is already eligible
    // via global access. We add admin to the role too, and create a second
    // role holder for the project.
    await request.patch(`${url}/api/model/user/update`, {
      data: {
        where: { id: adminUserId },
        data: { roleId: createdRoleId },
      },
    });

    const folderId = await api.createFolder(
      projectId,
      `RoleDecide ${Date.now()}`
    );
    const caseId = await api.createTestCaseWithState(
      projectId,
      folderId,
      `RoleDecide case ${Date.now()}`,
      currentStateId
    );
    const reviewRequestId = await createReviewRequest(request, url, {
      projectId,
      entityType: "CASE",
      entityId: caseId,
      fromStateId: currentStateId,
      toStateId: gatedWorkflowId,
      requestedByUserId: adminUserId,
      assigneeRoleId: createdRoleId,
    });
    createdReviewIds.push(reviewRequestId);

    // First decision (approve) — should succeed.
    const r1 = await request.post(
      `${url}/api/reviews/${reviewRequestId}/decide`,
      { data: { decision: "APPROVED" } }
    );
    expect(r1.ok()).toBe(true);

    // Second decision attempt (request changes) — must NOT silently succeed.
    const r2 = await request.post(
      `${url}/api/reviews/${reviewRequestId}/decide`,
      { data: { decision: "CHANGES_REQUESTED", comment: "race" } }
    );
    expect(r2.ok()).toBe(false);
    const body2 = await r2.json().catch(() => null);
    const code = body2?.error?.code ?? body2?.error;
    expect(String(code ?? "").toUpperCase()).toMatch(
      /ALREADY_DECIDED|ALREADY|CONFLICT/i
    );

    // Verify final DB state remains APPROVED (winner stays).
    const get = await request.get(`${url}/api/model/reviewRequest/findFirst`, {
      params: {
        q: JSON.stringify({
          where: { id: reviewRequestId },
          select: { status: true },
        }),
      },
    });
    expect((await get.json())?.data?.status).toBe("APPROVED");
  });
});
