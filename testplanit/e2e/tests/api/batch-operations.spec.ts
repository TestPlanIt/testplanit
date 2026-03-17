import { expect, test } from "../../fixtures/index";

/**
 * Batch Operations API Tests
 *
 * Verifies that createMany, updateMany, and deleteMany operations
 * complete atomically through the ZenStack v3 REST API.
 *
 * These tests provide regression coverage after the ZenStack v2->v3 upgrade,
 * confirming that batch endpoints process all targeted records (not partial subsets).
 *
 * BATCH-01: createMany on Steps creates 5 records atomically
 * BATCH-02: updateMany on RepositoryCases updates 3 records atomically
 * BATCH-03: deleteMany on Tags removes 4 records atomically
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

test.describe("Batch Operations - createMany Steps (BATCH-01)", () => {
  let projectId: number;
  let folderId: number;
  let caseId: number;

  test("setup: create project and test case for steps", async ({ api }) => {
    projectId = await api.createProject(`Batch Steps Project ${Date.now()}`);
    folderId = await api.getRootFolderId(projectId);
    caseId = await api.createTestCase(
      projectId,
      folderId,
      `Batch Steps Case ${Date.now()}`
    );
    expect(caseId).toBeGreaterThan(0);
  });

  test("createMany creates all 5 steps atomically", async ({
    request,
    baseURL,
  }) => {
    // Build array of 5 step objects using scalar testCaseId (not relation connect)
    // createMany does NOT support nested relation connects
    const stepsArray = Array.from({ length: 5 }, (_, i) => ({
      testCaseId: caseId,
      step: JSON.stringify(makeTiptapDoc(`Step ${i + 1}`)),
      expectedResult: JSON.stringify(makeTiptapDoc(`Expected ${i + 1}`)),
      order: i + 1,
      isDeleted: false,
    }));

    // POST to createMany endpoint
    const createManyResponse = await request.post(
      `${baseURL}/api/model/steps/createMany`,
      {
        data: { data: stepsArray },
      }
    );

    // createMany returns 201 Created
    expect(createManyResponse.ok()).toBe(true);

    // createMany returns { data: { count: N } }
    const createManyResult = await createManyResponse.json();
    expect(createManyResult.data.count).toBe(5);

    // Verify by reading back all 5 steps
    const findManyResponse = await request.get(
      `${baseURL}/api/model/steps/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: { testCaseId: caseId, isDeleted: false },
            orderBy: { order: "asc" },
          }),
        },
      }
    );

    expect(findManyResponse.ok()).toBe(true);
    const result = await findManyResponse.json();
    expect(result.data.length).toBe(5);

    // Verify all 5 orders (1-5) are present
    const orders = result.data.map((s: { order: number }) => s.order);
    expect(orders).toContain(1);
    expect(orders).toContain(2);
    expect(orders).toContain(3);
    expect(orders).toContain(4);
    expect(orders).toContain(5);
  });
});

test.describe("Batch Operations - updateMany RepositoryCases (BATCH-02)", () => {
  let projectId: number;
  let folderId: number;
  let caseIds: number[];

  test("setup: create project and 3 test cases for batch update", async ({
    api,
  }) => {
    const ts = Date.now();
    projectId = await api.createProject(`Batch Update Project ${ts}`);
    folderId = await api.getRootFolderId(projectId);

    caseIds = await Promise.all([
      api.createTestCase(projectId, folderId, `Batch Update Case A ${ts}`),
      api.createTestCase(projectId, folderId, `Batch Update Case B ${ts}`),
      api.createTestCase(projectId, folderId, `Batch Update Case C ${ts}`),
    ]);

    expect(caseIds.length).toBe(3);
    expect(caseIds.every((id) => id > 0)).toBe(true);
  });

  test("updateMany updates all 3 cases atomically", async ({
    request,
    baseURL,
  }) => {
    // PATCH to updateMany endpoint — set isArchived: true on all 3 cases
    const updateManyResponse = await request.patch(
      `${baseURL}/api/model/repositoryCases/updateMany`,
      {
        data: {
          where: { id: { in: caseIds } },
          data: { isArchived: true },
        },
      }
    );

    expect(updateManyResponse.ok()).toBe(true);

    // updateMany returns { data: { count: N } }
    const updateManyResult = await updateManyResponse.json();
    expect(updateManyResult.data.count).toBe(3);

    // Verify by reading back all 3 cases
    const findManyResponse = await request.get(
      `${baseURL}/api/model/repositoryCases/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: { id: { in: caseIds } },
          }),
        },
      }
    );

    expect(findManyResponse.ok()).toBe(true);
    const result = await findManyResponse.json();
    expect(result.data.length).toBe(3);

    // All 3 cases must have isArchived: true
    expect(result.data.every((c: { isArchived: boolean }) => c.isArchived === true)).toBe(true);
  });
});

test.describe("Batch Operations - deleteMany Tags (BATCH-03)", () => {
  let tagIds: number[];

  test("setup: create 4 tags for batch delete", async ({ api }) => {
    const ts = Date.now();
    tagIds = await Promise.all([
      api.createTag(`Batch Tag 1 ${ts}`),
      api.createTag(`Batch Tag 2 ${ts}`),
      api.createTag(`Batch Tag 3 ${ts}`),
      api.createTag(`Batch Tag 4 ${ts}`),
    ]);

    expect(tagIds.length).toBe(4);
    expect(tagIds.every((id) => id > 0)).toBe(true);
  });

  test("deleteMany hard-deletes all 4 tags atomically", async ({
    request,
    baseURL,
  }) => {
    // DELETE to deleteMany endpoint with where filter in q param
    // ZenStack v3 tags/deleteMany requires DELETE method (not POST)
    const deleteManyResponse = await request.delete(
      `${baseURL}/api/model/tags/deleteMany`,
      {
        params: {
          q: JSON.stringify({ where: { id: { in: tagIds } } }),
        },
      }
    );

    expect(deleteManyResponse.ok()).toBe(true);

    // deleteMany returns { data: { count: N } }
    const deleteManyResult = await deleteManyResponse.json();
    expect(deleteManyResult.data.count).toBe(4);

    // Verify by reading back — all rows should be gone (hard delete)
    const findManyResponse = await request.get(
      `${baseURL}/api/model/tags/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: { id: { in: tagIds } },
          }),
        },
      }
    );

    expect(findManyResponse.ok()).toBe(true);
    const result = await findManyResponse.json();
    // All 4 tags are hard-deleted — no rows remain
    expect(result.data.length).toBe(0);
  });
});
