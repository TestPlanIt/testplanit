import { expect, test } from "../../fixtures";

/**
 * TestRun and TestRunCase CRUD API Tests
 *
 * Verifies that test runs can be created, linked to repository cases,
 * updated (state changes, completion), and deleted cleanly through the REST API.
 *
 * Uses isolated projects created per-test to avoid interference with seeded data.
 */
test.describe.configure({ mode: "serial" });

test.describe("TestRuns CRUD", () => {
  test("should create a test run and read it back", async ({ api }) => {
    const uniqueName = `Test Run Create ${Date.now()}`;
    let projectId: number | undefined;
    let testRunId: number | undefined;

    await test.step("Create a project and a test run in it", async () => {
      projectId = await api.createProject(`TR-CRUD-Project-${Date.now()}`);
      testRunId = await api.createTestRun(projectId, uniqueName);
    });

    await test.step("Read the test run back and verify its fields", async () => {
      const testRun = await api.getTestRun(testRunId!);

      expect(testRun).not.toBeNull();
      expect(testRun.name).toBe(uniqueName);
      expect(testRun.projectId).toBe(projectId!);
      expect(testRun.isCompleted).toBe(false);
      expect(testRun.isDeleted).toBe(false);
    });
  });

  test("should update a test run to completed", async ({ request, api }) => {
    const uniqueName = `Test Run Update ${Date.now()}`;
    let testRunId: number | undefined;

    await test.step("Create a project and a test run in it", async () => {
      const projectId = await api.createProject(
        `TR-CRUD-Project-${Date.now()}`
      );
      testRunId = await api.createTestRun(projectId, uniqueName);
    });

    await test.step("Mark the test run completed via PATCH", async () => {
      const updateResponse = await request.patch(`/api/model/testRuns/update`, {
        data: {
          where: { id: testRunId },
          data: { isCompleted: true },
        },
      });
      expect(updateResponse.ok()).toBeTruthy();
    });

    await test.step("Read back and verify the run is completed", async () => {
      const testRun = await api.getTestRun(testRunId!);
      expect(testRun).not.toBeNull();
      expect(testRun.isCompleted).toBe(true);
    });
  });

  test("should soft-delete a test run", async ({ request, api }) => {
    const uniqueName = `Test Run SoftDelete ${Date.now()}`;
    let testRunId: number | undefined;

    await test.step("Create a project and a test run in it", async () => {
      const projectId = await api.createProject(
        `TR-CRUD-Project-${Date.now()}`
      );
      testRunId = await api.createTestRun(projectId, uniqueName);
    });

    await test.step("Soft-delete the test run by setting isDeleted true", async () => {
      const deleteResponse = await request.patch(`/api/model/testRuns/update`, {
        data: {
          where: { id: testRunId },
          data: { isDeleted: true },
        },
      });
      expect(deleteResponse.ok()).toBeTruthy();
    });

    await test.step("Confirm findFirst still returns it with isDeleted true", async () => {
      const findResponse = await request.get(`/api/model/testRuns/findFirst`, {
        params: {
          q: JSON.stringify({
            where: { id: testRunId },
          }),
        },
      });
      expect(findResponse.ok()).toBeTruthy();
      const found = await findResponse.json();
      expect(found.data).not.toBeNull();
      expect(found.data.isDeleted).toBe(true);
    });

    await test.step("Confirm findMany with isDeleted false excludes it", async () => {
      const findManyResponse = await request.get(
        `/api/model/testRuns/findMany`,
        {
          params: {
            q: JSON.stringify({
              where: { id: testRunId, isDeleted: false },
            }),
          },
        }
      );
      expect(findManyResponse.ok()).toBeTruthy();
      const findMany = await findManyResponse.json();
      expect(findMany.data).toHaveLength(0);
    });
  });

  test("should add a test case to a test run", async ({ request, api }) => {
    let caseId: number | undefined;
    let testRunId: number | undefined;
    let testRunCaseId: number | undefined;

    await test.step("Create a project, a test case, and a test run", async () => {
      const projectId = await api.createProject(
        `TR-CRUD-Project-${Date.now()}`
      );
      const folderId = await api.getRootFolderId(projectId);
      caseId = await api.createTestCase(
        projectId,
        folderId,
        `Test Case ${Date.now()}`
      );
      testRunId = await api.createTestRun(
        projectId,
        `Test Run AddCase ${Date.now()}`
      );
    });

    await test.step("Add the test case to the test run", async () => {
      testRunCaseId = await api.addTestCaseToTestRun(testRunId!, caseId!);
    });

    await test.step("Verify the link record exists", async () => {
      const linkResponse = await request.get(
        `/api/model/testRunCases/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: { testRunId, repositoryCaseId: caseId },
            }),
          },
        }
      );
      expect(linkResponse.ok()).toBeTruthy();
      const link = await linkResponse.json();
      expect(link.data).not.toBeNull();
      expect(link.data.id).toBe(testRunCaseId);
      expect(link.data.testRunId).toBe(testRunId);
      expect(link.data.repositoryCaseId).toBe(caseId);
    });
  });

  test("should delete a test run case", async ({ request, api }) => {
    let testRunId: number | undefined;
    let testRunCaseId: number | undefined;

    await test.step("Create a project, a test case, a test run, and link them", async () => {
      const projectId = await api.createProject(
        `TR-CRUD-Project-${Date.now()}`
      );
      const folderId = await api.getRootFolderId(projectId);
      const caseId = await api.createTestCase(
        projectId,
        folderId,
        `Test Case ${Date.now()}`
      );
      testRunId = await api.createTestRun(
        projectId,
        `Test Run DeleteCase ${Date.now()}`
      );
      testRunCaseId = await api.addTestCaseToTestRun(testRunId, caseId);
    });

    await test.step("Hard delete the test run case", async () => {
      const deleteResponse = await request.delete(
        `/api/model/testRunCases/delete`,
        {
          params: {
            q: JSON.stringify({
              where: { id: testRunCaseId },
            }),
          },
        }
      );
      expect(deleteResponse.ok()).toBeTruthy();
    });

    await test.step("Confirm the test run case is no longer found", async () => {
      const findResponse = await request.get(
        `/api/model/testRunCases/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: { id: testRunCaseId },
            }),
          },
        }
      );
      expect(findResponse.ok()).toBeTruthy();
      const found = await findResponse.json();
      expect(found.data).toBeNull();
    });

    await test.step("Confirm the parent test run still exists", async () => {
      const testRun = await api.getTestRun(testRunId!);
      expect(testRun).not.toBeNull();
      expect(testRun.id).toBe(testRunId);
    });
  });

  test("should delete a test run and verify no orphan testRunCases", async ({
    request,
    api,
  }) => {
    let testRunId: number | undefined;

    await test.step("Create a project with two test cases and a test run, then add both cases", async () => {
      const projectId = await api.createProject(
        `TR-CRUD-Project-${Date.now()}`
      );
      const folderId = await api.getRootFolderId(projectId);

      const caseId1 = await api.createTestCase(
        projectId,
        folderId,
        `Test Case A ${Date.now()}`
      );
      const caseId2 = await api.createTestCase(
        projectId,
        folderId,
        `Test Case B ${Date.now()}`
      );
      testRunId = await api.createTestRun(
        projectId,
        `Test Run Orphan ${Date.now()}`
      );

      await api.addTestCaseToTestRun(testRunId, caseId1, { order: 1 });
      await api.addTestCaseToTestRun(testRunId, caseId2, { order: 2 });
    });

    await test.step("Soft-delete the test run", async () => {
      const deleteResponse = await request.patch(`/api/model/testRuns/update`, {
        data: {
          where: { id: testRunId },
          data: { isDeleted: true },
        },
      });
      expect(deleteResponse.ok()).toBeTruthy();
    });

    await test.step("Confirm the run cases still exist (no cascade delete)", async () => {
      const runCasesResponse = await request.get(
        `/api/model/testRunCases/findMany`,
        {
          params: {
            q: JSON.stringify({
              where: { testRunId },
            }),
          },
        }
      );
      expect(runCasesResponse.ok()).toBeTruthy();
      const runCases = await runCasesResponse.json();
      expect(runCases.data).toHaveLength(2);
    });

    await test.step("Verify the test run itself is soft-deleted", async () => {
      const testRun = await api.getTestRun(testRunId!);
      expect(testRun).not.toBeNull();
      expect(testRun.isDeleted).toBe(true);
    });
  });
});
