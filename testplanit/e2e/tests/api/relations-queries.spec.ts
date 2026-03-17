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
    const projectId = await api.createProject(`E2E Filter Project ${Date.now()}`);
    const folderId = await api.getRootFolderId(projectId);

    // Create 3 test cases with distinct names
    await api.createTestCase(projectId, folderId, `${prefix}-Alpha`);
    await api.createTestCase(projectId, folderId, `${prefix}-Beta`);
    await api.createTestCase(projectId, folderId, `${prefix}-Gamma`);

    // Query only cases whose name contains "Alpha"
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

  test("should order RepositoryCases by name ascending and descending", async ({
    request,
    baseURL,
    api,
  }) => {
    const prefix = `OrderTest-${Date.now()}`;
    const projectId = await api.createProject(`E2E OrderBy Project ${Date.now()}`);
    const folderId = await api.getRootFolderId(projectId);

    // Create 3 test cases — A, B, C
    await api.createTestCase(projectId, folderId, `${prefix}-A`);
    await api.createTestCase(projectId, folderId, `${prefix}-B`);
    await api.createTestCase(projectId, folderId, `${prefix}-C`);

    // Query ascending
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

    // Query descending
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

  test("should paginate RepositoryCases with skip and take", async ({
    request,
    baseURL,
    api,
  }) => {
    const prefix = `PageTest-${Date.now()}`;
    const projectId = await api.createProject(`E2E Pagination Project ${Date.now()}`);
    const folderId = await api.getRootFolderId(projectId);

    // Create 5 test cases with ordered names
    await api.createTestCase(projectId, folderId, `${prefix}-01`);
    await api.createTestCase(projectId, folderId, `${prefix}-02`);
    await api.createTestCase(projectId, folderId, `${prefix}-03`);
    await api.createTestCase(projectId, folderId, `${prefix}-04`);
    await api.createTestCase(projectId, folderId, `${prefix}-05`);

    const baseWhere = {
      projectId,
      name: { startsWith: prefix },
      isDeleted: false,
    };

    // Page 1: skip 0, take 2
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
    const page1Names = page1Result.data.map((c: { name: string }) => c.name);

    // Page 2: skip 2, take 2
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
    const page2Names = page2Result.data.map((c: { name: string }) => c.name);

    // Page 1 and page 2 should have different records
    for (const name of page2Names) {
      expect(page1Names).not.toContain(name);
    }

    // Page 3: skip 4, take 2 — only 1 record left
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

  test("should count RepositoryCases with where filter", async ({
    request,
    baseURL,
    api,
  }) => {
    const prefix = `CountTest-${Date.now()}`;
    const projectId = await api.createProject(`E2E Count RC Project ${Date.now()}`);
    const folderId = await api.getRootFolderId(projectId);

    // Create 4 cases: 2 with "CountMatch" and 2 with "CountOther"
    await api.createTestCase(projectId, folderId, `${prefix}-CountMatch-1`);
    await api.createTestCase(projectId, folderId, `${prefix}-CountMatch-2`);
    await api.createTestCase(projectId, folderId, `${prefix}-CountOther-1`);
    await api.createTestCase(projectId, folderId, `${prefix}-CountOther-2`);

    // Total count: all 4 under this prefix
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

    // Filtered count: only the 2 "CountMatch" cases
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

    // Verify count matches actual findMany length
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

  test("should count TestRuns with where filter", async ({
    request,
    baseURL,
    api,
  }) => {
    const prefix = `CountRun-${Date.now()}`;
    const projectId = await api.createProject(`E2E Count Runs Project ${Date.now()}`);

    // Create 3 test runs with unique prefix
    await api.createTestRun(projectId, `${prefix}-A`);
    await api.createTestRun(projectId, `${prefix}-B`);
    await api.createTestRun(projectId, `${prefix}-C`);

    // Total count: all 3 runs under this prefix
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

    // Filtered count: only the run ending in "-A"
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

    // Verify count matches actual findMany length
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
