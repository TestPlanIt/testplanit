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
    const projectId = await api.createProject(`TR-CRUD-Project-${Date.now()}`);
    const uniqueName = `Test Run Create ${Date.now()}`;

    const testRunId = await api.createTestRun(projectId, uniqueName);

    const testRun = await api.getTestRun(testRunId);

    expect(testRun).not.toBeNull();
    expect(testRun.name).toBe(uniqueName);
    expect(testRun.projectId).toBe(projectId);
    expect(testRun.isCompleted).toBe(false);
    expect(testRun.isDeleted).toBe(false);
  });

  test("should update a test run to completed", async ({ request, api }) => {
    const projectId = await api.createProject(`TR-CRUD-Project-${Date.now()}`);
    const uniqueName = `Test Run Update ${Date.now()}`;

    const testRunId = await api.createTestRun(projectId, uniqueName);

    // PATCH to mark completed
    const updateResponse = await request.patch(
      `/api/model/testRuns/update`,
      {
        data: {
          where: { id: testRunId },
          data: { isCompleted: true },
        },
      }
    );
    expect(updateResponse.ok()).toBeTruthy();

    // Read back and verify
    const testRun = await api.getTestRun(testRunId);
    expect(testRun).not.toBeNull();
    expect(testRun.isCompleted).toBe(true);
  });

  test("should soft-delete a test run", async ({ request, api }) => {
    const projectId = await api.createProject(`TR-CRUD-Project-${Date.now()}`);
    const uniqueName = `Test Run SoftDelete ${Date.now()}`;

    const testRunId = await api.createTestRun(projectId, uniqueName);

    // Soft-delete by setting isDeleted: true
    const deleteResponse = await request.patch(
      `/api/model/testRuns/update`,
      {
        data: {
          where: { id: testRunId },
          data: { isDeleted: true },
        },
      }
    );
    expect(deleteResponse.ok()).toBeTruthy();

    // Read back via findFirst — should show isDeleted: true
    const findResponse = await request.get(
      `/api/model/testRuns/findFirst`,
      {
        params: {
          q: JSON.stringify({
            where: { id: testRunId },
          }),
        },
      }
    );
    expect(findResponse.ok()).toBeTruthy();
    const found = await findResponse.json();
    expect(found.data).not.toBeNull();
    expect(found.data.isDeleted).toBe(true);

    // findMany with isDeleted: false should NOT include it
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

  test("should add a test case to a test run", async ({ request, api }) => {
    const projectId = await api.createProject(`TR-CRUD-Project-${Date.now()}`);
    const folderId = await api.getRootFolderId(projectId);
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `Test Case ${Date.now()}`
    );
    const testRunId = await api.createTestRun(
      projectId,
      `Test Run AddCase ${Date.now()}`
    );

    const testRunCaseId = await api.addTestCaseToTestRun(testRunId, caseId);

    // Verify the link record exists
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

  test("should delete a test run case", async ({ request, api }) => {
    const projectId = await api.createProject(`TR-CRUD-Project-${Date.now()}`);
    const folderId = await api.getRootFolderId(projectId);
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `Test Case ${Date.now()}`
    );
    const testRunId = await api.createTestRun(
      projectId,
      `Test Run DeleteCase ${Date.now()}`
    );
    const testRunCaseId = await api.addTestCaseToTestRun(testRunId, caseId);

    // Hard DELETE the test run case
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

    // The test run case should no longer be found
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

    // The parent test run should still exist
    const testRun = await api.getTestRun(testRunId);
    expect(testRun).not.toBeNull();
    expect(testRun.id).toBe(testRunId);
  });

  test("should delete a test run and verify no orphan testRunCases", async ({
    request,
    api,
  }) => {
    const projectId = await api.createProject(`TR-CRUD-Project-${Date.now()}`);
    const folderId = await api.getRootFolderId(projectId);

    // Create 2 test cases to add to the run
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
    const testRunId = await api.createTestRun(
      projectId,
      `Test Run Orphan ${Date.now()}`
    );

    await api.addTestCaseToTestRun(testRunId, caseId1, { order: 1 });
    await api.addTestCaseToTestRun(testRunId, caseId2, { order: 2 });

    // Soft-delete the test run
    const deleteResponse = await request.patch(
      `/api/model/testRuns/update`,
      {
        data: {
          where: { id: testRunId },
          data: { isDeleted: true },
        },
      }
    );
    expect(deleteResponse.ok()).toBeTruthy();

    // The run cases still exist (soft-delete on run does NOT cascade-delete run cases)
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

    // Verify the test run itself is soft-deleted
    const testRun = await api.getTestRun(testRunId);
    expect(testRun).not.toBeNull();
    expect(testRun.isDeleted).toBe(true);
  });
});
