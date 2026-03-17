import { expect, test } from "../../fixtures/index";

/**
 * Projects CRUD API Tests
 *
 * Verifies that create, read, update, and delete (soft-delete) operations
 * on the Projects model work correctly through the ZenStack REST API.
 *
 * These tests establish a regression baseline before the ZenStack v2→v3 upgrade.
 */
test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Projects CRUD", () => {
  test("should create a project and read it back", async ({
    request,
    baseURL,
    api,
  }) => {
    const uniqueName = `E2E Project Create ${Date.now()}`;

    // Create the project using the api fixture (creates project + repo + root folder + template)
    const projectId = await api.createProject(uniqueName);
    expect(projectId).toBeGreaterThan(0);

    // Read it back via findFirst
    const findResponse = await request.get(
      `${baseURL}/api/model/projects/findFirst`,
      {
        params: {
          q: JSON.stringify({
            where: { name: uniqueName },
          }),
        },
      }
    );

    expect(findResponse.status()).toBe(200);
    const result = await findResponse.json();
    expect(result.data).toBeTruthy();
    expect(result.data.name).toBe(uniqueName);
    expect(typeof result.data.id).toBe("number");
    expect(result.data.isDeleted).toBe(false);
  });

  test("should update a project name", async ({ request, baseURL, api }) => {
    const originalName = `E2E Project Update ${Date.now()}`;
    const newName = `E2E Project Updated ${Date.now()}`;

    // Create a project
    const projectId = await api.createProject(originalName);

    // Update the name
    const updateResponse = await request.patch(
      `${baseURL}/api/model/projects/update`,
      {
        data: {
          where: { id: projectId },
          data: { name: newName },
        },
      }
    );

    expect(updateResponse.status()).toBe(200);

    // Read it back and verify the name changed
    const findResponse = await request.get(
      `${baseURL}/api/model/projects/findFirst`,
      {
        params: {
          q: JSON.stringify({
            where: { id: projectId },
          }),
        },
      }
    );

    expect(findResponse.status()).toBe(200);
    const result = await findResponse.json();
    expect(result.data.name).toBe(newName);
  });

  test("should soft-delete a project", async ({ request, baseURL, api }) => {
    const uniqueName = `E2E Project SoftDelete ${Date.now()}`;

    // Create a project and verify it exists before deletion
    const projectId = await api.createProject(uniqueName);

    // Confirm project exists before soft-delete
    const beforeDeleteResponse = await request.get(
      `${baseURL}/api/model/projects/findFirst`,
      {
        params: {
          q: JSON.stringify({ where: { id: projectId } }),
        },
      }
    );
    expect(beforeDeleteResponse.status()).toBe(200);
    const beforeResult = await beforeDeleteResponse.json();
    expect(beforeResult.data).toBeTruthy();
    expect(beforeResult.data.isDeleted).toBe(false);

    // Soft-delete the project.
    // NOTE: ZenStack v3 schema has @@deny('all', isDeleted) on Projects, which means:
    // - The PATCH returns 422 (RESULT_NOT_READABLE) because after setting isDeleted:true,
    //   the policy denies reading the result back (expected ZenStack v3 behavior).
    // - api.deleteProject() is fire-and-forget which handles this correctly.
    await api.deleteProject(projectId);

    // Give the delete a moment to propagate
    await new Promise((r) => setTimeout(r, 300));

    // Verify the project is no longer readable via the API (due to @@deny('all', isDeleted))
    const findManyResponse = await request.get(
      `${baseURL}/api/model/projects/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: { id: projectId },
          }),
        },
      }
    );

    expect(findManyResponse.status()).toBe(200);
    const findManyResult = await findManyResponse.json();
    // ZenStack's @@deny('all', isDeleted) makes the project invisible via REST API
    expect(findManyResult.data).toHaveLength(0);

    // Also confirm it's absent from a non-filtered findFirst
    const findFirstResponse = await request.get(
      `${baseURL}/api/model/projects/findFirst`,
      {
        params: {
          q: JSON.stringify({
            where: { id: projectId },
          }),
        },
      }
    );

    expect(findFirstResponse.status()).toBe(200);
    const findFirstResult = await findFirstResponse.json();
    // Soft-deleted projects are filtered out by ZenStack access policies
    expect(findFirstResult.data).toBeNull();
  });

  test("should list projects via findMany", async ({
    request,
    baseURL,
    api,
  }) => {
    const ts = Date.now();
    const name1 = `E2E Project List A ${ts}`;
    const name2 = `E2E Project List B ${ts}`;

    // Create 2 projects
    await api.createProject(name1);
    await api.createProject(name2);

    // List them via findMany filtering by name
    const findManyResponse = await request.get(
      `${baseURL}/api/model/projects/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: {
              name: { in: [name1, name2] },
              isDeleted: false,
            },
          }),
        },
      }
    );

    expect(findManyResponse.status()).toBe(200);
    const result = await findManyResponse.json();
    expect(result.data.length).toBeGreaterThanOrEqual(2);

    const names = result.data.map((p: { name: string }) => p.name);
    expect(names).toContain(name1);
    expect(names).toContain(name2);
  });

  test("should count projects", async ({ request, baseURL }) => {
    // Count all non-deleted projects
    const countResponse = await request.get(
      `${baseURL}/api/model/projects/count`,
      {
        params: {
          q: JSON.stringify({
            where: { isDeleted: false },
          }),
        },
      }
    );

    expect(countResponse.status()).toBe(200);
    const result = await countResponse.json();
    // ZenStack v3 returns { data: number } for count
    expect(typeof result.data).toBe("number");
    expect(result.data).toBeGreaterThanOrEqual(0);
  });
});
