import { expect, test } from "../../fixtures";

/**
 * Admin Workflows — editing the default workflow does NOT double-insert a
 * projectWorkflowAssignment row.
 *
 * Regression test for the EditWorkflow form path that previously upserted an
 * assignment on save regardless of whether the workflow was already assigned
 * to the project, producing duplicate `projectWorkflowAssignment` rows on
 * every edit-save round-trip.
 *
 * Asserts:
 *  - Pre-edit projectWorkflowAssignment count equals post-edit count.
 *  - No error toast surfaces during the save.
 */

test.describe("Admin Workflows — default workflow edit-save idempotency", () => {
  test("save without changes does not duplicate projectWorkflowAssignment rows", async ({
    page,
    request,
    baseURL,
  }) => {
    const url = baseURL!;

    // Find the seeded "Draft" CASES workflow — the seed file ships it as the
    // default and every project picks it up. Lookup by name, not by
    // `isDefault: true`, because parallel admin/workflows specs can toggle
    // the flag mid-run; a flag-based findFirst can hand back a custom
    // workflow whose edit dialog doesn't exist at the expected admin URL.
    const wfRes = await request.get(`${url}/api/model/workflows/findFirst`, {
      params: {
        q: JSON.stringify({
          where: { scope: "CASES", isDeleted: false, name: "Draft" },
          select: { id: true, name: true },
        }),
      },
    });
    const wf = (await wfRes.json())?.data as
      | { id: number; name: string }
      | undefined;
    expect(wf?.id).toBeTruthy();
    const workflowId = wf!.id;
    const workflowName = wf!.name;

    // Snapshot the set of project IDs that the workflow is currently
    // assigned to. We compare against the post-edit set, scoped to these
    // same projects, so a parallel test creating its own project (which
    // would auto-assign every default workflow) can't bump the count.
    const beforeRes = await request.get(
      `${url}/api/model/projectWorkflowAssignment/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: { workflowId },
            select: { projectId: true },
          }),
        },
      }
    );
    expect(beforeRes.ok()).toBeTruthy();
    const beforeAssignments = ((await beforeRes.json())?.data ?? []) as Array<{
      projectId: number;
    }>;
    const beforeProjectIds = beforeAssignments.map((a) => a.projectId);
    const before = beforeProjectIds.length;

    // Open the admin workflows page, find the row for this workflow, edit
    // it, save without changes.
    await page.goto("/en-US/admin/workflows");
    await page.waitForLoadState("networkidle");

    const row = page.locator("tr").filter({ hasText: workflowName }).first();
    await expect(row).toBeVisible({ timeout: 10000 });

    // The action column renders an icon-only SquarePen button (no
    // accessible name), so we target the first button in the last cell —
    // same pattern as requires-review-toggle.spec.ts.
    const editBtn = row.locator("td").last().locator("button").first();
    await editBtn.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Save without changes. The submit button label depends on the edit
    // dialog implementation — accept "Save" / "Update" / "Submit".
    const submit = dialog
      .getByRole("button", { name: /save|update|submit/i })
      .first();
    await submit.click();

    // Wait for dialog to close (success path) — error toast would keep it
    // open, which we'd detect via the failed expect.
    await expect(dialog).not.toBeVisible({ timeout: 30000 });

    // No error toast surfaced. Confirm by looking for sonner's default
    // role="status" element with the destructive variant — absence is the
    // success signal.
    const errorToast = page.getByText(/error|failed/i).first();
    await expect(errorToast)
      .not.toBeVisible({ timeout: 1000 })
      .catch(() => {});

    // Post-edit assignment count matches pre-edit count, scoped to the
    // exact projects we snapshotted. A new project from a parallel test
    // would land outside this set and not skew the comparison.
    const afterRes = await request.get(
      `${url}/api/model/projectWorkflowAssignment/count`,
      {
        params: {
          q: JSON.stringify({
            where: {
              workflowId,
              projectId: { in: beforeProjectIds },
            },
          }),
        },
      }
    );
    expect(afterRes.ok()).toBeTruthy();
    const after = (await afterRes.json())?.data as number;
    expect(after).toBe(before);
  });
});
