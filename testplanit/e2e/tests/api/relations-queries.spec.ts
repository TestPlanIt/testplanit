import { expect, test } from "../../fixtures/index";

/**
 * Filter, OrderBy, Pagination, and Count API Tests
 *
 * Verifies that findMany with where filters, orderBy, skip/take pagination,
 * and count operations work correctly through the ZenStack REST API.
 *
 * These tests cover REL-03 (filters, orderBy, pagination) and REL-04 (count
 * on multiple models) as regression tests for the ZenStack v2→v3 upgrade.
 */
test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Filter, OrderBy, Pagination, and Count", () => {
  test("should filter RepositoryCases by name pattern", async ({
    request,
    baseURL,
    api,
  }) => {
    const prefix = `FilterTest-${Date.now()}`;
    let projectId: number | undefined;
    let folderId: number | undefined;

    await test.step("Create a project with three distinctly named cases", async () => {
      projectId = await api.createProject(`E2E Filter Project ${Date.now()}`);
      folderId = await api.getRootFolderId(projectId);

      await api.createTestCase(projectId, folderId, `${prefix}-Alpha`);
      await api.createTestCase(projectId, folderId, `${prefix}-Beta`);
      await api.createTestCase(projectId, folderId, `${prefix}-Gamma`);
    });

    await test.step("Query cases filtered by name containing Alpha and verify one match", async () => {
      const filterResponse = await request.get(
        `${baseURL}/api/model/repositoryCases/findMany`,
        {
          params: {
            q: JSON.stringify({
              where: {
                projectId,
                name: { contains: "Alpha" },
                isDeleted: false,
              },
            }),
          },
        }
      );

      expect(filterResponse.status()).toBe(200);
      const result = await filterResponse.json();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toContain("Alpha");
    });
  });

  test("should order RepositoryCases by name ascending and descending", async ({
    request,
    baseURL,
    api,
  }) => {
    const prefix = `OrderTest-${Date.now()}`;
    let projectId: number | undefined;
    let folderId: number | undefined;

    await test.step("Create a project with cases named A, B, and C", async () => {
      projectId = await api.createProject(`E2E OrderBy Project ${Date.now()}`);
      folderId = await api.getRootFolderId(projectId);

      await api.createTestCase(projectId, folderId, `${prefix}-A`);
      await api.createTestCase(projectId, folderId, `${prefix}-B`);
      await api.createTestCase(projectId, folderId, `${prefix}-C`);
    });

    await test.step("Query cases ordered by name ascending and verify A, B, C order", async () => {
      const ascResponse = await request.get(
        `${baseURL}/api/model/repositoryCases/findMany`,
        {
          params: {
            q: JSON.stringify({
              where: {
                projectId,
                name: { startsWith: prefix },
                isDeleted: false,
              },
              orderBy: { name: "asc" },
            }),
          },
        }
      );

      expect(ascResponse.status()).toBe(200);
      const ascResult = await ascResponse.json();
      expect(ascResult.data).toHaveLength(3);
      const ascNames = ascResult.data.map((c: { name: string }) => c.name);
      expect(ascNames[0]).toBe(`${prefix}-A`);
      expect(ascNames[1]).toBe(`${prefix}-B`);
      expect(ascNames[2]).toBe(`${prefix}-C`);
    });

    await test.step("Query cases ordered by name descending and verify C, B, A order", async () => {
      const descResponse = await request.get(
        `${baseURL}/api/model/repositoryCases/findMany`,
        {
          params: {
            q: JSON.stringify({
              where: {
                projectId,
                name: { startsWith: prefix },
                isDeleted: false,
              },
              orderBy: { name: "desc" },
            }),
          },
        }
      );

      expect(descResponse.status()).toBe(200);
      const descResult = await descResponse.json();
      expect(descResult.data).toHaveLength(3);
      const descNames = descResult.data.map((c: { name: string }) => c.name);
      expect(descNames[0]).toBe(`${prefix}-C`);
      expect(descNames[1]).toBe(`${prefix}-B`);
      expect(descNames[2]).toBe(`${prefix}-A`);
    });
  });

  test("should paginate RepositoryCases with skip and take", async ({
    request,
    baseURL,
    api,
  }) => {
    const prefix = `PageTest-${Date.now()}`;
    let projectId: number | undefined;
    let folderId: number | undefined;
    let baseWhere:
      | {
          projectId: number;
          name: { startsWith: string };
          isDeleted: boolean;
        }
      | undefined;
    let page1Names: string[] | undefined;
    let page2Names: string[] | undefined;

    await test.step("Create a project with five ordered cases", async () => {
      projectId = await api.createProject(`E2E Pagination Project ${Date.now()}`);
      folderId = await api.getRootFolderId(projectId);

      await api.createTestCase(projectId, folderId, `${prefix}-01`);
      await api.createTestCase(projectId, folderId, `${prefix}-02`);
      await api.createTestCase(projectId, folderId, `${prefix}-03`);
      await api.createTestCase(projectId, folderId, `${prefix}-04`);
      await api.createTestCase(projectId, folderId, `${prefix}-05`);

      baseWhere = {
        projectId,
        name: { startsWith: prefix },
        isDeleted: false,
      };
    });

    await test.step("Fetch page 1 (skip 0, take 2) and verify two records", async () => {
      const page1Response = await request.get(
        `${baseURL}/api/model/repositoryCases/findMany`,
        {
          params: {
            q: JSON.stringify({
              where: baseWhere,
              orderBy: { name: "asc" },
              skip: 0,
              take: 2,
            }),
          },
        }
      );

      expect(page1Response.status()).toBe(200);
      const page1Result = await page1Response.json();
      expect(page1Result.data).toHaveLength(2);
      page1Names = page1Result.data.map((c: { name: string }) => c.name);
    });

    await test.step("Fetch page 2 (skip 2, take 2) and verify it has different records than page 1", async () => {
      const page2Response = await request.get(
        `${baseURL}/api/model/repositoryCases/findMany`,
        {
          params: {
            q: JSON.stringify({
              where: baseWhere,
              orderBy: { name: "asc" },
              skip: 2,
              take: 2,
            }),
          },
        }
      );

      expect(page2Response.status()).toBe(200);
      const page2Result = await page2Response.json();
      expect(page2Result.data).toHaveLength(2);
      page2Names = page2Result.data.map((c: { name: string }) => c.name);

      for (const name of page2Names!) {
        expect(page1Names).not.toContain(name);
      }
    });

    await test.step("Fetch final page (skip 4, take 2) and verify the single remaining record", async () => {
      const page3Response = await request.get(
        `${baseURL}/api/model/repositoryCases/findMany`,
        {
          params: {
            q: JSON.stringify({
              where: baseWhere,
              orderBy: { name: "asc" },
              skip: 4,
              take: 2,
            }),
          },
        }
      );

      expect(page3Response.status()).toBe(200);
      const page3Result = await page3Response.json();
      expect(page3Result.data).toHaveLength(1);
    });
  });

  test("should count RepositoryCases with where filter", async ({
    request,
    baseURL,
    api,
  }) => {
    const prefix = `CountTest-${Date.now()}`;
    let projectId: number | undefined;
    let folderId: number | undefined;

    await test.step("Create a project with two CountMatch and two CountOther cases", async () => {
      projectId = await api.createProject(`E2E Count RC Project ${Date.now()}`);
      folderId = await api.getRootFolderId(projectId);

      await api.createTestCase(projectId, folderId, `${prefix}-CountMatch-1`);
      await api.createTestCase(projectId, folderId, `${prefix}-CountMatch-2`);
      await api.createTestCase(projectId, folderId, `${prefix}-CountOther-1`);
      await api.createTestCase(projectId, folderId, `${prefix}-CountOther-2`);
    });

    await test.step("Count all cases under the prefix and verify the total is 4", async () => {
      const totalCountResponse = await request.get(
        `${baseURL}/api/model/repositoryCases/count`,
        {
          params: {
            q: JSON.stringify({
              where: {
                projectId,
                name: { startsWith: prefix },
                isDeleted: false,
              },
            }),
          },
        }
      );

      expect(totalCountResponse.status()).toBe(200);
      const totalResult = await totalCountResponse.json();
      // ZenStack v3 returns { data: number } for count
      expect(typeof totalResult.data).toBe("number");
      expect(totalResult.data).toBe(4);
    });

    await test.step("Count only the CountMatch cases and verify the filtered count is 2", async () => {
      const filteredCountResponse = await request.get(
        `${baseURL}/api/model/repositoryCases/count`,
        {
          params: {
            q: JSON.stringify({
              where: {
                projectId,
                name: { contains: "CountMatch" },
                isDeleted: false,
              },
            }),
          },
        }
      );

      expect(filteredCountResponse.status()).toBe(200);
      const filteredResult = await filteredCountResponse.json();
      expect(typeof filteredResult.data).toBe("number");
      expect(filteredResult.data).toBe(2);
    });

    await test.step("Verify count matches the findMany result length", async () => {
      const findManyResponse = await request.get(
        `${baseURL}/api/model/repositoryCases/findMany`,
        {
          params: {
            q: JSON.stringify({
              where: {
                projectId,
                name: { contains: "CountMatch" },
                isDeleted: false,
              },
            }),
          },
        }
      );

      expect(findManyResponse.status()).toBe(200);
      const findManyResult = await findManyResponse.json();
      expect(findManyResult.data.length).toBe(2);
    });
  });

  test("should count TestRuns with where filter", async ({
    request,
    baseURL,
    api,
  }) => {
    const prefix = `CountRun-${Date.now()}`;
    let projectId: number | undefined;

    await test.step("Create a project with three test runs under the prefix", async () => {
      projectId = await api.createProject(`E2E Count Runs Project ${Date.now()}`);

      await api.createTestRun(projectId, `${prefix}-A`);
      await api.createTestRun(projectId, `${prefix}-B`);
      await api.createTestRun(projectId, `${prefix}-C`);
    });

    await test.step("Count all runs under the prefix and verify the total is 3", async () => {
      const totalCountResponse = await request.get(
        `${baseURL}/api/model/testRuns/count`,
        {
          params: {
            q: JSON.stringify({
              where: {
                projectId,
                name: { startsWith: prefix },
              },
            }),
          },
        }
      );

      expect(totalCountResponse.status()).toBe(200);
      const totalResult = await totalCountResponse.json();
      // ZenStack v3 returns { data: number } for count
      expect(typeof totalResult.data).toBe("number");
      expect(totalResult.data).toBe(3);
    });

    await test.step("Count only the run ending in -A and verify the filtered count is 1", async () => {
      const filteredCountResponse = await request.get(
        `${baseURL}/api/model/testRuns/count`,
        {
          params: {
            q: JSON.stringify({
              where: {
                projectId,
                name: { contains: "-A" },
              },
            }),
          },
        }
      );

      expect(filteredCountResponse.status()).toBe(200);
      const filteredResult = await filteredCountResponse.json();
      expect(typeof filteredResult.data).toBe("number");
      expect(filteredResult.data).toBe(1);
    });

    await test.step("Verify count matches the findMany result length", async () => {
      const findManyResponse = await request.get(
        `${baseURL}/api/model/testRuns/findMany`,
        {
          params: {
            q: JSON.stringify({
              where: {
                projectId,
                name: { contains: "-A" },
              },
            }),
          },
        }
      );

      expect(findManyResponse.status()).toBe(200);
      const findManyResult = await findManyResponse.json();
      expect(findManyResult.data.length).toBe(1);
    });
  });
});
