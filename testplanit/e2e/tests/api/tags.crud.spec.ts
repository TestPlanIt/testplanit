import { expect, test } from "../../fixtures/index";

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Tags CRUD", () => {
  test("should create a tag and read it back", async ({
    api,
    request,
    baseURL,
  }) => {
    const tagName = `API Tag ${Date.now()}-1`;
    let tagId: number | undefined;

    await test.step("Create a tag via the API", async () => {
      tagId = await api.createTag(tagName);
    });

    await test.step("Read the tag back and verify its name and not-deleted state", async () => {
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
  });

  test("should update a tag name", async ({ api, request, baseURL }) => {
    const originalName = `API Tag ${Date.now()}-update-orig`;
    const newName = `API Tag ${Date.now()}-update-new`;
    let tagId: number | undefined;

    await test.step("Create a tag with its original name", async () => {
      tagId = await api.createTag(originalName);
    });

    await test.step("Update the tag with a new name", async () => {
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
    });

    await test.step("Read the tag back and verify the new name", async () => {
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
  });

  test("should soft-delete a tag", async ({ api, request, baseURL }) => {
    const tagName = `API Tag ${Date.now()}-delete`;
    let tagId: number | undefined;

    await test.step("Create a tag via the API", async () => {
      tagId = await api.createTag(tagName);
    });

    await test.step("Delete the tag", async () => {
      await api.deleteTag(tagId!);
    });

    await test.step("Read the tag back and verify it is soft-deleted", async () => {
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
  });

  test("should link a tag to a repository case", async ({
    api,
    request,
    baseURL,
  }) => {
    const tagName = `API Tag ${Date.now()}-link`;
    let caseId: number | undefined;
    let tagId: number | undefined;

    await test.step("Create a project, test case, and tag", async () => {
      // Create a fresh project with proper setup
      const projectId = await api.createProject(
        `API Tag Link Test Project ${Date.now()}`
      );
      const folderId = await api.getRootFolderId(projectId);
      caseId = await api.createTestCase(
        projectId,
        folderId,
        `Test Case ${Date.now()}`
      );
      tagId = await api.createTag(tagName);
    });

    await test.step("Link the tag to the repository case", async () => {
      // Link tag to case via explicit join model
      const linkResponse = await request.post(
        `${baseURL}/api/model/repositoryCaseTag/create`,
        {
          data: {
            data: { caseId, tagId },
          },
        }
      );

      expect(linkResponse.ok()).toBe(true);
    });

    await test.step("Read the case back and verify the tag is linked", async () => {
      // Read back with include caseTags
      const readResponse = await request.get(
        `${baseURL}/api/model/repositoryCases/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: { id: caseId },
              include: { caseTags: { include: { tag: true } } },
            }),
          },
        }
      );

      expect(readResponse.ok()).toBe(true);
      const result = await readResponse.json();
      expect(result.data.caseTags).toBeDefined();
      const linkedTags = result.data.caseTags.map(
        (ct: { tag: { id: number } }) => ct.tag
      );
      const linkedTag = linkedTags.find((t: { id: number }) => t.id === tagId);
      expect(linkedTag).toBeDefined();
    });
  });

  test("should unlink a tag from a repository case", async ({
    api,
    request,
    baseURL,
  }) => {
    const tagName = `API Tag ${Date.now()}-unlink`;
    let caseId: number | undefined;
    let tagId: number | undefined;

    await test.step("Create a project, test case, and tag", async () => {
      // Create a fresh project with proper setup
      const projectId = await api.createProject(
        `API Tag Unlink Test Project ${Date.now()}`
      );
      const folderId = await api.getRootFolderId(projectId);
      caseId = await api.createTestCase(
        projectId,
        folderId,
        `Test Case ${Date.now()}`
      );
      tagId = await api.createTag(tagName);
    });

    await test.step("Link the tag to the repository case", async () => {
      // Link tag to case first via explicit join model
      await request.post(`${baseURL}/api/model/repositoryCaseTag/create`, {
        data: {
          data: { caseId, tagId },
        },
      });
    });

    await test.step("Unlink the tag from the repository case", async () => {
      // Unlink tag from case via explicit join model.
      // ZenStack v3 RPC reads delete/deleteMany args from the `q` query param
      // and only accepts the DELETE method (not POST).
      const unlinkResponse = await request.delete(
        `${baseURL}/api/model/repositoryCaseTag/deleteMany`,
        {
          params: {
            q: JSON.stringify({ where: { caseId, tagId } }),
          },
        }
      );

      expect(unlinkResponse.ok()).toBe(true);
    });

    await test.step("Read the case back and verify the tag is no longer linked", async () => {
      // Read back and verify tag is no longer linked
      const readResponse = await request.get(
        `${baseURL}/api/model/repositoryCases/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: { id: caseId },
              include: { caseTags: { include: { tag: true } } },
            }),
          },
        }
      );

      expect(readResponse.ok()).toBe(true);
      const result = await readResponse.json();
      const linkedTags = result.data.caseTags.map(
        (ct: { tag: { id: number } }) => ct.tag
      );
      const linkedTag = linkedTags.find((t: { id: number }) => t.id === tagId);
      expect(linkedTag).toBeUndefined();
    });
  });

  test("should link multiple tags to a case", async ({
    api,
    request,
    baseURL,
  }) => {
    const ts = Date.now();
    let caseId: number | undefined;
    let tagId1: number | undefined;
    let tagId2: number | undefined;
    let tagId3: number | undefined;

    await test.step("Create a project, test case, and three tags", async () => {
      // Create a fresh project with proper setup
      const projectId = await api.createProject(
        `API Multi-Tag Test Project ${ts}`
      );
      const folderId = await api.getRootFolderId(projectId);
      caseId = await api.createTestCase(projectId, folderId, `Test Case ${ts}`);

      // Create 3 tags
      tagId1 = await api.createTag(`API Tag ${ts}-multi-1`);
      tagId2 = await api.createTag(`API Tag ${ts}-multi-2`);
      tagId3 = await api.createTag(`API Tag ${ts}-multi-3`);
    });

    await test.step("Link all three tags to the case via the explicit join model", async () => {
      // Connect all 3 tags via the explicit join model
      const linkResponses = await Promise.all(
        [tagId1, tagId2, tagId3].map((tagId) =>
          request.post(`${baseURL}/api/model/repositoryCaseTag/create`, {
            data: {
              data: { caseId, tagId },
            },
          })
        )
      );

      for (const linkResponse of linkResponses) {
        expect(linkResponse.ok()).toBe(true);
      }
    });

    await test.step("Read the case back and verify all three tags are linked", async () => {
      // Read back with include caseTags
      const readResponse = await request.get(
        `${baseURL}/api/model/repositoryCases/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: { id: caseId },
              include: { caseTags: { include: { tag: true } } },
            }),
          },
        }
      );

      expect(readResponse.ok()).toBe(true);
      const result = await readResponse.json();
      expect(result.data.caseTags).toBeDefined();
      expect(result.data.caseTags.length).toBeGreaterThanOrEqual(3);

      // Verify all three tag IDs are present
      const tagIds = result.data.caseTags.map(
        (ct: { tag: { id: number } }) => ct.tag.id
      );
      expect(tagIds).toContain(tagId1);
      expect(tagIds).toContain(tagId2);
      expect(tagIds).toContain(tagId3);
    });
  });
});
