import { expect, test } from "../../fixtures";

/**
 * A session's tags and attachments must outlive every save that does not
 * touch them. Two paths used to strip them: saving the session in edit mode,
 * and saving an edited result, whose submit also saved the whole session.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test.describe("Session tags and attachments survive saves", () => {
  test("saving the session or one of its results keeps its tags and attachments", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const ts = uid();
    const projectId = await api.createProject(`E2E Session Tags ${ts}`);
    const sessionId = await api.createSession(projectId, `Tagged ${ts}`);
    const tagId = await api.createTag(`SessionTag${ts}`);
    await api.addTagToSession(sessionId, tagId);

    const attachmentResponse = await request.post(
      `${baseURL}/api/model/attachments/create`,
      {
        data: {
          data: {
            name: `evidence-${ts}.txt`,
            url: `https://example.com/evidence-${ts}.txt`,
            mimeType: "text/plain",
            size: 1,
            createdBy: { connect: { id: await api.getCurrentUserId() } },
            session: { connect: { id: sessionId } },
          },
        },
      }
    );
    expect(attachmentResponse.ok()).toBe(true);
    const attachmentId = (await attachmentResponse.json()).data.id as number;

    const sessionLinks = async () => {
      const res = await request.get(`${baseURL}/api/model/sessions/findFirst`, {
        params: {
          q: JSON.stringify({
            where: { id: sessionId },
            select: {
              tags: { select: { id: true } },
              attachments: { select: { id: true } },
            },
          }),
        },
      });
      const data = (await res.json()).data as {
        tags: { id: number }[];
        attachments: { id: number }[];
      };
      return {
        tagIds: data.tags.map((tag) => tag.id),
        attachmentIds: data.attachments.map((attachment) => attachment.id),
      };
    };

    const versionCount = async () => {
      const res = await request.get(
        `${baseURL}/api/model/sessionVersions/count`,
        { params: { q: JSON.stringify({ where: { sessionId } }) } }
      );
      return (await res.json()).data as number;
    };

    const expectLinksIntact = async () => {
      await expect
        .poll(sessionLinks, { timeout: 15000 })
        .toEqual({ tagIds: [tagId], attachmentIds: [attachmentId] });
    };

    await expectLinksIntact();

    await test.step("Editing a result saves the result, not the session", async () => {
      await page.goto(`/en-US/projects/sessions/${projectId}/${sessionId}`);

      // Add a result through the form above the results list
      await page
        .getByRole("button", { name: "Save", exact: true })
        .first()
        .click();
      const editResult = page.getByTitle("Edit", { exact: true }).first();
      await expect(editResult).toBeVisible({ timeout: 15000 });

      // The list remounts while the new result settles, which would close a
      // dialog opened in that window; a reload gives a settled list.
      await page.reload();
      await expect(editResult).toBeVisible({ timeout: 15000 });

      await editResult.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 15000 });
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect(dialog).not.toBeVisible({ timeout: 15000 });

      await expectLinksIntact();
      expect(await versionCount()).toBe(0);
    });

    await test.step("Saving the session in edit mode keeps them too", async () => {
      await page.goto(
        `/en-US/projects/sessions/${projectId}/${sessionId}?edit=true`
      );
      const nameField = page.locator("form textarea").first();
      await expect(nameField).toBeVisible({ timeout: 15000 });
      await nameField.clear();
      await nameField.fill(`Tagged ${ts} renamed`);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page).not.toHaveURL(/edit=true/, { timeout: 15000 });

      await expect.poll(versionCount, { timeout: 15000 }).toBe(1);
      await expectLinksIntact();
    });
  });
});
