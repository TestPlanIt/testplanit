import { expect, test } from "../../fixtures/index";

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Tags CRUD", () => {
  test("should create a tag and read it back", async ({ api, request, baseURL }) => {
    const tagName = `API Tag ${Date.now()}-1`;
    const tagId = await api.createTag(tagName);

    const response = await request.get(
      `${baseURL}/api/model/tags/findFirst`,
      {
        params: {
          q: JSON.stringify({ where: { id: tagId } }),
        },
      }
    );

    expect(response.ok()).toBe(true);
    const result = await response.json();
    expect(result.data.name).toBe(tagName);
    expect(result.data.isDeleted).toBe(false);
  });

  test("should update a tag name", async ({ api, request, baseURL }) => {
    const originalName = `API Tag ${Date.now()}-update-orig`;
    const newName = `API Tag ${Date.now()}-update-new`;
    const tagId = await api.createTag(originalName);

    const updateResponse = await request.patch(
      `${baseURL}/api/model/tags/update`,
      {
        data: {
          where: { id: tagId },
          data: { name: newName },
        },
      }
    );

    expect(updateResponse.ok()).toBe(true);

    const readResponse = await request.get(
      `${baseURL}/api/model/tags/findFirst`,
      {
        params: {
          q: JSON.stringify({ where: { id: tagId } }),
        },
      }
    );

    expect(readResponse.ok()).toBe(true);
    const result = await readResponse.json();
    expect(result.data.name).toBe(newName);
  });

  test("should soft-delete a tag", async ({ api, request, baseURL }) => {
    const tagName = `API Tag ${Date.now()}-delete`;
    const tagId = await api.createTag(tagName);

    await api.deleteTag(tagId);

    const response = await request.get(
      `${baseURL}/api/model/tags/findFirst`,
      {
        params: {
          q: JSON.stringify({ where: { id: tagId } }),
        },
      }
    );

    expect(response.ok()).toBe(true);
    const result = await response.json();
    expect(result.data.isDeleted).toBe(true);
  });

  test("should link a tag to a repository case", async ({ api, request, baseURL }) => {
    const tagName = `API Tag ${Date.now()}-link`;

    // Create a fresh project with proper setup
    const projectId = await api.createProject(`API Tag Link Test Project ${Date.now()}`);
    const folderId = await api.getRootFolderId(projectId);
    const caseId = await api.createTestCase(projectId, folderId, `Test Case ${Date.now()}`);
    const tagId = await api.createTag(tagName);

    // Link tag to case
    const linkResponse = await request.patch(
      `${baseURL}/api/model/repositoryCases/update`,
      {
        data: {
          where: { id: caseId },
          data: {
            tags: {
              connect: [{ id: tagId }],
            },
          },
        },
      }
    );

    expect(linkResponse.ok()).toBe(true);

    // Read back with include tags
    const readResponse = await request.get(
      `${baseURL}/api/model/repositoryCases/findFirst`,
      {
        params: {
          q: JSON.stringify({
            where: { id: caseId },
            include: { tags: true },
          }),
        },
      }
    );

    expect(readResponse.ok()).toBe(true);
    const result = await readResponse.json();
    expect(result.data.tags).toBeDefined();
    const linkedTag = result.data.tags.find((t: { id: number }) => t.id === tagId);
    expect(linkedTag).toBeDefined();
  });

  test("should unlink a tag from a repository case", async ({ api, request, baseURL }) => {
    const tagName = `API Tag ${Date.now()}-unlink`;

    // Create a fresh project with proper setup
    const projectId = await api.createProject(`API Tag Unlink Test Project ${Date.now()}`);
    const folderId = await api.getRootFolderId(projectId);
    const caseId = await api.createTestCase(projectId, folderId, `Test Case ${Date.now()}`);
    const tagId = await api.createTag(tagName);

    // Link tag to case first
    await request.patch(
      `${baseURL}/api/model/repositoryCases/update`,
      {
        data: {
          where: { id: caseId },
          data: {
            tags: {
              connect: [{ id: tagId }],
            },
          },
        },
      }
    );

    // Unlink tag from case
    const unlinkResponse = await request.patch(
      `${baseURL}/api/model/repositoryCases/update`,
      {
        data: {
          where: { id: caseId },
          data: {
            tags: {
              disconnect: [{ id: tagId }],
            },
          },
        },
      }
    );

    expect(unlinkResponse.ok()).toBe(true);

    // Read back and verify tag is no longer linked
    const readResponse = await request.get(
      `${baseURL}/api/model/repositoryCases/findFirst`,
      {
        params: {
          q: JSON.stringify({
            where: { id: caseId },
            include: { tags: true },
          }),
        },
      }
    );

    expect(readResponse.ok()).toBe(true);
    const result = await readResponse.json();
    const linkedTag = result.data.tags.find((t: { id: number }) => t.id === tagId);
    expect(linkedTag).toBeUndefined();
  });

  test("should link multiple tags to a case", async ({ api, request, baseURL }) => {
    const ts = Date.now();

    // Create a fresh project with proper setup
    const projectId = await api.createProject(`API Multi-Tag Test Project ${ts}`);
    const folderId = await api.getRootFolderId(projectId);
    const caseId = await api.createTestCase(projectId, folderId, `Test Case ${ts}`);

    // Create 3 tags
    const tagId1 = await api.createTag(`API Tag ${ts}-multi-1`);
    const tagId2 = await api.createTag(`API Tag ${ts}-multi-2`);
    const tagId3 = await api.createTag(`API Tag ${ts}-multi-3`);

    // Connect all 3 tags in a single update
    const linkResponse = await request.patch(
      `${baseURL}/api/model/repositoryCases/update`,
      {
        data: {
          where: { id: caseId },
          data: {
            tags: {
              connect: [{ id: tagId1 }, { id: tagId2 }, { id: tagId3 }],
            },
          },
        },
      }
    );

    expect(linkResponse.ok()).toBe(true);

    // Read back with include tags
    const readResponse = await request.get(
      `${baseURL}/api/model/repositoryCases/findFirst`,
      {
        params: {
          q: JSON.stringify({
            where: { id: caseId },
            include: { tags: true },
          }),
        },
      }
    );

    expect(readResponse.ok()).toBe(true);
    const result = await readResponse.json();
    expect(result.data.tags).toBeDefined();
    expect(result.data.tags.length).toBeGreaterThanOrEqual(3);

    // Verify all three tag IDs are present
    const tagIds = result.data.tags.map((t: { id: number }) => t.id);
    expect(tagIds).toContain(tagId1);
    expect(tagIds).toContain(tagId2);
    expect(tagIds).toContain(tagId3);
  });
});
