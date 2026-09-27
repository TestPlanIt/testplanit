import { expect, test } from "../../fixtures";
import { signInSecondaryContext } from "../../utils/secondary-context-login";

/**
 * Project → Settings → Access: the read-only roster of who can open the
 * project and the role they hold there. Administrators get a link into
 * Administration → Projects → Edit Project; other settings holders are told
 * that only administrators change access.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test.describe("Project Settings - Access", () => {
  test("lists members with their effective role and links an admin to the editor", async ({
    api,
    page,
  }) => {
    const ts = uid();
    const projectId = await api.createProject(`E2E Access ${ts}`);
    const adminId = await api.getCurrentUserId();
    const member = await api.createUser({
      name: `Access Member ${ts}`,
      email: `access-member-${ts}@example.com`,
      password: "Password123!",
      access: "USER",
    });
    await api.assignUserToProject(member.data.id, projectId);

    await test.step("Open the Access settings page", async () => {
      await page.goto(`/en-US/projects/settings/${projectId}/access`);
      await expect(page.getByTestId("project-access-title")).toBeVisible({
        timeout: 15000,
      });
    });

    await test.step("The admin and the assigned member are listed", async () => {
      const adminRow = page.getByTestId(`project-access-row-${adminId}`);
      await expect(adminRow).toBeVisible({ timeout: 15000 });
      await expect(adminRow).toContainText("Admin");
      await expect(adminRow).toContainText("System Access");

      const memberRow = page.getByTestId(
        `project-access-row-${member.data.id}`
      );
      await expect(memberRow).toBeVisible();
      await expect(memberRow).toContainText(member.data.name);
      // A fresh project defaults to GLOBAL_ROLE, so the member's own global
      // role is the effective one and the project default is the source.
      await expect(memberRow).toContainText("Project Default");
    });

    await test.step("The filter narrows the list by name or email", async () => {
      await page
        .getByTestId("project-access-filter")
        .fill(`access-member-${ts}`);
      await expect(
        page.getByTestId(`project-access-row-${member.data.id}`)
      ).toBeVisible();
      await expect(
        page.getByTestId(`project-access-row-${adminId}`)
      ).toHaveCount(0);
      await page.getByTestId("project-access-filter").fill("");
      await expect(
        page.getByTestId(`project-access-row-${adminId}`)
      ).toBeVisible();
    });

    await test.step("An admin sees the edit link, not the admin-only note", async () => {
      await expect(page.getByTestId("project-access-admin-note")).toHaveCount(
        0
      );
      await page.getByTestId("project-access-edit-button").click();
      await expect(page).toHaveURL(
        new RegExp(`/admin/projects\\?edit=${projectId}&tab=users`)
      );
    });

    await test.step("The deep link opens Edit Project on the Users tab", async () => {
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 15000 });
      await expect(
        dialog.getByRole("tab", { name: "Users", selected: true })
      ).toBeVisible();
      // The Users tab lists the project's members, so the assigned member
      // proves the dialog opened on this project.
      await expect(dialog).toContainText(member.data.name);
    });

    await test.step("Closing the dialog drops the deep-link params", async () => {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page).toHaveURL(/\/admin\/projects$/);
    });
  });

  test("a project admin who is not a system admin sees the admin-only note", async ({
    api,
    browser,
    baseURL,
  }) => {
    const ts = uid();
    const email = `access-pa-${ts}@example.com`;
    const password = "Password123!";
    const projectId = await api.createProject(`E2E Access PA ${ts}`);
    // Signup only accepts USER/ADMIN; promote afterwards.
    const projectAdmin = await api.createUser({
      name: `Access PA ${ts}`,
      email,
      password,
      access: "USER",
    });
    await api.setUserAccess(projectAdmin.data.id, "PROJECTADMIN");
    await api.assignUserToProject(projectAdmin.data.id, projectId);

    const context = await signInSecondaryContext(
      browser,
      baseURL!,
      email,
      password
    );
    const page = await context.newPage();
    try {
      await page.goto(`${baseURL}/en-US/projects/settings/${projectId}/access`);
      await expect(page.getByTestId("project-access-title")).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByTestId("project-access-admin-note")).toContainText(
        "Only System Administrators can modify project access."
      );
      await expect(page.getByTestId("project-access-edit-button")).toHaveCount(
        0
      );

      const ownRow = page.getByTestId(
        `project-access-row-${projectAdmin.data.id}`
      );
      await expect(ownRow).toBeVisible({ timeout: 15000 });
      await expect(ownRow).toContainText("Project Admin");
      await expect(ownRow).toContainText("System Access");
    } finally {
      await context.close();
    }
  });

  test("a plain USER member cannot open the page", async ({
    api,
    browser,
    baseURL,
  }) => {
    const ts = uid();
    const email = `access-user-${ts}@example.com`;
    const password = "Password123!";
    const projectId = await api.createProject(`E2E Access User ${ts}`);
    const member = await api.createUser({
      name: `Access User ${ts}`,
      email,
      password,
      access: "USER",
    });
    await api.assignUserToProject(member.data.id, projectId);

    const context = await signInSecondaryContext(
      browser,
      baseURL!,
      email,
      password
    );
    const page = await context.newPage();
    try {
      await page.goto(`${baseURL}/en-US/projects/settings/${projectId}/access`);
      // The page resolves project-admin authority server-side and 404s
      // everyone else, so neither the title nor any roster row renders.
      await expect(page.getByTestId("project-access-title")).toHaveCount(0, {
        timeout: 15000,
      });
      await expect(
        page.getByTestId(`project-access-row-${member.data.id}`)
      ).toHaveCount(0);

      const direct = await context.request.get(
        `${baseURL}/api/projects/${projectId}/access`,
        { headers: { "Sec-Fetch-Site": "same-origin" } }
      );
      expect(direct.status()).toBe(403);
    } finally {
      await context.close();
    }
  });
});
