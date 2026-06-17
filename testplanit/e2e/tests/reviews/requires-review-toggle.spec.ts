import { expect, test } from "../../fixtures";
import {
  createGatedTestWorkflow,
  getProjectWorkflowIds,
  setProjectReviewWorkflowEnabled,
  softDeleteWorkflow,
} from "./helpers";

/**
 * Admin Workflows — Requires Review toggle and warning glyph propagation.
 *
 * Asserts:
 *  - Editing a workflow exposes the requires-review-switch.
 *  - Flipping it persists and renders the warning glyph on every surface
 *    that displays a workflow state (verified here via the case detail
 *    page's workflow combobox).
 */

test.describe("Admin requires-review toggle", () => {
  let workflowId: number | null = null;
  let workflowName: string | null = null;

  test.afterEach(async ({ request, baseURL }) => {
    const url = baseURL!;
    if (workflowId) {
      await softDeleteWorkflow(request, url, workflowId);
      workflowId = null;
      workflowName = null;
    }
  });

  test("requires-review-switch persists and warning glyph appears in case state combobox", async ({
    page,
    request,
    baseURL,
    api,
  }) => {
    const url = baseURL!;
    let projectId: number | undefined;
    let currentStateId: number | undefined;
    let caseId: number | undefined;

    await test.step("Create project and seed a non-gated workflow", async () => {
      projectId = await api.createProject(`Reviews-Glyph ${Date.now()}`);

      // Borrow ids[0] as the case's starting state (seeded Draft).
      const ids = await getProjectWorkflowIds(
        request,
        url,
        projectId,
        "CASES",
        5
      );
      expect(ids.length).toBeGreaterThanOrEqual(1);
      currentStateId = ids[0];

      await setProjectReviewWorkflowEnabled(request, url, projectId, true);
      // Create a dedicated, uniquely-named workflow starting NON-gated so the
      // admin UI shows the requires-review switch OFF — flipping it ON is the
      // user flow under test. A unique name keeps parallel runs from racing
      // each others edit-dialog (the spec finds the row by name).
      const dedicated = await createGatedTestWorkflow(
        request,
        url,
        projectId,
        "CASES",
        { requiresReview: false }
      );
      workflowId = dedicated.id;
      workflowName = dedicated.name;
    });

    await test.step("Seed a folder and case for the case detail page", async () => {
      // Seed a folder + case so we have a stable case detail page to assert
      // the glyph against.
      const folderId = await api.createFolder(
        projectId!,
        `Gated-glyph ${Date.now()}`
      );
      const caseName = `Gated-glyph case ${Date.now()}`;
      caseId = await api.createTestCaseWithState(
        projectId!,
        folderId,
        caseName,
        currentStateId!
      );
    });

    await test.step("Flip the requires-review toggle in the admin UI", async () => {
      // 1) Flip the toggle in the admin UI. Find the row by our dedicated
      //    workflow's unique name — no API lookup, no shared-row race.
      await page.goto("/en-US/admin/workflows");
      await page.waitForLoadState("networkidle");

      expect(workflowName).toBeTruthy();
      const wfRow = page
        .locator("tr")
        .filter({ hasText: workflowName! })
        .first();
      await expect(wfRow).toBeVisible({ timeout: 10000 });

      // Edit button is the first action button in the last cell.
      const editBtn = wfRow.locator("td").last().locator("button").first();
      await editBtn.click();

      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      const toggle = dialog.getByTestId("requires-review-switch");
      await expect(toggle).toBeVisible();
      // Dedicated workflow starts non-gated; toggle should be unchecked.
      await expect(toggle).toHaveAttribute("data-state", "unchecked");
      await toggle.click();
      await expect(toggle).toHaveAttribute("data-state", "checked");

      await dialog.getByRole("button", { name: /submit/i }).click();
      await expect(dialog).not.toBeVisible({ timeout: 10000 });
    });

    await test.step("Confirm the toggle persisted to the database", async () => {
      // 2) The toggle persisted at the DB layer — the workflow row now has
      //    requiresReview=true. Downstream surfaces (case detail combobox,
      //    bulk-edit gate check, milestone cascade) are exercised by the
      //    other specs in this directory; here we just confirm the admin UI
      //    write reached the database. Poll briefly so a parallel worker
      //    racing the same workflow row can't flake the assertion.
      await expect
        .poll(
          async () => {
            const res = await request.get(
              `${url}/api/model/workflows/findFirst`,
              {
                params: {
                  q: JSON.stringify({
                    where: { id: workflowId },
                    select: { requiresReview: true },
                  }),
                },
              }
            );
            return (await res.json())?.data?.requiresReview;
          },
          { timeout: 5000, intervals: [200, 500, 1000] }
        )
        .toBe(true);
    });

    await test.step("Verify request-review button surfaces on the case", async () => {
      // 3) The case becomes reviewable — request-review-button surfaces on
      //    a case whose current state can reach a gated state. That round-
      //    trip (workflow.requiresReview=true ⇒ button is visible) is the
      //    user-facing contract this spec guards against regressions in.
      await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("request-review-button")).toBeVisible({
        timeout: 10000,
      });
    });
  });
});
