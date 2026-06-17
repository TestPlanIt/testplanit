import { expect, test } from "../../fixtures/index";

/**
 * Integration Setup E2E Tests
 *
 * Covers INTG-01, INTG-02, INTG-03:
 * - Admin can create integrations for Jira, GitHub, Azure DevOps, and SIMPLE_URL providers
 * - Test-connection endpoint returns correct shape for valid/invalid SIMPLE_URL configs
 * - External provider test-connection returns error shape (not crash)
 * - Project integration linking works and is verifiable
 *
 * All integration creation uses the custom /api/integrations endpoint (not ZenStack REST API)
 * because the custom endpoint handles credential encryption.
 */
test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test.describe("Integration Setup - Admin CRUD via API", () => {
  let _jiraIntegrationId: number;
  let _githubIntegrationId: number;
  let _azureIntegrationId: number;
  let _simpleUrlIntegrationId: number;

  test("Admin can create a Jira integration with API_KEY auth", async ({
    request,
    baseURL,
  }) => {
    let response: Awaited<ReturnType<typeof request.post>> | undefined;
    await test.step("Create a Jira integration via API", async () => {
      response = await request.post(`${baseURL}/api/integrations`, {
        data: {
          name: `E2E Jira Integration ${uniqueId}`,
          type: "JIRA",
          authType: "API_KEY",
          config: {
            email: "test@example.com",
            apiToken: "fake-api-token-for-e2e",
            baseUrl: "https://example.atlassian.net",
          },
        },
      });
    });

    await test.step("Verify the Jira integration was created with API_KEY auth", async () => {
      expect(response!.status()).toBe(201);
      const body = await response!.json();
      expect(body).toHaveProperty("id");
      expect(body.provider).toBe("JIRA");
      expect(body.authType).toBe("API_KEY");
      expect(body.status).toBe("ACTIVE");
      _jiraIntegrationId = body.id;
    });
  });

  test("Admin can create a GitHub integration with PERSONAL_ACCESS_TOKEN auth", async ({
    request,
    baseURL,
  }) => {
    let response: Awaited<ReturnType<typeof request.post>> | undefined;
    await test.step("Create a GitHub integration via API", async () => {
      response = await request.post(`${baseURL}/api/integrations`, {
        data: {
          name: `E2E GitHub Integration ${uniqueId}`,
          type: "GITHUB",
          authType: "PERSONAL_ACCESS_TOKEN",
          config: {
            personalAccessToken: "ghp_fakePATforE2Etesting1234567890",
          },
        },
      });
    });

    await test.step("Verify the GitHub integration was created with PERSONAL_ACCESS_TOKEN auth", async () => {
      expect(response!.status()).toBe(201);
      const body = await response!.json();
      expect(body).toHaveProperty("id");
      expect(body.provider).toBe("GITHUB");
      expect(body.authType).toBe("PERSONAL_ACCESS_TOKEN");
      _githubIntegrationId = body.id;
    });
  });

  test("Admin can create an Azure DevOps integration with PERSONAL_ACCESS_TOKEN auth", async ({
    request,
    baseURL,
  }) => {
    let response: Awaited<ReturnType<typeof request.post>> | undefined;
    await test.step("Create an Azure DevOps integration via API", async () => {
      response = await request.post(`${baseURL}/api/integrations`, {
        data: {
          name: `E2E Azure Integration ${uniqueId}`,
          type: "AZURE_DEVOPS",
          authType: "PERSONAL_ACCESS_TOKEN",
          config: {
            personalAccessToken: "fake-azure-pat-for-e2e-testing",
            organizationUrl: "https://dev.azure.com/fakeorg",
          },
        },
      });
    });

    await test.step("Verify the Azure DevOps integration was created with PERSONAL_ACCESS_TOKEN auth", async () => {
      expect(response!.status()).toBe(201);
      const body = await response!.json();
      expect(body).toHaveProperty("id");
      expect(body.provider).toBe("AZURE_DEVOPS");
      expect(body.authType).toBe("PERSONAL_ACCESS_TOKEN");
      _azureIntegrationId = body.id;
    });
  });

  test("Admin can create a SIMPLE_URL integration", async ({
    request,
    baseURL,
  }) => {
    let response: Awaited<ReturnType<typeof request.post>> | undefined;
    await test.step("Create a SIMPLE_URL integration via API", async () => {
      response = await request.post(`${baseURL}/api/integrations`, {
        data: {
          name: `E2E SimpleURL Integration ${uniqueId}`,
          type: "SIMPLE_URL",
          authType: "NONE",
          config: {
            baseUrl: "https://issues.example.com/{issueId}",
          },
        },
      });
    });

    await test.step("Verify the SIMPLE_URL integration was created", async () => {
      expect(response!.status()).toBe(201);
      const body = await response!.json();
      expect(body).toHaveProperty("id");
      expect(body.provider).toBe("SIMPLE_URL");
      _simpleUrlIntegrationId = body.id;
    });
  });

  test("Each integration is retrievable via GET", async ({
    request,
    baseURL,
  }) => {
    let integrations: { name: string }[] | undefined;
    await test.step("Retrieve the list of integrations", async () => {
      const response = await request.get(`${baseURL}/api/integrations`);
      expect(response.status()).toBe(200);
      integrations = await response.json();
      expect(Array.isArray(integrations)).toBe(true);
    });

    await test.step("Verify each created integration is present in the list", async () => {
      const names = integrations!.map((i: { name: string }) => i.name);
      expect(names).toContain(`E2E Jira Integration ${uniqueId}`);
      expect(names).toContain(`E2E GitHub Integration ${uniqueId}`);
      expect(names).toContain(`E2E Azure Integration ${uniqueId}`);
      expect(names).toContain(`E2E SimpleURL Integration ${uniqueId}`);
    });
  });

  test("GET /api/integrations/{id} returns integration detail", async ({
    request,
    baseURL,
  }) => {
    let simpleUrl: { id: number; name: string } | undefined;
    await test.step("Look up the SIMPLE_URL integration by listing then finding it", async () => {
      const listResponse = await request.get(`${baseURL}/api/integrations`);
      expect(listResponse.status()).toBe(200);
      const integrations = await listResponse.json();
      simpleUrl = integrations.find(
        (i: { name: string }) =>
          i.name === `E2E SimpleURL Integration ${uniqueId}`
      );
      expect(simpleUrl).toBeTruthy();
    });

    await test.step("Fetch the integration detail by id and verify its provider", async () => {
      const detailResponse = await request.get(
        `${baseURL}/api/integrations/${simpleUrl!.id}`
      );
      expect(detailResponse.status()).toBe(200);
      const detail = await detailResponse.json();
      expect(detail.id).toBe(simpleUrl!.id);
      expect(detail.provider).toBe("SIMPLE_URL");
    });
  });

  test("Creating integration with duplicate name returns 400", async ({
    request,
    baseURL,
  }) => {
    let response: Awaited<ReturnType<typeof request.post>> | undefined;
    await test.step("Attempt to create an integration with a duplicate name", async () => {
      response = await request.post(`${baseURL}/api/integrations`, {
        data: {
          name: `E2E Jira Integration ${uniqueId}`,
          type: "JIRA",
          authType: "API_KEY",
          config: {
            email: "other@example.com",
            apiToken: "another-fake-token",
            baseUrl: "https://other.atlassian.net",
          },
        },
      });
    });

    await test.step("Verify the duplicate name is rejected with 400 and an error", async () => {
      expect(response!.status()).toBe(400);
      const body = await response!.json();
      expect(body).toHaveProperty("error");
    });
  });

  test.afterAll(async ({ request, baseURL }) => {
    // Cleanup: delete test integrations created in this suite
    // Must delete in reverse order since project integrations block deletion
    const listResponse = await request.get(`${baseURL}/api/integrations`);
    if (!listResponse.ok()) return;
    const integrations = await listResponse.json();
    const e2eIntegrations = integrations.filter((i: { name: string }) =>
      i.name.includes(uniqueId)
    );
    for (const integration of e2eIntegrations) {
      await request.delete(`${baseURL}/api/integrations/${integration.id}`);
    }
  });
});

test.describe("Integration Setup - Test Connection Endpoint", () => {
  test("SIMPLE_URL with valid URL pattern returns success:true", async ({
    request,
    baseURL,
  }) => {
    let response: Awaited<ReturnType<typeof request.post>> | undefined;
    await test.step("Test connection for a SIMPLE_URL with a valid URL pattern", async () => {
      response = await request.post(
        `${baseURL}/api/integrations/test-connection`,
        {
          data: {
            provider: "SIMPLE_URL",
            credentials: {},
            settings: {
              baseUrl: "https://tracker.example.com/issues/{issueId}",
            },
          },
        }
      );
    });

    await test.step("Verify the connection test reports success", async () => {
      expect(response!.status()).toBe(200);
      const body = await response!.json();
      expect(body).toHaveProperty("success");
      expect(body.success).toBe(true);
    });
  });

  test("SIMPLE_URL without {issueId} placeholder returns success:false", async ({
    request,
    baseURL,
  }) => {
    let response: Awaited<ReturnType<typeof request.post>> | undefined;
    await test.step("Test connection for a SIMPLE_URL missing the {issueId} placeholder", async () => {
      response = await request.post(
        `${baseURL}/api/integrations/test-connection`,
        {
          data: {
            provider: "SIMPLE_URL",
            credentials: {},
            settings: {
              baseUrl: "https://tracker.example.com/issues/123",
            },
          },
        }
      );
    });

    await test.step("Verify the connection test reports failure with an error string", async () => {
      expect(response!.status()).toBe(200);
      const body = await response!.json();
      expect(body.success).toBe(false);
      expect(body).toHaveProperty("error");
      expect(typeof body.error).toBe("string");
    });
  });

  test("Test-connection with missing provider returns 400", async ({
    request,
    baseURL,
  }) => {
    let response: Awaited<ReturnType<typeof request.post>> | undefined;
    await test.step("Test connection with a missing provider", async () => {
      response = await request.post(
        `${baseURL}/api/integrations/test-connection`,
        {
          data: {
            credentials: {},
            settings: {},
          },
        }
      );
    });

    await test.step("Verify the request is rejected with 400 and success:false", async () => {
      expect(response!.status()).toBe(400);
      const body = await response!.json();
      expect(body).toHaveProperty("success");
      expect(body.success).toBe(false);
    });
  });

  test("Jira test-connection with fake credentials returns error shape (not crash)", async ({
    request,
    baseURL,
  }) => {
    let response: Awaited<ReturnType<typeof request.post>> | undefined;
    await test.step("Test Jira connection with fake credentials", async () => {
      response = await request.post(
        `${baseURL}/api/integrations/test-connection`,
        {
          data: {
            provider: "JIRA",
            authType: "API_KEY",
            credentials: {
              email: "fake@example.com",
              apiToken: "fake-token",
            },
            settings: {
              baseUrl: "https://nonexistent.atlassian.net",
            },
          },
        }
      );
    });

    await test.step("Verify the response returns an error shape instead of crashing", async () => {
      // Must return a valid JSON response (not crash with 500)
      expect([200, 500].includes(response!.status())).toBe(true);
      const body = await response!.json();
      // Whether 200 (with success:false) or 500, must have the error shape
      expect(body).toHaveProperty("success");
      expect(body.success).toBe(false);
      expect(body).toHaveProperty("error");
    });
  });

  test("GitHub test-connection with fake PAT returns error shape (not crash)", async ({
    request,
    baseURL,
  }) => {
    let response: Awaited<ReturnType<typeof request.post>> | undefined;
    await test.step("Test GitHub connection with a fake PAT", async () => {
      response = await request.post(
        `${baseURL}/api/integrations/test-connection`,
        {
          data: {
            provider: "GITHUB",
            credentials: {
              personalAccessToken: "ghp_fakePATthatWillFailGitHubAuth",
            },
          },
        }
      );
    });

    await test.step("Verify the response returns an error shape instead of crashing", async () => {
      expect([200, 500].includes(response!.status())).toBe(true);
      const body = await response!.json();
      expect(body).toHaveProperty("success");
      expect(body.success).toBe(false);
      expect(body).toHaveProperty("error");
    });
  });

  test("Azure DevOps test-connection with fake PAT returns error shape (not crash)", async ({
    request,
    baseURL,
  }) => {
    let response: Awaited<ReturnType<typeof request.post>> | undefined;
    await test.step("Test Azure DevOps connection with a fake PAT", async () => {
      response = await request.post(
        `${baseURL}/api/integrations/test-connection`,
        {
          data: {
            provider: "AZURE_DEVOPS",
            credentials: {
              personalAccessToken: "fake-azure-pat",
            },
            settings: {
              organizationUrl: "https://dev.azure.com/nonexistent-org",
            },
          },
        }
      );
    });

    await test.step("Verify the response returns an error shape instead of crashing", async () => {
      expect([200, 500].includes(response!.status())).toBe(true);
      const body = await response!.json();
      expect(body).toHaveProperty("success");
      expect(body.success).toBe(false);
      expect(body).toHaveProperty("error");
    });
  });
});

test.describe("Integration Setup - Project Integration Linking", () => {
  let integrationId: number;
  let projectId: number;
  let projectIntegrationId: string;

  test.beforeAll(async ({ request, baseURL, api }) => {
    // Create an integration to link
    const integrationResponse = await request.post(
      `${baseURL}/api/integrations`,
      {
        data: {
          name: `E2E Link SimpleURL ${uniqueId}`,
          type: "SIMPLE_URL",
          authType: "NONE",
          config: {
            baseUrl: "https://link-test.example.com/{issueId}",
          },
        },
      }
    );
    expect(integrationResponse.status()).toBe(201);
    const integration = await integrationResponse.json();
    integrationId = integration.id;

    // Create a project
    projectId = await api.createProject(
      `E2E Integration Link Project ${uniqueId}`
    );
  });

  test("Admin can link a SIMPLE_URL integration to a project", async ({
    request,
    baseURL,
  }) => {
    let response: Awaited<ReturnType<typeof request.post>> | undefined;
    await test.step("Link the SIMPLE_URL integration to the project", async () => {
      response = await request.post(
        `${baseURL}/api/model/projectIntegration/create`,
        {
          data: {
            data: {
              project: { connect: { id: projectId } },
              integration: { connect: { id: integrationId } },
              isActive: true,
            },
          },
        }
      );
    });

    await test.step("Verify the link was created and is active", async () => {
      expect(response!.status()).toBe(201);
      const body = await response!.json();
      expect(body.data).toHaveProperty("id");
      expect(body.data.projectId).toBe(projectId);
      expect(body.data.integrationId).toBe(integrationId);
      expect(body.data.isActive).toBe(true);
      projectIntegrationId = body.data.id;
    });
  });

  test("Linked integration appears in project integrations query", async ({
    request,
    baseURL,
  }) => {
    let response: Awaited<ReturnType<typeof request.get>> | undefined;
    await test.step("Query the project integrations for the linked integration", async () => {
      response = await request.get(
        `${baseURL}/api/model/projectIntegration/findMany`,
        {
          params: {
            q: JSON.stringify({
              where: { projectId, integrationId },
              include: { integration: true },
            }),
          },
        }
      );
    });

    await test.step("Verify the linked integration is returned and active", async () => {
      expect(response!.status()).toBe(200);
      const result = await response!.json();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data[0].integrationId).toBe(integrationId);
      expect(result.data[0].isActive).toBe(true);
    });
  });

  test.afterAll(async ({ request, baseURL }) => {
    // Cleanup: remove project integration link then delete integration
    if (projectIntegrationId) {
      await request.delete(`${baseURL}/api/model/projectIntegration/delete`, {
        data: { where: { id: projectIntegrationId } },
      });
    }
    if (integrationId) {
      await request.delete(`${baseURL}/api/integrations/${integrationId}`);
    }
  });
});

test.describe("Integration Setup - Code Repository Integration (INTG-03)", () => {
  let githubIntegrationId: number;
  let projectId: number;
  let projectIntegrationId: string;

  test.beforeAll(async ({ request, baseURL, api }) => {
    // Create a GitHub integration for code repo access
    const integrationResponse = await request.post(
      `${baseURL}/api/integrations`,
      {
        data: {
          name: `E2E Code Repo GitHub ${uniqueId}`,
          type: "GITHUB",
          authType: "PERSONAL_ACCESS_TOKEN",
          config: {
            personalAccessToken: "ghp_fakeCodeRepoPATforE2E",
          },
        },
      }
    );
    expect(integrationResponse.status()).toBe(201);
    const integration = await integrationResponse.json();
    githubIntegrationId = integration.id;

    // Create a project to link it to
    projectId = await api.createProject(`E2E Code Repo Project ${uniqueId}`);
  });

  test("GitHub integration for code repo can be linked to a project", async ({
    request,
    baseURL,
  }) => {
    let response: Awaited<ReturnType<typeof request.post>> | undefined;
    await test.step("Link the GitHub code repo integration to the project", async () => {
      response = await request.post(
        `${baseURL}/api/model/projectIntegration/create`,
        {
          data: {
            data: {
              project: { connect: { id: projectId } },
              integration: { connect: { id: githubIntegrationId } },
              isActive: true,
            },
          },
        }
      );
    });

    await test.step("Verify the GitHub integration is linked to the project", async () => {
      expect(response!.status()).toBe(201);
      const body = await response!.json();
      expect(body.data.integrationId).toBe(githubIntegrationId);
      expect(body.data.projectId).toBe(projectId);
      projectIntegrationId = body.data.id;
    });
  });

  test("Code repo integration is accessible from project settings", async ({
    request,
    baseURL,
  }) => {
    let response: Awaited<ReturnType<typeof request.get>> | undefined;
    await test.step("Query the project integrations including integration detail", async () => {
      response = await request.get(
        `${baseURL}/api/model/projectIntegration/findMany`,
        {
          params: {
            q: JSON.stringify({
              where: { projectId, integrationId: githubIntegrationId },
              include: {
                integration: {
                  select: {
                    id: true,
                    name: true,
                    provider: true,
                    authType: true,
                    status: true,
                  },
                },
              },
            }),
          },
        }
      );
    });

    await test.step("Verify the linked integration is a GitHub PAT integration", async () => {
      expect(response!.status()).toBe(200);
      const result = await response!.json();
      expect(result.data.length).toBeGreaterThan(0);
      const linked = result.data[0];
      expect(linked.integration.provider).toBe("GITHUB");
      expect(linked.integration.authType).toBe("PERSONAL_ACCESS_TOKEN");
    });
  });

  test.afterAll(async ({ request, baseURL }) => {
    if (projectIntegrationId) {
      await request.delete(`${baseURL}/api/model/projectIntegration/delete`, {
        data: { where: { id: projectIntegrationId } },
      });
    }
    if (githubIntegrationId) {
      await request.delete(
        `${baseURL}/api/integrations/${githubIntegrationId}`
      );
    }
  });
});

test.describe("Integration Setup - Unauthenticated Access Denied", () => {
  test("GET /api/integrations rejects unauthenticated requests with 401", async ({
    page,
  }) => {
    const e2eBaseURL = process.env.E2E_BASE_URL || "http://localhost:3002";
    const incognitoContext = await page
      .context()
      .browser()!
      .newContext({
        storageState: { cookies: [], origins: [] },
      });
    const incognitoPage = await incognitoContext.newPage();

    try {
      await test.step("GET /api/integrations unauthenticated and verify 401", async () => {
        const response = await incognitoPage.request.get(
          `${e2eBaseURL}/api/integrations`
        );
        expect(response.status()).toBe(401);
      });
    } finally {
      await incognitoPage.close();
      await incognitoContext.close();
    }
  });

  test("POST /api/integrations rejects unauthenticated requests with 401", async ({
    page,
  }) => {
    const e2eBaseURL = process.env.E2E_BASE_URL || "http://localhost:3002";
    const incognitoContext = await page
      .context()
      .browser()!
      .newContext({
        storageState: { cookies: [], origins: [] },
      });
    const incognitoPage = await incognitoContext.newPage();

    try {
      await test.step("POST /api/integrations unauthenticated and verify 401", async () => {
        const response = await incognitoPage.request.post(
          `${e2eBaseURL}/api/integrations`,
          {
            data: {
              name: "Unauthorized Integration",
              type: "SIMPLE_URL",
              authType: "NONE",
              config: { baseUrl: "https://example.com/{issueId}" },
            },
          }
        );
        expect(response.status()).toBe(401);
      });
    } finally {
      await incognitoPage.close();
      await incognitoContext.close();
    }
  });

  test("POST /api/integrations/test-connection rejects unauthenticated requests with 401", async ({
    page,
  }) => {
    const e2eBaseURL = process.env.E2E_BASE_URL || "http://localhost:3002";
    const incognitoContext = await page
      .context()
      .browser()!
      .newContext({
        storageState: { cookies: [], origins: [] },
      });
    const incognitoPage = await incognitoContext.newPage();

    try {
      await test.step("POST /api/integrations/test-connection unauthenticated and verify 401", async () => {
        const response = await incognitoPage.request.post(
          `${e2eBaseURL}/api/integrations/test-connection`,
          {
            data: {
              provider: "SIMPLE_URL",
              settings: { baseUrl: "https://example.com/{issueId}" },
            },
          }
        );
        expect(response.status()).toBe(401);
      });
    } finally {
      await incognitoPage.close();
      await incognitoContext.close();
    }
  });
});
