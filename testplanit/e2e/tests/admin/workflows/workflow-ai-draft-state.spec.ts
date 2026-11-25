import { expect, test } from "../../../fixtures";

/**
 * A test case workflow state can be marked as the one that holds unreviewed
 * AI drafts (Admin > Workflows). The mark shows as a badge in the list and
 * can be taken off again. The state made here is assigned to no project, so
 * no other spec's drafts land in it. The switch shows only once an AI model
 * is active, so the spec adds one.
 */

test.use({ storageState: "e2e/.auth/admin.json" });

test.describe("Workflow states that hold unreviewed AI drafts", () => {
  test("an admin can mark a test case state and unmark it", async ({
    page,
    request,
    baseURL,
    api,
  }) => {
    const name = `AI drafts ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const find = async (model: string, where?: Record<string, unknown>) => {
      const response = await request.get(
        `${baseURL}/api/model/${model}/findFirst`,
        {
          params: {
            q: JSON.stringify({
              ...(where ? { where } : {}),
              select: { id: true },
            }),
          },
        }
      );
      expect(response.ok()).toBe(true);
      return (await response.json()).data.id as number;
    };
    const created = await request.post(
      `${baseURL}/api/model/workflows/create`,
      {
        data: {
          data: {
            name,
            scope: "CASES",
            workflowType: "NOT_STARTED",
            isEnabled: true,
            isDefault: false,
            iconId: await find("fieldIcon", { name: "layout-list" }),
            colorId: await find("color"),
          },
        },
      }
    );
    expect(created.ok()).toBe(true);
    const workflowId = (await created.json()).data.id as number;
    const isMarked = async () => {
      const response = await request.get(
        `${baseURL}/api/model/workflows/findUnique`,
        {
          params: {
            q: JSON.stringify({
              where: { id: workflowId },
              select: { isAiDraft: true },
            }),
          },
        }
      );
      return (await response.json()).data.isAiDraft as boolean;
    };

    await api.createLlmIntegration(`AI drafts model ${name}`);

    const dialog = page.locator('[role="dialog"]');
    const row = page.locator("tr").filter({ hasText: name }).first();
    const badge = page.getByTestId(`ai-draft-badge-${workflowId}`);
    const openEdit = async () => {
      await expect(row).toBeVisible();
      await row.locator("td").last().locator("button").first().click();
      await expect(dialog).toBeVisible();
    };
    const submit = async () => {
      await dialog
        .getByRole("button", { name: /submit/i })
        .first()
        .click();
      await expect(dialog).toBeHidden();
    };

    try {
      await test.step("The new state is not marked", async () => {
        await page.goto("/en-US/admin/workflows");
        await page.waitForLoadState("load");
        await expect(row).toBeVisible();
        await expect(badge).toHaveCount(0);
      });

      await test.step("Marking it shows the badge and saves the flag", async () => {
        await openEdit();
        const toggle = dialog.getByTestId("ai-draft-switch");
        await expect(toggle).toHaveAttribute("aria-checked", "false");
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-checked", "true");
        await submit();
        await expect(badge).toBeVisible();
        await expect(badge).toHaveText("AI drafts");
        await expect.poll(isMarked).toBe(true);
      });

      await test.step("Unmarking it removes the badge", async () => {
        await openEdit();
        const toggle = dialog.getByTestId("ai-draft-switch");
        await expect(toggle).toHaveAttribute("aria-checked", "true");
        await toggle.click();
        await submit();
        await expect(badge).toHaveCount(0);
        await expect.poll(isMarked).toBe(false);
      });
    } finally {
      await request
        .patch(`${baseURL}/api/model/workflows/update`, {
          data: { where: { id: workflowId }, data: { isDeleted: true } },
        })
        .catch(() => {});
    }
  });
});
