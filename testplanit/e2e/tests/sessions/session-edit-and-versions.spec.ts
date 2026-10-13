import { expect, test } from "../../fixtures";

/**
 * Editing a session records a version; the version selector on the detail
 * page opens the version diff page, which shows the renamed title against
 * the previous one.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test.describe("Session edit and version history", () => {
  test("renames a session twice and browses the version diff", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const ts = uid();
    const projectId = await api.createProject(`E2E Session Versions ${ts}`);
    const original = `Session v1 ${ts}`;
    const renamed = `Session v2 ${ts}`;
    const sessionId = await api.createSession(projectId, original);

    const versionCount = async () => {
      const res = await request.get(
        `${baseURL}/api/model/sessionVersions/count`,
        { params: { q: JSON.stringify({ where: { sessionId } }) } }
      );
      return (await res.json()).data as number;
    };

    const renameTo = async (name: string) => {
      await page.goto(
        `/en-US/projects/sessions/${projectId}/${sessionId}?edit=true`
      );
      const nameField = page.locator("form textarea").first();
      await expect(nameField).toBeVisible({ timeout: 15000 });
      await nameField.clear();
      await nameField.fill(name);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page).not.toHaveURL(/edit=true/, { timeout: 15000 });
    };

    await test.step("The list row's Edit action opens the session in edit mode", async () => {
      await page.goto(`/en-US/projects/sessions/${projectId}`);
      const row = page.locator(`#session-${sessionId}`);
      await expect(row).toBeVisible({ timeout: 15000 });
      await row.getByRole("button", { name: "Actions" }).click();
      await page.getByTestId(`session-edit-${sessionId}`).click();
      await expect(page).toHaveURL(
        new RegExp(`/projects/sessions/${projectId}/${sessionId}\\?edit=true`),
        { timeout: 15000 }
      );
    });

    await test.step("Two saves record two versions", async () => {
      await renameTo(`${original} draft`);
      await expect.poll(versionCount, { timeout: 15000 }).toBe(1);
      await renameTo(renamed);
      await expect.poll(versionCount, { timeout: 15000 }).toBe(2);
    });

    await test.step("The version selector opens the older version's diff page", async () => {
      await page.goto(`/en-US/projects/sessions/${projectId}/${sessionId}`);
      await page.getByTestId("version-select-trigger").click();
      await page.getByRole("option", { name: /v1\b/ }).click();
      await expect(page).toHaveURL(
        new RegExp(`/projects/sessions/${projectId}/${sessionId}/1(?:[?#]|$)`),
        { timeout: 15000 }
      );
      await expect(page.getByText(`${original} draft`).first()).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByTitle("Newer Version")).toBeVisible();
    });
  });
});
