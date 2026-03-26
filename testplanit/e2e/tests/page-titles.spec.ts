import { expect, test } from "../fixtures";

test.describe("Page Titles", () => {
  test.describe("Dashboard", () => {
    test("shows Dashboard title", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("load");
      await expect(page).toHaveTitle(/Dashboard.*TestPlanIt/);
    });
  });

  test.describe("Admin pages", () => {
    const adminPages = [
      { path: "/admin/users", expected: /Admin.*Users.*TestPlanIt/ },
      { path: "/admin/projects", expected: /Admin.*Projects.*TestPlanIt/ },
      { path: "/admin/fields", expected: /Admin.*Templates.*Fields.*TestPlanIt/ },
      { path: "/admin/workflows", expected: /Admin.*Workflows.*TestPlanIt/ },
      { path: "/admin/statuses", expected: /Admin.*Statuses.*TestPlanIt/ },
      { path: "/admin/roles", expected: /Admin.*Roles.*TestPlanIt/ },
      { path: "/admin/groups", expected: /Admin.*Groups.*TestPlanIt/ },
      { path: "/admin/tags", expected: /Admin.*Tags.*TestPlanIt/ },
      { path: "/admin/issues", expected: /Admin.*Issues.*TestPlanIt/ },
      { path: "/admin/integrations", expected: /Admin.*Integrations.*TestPlanIt/ },
      { path: "/admin/notifications", expected: /Admin.*Notifications.*TestPlanIt/ },
      { path: "/admin/llm", expected: /Admin.*AI Models.*TestPlanIt/ },
      { path: "/admin/sso", expected: /Admin.*Authentication.*TestPlanIt/ },
      { path: "/admin/trash", expected: /Admin.*Trash.*TestPlanIt/ },
      { path: "/admin/audit-logs", expected: /Admin.*Audit Logs.*TestPlanIt/ },
      { path: "/admin/queues", expected: /Admin.*Job Queues.*TestPlanIt/ },
    ];

    for (const { path, expected } of adminPages) {
      test(`${path} has correct title`, async ({ page }) => {
        await page.goto(path);
        await page.waitForLoadState("load");
        await expect(page).toHaveTitle(expected);
      });
    }
  });

  test.describe("Project pages", () => {
    let projectId: number;

    test.beforeAll(async ({ request, baseURL }) => {
      // Find an existing project
      const response = await request.get(
        `${baseURL}/api/model/projects/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: { isDeleted: false },
              select: { id: true },
            }),
          },
        }
      );
      const result = await response.json();
      projectId = result.data?.id || result.id;
    });

    test("overview has project-specific title", async ({ page }) => {
      await page.goto(`/projects/overview/${projectId}`);
      await page.waitForLoadState("load");
      // Dynamic title from fetchPageMetadata, should contain project name
      await expect(page).toHaveTitle(/.*\|.*TestPlanIt/);
      // Should NOT be the default generic title
      const title = await page.title();
      expect(title).not.toBe("TestPlanIt - Modern Test Management Platform");
    });

    const projectSections = [
      { section: "repository", expected: /Repository.*TestPlanIt/ },
      { section: "runs", expected: /Test Runs.*TestPlanIt/ },
      { section: "sessions", expected: /Sessions.*TestPlanIt/ },
      { section: "milestones", expected: /Milestones.*TestPlanIt/ },
      { section: "issues", expected: /Issues.*TestPlanIt/ },
      { section: "documentation", expected: /Documentation.*TestPlanIt/ },
      { section: "tags", expected: /Tags.*TestPlanIt/ },
    ];

    for (const { section, expected } of projectSections) {
      test(`${section} has correct title`, async ({ page }) => {
        await page.goto(`/projects/${section}/${projectId}`);
        await page.waitForLoadState("load");
        await expect(page).toHaveTitle(expected);
      });
    }
  });

  test.describe("Does not show default title on named pages", () => {
    test("admin page does not show generic title", async ({ page }) => {
      await page.goto("/admin/users");
      await page.waitForLoadState("load");
      const title = await page.title();
      expect(title).not.toBe("TestPlanIt - Modern Test Management Platform");
    });
  });

});
