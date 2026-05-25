import { expect, test } from "../../fixtures";
import {
  createGatedTestWorkflow,
  createReviewRequest,
  deleteReviewRequest,
  decideReviewRequest,
  getProjectWorkflowIds,
  setProjectReviewWorkflowEnabled,
  softDeleteWorkflow,
} from "./helpers";

/**
 * Bulk-edit + strict transitive gating.
 *
 * Asserts:
 *  - With two gated states ordered current → A → B, attempting a bulk
 *    transition to B from current (skipping A) blocks Save and surfaces
 *    a list of case NAMES (not numeric ids) in the inline error.
 *  - An approval for state B alone does NOT satisfy gate A — Save stays
 *    disabled until BOTH gates are approved for the affected cases
 *    (strict transitive).
 */

test.describe("Bulk-edit strict transitive gating", () => {
  const gatedWorkflowIds: number[] = [];
  const createdReviewIds: string[] = [];
  const createdUserIds: string[] = [];

  test.afterEach(async ({ request, baseURL }) => {
    const url = baseURL!;
    while (createdReviewIds.length) {
      const id = createdReviewIds.pop();
      if (id) await deleteReviewRequest(request, url, id);
    }
    while (gatedWorkflowIds.length) {
      const id = gatedWorkflowIds.pop();
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
  });

  test("bulk edit blocks Save with case-name inline summary and requires both gate approvals", async ({
    page,
    request,
    baseURL,
    api,
    adminUserId,
  }) => {
    const url = baseURL!;
    const projectId = await api.createProject(`Reviews-BulkGate ${Date.now()}`);
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
    // Two dedicated gated workflows with strict ordering: gateA before
    // gateB so the page predicate `order > currentStateOrder` accepts both,
    // and the case-page filter treats A as the FIRST blocking gate when
    // jumping to B.
    const gateA = await createGatedTestWorkflow(
      request,
      url,
      projectId,
      "CASES",
      { orderOffset: 1000 }
    );
    const gateB = await createGatedTestWorkflow(
      request,
      url,
      projectId,
      "CASES",
      { orderOffset: 2000 }
    );
    const gateAId = gateA.id;
    const gateBId = gateB.id;
    const gateAName = gateA.name;
    const gateBName = gateB.name;
    gatedWorkflowIds.push(gateAId, gateBId);

    // Separate requester so the schema "assignee != requester" validate doesn't
    // reject our seed requests.
    const requester = await api.createUser({
      name: `BG-Req ${Date.now()}`,
      email: `bg-req-${Date.now()}@example.com`,
      password: "S3cure!password",
      access: "USER",
      isActive: true,
      emailVerified: true,
    });
    createdUserIds.push(requester.data.id);
    const requesterId = requester.data.id;

    const folderId = await api.createFolder(
      projectId,
      `BulkGate ${Date.now()}`
    );
    const caseName1 = `Bulk-A ${Date.now()}`;
    const caseName2 = `Bulk-B ${Date.now()}`;
    const caseId1 = await api.createTestCaseWithState(
      projectId,
      folderId,
      caseName1,
      currentStateId
    );
    const caseId2 = await api.createTestCaseWithState(
      projectId,
      folderId,
      caseName2,
      currentStateId
    );

    // Open repository at the folder our seeded cases live in.
    await page.goto(
      `/en-US/projects/repository/${projectId}/?node=${folderId}`
    );
    await page.waitForLoadState("networkidle");

    // Use the case rows (search by name to be robust against ordering).
    const row1 = page.getByRole("row", { name: new RegExp(caseName1) }).first();
    const row2 = page.getByRole("row", { name: new RegExp(caseName2) }).first();
    await expect(row1).toBeVisible({ timeout: 10000 });
    await expect(row2).toBeVisible({ timeout: 10000 });
    await row1.getByRole("checkbox").first().click();
    await row2.getByRole("checkbox").first().click();

    // Trigger Bulk Edit from the selection bar.
    const bulkEditButton = page.getByRole("button", { name: /bulk edit/i });
    await bulkEditButton.click();

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Activate State editing by ticking its enable checkbox (id `edit-state`).
    // That toggle reveals the State Select inside the row.
    await dialog.locator("#edit-state").click();

    // The freshly-revealed Select is the only combobox in the State row.
    const stateCombo = dialog.locator('[role="combobox"]').first();
    await stateCombo.click();
    await page
      .getByRole("option")
      .filter({ hasText: new RegExp(`^${gateBName}$`, "i") })
      .first()
      .click();

    // Inline error appears with both case names (quoted) and the FIRST
    // blocking gate (gate A).
    const inlineMsg = dialog.locator("p.text-destructive").filter({
      hasText: new RegExp(gateAName, "i"),
    });
    await expect(inlineMsg).toBeVisible({ timeout: 5000 });
    await expect(inlineMsg).toContainText(caseName1);
    await expect(inlineMsg).toContainText(caseName2);

    // Save is disabled.
    const saveBtn = dialog.getByRole("button", { name: /save/i });
    await expect(saveBtn).toBeDisabled();

    await dialog.getByRole("button", { name: /cancel/i }).click();

    // ----- Strict transitive check via API -----
    // Approve ONLY gate B for both cases. Save should stay disabled because
    // gate A still has no approval.
    for (const caseId of [caseId1, caseId2]) {
      const id = await createReviewRequest(request, url, {
        projectId,
        entityType: "CASE",
        entityId: caseId,
        fromStateId: currentStateId,
        toStateId: gateBId,
        requestedByUserId: requesterId,
        assigneeUserId: adminUserId,
      });
      createdReviewIds.push(id);
      await decideReviewRequest(request, url, id, "APPROVED");
    }

    // Re-open bulk edit, repeat the state pick — still blocked.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page
      .getByRole("row", { name: new RegExp(caseName1) })
      .first()
      .getByRole("checkbox")
      .first()
      .click();
    await page
      .getByRole("row", { name: new RegExp(caseName2) })
      .first()
      .getByRole("checkbox")
      .first()
      .click();
    await page.getByRole("button", { name: /bulk edit/i }).click();
    const dialog2 = page.locator('[role="dialog"]').first();
    await expect(dialog2).toBeVisible();
    await dialog2.locator("#edit-state").click();
    await dialog2.locator('[role="combobox"]').first().click();
    await page
      .getByRole("option")
      .filter({ hasText: new RegExp(`^${gateBName}$`, "i") })
      .first()
      .click();
    await expect(dialog2.getByRole("button", { name: /save/i })).toBeDisabled();

    // Approve gate A as well — now Save must be enabled.
    for (const caseId of [caseId1, caseId2]) {
      const id = await createReviewRequest(request, url, {
        projectId,
        entityType: "CASE",
        entityId: caseId,
        fromStateId: currentStateId,
        toStateId: gateAId,
        requestedByUserId: requesterId,
        assigneeUserId: adminUserId,
      });
      createdReviewIds.push(id);
      await decideReviewRequest(request, url, id, "APPROVED");
    }

    // Close and re-open to refetch the cached gate hook.
    await dialog2.getByRole("button", { name: /cancel/i }).click();
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page
      .getByRole("row", { name: new RegExp(caseName1) })
      .first()
      .getByRole("checkbox")
      .first()
      .click();
    await page
      .getByRole("row", { name: new RegExp(caseName2) })
      .first()
      .getByRole("checkbox")
      .first()
      .click();
    await page.getByRole("button", { name: /bulk edit/i }).click();
    const dialog3 = page.locator('[role="dialog"]').first();
    await dialog3.locator("#edit-state").click();
    await dialog3.locator('[role="combobox"]').first().click();
    await page
      .getByRole("option")
      .filter({ hasText: new RegExp(`^${gateBName}$`, "i") })
      .first()
      .click();
    await expect(dialog3.getByRole("button", { name: /save/i })).toBeEnabled({
      timeout: 5000,
    });
  });
});
