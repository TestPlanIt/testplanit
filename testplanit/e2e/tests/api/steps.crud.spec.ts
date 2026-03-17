import { expect, test } from "../../fixtures/index";

/**
 * Steps CRUD API Tests
 *
 * Verifies that create, read, update, and delete (hard delete) operations
 * on the Steps model work correctly through the ZenStack REST API.
 *
 * Steps are child records of RepositoryCases and use Tiptap JSON (ProseMirror doc format)
 * for the step and expectedResult fields.
 *
 * These tests establish a regression baseline before the ZenStack v2→v3 upgrade.
 */
test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

// Tiptap JSON format for step content
function makeTiptapDoc(text: string) {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  };
}

test.describe("Steps CRUD", () => {
  // Shared project for step tests (created once, reused across tests for performance)
  let sharedProjectId: number;
  let sharedFolderId: number;

  test.beforeAll(async ({ request, baseURL }) => {
    // We need to create a project for step tests using the API directly
    // (beforeAll doesn't have the api fixture, so we use request directly)
    // Get admin auth session to get user ID
    const sessionResponse = await request.get(`${baseURL}/api/auth/session`);
    const session = await sessionResponse.json();
    const userId = session?.user?.id;

    if (!userId) {
      throw new Error("Could not get admin user ID for beforeAll setup");
    }

    // Find the default template
    const templateResponse = await request.get(
      `${baseURL}/api/model/templates/findFirst`,
      {
        params: {
          q: JSON.stringify({ where: { isDefault: true, isDeleted: false } }),
        },
      }
    );
    const templateResult = await templateResponse.json();
    const defaultTemplateId = templateResult.data?.id;
    if (!defaultTemplateId) {
      throw new Error("No default template found");
    }

    // Create project
    const projectResponse = await request.post(
      `${baseURL}/api/model/projects/create`,
      {
        data: {
          data: {
            name: `E2E Steps Test Project ${Date.now()}`,
            isDeleted: false,
            createdBy: userId,
          },
        },
      }
    );
    expect(projectResponse.ok()).toBe(true);
    const projectResult = await projectResponse.json();
    sharedProjectId = projectResult.data.id;

    // Create repository
    const repoResponse = await request.post(
      `${baseURL}/api/model/repositories/create`,
      {
        data: {
          data: { project: { connect: { id: sharedProjectId } } },
        },
      }
    );
    const repoResult = await repoResponse.json();
    const repositoryId = repoResult.data.id;

    // Create root folder
    const folderResponse = await request.post(
      `${baseURL}/api/model/repositoryFolders/create`,
      {
        data: {
          data: {
            name: "Root Folder",
            order: 0,
            isDeleted: false,
            docs: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
            project: { connect: { id: sharedProjectId } },
            repository: { connect: { id: repositoryId } },
            creator: { connect: { id: userId } },
          },
        },
      }
    );
    const folderResult = await folderResponse.json();
    sharedFolderId = folderResult.data.id;

    // Assign template to project
    await request.post(`${baseURL}/api/model/templateProjectAssignment/create`, {
      data: {
        data: { templateId: defaultTemplateId, projectId: sharedProjectId },
      },
    });

    // Assign workflows to project
    const workflowsResponse = await request.get(
      `${baseURL}/api/model/workflows/findMany`,
      {
        params: {
          q: JSON.stringify({ where: { isDeleted: false, isEnabled: true } }),
        },
      }
    );
    const workflows = (await workflowsResponse.json()).data || [];
    if (workflows.length > 0) {
      await request.post(`${baseURL}/api/model/projectWorkflowAssignment/createMany`, {
        data: {
          data: workflows.map((w: { id: number }) => ({
            workflowId: w.id,
            projectId: sharedProjectId,
          })),
        },
      });
    }

    // Add user as project member
    await request.post(`${baseURL}/api/model/projectAssignment/create`, {
      data: { data: { userId, projectId: sharedProjectId } },
    });
  });

  test("should create a step and read it back", async ({
    request,
    baseURL,
    api,
  }) => {
    // Create a test case to attach the step to
    const caseId = await api.createTestCase(
      sharedProjectId,
      sharedFolderId,
      `E2E Step Create Case ${Date.now()}`
    );

    const stepContent = makeTiptapDoc("Step 1 action");
    const expectedResultContent = makeTiptapDoc("Expected result");

    // Create a step via POST
    const createResponse = await request.post(
      `${baseURL}/api/model/steps/create`,
      {
        data: {
          data: {
            testCaseId: caseId,
            step: stepContent,
            expectedResult: expectedResultContent,
            order: 1,
          },
        },
      }
    );

    expect(createResponse.ok()).toBe(true);
    const createResult = await createResponse.json();
    const stepId = createResult.data.id;
    expect(stepId).toBeGreaterThan(0);

    // Read back via findFirst
    const findResponse = await request.get(
      `${baseURL}/api/model/steps/findFirst`,
      {
        params: {
          q: JSON.stringify({
            where: { id: stepId },
          }),
        },
      }
    );

    expect(findResponse.ok()).toBe(true);
    const findResult = await findResponse.json();
    expect(findResult.data).toBeTruthy();
    expect(findResult.data.testCaseId).toBe(caseId);
    expect(findResult.data.order).toBe(1);
    // Verify JSON fields are stored correctly
    expect(findResult.data.step).toMatchObject(stepContent);
    expect(findResult.data.expectedResult).toMatchObject(expectedResultContent);

    // Cleanup: hard delete the step
    await request.delete(`${baseURL}/api/model/steps/delete`, {
      params: { q: JSON.stringify({ where: { id: stepId } }) },
    });
  });

  test("should update a step", async ({ request, baseURL, api }) => {
    // Create a test case
    const caseId = await api.createTestCase(
      sharedProjectId,
      sharedFolderId,
      `E2E Step Update Case ${Date.now()}`
    );

    const originalContent = makeTiptapDoc("Original step action");
    const updatedContent = makeTiptapDoc("Updated step action");

    // Create a step
    const createResponse = await request.post(
      `${baseURL}/api/model/steps/create`,
      {
        data: {
          data: {
            testCaseId: caseId,
            step: originalContent,
            expectedResult: makeTiptapDoc("Expected result"),
            order: 1,
          },
        },
      }
    );
    expect(createResponse.ok()).toBe(true);
    const stepId = (await createResponse.json()).data.id;

    // Update the step content
    const updateResponse = await request.patch(
      `${baseURL}/api/model/steps/update`,
      {
        data: {
          where: { id: stepId },
          data: { step: updatedContent },
        },
      }
    );

    expect(updateResponse.ok()).toBe(true);

    // Read back and verify the content changed
    const findResponse = await request.get(
      `${baseURL}/api/model/steps/findFirst`,
      {
        params: {
          q: JSON.stringify({ where: { id: stepId } }),
        },
      }
    );

    expect(findResponse.ok()).toBe(true);
    const findResult = await findResponse.json();
    expect(findResult.data.step).toMatchObject(updatedContent);

    // Cleanup
    await request.delete(`${baseURL}/api/model/steps/delete`, {
      params: { q: JSON.stringify({ where: { id: stepId } }) },
    });
  });

  test("should delete a step", async ({ request, baseURL, api }) => {
    // Create a test case
    const caseId = await api.createTestCase(
      sharedProjectId,
      sharedFolderId,
      `E2E Step Delete Case ${Date.now()}`
    );

    // Create a step
    const createResponse = await request.post(
      `${baseURL}/api/model/steps/create`,
      {
        data: {
          data: {
            testCaseId: caseId,
            step: makeTiptapDoc("Step to delete"),
            expectedResult: makeTiptapDoc("Expected"),
            order: 1,
          },
        },
      }
    );
    expect(createResponse.ok()).toBe(true);
    const stepId = (await createResponse.json()).data.id;

    // Hard delete the step
    // ZenStack v3 DELETE reads args from URL q param (not request body)
    const deleteResponse = await request.delete(
      `${baseURL}/api/model/steps/delete`,
      {
        params: { q: JSON.stringify({ where: { id: stepId } }) },
      }
    );

    expect(deleteResponse.ok()).toBe(true);

    // Verify the step is gone
    const findResponse = await request.get(
      `${baseURL}/api/model/steps/findFirst`,
      {
        params: {
          q: JSON.stringify({ where: { id: stepId } }),
        },
      }
    );

    expect(findResponse.ok()).toBe(true);
    const findResult = await findResponse.json();
    expect(findResult.data).toBeNull();
  });

  test("should create multiple steps and verify order", async ({
    request,
    baseURL,
    api,
  }) => {
    // Create a test case
    const caseId = await api.createTestCase(
      sharedProjectId,
      sharedFolderId,
      `E2E Step Order Case ${Date.now()}`
    );

    const stepIds: number[] = [];

    // Create 3 steps with explicit order
    for (let i = 1; i <= 3; i++) {
      const createResponse = await request.post(
        `${baseURL}/api/model/steps/create`,
        {
          data: {
            data: {
              testCaseId: caseId,
              step: makeTiptapDoc(`Step ${i} action`),
              expectedResult: makeTiptapDoc(`Expected result ${i}`),
              order: i,
            },
          },
        }
      );
      expect(createResponse.ok()).toBe(true);
      const stepId = (await createResponse.json()).data.id;
      stepIds.push(stepId);
    }

    // Find all steps for this case ordered by order asc
    const findManyResponse = await request.get(
      `${baseURL}/api/model/steps/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: { testCaseId: caseId },
            orderBy: { order: "asc" },
          }),
        },
      }
    );

    expect(findManyResponse.ok()).toBe(true);
    const result = await findManyResponse.json();
    expect(result.data.length).toBe(3);

    // Verify the order is [1, 2, 3]
    const orders = result.data.map((s: { order: number }) => s.order);
    expect(orders).toEqual([1, 2, 3]);

    // Verify step content corresponds to order
    expect(result.data[0].step).toMatchObject(makeTiptapDoc("Step 1 action"));
    expect(result.data[1].step).toMatchObject(makeTiptapDoc("Step 2 action"));
    expect(result.data[2].step).toMatchObject(makeTiptapDoc("Step 3 action"));

    // Cleanup: hard delete all steps
    for (const stepId of stepIds) {
      await request.delete(`${baseURL}/api/model/steps/delete`, {
        data: { where: { id: stepId } },
      });
    }
  });
});
