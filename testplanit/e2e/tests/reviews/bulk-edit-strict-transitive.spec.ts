import type { APIRequestContext, BrowserContext } from "@playwright/test";

import { expect, test } from "../../fixtures";
import type { ApiHelper } from "../../fixtures/api.fixture";
import { clickOverflowAction } from "../../utils/action-overflow";
import {
  createGatedTestWorkflow,
  createReviewRequest,
  deleteReviewRequest,
  decideReviewRequest,
  getProjectWorkflowIds,
  setProjectReviewWorkflowEnabled,
  signInGateActor,
  softDeleteWorkflow,
} from "./helpers";

/**
 * Shared setup for the mixed-selection scenarios: a project with review
 * enabled and two strictly-ordered gates (gateA.order < gateB.order) plus a
 * NON-gated state parked between them. The mid state lets a case sit ABOVE
 * gateA without having had to cross it (no seeded state ranks that high), so
 * the specs can exercise "already past the gate" and "moving backward" cases.
 */
async function setupMixedGateProject(
  request: APIRequestContext,
  url: string,
  api: ApiHelper,
  gatedWorkflowIds: number[]
) {
  const projectId = await api.createProject(
    `Reviews-BulkGateMix ${Date.now()}`
  );
  const ids = await getProjectWorkflowIds(request, url, projectId, "CASES", 5);
  const currentStateId = ids[0]!;
  await setProjectReviewWorkflowEnabled(request, url, projectId, true);

  const gateA = await createGatedTestWorkflow(
    request,
    url,
    projectId,
    "CASES",
    {
      orderOffset: 1000,
    }
  );
  const mid = await createGatedTestWorkflow(request, url, projectId, "CASES", {
    requiresReview: false,
    orderOffset: 1500,
  });
  const gateB = await createGatedTestWorkflow(
    request,
    url,
    projectId,
    "CASES",
    {
      orderOffset: 2000,
    }
  );
  gatedWorkflowIds.push(gateA.id, mid.id, gateB.id);

  const folderId = await api.createFolder(
    projectId,
    `BulkGateMix ${Date.now()}`
  );
  return { projectId, currentStateId, gateA, mid, gateB, folderId };
}

/**
 * Bulk-edit + strict transitive gating.
 *
 * Asserts:
 *  - With two gated states ordered current → A → B, attempting a bulk
 *    transition to B from current (skipping A) withholds the plain Save and
 *    surfaces a list of case NAMES (not numeric ids) in the inline error.
 *  - While blocked, Save is replaced by "Save & request review", which opens
 *    the bulk assignee sheet listing the FIRST blocking gate (A) — the way
 *    out of the block rather than a dead end.
 *  - An approval for state B alone does NOT satisfy gate A — the plain Save
 *    stays withheld until BOTH gates are approved for the affected cases
 *    (strict transitive).
 */

test.describe("Bulk-edit strict transitive gating", () => {
  const gatedWorkflowIds: number[] = [];
  const createdReviewIds: string[] = [];
  const createdUserIds: string[] = [];
  // Gate blocking only applies to non-admins (system ADMINs bypass), so each
  // test drives the UI through a signed-in PROJECTADMIN context.
  const actorContexts: BrowserContext[] = [];

  test.afterEach(async ({ request, baseURL }) => {
    const url = baseURL!;
    while (actorContexts.length) {
      await actorContexts
        .pop()
        ?.close()
        .catch(() => {});
    }
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
    browser,
    request,
    baseURL,
    api,
    adminUserId,
  }) => {
    const url = baseURL!;
    let projectId: number | undefined;
    let currentStateId: number | undefined;
    let gateAId: number | undefined;
    let gateBId: number | undefined;
    let gateAName: string | undefined;
    let gateBName: string | undefined;
    let requesterId: string | undefined;
    let caseName1: string | undefined;
    let caseName2: string | undefined;
    let caseId1: number | undefined;
    let caseId2: number | undefined;

    await test.step("Create project and resolve its case workflow states", async () => {
      projectId = await api.createProject(`Reviews-BulkGate ${Date.now()}`);
      const ids = await getProjectWorkflowIds(
        request,
        url,
        projectId,
        "CASES",
        5
      );
      expect(ids.length).toBeGreaterThanOrEqual(1);
      currentStateId = ids[0];
    });

    await test.step("Enable review workflow and create two strictly-ordered gated states", async () => {
      await setProjectReviewWorkflowEnabled(request, url, projectId!, true);
      // Two dedicated gated workflows with strict ordering: gateA before
      // gateB so the page predicate `order > currentStateOrder` accepts both,
      // and the case-page filter treats A as the FIRST blocking gate when
      // jumping to B.
      const gateA = await createGatedTestWorkflow(
        request,
        url,
        projectId!,
        "CASES",
        { orderOffset: 1000 }
      );
      const gateB = await createGatedTestWorkflow(
        request,
        url,
        projectId!,
        "CASES",
        { orderOffset: 2000 }
      );
      gateAId = gateA.id;
      gateBId = gateB.id;
      gateAName = gateA.name;
      gateBName = gateB.name;
      gatedWorkflowIds.push(gateAId, gateBId);
    });

    await test.step("Seed a separate requester user", async () => {
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
      requesterId = requester.data.id;
    });

    // Sign the actor in AFTER the project exists: the accessible-project
    // resolution is cached for 60s per user, so a session established before
    // the project's creation would not see it for the rest of the test.
    const { context: actorContext, userId: actorUserId } =
      await signInGateActor(browser, request, url, api, createdUserIds);
    actorContexts.push(actorContext);
    const page = await actorContext.newPage();

    await test.step("Grant the actor explicit project membership", async () => {
      // ReviewRequest reads are restricted to requester/assignee/decider,
      // explicit user/group permissions, or system ADMIN — default-access
      // (GLOBAL_ROLE) reach is deliberately not enough. Without this row the
      // actor cannot SEE the gate approvals seeded below, and the final
      // "Save returns once both gates are approved" assertion would stay
      // blocked forever.
      const permRes = await request.post(
        `${url}/api/model/userProjectPermission/create`,
        {
          data: {
            data: {
              userId: actorUserId,
              projectId: projectId!,
              accessType: "GLOBAL_ROLE",
            },
          },
        }
      );
      expect(permRes.ok()).toBe(true);
    });

    await test.step("Seed a folder and two cases in the current state", async () => {
      const folderId = await api.createFolder(
        projectId!,
        `BulkGate ${Date.now()}`
      );
      caseName1 = `Bulk-A ${Date.now()}`;
      caseName2 = `Bulk-B ${Date.now()}`;
      caseId1 = await api.createTestCaseWithState(
        projectId!,
        folderId,
        caseName1,
        currentStateId!
      );
      caseId2 = await api.createTestCaseWithState(
        projectId!,
        folderId,
        caseName2,
        currentStateId!
      );

      // Open repository at the folder our seeded cases live in. Absolute URL:
      // the actor context does not inherit the config baseURL.
      await page.goto(
        `${url}/en-US/projects/repository/${projectId}/?node=${folderId}`
      );
      await page.waitForLoadState("networkidle");
    });

    await test.step("Select both cases and open Bulk Edit", async () => {
      // Use the case rows (search by name to be robust against ordering).
      const row1 = page
        .getByRole("row", { name: new RegExp(caseName1!) })
        .first();
      const row2 = page
        .getByRole("row", { name: new RegExp(caseName2!) })
        .first();
      await expect(row1).toBeVisible({ timeout: 10000 });
      await expect(row2).toBeVisible({ timeout: 10000 });
      await row1.getByRole("checkbox").first().click();
      await row2.getByRole("checkbox").first().click();

      // Trigger Bulk Edit from the selection bar (kebab-aware).
      await clickOverflowAction(page, "bulk-edit-button", "cases-actions-menu");
    });

    await test.step("Pick gate B as the target state, skipping gate A", async () => {
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

      // Inline summary appears: a heading naming the FIRST blocking gate
      // (gate A), then one truncated bullet per blocked case name. Truncation
      // is CSS-only, so the full name stays in the DOM for these assertions.
      const inlineMsg = dialog.getByTestId("bulk-gate-blocked-summary");
      await expect(inlineMsg).toBeVisible({ timeout: 5000 });
      await expect(inlineMsg).toContainText(new RegExp(gateAName!, "i"));
      const bullets = inlineMsg.getByRole("listitem");
      await expect(bullets.filter({ hasText: caseName1! })).toHaveCount(1);
      await expect(bullets.filter({ hasText: caseName2! })).toHaveCount(1);

      // The plain Save is withheld while the gate blocks the transition —
      // it is replaced by the request-review affordance, not merely disabled.
      await expect(dialog.getByRole("button", { name: /^save$/i })).toHaveCount(
        0
      );
      const requestBtn = dialog.getByTestId(
        "bulk-edit-save-and-request-review"
      );
      await expect(requestBtn).toBeEnabled();

      await dialog.getByRole("button", { name: /cancel/i }).click();
    });

    await test.step("Save & request review opens the sheet listing the first blocking gate", async () => {
      // Re-open and repeat the state pick, then check the request path is
      // reachable and describes gate A (the FIRST blocker), not gate B.
      await page.reload();
      await page.waitForLoadState("networkidle");
      await page
        .getByRole("row", { name: new RegExp(caseName1!) })
        .first()
        .getByRole("checkbox")
        .first()
        .click();
      await clickOverflowAction(page, "bulk-edit-button", "cases-actions-menu");
      const dialog = page.locator('[role="dialog"]').first();
      await expect(dialog).toBeVisible({ timeout: 5000 });
      await dialog.locator("#edit-state").click();
      await dialog.locator('[role="combobox"]').first().click();
      await page
        .getByRole("option")
        .filter({ hasText: new RegExp(`^${gateBName}$`, "i") })
        .first()
        .click();

      await dialog.getByTestId("bulk-edit-save-and-request-review").click();

      const sheet = page.getByTestId("bulk-request-review-sheet");
      await expect(sheet).toBeVisible({ timeout: 5000 });
      // One breakdown row, naming gate A — the transition crosses A before B,
      // so A is what the request must target.
      await expect(
        sheet.getByTestId(`bulk-request-review-breakdown-${gateAId}`)
      ).toBeVisible();
      await expect(
        sheet.getByTestId(`bulk-request-review-breakdown-${gateBId}`)
      ).toHaveCount(0);

      await sheet.getByRole("button", { name: /cancel/i }).click();
      await page
        .locator('[role="dialog"]')
        .first()
        .getByRole("button", { name: /cancel/i })
        .click();
    });

    await test.step("Approve only gate B for both cases", async () => {
      // ----- Strict transitive check via API -----
      // Approve ONLY gate B for both cases. Save should stay disabled because
      // gate A still has no approval.
      for (const caseId of [caseId1!, caseId2!]) {
        const id = await createReviewRequest(request, url, {
          projectId: projectId!,
          entityType: "CASE",
          entityId: caseId,
          fromStateId: currentStateId!,
          toStateId: gateBId!,
          requestedByUserId: requesterId!,
          assigneeUserId: adminUserId,
        });
        createdReviewIds.push(id);
        await decideReviewRequest(request, url, id, "APPROVED");
      }
    });

    let dialog2: ReturnType<typeof page.locator> | undefined;

    await test.step("Re-open bulk edit and confirm Save stays withheld with only gate B approved", async () => {
      // Re-open bulk edit, repeat the state pick — still blocked.
      await page.reload();
      await page.waitForLoadState("networkidle");
      await page
        .getByRole("row", { name: new RegExp(caseName1!) })
        .first()
        .getByRole("checkbox")
        .first()
        .click();
      await page
        .getByRole("row", { name: new RegExp(caseName2!) })
        .first()
        .getByRole("checkbox")
        .first()
        .click();
      await clickOverflowAction(page, "bulk-edit-button", "cases-actions-menu");
      dialog2 = page.locator('[role="dialog"]').first();
      await expect(dialog2).toBeVisible();
      await dialog2.locator("#edit-state").click();
      await dialog2.locator('[role="combobox"]').first().click();
      await page
        .getByRole("option")
        .filter({ hasText: new RegExp(`^${gateBName}$`, "i") })
        .first()
        .click();
      // Gate A is still unapproved, so the plain Save is still withheld in
      // favour of the request-review affordance.
      await expect(
        dialog2.getByRole("button", { name: /^save$/i })
      ).toHaveCount(0);
      await expect(
        dialog2.getByTestId("bulk-edit-save-and-request-review")
      ).toBeVisible();
    });

    await test.step("Approve gate A for both cases", async () => {
      // Approve gate A as well — now Save must be enabled.
      for (const caseId of [caseId1!, caseId2!]) {
        const id = await createReviewRequest(request, url, {
          projectId: projectId!,
          entityType: "CASE",
          entityId: caseId,
          fromStateId: currentStateId!,
          toStateId: gateAId!,
          requestedByUserId: requesterId!,
          assigneeUserId: adminUserId,
        });
        createdReviewIds.push(id);
        await decideReviewRequest(request, url, id, "APPROVED");
      }
    });

    await test.step("Re-open bulk edit and confirm Save is now enabled with both gates approved", async () => {
      // Close and re-open to refetch the cached gate hook.
      await dialog2!.getByRole("button", { name: /cancel/i }).click();
      await page.reload();
      await page.waitForLoadState("networkidle");
      await page
        .getByRole("row", { name: new RegExp(caseName1!) })
        .first()
        .getByRole("checkbox")
        .first()
        .click();
      await page
        .getByRole("row", { name: new RegExp(caseName2!) })
        .first()
        .getByRole("checkbox")
        .first()
        .click();
      await clickOverflowAction(page, "bulk-edit-button", "cases-actions-menu");
      const dialog3 = page.locator('[role="dialog"]').first();
      await dialog3.locator("#edit-state").click();
      await dialog3.locator('[role="combobox"]').first().click();
      await page
        .getByRole("option")
        .filter({ hasText: new RegExp(`^${gateBName}$`, "i") })
        .first()
        .click();
      // Both gates approved — the plain Save returns and is actionable.
      await expect(
        dialog3.getByRole("button", { name: /^save$/i })
      ).toBeEnabled({
        timeout: 5000,
      });
      await expect(
        dialog3.getByTestId("bulk-edit-save-and-request-review")
      ).toHaveCount(0);
    });
  });

  test("mixed-gate selection groups the blocked cases under each gate", async ({
    browser,
    request,
    baseURL,
    api,
  }) => {
    const url = baseURL!;
    const { projectId, currentStateId, gateA, mid, gateB, folderId } =
      await setupMixedGateProject(request, url, api, gatedWorkflowIds);
    // Sign in after the project exists — see the 60s cache note in test 1.
    const { context: actorContext } = await signInGateActor(
      browser,
      request,
      url,
      api,
      createdUserIds
    );
    actorContexts.push(actorContext);
    const page = await actorContext.newPage();

    // Two cases sitting at different heights, both aimed at gateB:
    //   - low  (before gateA) is blocked on gateA — its FIRST gate.
    //   - mid  (past gateA, at the non-gated mid state) is blocked on gateB.
    // So one bulk action is blocked across two different gates.
    const nameLow = `Mix-Low ${Date.now()}`;
    const nameMid = `Mix-Mid ${Date.now()}`;
    // The create-time remap rewrites any state at-or-beyond a gate down to
    // the project default while gating is active, so park the flag off while
    // positioning the fixture cases past the gates, then re-enable it.
    await setProjectReviewWorkflowEnabled(request, url, projectId, false);
    await api.createTestCaseWithState(
      projectId,
      folderId,
      nameLow,
      currentStateId
    );
    await api.createTestCaseWithState(projectId, folderId, nameMid, mid.id);
    await setProjectReviewWorkflowEnabled(request, url, projectId, true);

    await page.goto(
      `${url}/en-US/projects/repository/${projectId}/?node=${folderId}`
    );
    await page.waitForLoadState("networkidle");
    for (const nm of [nameLow, nameMid]) {
      await page
        .getByRole("row", { name: new RegExp(nm) })
        .first()
        .getByRole("checkbox")
        .first()
        .click();
    }
    await clickOverflowAction(page, "bulk-edit-button", "cases-actions-menu");

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.locator("#edit-state").click();
    await dialog.locator('[role="combobox"]').first().click();
    await page
      .getByRole("option")
      .filter({ hasText: new RegExp(`^${gateB.name}$`, "i") })
      .first()
      .click();

    // Blocked across two gates → gate-agnostic heading, one sub-group per gate,
    // each case bulleted under the gate it actually needs.
    const summary = dialog.getByTestId("bulk-gate-blocked-summary");
    await expect(summary).toBeVisible({ timeout: 5000 });
    await expect(summary).toContainText(
      /need approval before this transition/i
    );
    await expect(summary).toContainText(new RegExp(gateA.name, "i"));
    await expect(summary).toContainText(new RegExp(gateB.name, "i"));
    const bullets = summary.getByRole("listitem");
    await expect(bullets.filter({ hasText: nameLow })).toHaveCount(1);
    await expect(bullets.filter({ hasText: nameMid })).toHaveCount(1);

    // Save gives way to the request affordance, and the sheet breaks the
    // selection down into the same two gates.
    await expect(dialog.getByRole("button", { name: /^save$/i })).toHaveCount(
      0
    );
    await dialog.getByTestId("bulk-edit-save-and-request-review").click();
    const sheet = page.getByTestId("bulk-request-review-sheet");
    await expect(sheet).toBeVisible({ timeout: 5000 });
    await expect(
      sheet.getByTestId(`bulk-request-review-breakdown-${gateA.id}`)
    ).toBeVisible();
    await expect(
      sheet.getByTestId(`bulk-request-review-breakdown-${gateB.id}`)
    ).toBeVisible();
  });

  test("a backward-moving case is excluded from the blocked set", async ({
    browser,
    request,
    baseURL,
    api,
  }) => {
    const url = baseURL!;
    const { projectId, currentStateId, gateA, mid, folderId } =
      await setupMixedGateProject(request, url, api, gatedWorkflowIds);
    // Sign in after the project exists — see the 60s cache note in test 1.
    const { context: actorContext } = await signInGateActor(
      browser,
      request,
      url,
      api,
      createdUserIds
    );
    actorContexts.push(actorContext);
    const page = await actorContext.newPage();

    // Target gateA — a middle gate. The two cases straddle it:
    //   - fwd  (below gateA) crosses it going forward → blocked.
    //   - back (at the mid state, above gateA) moves backward into it → allowed,
    //     so it must NOT appear among the blocked cases.
    const nameFwd = `Dir-Fwd ${Date.now()}`;
    const nameBack = `Dir-Back ${Date.now()}`;
    // See above: position the cases with gating off so the create-time remap
    // does not pull nameBack down to the default state.
    await setProjectReviewWorkflowEnabled(request, url, projectId, false);
    await api.createTestCaseWithState(
      projectId,
      folderId,
      nameFwd,
      currentStateId
    );
    await api.createTestCaseWithState(projectId, folderId, nameBack, mid.id);
    await setProjectReviewWorkflowEnabled(request, url, projectId, true);

    await page.goto(
      `${url}/en-US/projects/repository/${projectId}/?node=${folderId}`
    );
    await page.waitForLoadState("networkidle");
    for (const nm of [nameFwd, nameBack]) {
      await page
        .getByRole("row", { name: new RegExp(nm) })
        .first()
        .getByRole("checkbox")
        .first()
        .click();
    }
    await clickOverflowAction(page, "bulk-edit-button", "cases-actions-menu");

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.locator("#edit-state").click();
    await dialog.locator('[role="combobox"]').first().click();
    await page
      .getByRole("option")
      .filter({ hasText: new RegExp(`^${gateA.name}$`, "i") })
      .first()
      .click();

    // Single gate, single blocked case: only the forward one. The backward
    // case is never named, and the heading counts 1 — not 2.
    const summary = dialog.getByTestId("bulk-gate-blocked-summary");
    await expect(summary).toBeVisible({ timeout: 5000 });
    await expect(summary).toContainText(/1 case blocked by gate/i);
    const bullets = summary.getByRole("listitem");
    await expect(bullets.filter({ hasText: nameFwd })).toHaveCount(1);
    await expect(bullets.filter({ hasText: nameBack })).toHaveCount(0);

    await expect(dialog.getByRole("button", { name: /^save$/i })).toHaveCount(
      0
    );
    await expect(
      dialog.getByTestId("bulk-edit-save-and-request-review")
    ).toBeVisible();
  });
});
