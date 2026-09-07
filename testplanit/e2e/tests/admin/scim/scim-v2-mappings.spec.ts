import { expect, test } from "../../../fixtures";

/**
 * Admin surfaces for the SCIM v2 follow-ups:
 *
 *   - the Role Mappings card on /admin/scim (add, retier, remove)
 *   - the Per-project access section in the group edit dialog
 *
 * Both write through server actions that materialize access, so these assert
 * the persisted result through the model API rather than trusting the toast.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test.describe("SCIM role mappings", () => {
  test("adds, retiers, and removes a role mapping", async ({
    page,
    request,
    baseURL,
  }) => {
    const roleValue = `e2e-role-${uid()}`;

    await test.step("Open the SCIM admin page", async () => {
      await page.goto("/en-US/admin/scim");
      await expect(page.getByTestId("scim-role-mappings-card")).toBeVisible({
        timeout: 15000,
      });
    });

    await test.step("Add a mapping", async () => {
      await page.getByTestId("scim-role-mapping-value-input").fill(roleValue);
      await page.getByTestId("scim-role-mapping-access-select").click();
      await page.getByRole("option", { name: "Project Admin" }).click();
      await page.getByTestId("scim-role-mapping-add").click();

      await expect(
        page.getByTestId(`scim-role-mapping-row-${roleValue}`)
      ).toBeVisible({ timeout: 15000 });
    });

    await test.step("It persisted with the chosen tier", async () => {
      const res = await request.get(
        `${baseURL}/api/model/scimRoleMapping/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: { roleValue },
              select: { mappedAccess: true },
            }),
          },
        }
      );
      expect((await res.json())?.data?.mappedAccess).toBe("PROJECTADMIN");
    });

    await test.step("Remove it", async () => {
      await page.getByTestId(`scim-role-mapping-delete-${roleValue}`).click();
      await expect(
        page.getByTestId(`scim-role-mapping-row-${roleValue}`)
      ).toBeHidden({ timeout: 15000 });
    });

    await test.step("It is gone from the database", async () => {
      const res = await request.get(
        `${baseURL}/api/model/scimRoleMapping/findFirst`,
        {
          params: {
            q: JSON.stringify({ where: { roleValue } }),
          },
        }
      );
      expect((await res.json())?.data ?? null).toBeNull();
    });
  });
});

test.describe("Per-project group access mapping", () => {
  test("grants a group access on one project and withdraws it again", async ({
    page,
    request,
    baseURL,
  }) => {
    const run = uid();
    const groupName = `E2E PPM ${run}`;
    let groupId = 0;
    let projectId = 0;

    await test.step("Create a group and pick a project", async () => {
      const created = await request.post(`${baseURL}/api/model/groups/create`, {
        data: { data: { name: groupName }, select: { id: true } },
      });
      expect(created.ok()).toBeTruthy();
      groupId = (await created.json())?.data?.id;
      expect(groupId).toBeTruthy();

      const projects = await request.get(
        `${baseURL}/api/model/projects/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: { isDeleted: false },
              select: { id: true, name: true },
            }),
          },
        }
      );
      projectId = (await projects.json())?.data?.id;
      expect(projectId).toBeTruthy();
    });

    await test.step("Open the group's edit dialog", async () => {
      await page.goto("/en-US/admin/groups");
      await page.getByTestId(`admin-group-edit-${groupId}`).click();
      await expect(page.getByTestId("group-project-mappings")).toBeVisible({
        timeout: 15000,
      });
    });

    await test.step("Map the group to the project as Project Admin", async () => {
      await page.getByTestId("group-project-mapping-project-select").click();
      await page.getByRole("option").first().click();
      await page.getByTestId("group-project-mapping-access-select").click();
      await page.getByRole("option", { name: "Project Admin" }).click();
      await page.getByTestId("group-project-mapping-add").click();

      await expect(
        page.locator('[data-testid^="group-project-mapping-row-"]').first()
      ).toBeVisible({ timeout: 15000 });
    });

    await test.step("A derived permission row was materialized", async () => {
      const res = await request.get(
        `${baseURL}/api/model/groupProjectPermission/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: { groupId },
              select: {
                accessType: true,
                derivedFromMapping: true,
                projectId: true,
              },
            }),
          },
        }
      );
      const data = (await res.json())?.data;
      expect(data).toBeTruthy();
      expect(data.accessType).toBe("SPECIFIC_ROLE");
      expect(data.derivedFromMapping).toBe(true);
    });

    await test.step("Remove the mapping", async () => {
      await page
        .locator('[data-testid^="group-project-mapping-delete-"]')
        .first()
        .click();
      await expect(
        page.locator('[data-testid^="group-project-mapping-row-"]')
      ).toHaveCount(0, { timeout: 15000 });
    });

    await test.step("The derived permission row was withdrawn", async () => {
      const res = await request.get(
        `${baseURL}/api/model/groupProjectPermission/findFirst`,
        {
          params: {
            q: JSON.stringify({ where: { groupId } }),
          },
        }
      );
      expect((await res.json())?.data ?? null).toBeNull();
    });

    await test.step("Clean up", async () => {
      await request
        .post(`${baseURL}/api/model/groups/delete`, {
          data: { where: { id: groupId } },
        })
        .catch(() => undefined);
    });
  });
});
