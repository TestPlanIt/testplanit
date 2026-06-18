import { expect, test } from "../../fixtures/index";

/**
 * Templates CRUD API Tests
 *
 * Tests the Template model via ZenStack auto-generated REST endpoints.
 * Templates use soft-delete (isDeleted flag).
 */

// Run serially to avoid ZenStack v3 deadlock under parallel workers
test.describe.configure({ mode: "serial" });

test.describe("Templates CRUD", () => {
  test("should create a template and read it back", async ({
    request,
    baseURL,
    api,
  }) => {
    const uniqueName = `API Test Template ${Date.now()}`;

    let templateId: number | undefined;
    await test.step("Create template via fixture helper", async () => {
      templateId = await api.createTemplate({ name: uniqueName });
    });

    await test.step("Read template back and verify it persisted", async () => {
      const response = await request.get(
        `${baseURL}/api/model/templates/findFirst`,
        {
          params: {
            q: JSON.stringify({ where: { id: templateId } }),
          },
        }
      );

      expect(response.ok()).toBeTruthy();
      const result = await response.json();
      expect(result.data).toBeTruthy();
      expect(result.data.templateName).toBe(uniqueName);
      expect(result.data.isDeleted).toBe(false);
    });
  });

  test("should update a template name", async ({ request, baseURL, api }) => {
    const originalName = `API Test Template ${Date.now()}`;
    const updatedName = `Updated Template ${Date.now()}`;

    let templateId: number | undefined;
    await test.step("Create template", async () => {
      templateId = await api.createTemplate({ name: originalName });
    });

    await test.step("Update the template name via PATCH", async () => {
      const updateResponse = await request.patch(
        `${baseURL}/api/model/templates/update`,
        {
          data: {
            where: { id: templateId },
            data: { templateName: updatedName },
          },
        }
      );

      expect(updateResponse.ok()).toBeTruthy();
    });

    await test.step("Read template back and verify the new name", async () => {
      const readResponse = await request.get(
        `${baseURL}/api/model/templates/findFirst`,
        {
          params: {
            q: JSON.stringify({ where: { id: templateId } }),
          },
        }
      );

      expect(readResponse.ok()).toBeTruthy();
      const result = await readResponse.json();
      expect(result.data.templateName).toBe(updatedName);
    });
  });

  test("should soft-delete a template", async ({ request, baseURL, api }) => {
    const uniqueName = `API Delete Template ${Date.now()}`;

    let templateId: number | undefined;
    await test.step("Create template", async () => {
      templateId = await api.createTemplate({ name: uniqueName });
    });

    await test.step("Soft-delete the template via PATCH", async () => {
      // Note: deleteTemplate is fire-and-forget in fixture, so we do it directly
      const deleteResponse = await request.patch(
        `${baseURL}/api/model/templates/update`,
        {
          data: {
            where: { id: templateId },
            data: { isDeleted: true },
          },
        }
      );

      expect(deleteResponse.ok()).toBeTruthy();
    });

    await test.step("Read template back and verify it is soft-deleted", async () => {
      const readResponse = await request.get(
        `${baseURL}/api/model/templates/findFirst`,
        {
          params: {
            q: JSON.stringify({ where: { id: templateId } }),
          },
        }
      );

      expect(readResponse.ok()).toBeTruthy();
      const result = await readResponse.json();
      expect(result.data).toBeTruthy();
      expect(result.data.isDeleted).toBe(true);
    });
  });

  test("should list templates via findMany", async ({
    request,
    baseURL,
    api,
  }) => {
    const timestamp = Date.now();
    const name1 = `API List Template A ${timestamp}`;
    const name2 = `API List Template B ${timestamp}`;

    await test.step("Create two templates", async () => {
      await api.createTemplate({ name: name1 });
      await api.createTemplate({ name: name2 });
    });

    await test.step("List templates via findMany and verify both are returned", async () => {
      const response = await request.get(
        `${baseURL}/api/model/templates/findMany`,
        {
          params: {
            q: JSON.stringify({
              where: {
                templateName: { in: [name1, name2] },
                isDeleted: false,
              },
            }),
          },
        }
      );

      expect(response.ok()).toBeTruthy();
      const result = await response.json();
      expect(result.data).toBeTruthy();
      expect(result.data.length).toBe(2);

      const names = result.data.map(
        (t: { templateName: string }) => t.templateName
      );
      expect(names).toContain(name1);
      expect(names).toContain(name2);
    });
  });
});
