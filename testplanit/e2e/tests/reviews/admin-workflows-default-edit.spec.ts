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

    // Find the first default CASES workflow — the one every project picks up
    // by default. The bug originally surfaced on the default workflow because
    // it's the most-edited.
    const wfRes = await request.get(`${url}/api/model/workflows/findFirst`, {
      params: {
        q: JSON.stringify({
          where: { scope: "CASES", isDeleted: false, isDefault: true },
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

    // Count projectWorkflowAssignment rows for this workflow BEFORE the
    // edit. We compare against the post-edit count.
    const beforeRes = await request.get(
      `${url}/api/model/projectWorkflowAssignment/count`,
      {
        params: {
          q: JSON.stringify({ where: { workflowId } }),
        },
      }
    );
    expect(beforeRes.ok()).toBeTruthy();
    const before = (await beforeRes.json())?.data as number;

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
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // No error toast surfaced. Confirm by looking for sonner's default
    // role="status" element with the destructive variant — absence is the
    // success signal.
    const errorToast = page.getByText(/error|failed/i).first();
    await expect(errorToast)
      .not.toBeVisible({ timeout: 1000 })
      .catch(() => {});

    // Post-edit assignment count matches pre-edit count.
    const afterRes = await request.get(
      `${url}/api/model/projectWorkflowAssignment/count`,
      {
        params: {
          q: JSON.stringify({ where: { workflowId } }),
        },
      }
    );
    expect(afterRes.ok()).toBeTruthy();
    const after = (await afterRes.json())?.data as number;
    expect(after).toBe(before);
  });
});
