import { expect, test } from "../../fixtures";
import { signInSecondaryContext } from "../../utils/secondary-context-login";

/**
 * What a plain USER-access project member can and cannot reach: admin pages
 * bounce to the home page, project settings are withheld, and the
 * requirements tree is read-only for them.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test.describe("Non-admin member access", () => {
  test("a USER member is kept out of admin and settings and sees a read-only tree", async ({
    api,
    browser,
    baseURL,
  }) => {
    const ts = uid();
    const email = `member-${ts}@example.com`;
    const password = "Password123!";
    const projectId = await api.createProject(`E2E Member Access ${ts}`);
    await api.enableRequirements(projectId);
    const requirementId = await api.createRequirement(
      projectId,
      `REQ-${ts}`,
      `Visible to members ${ts}`
    );
    const user = await api.createUser({
      name: `Member ${ts}`,
      email,
      password,
      access: "USER",
    });
    await api.assignUserToProject(user.data.id, projectId);

    const context = await signInSecondaryContext(
      browser,
      baseURL!,
      email,
      password
    );
    const page = await context.newPage();
    try {
      await test.step("Admin pages redirect the member home", async () => {
        await page.goto(`${baseURL}/en-US/admin/users`);
        await page.waitForURL(/\/en-US\/?$/, { timeout: 15000 });
      });

      await test.step("Project settings are withheld", async () => {
        await page.goto(
          `${baseURL}/en-US/projects/settings/${projectId}/parameters`
        );
        await expect(
          page.getByTestId("junit-iteration-property-input")
        ).toHaveCount(0, { timeout: 15000 });
      });

      await test.step("The requirements tree is visible but not editable", async () => {
        await page.goto(`${baseURL}/en-US/projects/requirements/${projectId}`);
        await expect(
          page.getByTestId(`requirement-row-${requirementId}`)
        ).toBeVisible({ timeout: 15000 });
        await expect(
          page.getByTestId("requirements-tree-add-root")
        ).toHaveCount(0);
        await expect(
          page.getByTestId("requirements-tree-empty-add-root")
        ).toHaveCount(0);
      });
    } finally {
      await context.close();
      await api.deleteUser(user.data.id);
    }
  });
});
