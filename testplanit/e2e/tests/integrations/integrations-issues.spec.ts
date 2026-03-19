import { expect, test } from "../../fixtures/index";

/**
 * Integration Issue Operations E2E Tests
 *
 * Covers INTG-01, INTG-02:
 * - SIMPLE_URL issue create, link, unlink full cycle (these work without external APIs)
 * - External provider endpoints return expected error shapes (not crashes)
 * - Invalid input returns 400 with proper validation errors
 * - Unauthenticated requests return 401 across all endpoints
 * - Sync endpoint handles missing issues (404) gracefully
 *
 * Note: GitHub/Jira/Azure DevOps create-issue and search tests intentionally fail
 * at the adapter level since no real external services are available in E2E env.
 * We assert the error shape to confirm no unexpected crashes.
 */
test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test.describe("Issue Operations - SIMPLE_URL Full Cycle", () => {
  let integrationId: number;
  let projectId: number;
  let testCaseId: number;
  let issueId: number;

  test.beforeAll(async ({ request, baseURL, api }) => {
    // Create SIMPLE_URL integration
    const integrationResponse = await request.post(
      `${baseURL}/api/integrations`,
      {
        data: {
          name: `E2E SimpleURL Issues ${uniqueId}`,
          type: "SIMPLE_URL",
          authType: "NONE",
          config: {
            baseUrl: "https://tracker.example.com/{issueId}",
          },
        },
      }
    );
    expect(integrationResponse.status()).toBe(201);
    const integration = await integrationResponse.json();
    integrationId = integration.id;

    // Create a project and link the integration
    projectId = await api.createProject(`E2E Issues Project ${uniqueId}`);

    await request.post(`${baseURL}/api/model/projectIntegration/create`, {
      data: {
        data: {
          project: { connect: { id: projectId } },
          integration: { connect: { id: integrationId } },
          isActive: true,
        },
      },
    });

    // Create a test case to link issues to
    const folderId = await api.getRootFolderId(projectId);
    testCaseId = await api.createTestCase(
      projectId,
      folderId,
      `E2E Issue Link Case ${uniqueId}`
    );
  });

  test("Can create an issue record linked to an integration", async ({
    request,
    baseURL,
  }) => {
    // Get admin user ID for createdBy
    const userResponse = await request.get(
      `${baseURL}/api/model/user/findFirst`,
      {
        params: {
          q: JSON.stringify({
            where: { access: "ADMIN", isDeleted: false },
            select: { id: true },
          }),
        },
      }
    );
    expect(userResponse.status()).toBe(200);
    const userResult = await userResponse.json();
    const adminUserId = userResult.data?.id;
    expect(adminUserId).toBeTruthy();

    // Create an issue via ZenStack create endpoint
    // ZenStack v3 requires relation connect syntax (no scalar FKs for relation fields)
    const createResponse = await request.post(
      `${baseURL}/api/model/issue/create`,
      {
        data: {
          data: {
            name: `E2E-ISSUE-${uniqueId}`,
            title: `E2E Test Issue ${uniqueId}`,
            externalId: `EXT-${uniqueId}`,
            integration: { connect: { id: integrationId } },
            project: { connect: { id: projectId } },
            createdBy: { connect: { id: adminUserId } },
          },
        },
      }
    );

    expect([200, 201].includes(createResponse.status())).toBe(true);
    const createResult = await createResponse.json();
    issueId = createResult.data?.id;
    expect(issueId).toBeTruthy();
    expect(createResult.data.externalId).toBe(`EXT-${uniqueId}`);
  });

  test("Can link the issue to a test case via POST /api/issues/{id}/link", async ({
    request,
    baseURL,
  }) => {
    expect(issueId).toBeTruthy();

    const response = await request.post(
      `${baseURL}/api/issues/${issueId}/link`,
      {
        data: {
          entityType: "testCase",
          entityId: String(testCaseId),
        },
      }
    );

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("id");
  });

  test("Linked issue appears in test case's issues query", async ({
    request,
    baseURL,
  }) => {
    expect(issueId).toBeTruthy();

    const response = await request.get(
      `${baseURL}/api/model/issue/findFirst`,
      {
        params: {
          q: JSON.stringify({
            where: {
              id: issueId,
              repositoryCases: { some: { id: testCaseId } },
            },
          }),
        },
      }
    );

    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.data).toBeTruthy();
    expect(result.data.id).toBe(issueId);
  });

  test("Can unlink the issue from the test case via POST /api/issues/{id}/unlink", async ({
    request,
    baseURL,
  }) => {
    expect(issueId).toBeTruthy();

    const response = await request.post(
      `${baseURL}/api/issues/${issueId}/unlink`,
      {
        data: {
          entityType: "testCase",
          entityId: String(testCaseId),
        },
      }
    );

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("id");
  });

  test("After unlink, issue is no longer associated with test case", async ({
    request,
    baseURL,
  }) => {
    expect(issueId).toBeTruthy();

    const response = await request.get(
      `${baseURL}/api/model/issue/findFirst`,
      {
        params: {
          q: JSON.stringify({
            where: {
              id: issueId,
              repositoryCases: { some: { id: testCaseId } },
            },
          }),
        },
      }
    );

    expect(response.status()).toBe(200);
    const result = await response.json();
    // Should be null since we unlinked
    expect(result.data).toBeNull();
  });

  test.afterAll(async ({ request, baseURL }) => {
    // Cleanup project integration link first (blocks integration deletion)
    const linkResponse = await request.get(
      `${baseURL}/api/model/projectIntegration/findMany`,
      {
        params: {
          q: JSON.stringify({ where: { integrationId, projectId } }),
        },
      }
    );
    if (linkResponse.ok()) {
      const links = await linkResponse.json();
      for (const link of (links.data || [])) {
        await request.delete(`${baseURL}/api/model/projectIntegration/delete`, {
          data: { where: { id: link.id } },
        });
      }
    }
    // Delete the integration
    if (integrationId) {
      await request.delete(`${baseURL}/api/integrations/${integrationId}`);
    }
  });
});

test.describe("Issue Operations - External Provider Error Handling", () => {
  let githubIntegrationId: number;

  test.beforeAll(async ({ request, baseURL }) => {
    // Create a GitHub integration with fake PAT for testing error shapes
    const integrationResponse = await request.post(
      `${baseURL}/api/integrations`,
      {
        data: {
          name: `E2E GitHub Error Shape ${uniqueId}`,
          type: "GITHUB",
          authType: "PERSONAL_ACCESS_TOKEN",
          config: {
            personalAccessToken: "ghp_fakeTokenForErrorShapeTesting",
          },
        },
      }
    );
    expect(integrationResponse.status()).toBe(201);
    const integration = await integrationResponse.json();
    githubIntegrationId = integration.id;
  });

  test("POST /api/integrations/{id}/create-issue with invalid body returns 400", async ({
    request,
    baseURL,
  }) => {
    const response = await request.post(
      `${baseURL}/api/integrations/${githubIntegrationId}/create-issue`,
      {
        data: {
          // Missing required 'title' and 'projectId' fields
          description: "A description without a title",
        },
      }
    );

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty("error");
    // Should include validation details
    expect(body.error).toMatch(/invalid|validation/i);
  });

  test("POST /api/integrations/{id}/create-issue with valid body returns error (no real GitHub)", async ({
    request,
    baseURL,
  }) => {
    const response = await request.post(
      `${baseURL}/api/integrations/${githubIntegrationId}/create-issue`,
      {
        data: {
          title: "E2E Test Issue - Should Fail At Adapter",
          projectId: "owner/repo",
          description: "This will fail because no real GitHub is configured",
        },
      }
    );

    // Adapter will fail to reach GitHub (fake token) — expect error response
    expect([401, 404, 500].includes(response.status())).toBe(true);
    const body = await response.json();
    expect(body).toHaveProperty("error");
  });

  test("GET /api/integrations/{id}/search without query param returns 400", async ({
    request,
    baseURL,
  }) => {
    const response = await request.get(
      `${baseURL}/api/integrations/${githubIntegrationId}/search`
    );

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty("error");
  });

  test("GET /api/integrations/{id}/search with query returns error from adapter (no real service)", async ({
    request,
    baseURL,
  }) => {
    const response = await request.get(
      `${baseURL}/api/integrations/${githubIntegrationId}/search`,
      {
        params: { q: "test issue" },
      }
    );

    // Adapter will fail to reach GitHub — accept any error status
    expect([401, 404, 500].includes(response.status())).toBe(true);
    const body = await response.json();
    expect(body).toHaveProperty("error");
  });

  test.afterAll(async ({ request, baseURL }) => {
    if (githubIntegrationId) {
      await request.delete(`${baseURL}/api/integrations/${githubIntegrationId}`);
    }
  });
});

test.describe("Issue Operations - Sync Endpoint", () => {
  let integrationId: number;
  let issueId: number;

  test.beforeAll(async ({ request, baseURL, api }) => {
    // Create an integration and an issue record in DB for sync testing
    const integrationResponse = await request.post(
      `${baseURL}/api/integrations`,
      {
        data: {
          name: `E2E Sync Test Integration ${uniqueId}`,
          type: "SIMPLE_URL",
          authType: "NONE",
          config: {
            baseUrl: "https://sync-test.example.com/{issueId}",
          },
        },
      }
    );
    expect(integrationResponse.status()).toBe(201);
    const integration = await integrationResponse.json();
    integrationId = integration.id;

    // Get admin user for issue creation
    const userResponse = await request.get(
      `${baseURL}/api/model/user/findFirst`,
      {
        params: {
          q: JSON.stringify({
            where: { access: "ADMIN", isDeleted: false },
            select: { id: true },
          }),
        },
      }
    );
    expect(userResponse.status()).toBe(200);
    const userResult = await userResponse.json();
    const adminUserId = userResult.data?.id;
    expect(adminUserId).toBeTruthy();

    // Create project for issue to belong to
    const projectId = await api.createProject(`E2E Sync Project ${uniqueId}`);

    // Create an issue record in DB linked to this integration
    // ZenStack v3 requires relation connect syntax (no scalar FKs for relation fields)
    const issueResponse = await request.post(
      `${baseURL}/api/model/issue/create`,
      {
        data: {
          data: {
            name: `E2E-SYNC-ISSUE-${uniqueId}`,
            title: `E2E Sync Test Issue ${uniqueId}`,
            externalId: `SYNC-EXT-${uniqueId}`,
            integration: { connect: { id: integrationId } },
            project: { connect: { id: projectId } },
            createdBy: { connect: { id: adminUserId } },
          },
        },
      }
    );

    if (issueResponse.ok()) {
      const issueResult = await issueResponse.json();
      issueId = issueResult.data?.id;
    }
  });

  test("POST /api/issues/{id}/sync with non-existent issue returns 404", async ({
    request,
    baseURL,
  }) => {
    const response = await request.post(
      `${baseURL}/api/issues/999999/sync`
    );

    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body).toHaveProperty("error");
  });

  test("POST /api/issues/{id}/sync with existing issue returns error (no real external service)", async ({
    request,
    baseURL,
  }) => {
    if (!issueId) {
      test.skip();
      return;
    }

    const response = await request.post(
      `${baseURL}/api/issues/${issueId}/sync`
    );

    // Sync will fail because SIMPLE_URL doesn't support sync in the adapter
    // but it should NOT return an unexpected crash shape
    expect([200, 400, 500].includes(response.status())).toBe(true);
    const body = await response.json();
    // Either success or proper error shape — no undefined/crash
    expect(typeof body).toBe("object");
    expect(body).not.toBeNull();
  });

  test.afterAll(async ({ request, baseURL }) => {
    if (integrationId) {
      await request.delete(`${baseURL}/api/integrations/${integrationId}`);
    }
  });
});

test.describe("Issue Operations - Auth Enforcement", () => {
  let integrationId: number;

  test.beforeAll(async ({ request, baseURL }) => {
    // Create an integration to use for auth tests
    const integrationResponse = await request.post(
      `${baseURL}/api/integrations`,
      {
        data: {
          name: `E2E Auth Test Integration ${uniqueId}`,
          type: "SIMPLE_URL",
          authType: "NONE",
          config: {
            baseUrl: "https://auth-test.example.com/{issueId}",
          },
        },
      }
    );
    expect(integrationResponse.status()).toBe(201);
    const integration = await integrationResponse.json();
    integrationId = integration.id;
  });

  test("POST /api/integrations/{id}/create-issue rejects unauthenticated with 401", async ({
    page,
  }) => {
    const e2eBaseURL = process.env.E2E_BASE_URL || "http://localhost:3002";
    const incognitoContext = await page.context().browser()!.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const incognitoPage = await incognitoContext.newPage();

    try {
      const response = await incognitoPage.request.post(
        `${e2eBaseURL}/api/integrations/${integrationId}/create-issue`,
        {
          data: {
            title: "Unauthorized Issue",
            projectId: "test/repo",
          },
        }
      );
      expect(response.status()).toBe(401);
    } finally {
      await incognitoPage.close();
      await incognitoContext.close();
    }
  });

  test("GET /api/integrations/{id}/search rejects unauthenticated with 401", async ({
    page,
  }) => {
    const e2eBaseURL = process.env.E2E_BASE_URL || "http://localhost:3002";
    const incognitoContext = await page.context().browser()!.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const incognitoPage = await incognitoContext.newPage();

    try {
      const response = await incognitoPage.request.get(
        `${e2eBaseURL}/api/integrations/${integrationId}/search`,
        { params: { q: "test" } }
      );
      expect(response.status()).toBe(401);
    } finally {
      await incognitoPage.close();
      await incognitoContext.close();
    }
  });

  test("POST /api/issues/{id}/link rejects unauthenticated with 401", async ({
    page,
  }) => {
    const e2eBaseURL = process.env.E2E_BASE_URL || "http://localhost:3002";
    const incognitoContext = await page.context().browser()!.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const incognitoPage = await incognitoContext.newPage();

    try {
      const response = await incognitoPage.request.post(
        `${e2eBaseURL}/api/issues/1/link`,
        {
          data: { entityType: "testCase", entityId: "1" },
        }
      );
      expect(response.status()).toBe(401);
    } finally {
      await incognitoPage.close();
      await incognitoContext.close();
    }
  });

  test("POST /api/issues/{id}/unlink rejects unauthenticated with 401", async ({
    page,
  }) => {
    const e2eBaseURL = process.env.E2E_BASE_URL || "http://localhost:3002";
    const incognitoContext = await page.context().browser()!.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const incognitoPage = await incognitoContext.newPage();

    try {
      const response = await incognitoPage.request.post(
        `${e2eBaseURL}/api/issues/1/unlink`,
        {
          data: { entityType: "testCase", entityId: "1" },
        }
      );
      expect(response.status()).toBe(401);
    } finally {
      await incognitoPage.close();
      await incognitoContext.close();
    }
  });

  test("POST /api/issues/{id}/sync rejects unauthenticated with 401", async ({
    page,
  }) => {
    const e2eBaseURL = process.env.E2E_BASE_URL || "http://localhost:3002";
    const incognitoContext = await page.context().browser()!.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const incognitoPage = await incognitoContext.newPage();

    try {
      const response = await incognitoPage.request.post(
        `${e2eBaseURL}/api/issues/1/sync`
      );
      expect(response.status()).toBe(401);
    } finally {
      await incognitoPage.close();
      await incognitoContext.close();
    }
  });

  test.afterAll(async ({ request, baseURL }) => {
    if (integrationId) {
      await request.delete(`${baseURL}/api/integrations/${integrationId}`);
    }
  });
});
