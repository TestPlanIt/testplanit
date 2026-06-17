import { expect, test } from "../../fixtures/index";

/**
 * RepositoryCases CRUD API Tests
 *
 * Verifies that create, read, update, and delete (soft-delete) operations
 * on the RepositoryCases model work correctly through the ZenStack REST API.
 *
 * These tests establish a regression baseline before the ZenStack v2→v3 upgrade.
 */
test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("RepositoryCases CRUD", () => {
  test("should create a repository case and read it back", async ({
    request,
    baseURL,
    api,
  }) => {
    const uniqueName = `E2E Case Create ${Date.now()}`;

    let projectId: number | undefined;
    let folderId: number | undefined;
    let caseId: number | undefined;

    await test.step("Create a fresh project and test case", async () => {
      // Create a fresh project for isolation
      projectId = await api.createProject(`E2E RC Create Project ${Date.now()}`);
      folderId = await api.getRootFolderId(projectId);

      // Create a test case using the api fixture
      caseId = await api.createTestCase(projectId, folderId, uniqueName);
      expect(caseId).toBeGreaterThan(0);
    });

    await test.step("Read the case back and verify its fields and relations", async () => {
      // Read it back via findFirst with relations
      const findResponse = await request.get(
        `${baseURL}/api/model/repositoryCases/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: { id: caseId },
              include: {
                project: true,
                folder: true,
              },
            }),
          },
        }
      );

      expect(findResponse.status()).toBe(200);
      const result = await findResponse.json();
      expect(result.data).toBeTruthy();
      expect(result.data.name).toBe(uniqueName);
      expect(result.data.projectId).toBe(projectId);
      expect(result.data.folderId).toBe(folderId);
      expect(result.data.isDeleted).toBe(false);
      // Verify the included relations
      expect(result.data.project).toBeTruthy();
      expect(result.data.folder).toBeTruthy();
    });
  });

  test("should update a repository case name", async ({
    request,
    baseURL,
    api,
  }) => {
    const originalName = `E2E Case Update Orig ${Date.now()}`;
    const newName = `E2E Case Updated ${Date.now()}`;

    let projectId: number | undefined;
    let folderId: number | undefined;
    let caseId: number | undefined;

    await test.step("Create a fresh project and test case", async () => {
      // Create a fresh project for isolation
      projectId = await api.createProject(`E2E RC Update Project ${Date.now()}`);
      folderId = await api.getRootFolderId(projectId);
      caseId = await api.createTestCase(projectId, folderId, originalName);
    });

    await test.step("Update the case name", async () => {
      // Update the case name
      const updateResponse = await request.patch(
        `${baseURL}/api/model/repositoryCases/update`,
        {
          data: {
            where: { id: caseId },
            data: { name: newName },
          },
        }
      );

      expect(updateResponse.status()).toBe(200);
    });

    await test.step("Read the case back and verify the name changed", async () => {
      // Read it back and verify the name changed
      const findResponse = await request.get(
        `${baseURL}/api/model/repositoryCases/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: { id: caseId },
            }),
          },
        }
      );

      expect(findResponse.status()).toBe(200);
      const result = await findResponse.json();
      expect(result.data.name).toBe(newName);
    });
  });

  test("should soft-delete a repository case", async ({
    request,
    baseURL,
    api,
  }) => {
    const uniqueName = `E2E Case SoftDelete ${Date.now()}`;

    let projectId: number | undefined;
    let folderId: number | undefined;
    let caseId: number | undefined;

    await test.step("Create a fresh project and test case", async () => {
      // Create a fresh project for isolation
      projectId = await api.createProject(`E2E RC Delete Project ${Date.now()}`);
      folderId = await api.getRootFolderId(projectId);
      caseId = await api.createTestCase(projectId, folderId, uniqueName);
    });

    await test.step("Confirm the case exists before soft-delete", async () => {
      // Confirm the case exists before soft-delete
      const beforeResponse = await request.get(
        `${baseURL}/api/model/repositoryCases/findFirst`,
        {
          params: {
            q: JSON.stringify({ where: { id: caseId } }),
          },
        }
      );
      expect(beforeResponse.status()).toBe(200);
      expect((await beforeResponse.json()).data).toBeTruthy();
    });

    await test.step("Soft-delete the case via PATCH", async () => {
      // Soft-delete via PATCH
      const deleteResponse = await request.patch(
        `${baseURL}/api/model/repositoryCases/update`,
        {
          data: {
            where: { id: caseId },
            data: { isDeleted: true },
          },
        }
      );

      // 200 or 422 (ZenStack v3 RESULT_NOT_READABLE when isDeleted:true) are both valid
      // indicating the update was applied
      const deleteStatus = deleteResponse.status();
      expect([200, 422]).toContain(deleteStatus);
    });

    await test.step("Verify the case is hidden by the isDeleted:false filter", async () => {
      // Verify the case no longer appears with isDeleted:false filter
      const findManyResponse = await request.get(
        `${baseURL}/api/model/repositoryCases/findMany`,
        {
          params: {
            q: JSON.stringify({
              where: { id: caseId, isDeleted: false },
            }),
          },
        }
      );

      expect(findManyResponse.status()).toBe(200);
      const findManyResult = await findManyResponse.json();
      expect(findManyResult.data).toHaveLength(0);
    });

    await test.step("Verify the case is visible when querying for deleted ones", async () => {
      // Verify the case is visible when explicitly querying for deleted ones
      const findDeletedResponse = await request.get(
        `${baseURL}/api/model/repositoryCases/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: { id: caseId, isDeleted: true },
            }),
          },
        }
      );

      expect(findDeletedResponse.status()).toBe(200);
      const deletedResult = await findDeletedResponse.json();
      expect(deletedResult.data).toBeTruthy();
      expect(deletedResult.data.isDeleted).toBe(true);
    });
  });

  test("should create multiple cases in same folder", async ({
    request,
    baseURL,
    api,
  }) => {
    const ts = Date.now();
    const prefix = `E2E Multi Case ${ts}`;

    let projectId: number | undefined;
    let folderId: number | undefined;

    await test.step("Create a fresh project and three cases in the same folder", async () => {
      // Create a fresh project for isolation
      projectId = await api.createProject(`E2E RC Multi Project ${ts}`);
      folderId = await api.getRootFolderId(projectId);

      // Create 3 cases in the same folder
      await api.createTestCase(projectId, folderId, `${prefix} A`);
      await api.createTestCase(projectId, folderId, `${prefix} B`);
      await api.createTestCase(projectId, folderId, `${prefix} C`);
    });

    await test.step("Find all three cases by folder and prefix and verify their names", async () => {
      // Find all cases in that folder with the prefix
      const findManyResponse = await request.get(
        `${baseURL}/api/model/repositoryCases/findMany`,
        {
          params: {
            q: JSON.stringify({
              where: {
                folderId,
                isDeleted: false,
                name: { startsWith: prefix },
              },
            }),
          },
        }
      );

      expect(findManyResponse.status()).toBe(200);
      const result = await findManyResponse.json();
      expect(result.data.length).toBe(3);

      // Verify all 3 case names are present
      const names = result.data.map((c: { name: string }) => c.name);
      expect(names).toContain(`${prefix} A`);
      expect(names).toContain(`${prefix} B`);
      expect(names).toContain(`${prefix} C`);
    });
  });
});
