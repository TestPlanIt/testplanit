import { expect, test } from "../../../fixtures";

/**
 * Admin trash (/admin/trash): soft-deleted records can be restored or purged
 * per entity type. Tags are the lightest entity to soft-delete through the
 * model API, so they stand in for the whole table.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test.describe("Admin trash", () => {
  test("restores a soft-deleted tag", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const name = `e2e-trash-restore-${uid()}`;
    const tagId = await api.createTag(name);
    await api.deleteTag(tagId);

    await test.step("The deleted tag is listed under Tags", async () => {
      await page.goto("/en-US/admin/trash");
      await page.getByRole("button", { name: "Tags", exact: true }).click();
      await expect(page.getByTestId(`trash-Tags-row-${tagId}`)).toBeVisible({
        timeout: 15000,
      });
    });

    await test.step("Restore it and confirm", async () => {
      await page
        .getByTestId(`trash-Tags-row-${tagId}`)
        .getByRole("button", { name: "Restore" })
        .click();
      const alert = page.getByRole("alertdialog");
      await expect(alert).toBeVisible({ timeout: 10000 });
      await alert.getByRole("button", { name: "Restore" }).click();
      await expect(alert).toBeHidden({ timeout: 15000 });
      await expect(page.getByTestId(`trash-Tags-row-${tagId}`)).toBeHidden({
        timeout: 15000,
      });
    });

    await test.step("The tag is live again", async () => {
      const res = await request.get(`${baseURL}/api/model/tags/findFirst`, {
        params: {
          q: JSON.stringify({
            where: { id: tagId },
            select: { isDeleted: true },
          }),
        },
      });
      expect((await res.json()).data?.isDeleted).toBe(false);
    });
  });

  test("purges a soft-deleted tag for good", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const name = `e2e-trash-purge-${uid()}`;
    const tagId = await api.createTag(name);
    await api.deleteTag(tagId);
    api.untrackTag(tagId);

    await test.step("Purge it from the Tags list and confirm", async () => {
      await page.goto("/en-US/admin/trash");
      await page.getByRole("button", { name: "Tags", exact: true }).click();
      const row = page.getByTestId(`trash-Tags-row-${tagId}`);
      await expect(row).toBeVisible({ timeout: 15000 });
      await row.getByRole("button", { name: "Purge" }).click();
      const alert = page.getByRole("alertdialog");
      await expect(alert).toBeVisible({ timeout: 10000 });
      await alert.getByRole("button", { name: "Purge" }).click();
      await expect(alert).toBeHidden({ timeout: 15000 });
      await expect(row).toBeHidden({ timeout: 15000 });
    });

    await test.step("The tag no longer exists", async () => {
      const res = await request.get(`${baseURL}/api/model/tags/findFirst`, {
        params: {
          q: JSON.stringify({ where: { id: tagId }, select: { id: true } }),
        },
      });
      expect((await res.json()).data).toBeNull();
    });
  });
});
