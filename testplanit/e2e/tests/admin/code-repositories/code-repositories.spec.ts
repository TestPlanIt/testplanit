import { expect, test } from "../../../fixtures";

/**
 * Code repositories (admin): a seeded repository is listed and its status
 * switch persists through the model API.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test.describe("Code repositories", () => {
  test("lists a repository and toggles its status", async ({
    page,
    request,
    baseURL,
  }) => {
    const name = `E2E Repo ${uid()}`;
    const created = await request.post(
      `${baseURL}/api/model/codeRepository/create`,
      {
        data: {
          data: {
            name,
            provider: "GITHUB",
            credentials: { token: "e2e-placeholder" },
            settings: { repoIdentifier: "e2e/repo" },
          },
        },
      }
    );
    expect(created.ok()).toBeTruthy();
    const id: number = (await created.json()).data.id;

    try {
      await test.step("The repository appears in the admin list", async () => {
        await page.goto("/en-US/admin/code-repositories");
        await expect(
          page.getByTestId("code-repositories-admin-page-title")
        ).toBeVisible({ timeout: 15000 });
        const row = page.getByTestId(`admin-code-repository-row-${id}`);
        await expect(row).toBeVisible({ timeout: 15000 });
        await expect(row).toContainText(name);
      });

      await test.step("Flipping the status switch deactivates it", async () => {
        await page
          .getByTestId(`admin-code-repository-row-${id}`)
          .getByRole("switch")
          .click();
        await expect
          .poll(
            async () => {
              const res = await request.get(
                `${baseURL}/api/model/codeRepository/findFirst`,
                {
                  params: {
                    q: JSON.stringify({
                      where: { id },
                      select: { status: true },
                    }),
                  },
                }
              );
              return (await res.json()).data?.status;
            },
            { timeout: 15000 }
          )
          .toBe("INACTIVE");
      });
    } finally {
      await request
        .patch(`${baseURL}/api/model/codeRepository/update`, {
          data: { where: { id }, data: { isDeleted: true } },
        })
        .catch(() => {});
    }
  });
});
