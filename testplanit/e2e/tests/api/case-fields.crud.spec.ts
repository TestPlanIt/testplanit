import { expect, test } from "../../fixtures/index";

/**
 * CaseFields and CaseFieldValues CRUD API Tests
 *
 * Tests the CaseFields and CaseFieldValues models via ZenStack auto-generated REST endpoints.
 * CaseFields use soft-delete (isDeleted flag).
 * CaseFieldValues use hard DELETE.
 */

// Run serially to avoid ZenStack v3 deadlock under parallel workers
test.describe.configure({ mode: "serial" });

/**
 * Discover a valid typeId at runtime to avoid hardcoding.
 */
async function _getFirstCaseFieldTypeId(
  request: import("@playwright/test").APIRequestContext,
  baseURL: string
): Promise<number> {
  const response = await request.get(
    `${baseURL}/api/model/caseFieldTypes/findFirst`,
    {
      params: {
        q: JSON.stringify({}),
      },
    }
  );

  if (!response.ok()) {
    throw new Error(`Failed to fetch caseFieldTypes: ${response.status()}`);
  }

  const result = await response.json();
  if (!result.data) {
    throw new Error("No caseFieldTypes found in database. Run seed first.");
  }

  return result.data.id;
}

test.describe("CaseFields CRUD", () => {
  test("should create a case field and read it back", async ({
    request,
    baseURL,
    api,
  }) => {
    const timestamp = Date.now();
    const displayName = `API Field ${timestamp}`;
    const systemName = `api_field_${timestamp}`;

    let fieldId: number | undefined;
    await test.step("Create a case field via the fixture helper", async () => {
      // Use fixture helper — takes typeName string, resolves typeId internally
      fieldId = await api.createCaseField({
        displayName,
        systemName,
        typeName: "Text String",
      });
    });

    await test.step("Read the field back and verify its attributes", async () => {
      // Read back via findFirst
      const response = await request.get(
        `${baseURL}/api/model/caseFields/findFirst`,
        {
          params: {
            q: JSON.stringify({ where: { id: fieldId! } }),
          },
        }
      );

      expect(response.ok()).toBeTruthy();
      const result = await response.json();
      expect(result.data).toBeTruthy();
      expect(result.data.displayName).toBe(displayName);
      expect(result.data.systemName).toBe(systemName);
      // typeId should be set (non-null)
      expect(result.data.typeId).toBeTruthy();
      expect(result.data.isDeleted).toBe(false);
    });
  });

  test("should update a case field displayName", async ({
    request,
    baseURL,
    api,
  }) => {
    const timestamp = Date.now();
    const originalDisplay = `API Field ${timestamp}`;
    const updatedDisplay = `Updated Field ${timestamp}`;

    let fieldId: number | undefined;
    await test.step("Create a case field", async () => {
      fieldId = await api.createCaseField({
        displayName: originalDisplay,
        typeName: "Text String",
      });
    });

    await test.step("Update the field displayName", async () => {
      // PATCH update
      const updateResponse = await request.patch(
        `${baseURL}/api/model/caseFields/update`,
        {
          data: {
            where: { id: fieldId! },
            data: { displayName: updatedDisplay },
          },
        }
      );

      expect(updateResponse.ok()).toBeTruthy();
    });

    await test.step("Read the field back and verify the new displayName", async () => {
      // Read back and assert
      const readResponse = await request.get(
        `${baseURL}/api/model/caseFields/findFirst`,
        {
          params: {
            q: JSON.stringify({ where: { id: fieldId! } }),
          },
        }
      );

      expect(readResponse.ok()).toBeTruthy();
      const result = await readResponse.json();
      expect(result.data.displayName).toBe(updatedDisplay);
    });
  });

  test("should soft-delete a case field", async ({ request, baseURL, api }) => {
    const timestamp = Date.now();
    const displayName = `API Delete Field ${timestamp}`;

    let fieldId: number | undefined;
    await test.step("Create a case field", async () => {
      fieldId = await api.createCaseField({
        displayName,
        typeName: "Text String",
      });
    });

    await test.step("Soft-delete the field via PATCH", async () => {
      // Soft delete via PATCH
      const deleteResponse = await request.patch(
        `${baseURL}/api/model/caseFields/update`,
        {
          data: {
            where: { id: fieldId! },
            data: { isDeleted: true },
          },
        }
      );

      expect(deleteResponse.ok()).toBeTruthy();
    });

    await test.step("Read the field back and verify it is soft-deleted", async () => {
      // Read back and verify soft-deleted
      const readResponse = await request.get(
        `${baseURL}/api/model/caseFields/findFirst`,
        {
          params: {
            q: JSON.stringify({ where: { id: fieldId! } }),
          },
        }
      );

      expect(readResponse.ok()).toBeTruthy();
      const result = await readResponse.json();
      expect(result.data).toBeTruthy();
      expect(result.data.isDeleted).toBe(true);
    });
  });
});

test.describe("CaseFieldValues CRUD", () => {
  // CaseFieldValues need a project + test case. Create a fresh project per describe block.
  let projectId: number;
  let folderId: number;

  test.beforeAll(async ({ request: _request, baseURL: _baseURL, api }) => {
    // Create a fresh project so we get a root folder with parentId === null
    projectId = await api.createProject(
      `API FieldValues Project ${Date.now()}`
    );
    folderId = await api.getRootFolderId(projectId);
  });

  test("should create a field value for a test case", async ({
    request,
    baseURL,
    api,
  }) => {
    const timestamp = Date.now();

    let fieldId: number | undefined;
    let caseId: number | undefined;
    await test.step("Create a case field and a test case", async () => {
      // Create a field and a test case
      fieldId = await api.createCaseField({
        displayName: `Value Field ${timestamp}`,
        typeName: "Text String",
      });
      caseId = await api.createTestCase(
        projectId,
        folderId,
        `Value Test Case ${timestamp}`
      );
    });

    let valueId: number | undefined;
    await test.step("Create a field value for the test case", async () => {
      // POST to create caseFieldValue — value is Json? so pass raw value
      const createResponse = await request.post(
        `${baseURL}/api/model/caseFieldValues/create`,
        {
          data: {
            data: {
              testCaseId: caseId!,
              fieldId: fieldId!,
              value: "test value",
            },
          },
        }
      );

      expect(createResponse.ok()).toBeTruthy();
      const createResult = await createResponse.json();
      expect(createResult.data).toBeTruthy();

      valueId = createResult.data.id;
    });

    await test.step("Read the field value back and verify it", async () => {
      // Read back via findFirst
      const readResponse = await request.get(
        `${baseURL}/api/model/caseFieldValues/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: { testCaseId: caseId!, fieldId: fieldId! },
            }),
          },
        }
      );

      expect(readResponse.ok()).toBeTruthy();
      const readResult = await readResponse.json();
      expect(readResult.data).toBeTruthy();
      expect(readResult.data.value).toBe("test value");
    });

    await test.step("Clean up the field value", async () => {
      // Manual cleanup — api.cleanup() doesn't track field values
      await request.delete(`${baseURL}/api/model/caseFieldValues/delete`, {
        params: {
          q: JSON.stringify({ where: { id: valueId! } }),
        },
      });
    });
  });

  test("should update a field value", async ({ request, baseURL, api }) => {
    const timestamp = Date.now();

    let fieldId: number | undefined;
    let caseId: number | undefined;
    await test.step("Create a case field and a test case", async () => {
      fieldId = await api.createCaseField({
        displayName: `Update Value Field ${timestamp}`,
        typeName: "Text String",
      });
      caseId = await api.createTestCase(
        projectId,
        folderId,
        `Update Value Case ${timestamp}`
      );
    });

    let valueId: number | undefined;
    await test.step("Create the field value", async () => {
      // Create the field value
      const createResponse = await request.post(
        `${baseURL}/api/model/caseFieldValues/create`,
        {
          data: {
            data: {
              testCaseId: caseId!,
              fieldId: fieldId!,
              value: "original value",
            },
          },
        }
      );

      expect(createResponse.ok()).toBeTruthy();
      valueId = (await createResponse.json()).data.id;
    });

    await test.step("Update the field value", async () => {
      // PATCH update
      const updateResponse = await request.patch(
        `${baseURL}/api/model/caseFieldValues/update`,
        {
          data: {
            where: { id: valueId! },
            data: { value: "updated value" },
          },
        }
      );

      expect(updateResponse.ok()).toBeTruthy();
    });

    await test.step("Read the field value back and verify the new value", async () => {
      // Read back and verify
      const readResponse = await request.get(
        `${baseURL}/api/model/caseFieldValues/findFirst`,
        {
          params: {
            q: JSON.stringify({ where: { id: valueId! } }),
          },
        }
      );

      expect(readResponse.ok()).toBeTruthy();
      const readResult = await readResponse.json();
      expect(readResult.data.value).toBe("updated value");
    });

    await test.step("Clean up the field value", async () => {
      // Cleanup
      await request.delete(`${baseURL}/api/model/caseFieldValues/delete`, {
        params: {
          q: JSON.stringify({ where: { id: valueId! } }),
        },
      });
    });
  });

  test("should delete a field value", async ({ request, baseURL, api }) => {
    const timestamp = Date.now();

    let fieldId: number | undefined;
    let caseId: number | undefined;
    await test.step("Create a case field and a test case", async () => {
      fieldId = await api.createCaseField({
        displayName: `Delete Value Field ${timestamp}`,
        typeName: "Text String",
      });
      caseId = await api.createTestCase(
        projectId,
        folderId,
        `Delete Value Case ${timestamp}`
      );
    });

    let valueId: number | undefined;
    await test.step("Create the field value", async () => {
      // Create the field value
      const createResponse = await request.post(
        `${baseURL}/api/model/caseFieldValues/create`,
        {
          data: {
            data: {
              testCaseId: caseId!,
              fieldId: fieldId!,
              value: "to be deleted",
            },
          },
        }
      );

      expect(createResponse.ok()).toBeTruthy();
      valueId = (await createResponse.json()).data.id;
    });

    await test.step("Hard-delete the field value", async () => {
      // Hard DELETE via query param (ZenStack RPC reads args from ?q= not body)
      const deleteResponse = await request.delete(
        `${baseURL}/api/model/caseFieldValues/delete`,
        {
          params: {
            q: JSON.stringify({ where: { id: valueId! } }),
          },
        }
      );

      expect(deleteResponse.ok()).toBeTruthy();
    });

    await test.step("Verify the field value is gone", async () => {
      // Verify it's gone — findFirst should return null data
      const readResponse = await request.get(
        `${baseURL}/api/model/caseFieldValues/findFirst`,
        {
          params: {
            q: JSON.stringify({ where: { id: valueId! } }),
          },
        }
      );

      // ZenStack returns 200 with data: null when not found
      expect(readResponse.ok()).toBeTruthy();
      const readResult = await readResponse.json();
      expect(readResult.data).toBeNull();
    });
  });
});
