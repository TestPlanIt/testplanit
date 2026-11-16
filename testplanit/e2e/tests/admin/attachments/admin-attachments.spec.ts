import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "../../../fixtures";

/**
 * Admin > Attachments (/admin/attachments): every attachment on the instance
 * in one list, with detach, delete, restore and purge for one or many.
 *
 * The attachments here are external links, which have no stored file, so the
 * spec needs no storage backend.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function createLink(
  request: APIRequestContext,
  baseURL: string | undefined,
  data: { name: string; sessionId: number; userId: string }
): Promise<number> {
  const response = await request.post(
    `${baseURL}/api/model/attachments/create`,
    {
      data: {
        data: {
          name: data.name,
          url: `https://example.com/${encodeURIComponent(data.name)}`,
          mimeType: "text/uri-list",
          size: 1,
          createdBy: { connect: { id: data.userId } },
          session: { connect: { id: data.sessionId } },
        },
      },
    }
  );
  expect(response.status(), await response.text()).toBeLessThan(300);
  return (await response.json()).data.id as number;
}

async function findAttachment(
  request: APIRequestContext,
  baseURL: string | undefined,
  id: number
): Promise<{ isDeleted: boolean; sessionId: number | null } | null> {
  const response = await request.get(
    `${baseURL}/api/model/attachments/findFirst`,
    {
      params: {
        q: JSON.stringify({
          where: { id },
          select: { isDeleted: true, sessionId: true },
        }),
      },
    }
  );
  return (await response.json()).data ?? null;
}

/** Open the page and narrow the list to the attachments named with `term`. */
async function openFilteredTo(page: Page, term: string) {
  await page.goto("/en-US/admin/attachments");
  await expect(page.getByTestId("admin-attachments-title")).toBeVisible({
    timeout: 15000,
  });
  await page.getByPlaceholder("Filter by name or note...").fill(term);
}

/** Run a bulk or detail action through its confirmation dialog. */
async function confirmAction(page: Page, buttonTestId: string) {
  await page.getByTestId(buttonTestId).click();
  const dialog = page.getByTestId("attachment-action-dialog");
  await expect(dialog.getByTestId("attachment-action-summary")).toBeVisible({
    timeout: 15000,
  });
  await dialog.getByTestId("attachment-action-confirm").click();
  await expect(dialog).toBeHidden({ timeout: 15000 });
}

test.describe("Admin attachments", () => {
  test("lists attachments and deletes, restores and detaches a selection", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const ts = uid();
    const projectId = await api.createProject(`E2E Attachments ${ts}`);
    const sessionId = await api.createSession(projectId, `Evidence ${ts}`);
    const userId = await api.getCurrentUserId();
    const first = await createLink(request, baseURL, {
      name: `e2e-attach-${ts}-one`,
      sessionId,
      userId,
    });
    const second = await createLink(request, baseURL, {
      name: `e2e-attach-${ts}-two`,
      sessionId,
      userId,
    });

    await test.step("Both attachments are listed as active links on their session", async () => {
      await openFilteredTo(page, `e2e-attach-${ts}`);
      for (const id of [first, second]) {
        const row = page.getByTestId(`attachment-row-${id}`);
        await expect(row).toBeVisible({ timeout: 15000 });
        await expect(row).toContainText(`Evidence ${ts}`);
        await expect(page.getByTestId(`attachment-status-${id}`)).toHaveText(
          "Active"
        );
      }
      await expect(page.getByTestId("attachments-showing")).toContainText(
        "2 of 2"
      );
    });

    await test.step("Delete both from the bulk bar", async () => {
      await page.getByTestId(`attachment-select-${first}`).click();
      await page.getByTestId(`attachment-select-${second}`).click();
      await expect(page.getByTestId("attachments-bulk-actions")).toContainText(
        "Selected: 2"
      );
      await confirmAction(page, "attachments-bulk-softDelete");
      for (const id of [first, second]) {
        await expect(page.getByTestId(`attachment-status-${id}`)).toHaveText(
          "Deleted",
          { timeout: 15000 }
        );
      }
      await expect(page.getByTestId("attachments-bulk-actions")).toBeHidden();
      expect((await findAttachment(request, baseURL, first))?.isDeleted).toBe(
        true
      );
    });

    await test.step("The status filter narrows to what is deleted", async () => {
      await page
        .getByTestId("attachments-status-filter")
        .getByRole("combobox")
        .click();
      await page.getByRole("option", { name: "Active", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId(`attachment-row-${first}`)).toBeHidden({
        timeout: 15000,
      });
      await page
        .getByTestId("attachments-status-filter")
        .getByRole("combobox")
        .click();
      await page.getByRole("option", { name: "Active", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId(`attachment-row-${first}`)).toBeVisible({
        timeout: 15000,
      });
    });

    await test.step("Restore both with select all", async () => {
      await page.getByTestId("attachments-select-all").click();
      await confirmAction(page, "attachments-bulk-restore");
      for (const id of [first, second]) {
        await expect(page.getByTestId(`attachment-status-${id}`)).toHaveText(
          "Active",
          { timeout: 15000 }
        );
      }
      expect((await findAttachment(request, baseURL, second))?.isDeleted).toBe(
        false
      );
    });

    await test.step("Open one's details, then detach it from its row", async () => {
      await page.getByTestId(`attachment-detail-open-${first}`).click();
      await expect(
        page.getByTestId(`attachment-detail-${first}`)
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await confirmAction(page, `attachment-row-detach-${first}`);
      await expect(page.getByTestId(`attachment-status-${first}`)).toHaveText(
        "Unattached",
        { timeout: 15000 }
      );
      expect(
        (await findAttachment(request, baseURL, first))?.sessionId
      ).toBeNull();
      expect((await findAttachment(request, baseURL, second))?.sessionId).toBe(
        sessionId
      );
    });
  });

  test("purges only what is already deleted", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const ts = uid();
    const projectId = await api.createProject(`E2E Attachments ${ts}`);
    const sessionId = await api.createSession(projectId, `Evidence ${ts}`);
    const userId = await api.getCurrentUserId();
    const kept = await createLink(request, baseURL, {
      name: `e2e-purge-${ts}-kept`,
      sessionId,
      userId,
    });
    const purged = await createLink(request, baseURL, {
      name: `e2e-purge-${ts}-purged`,
      sessionId,
      userId,
    });

    await openFilteredTo(page, `e2e-purge-${ts}`);
    await expect(page.getByTestId(`attachment-row-${purged}`)).toBeVisible({
      timeout: 15000,
    });
    // The search applies a moment after typing and clears any selection, so
    // wait for the narrowed list before selecting from it.
    await expect(page.getByTestId("attachments-showing")).toContainText(
      "2 of 2",
      { timeout: 15000 }
    );

    await test.step("A live attachment offers no purge", async () => {
      await page.getByTestId(`attachment-select-${purged}`).click();
      await expect(
        page.getByTestId("attachments-bulk-softDelete")
      ).toBeVisible();
      await expect(page.getByTestId("attachments-bulk-purge")).toBeHidden();
    });

    await test.step("Delete one, then purge a selection of both", async () => {
      await confirmAction(page, "attachments-bulk-softDelete");
      await expect(page.getByTestId(`attachment-status-${purged}`)).toHaveText(
        "Deleted",
        { timeout: 15000 }
      );

      await page.getByTestId(`attachment-select-${purged}`).click();
      await page.getByTestId(`attachment-select-${kept}`).click();
      await page.getByTestId("attachments-bulk-purge").click();
      const dialog = page.getByTestId("attachment-action-dialog");
      await expect(dialog.getByTestId("attachment-action-summary")).toHaveText(
        "Permanently delete this attachment? This cannot be undone."
      );
      // A link has no stored file, and the live attachment is left alone.
      await expect(dialog.getByTestId("attachment-action-files")).toHaveText(
        "No stored files are deleted."
      );
      await expect(
        dialog.getByTestId("attachment-action-skipped")
      ).toBeVisible();
      await dialog.getByTestId("attachment-action-confirm").click();
      await expect(dialog).toBeHidden({ timeout: 15000 });
    });

    await test.step("Only the deleted one is gone", async () => {
      await expect(page.getByTestId(`attachment-row-${purged}`)).toBeHidden({
        timeout: 15000,
      });
      await expect(page.getByTestId(`attachment-row-${kept}`)).toBeVisible();
      expect(await findAttachment(request, baseURL, purged)).toBeNull();
      expect((await findAttachment(request, baseURL, kept))?.isDeleted).toBe(
        false
      );
    });
  });

  test("opens the Storage tab and puts it in the address", async ({ page }) => {
    await page.goto("/en-US/admin/attachments");
    await page.getByTestId("storage-tab").click();
    await expect(page).toHaveURL(/[?&]tab=storage/);

    const view = page.getByTestId("storage-view");
    await expect(view).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("storage-scan-status")).toBeVisible();
    await expect(page.getByTestId("storage-scan-start")).toBeEnabled();
    await expect(page.getByTestId("storage-status-filter")).toContainText(
      "All Statuses"
    );
    await expect(page.getByTestId("storage-folder-filter")).toContainText(
      "All folders"
    );

    // Back on the first tab the attachment list is still there.
    await page.getByTestId("attachments-tab").click();
    await expect(page.getByTestId("attachments-status-filter")).toBeVisible();
  });
});
