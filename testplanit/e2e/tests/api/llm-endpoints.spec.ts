import { expect, test } from "../../fixtures/index";

/**
 * LLM API Endpoint Tests
 *
 * Verifies auth, validation, and error handling for all LLM endpoints.
 * Tests use the Playwright request fixture (not browser navigation).
 *
 * Since the E2E environment does not have a real LLM integration configured,
 * success paths verify the expected "No active LLM integration" error response.
 * Auth and validation paths are tested directly without needing LLM access.
 */
test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("LLM API Endpoints", () => {
  /**
   * POST /api/llm/generate-test-cases
   */
  test.describe("POST /api/llm/generate-test-cases", () => {
    test("returns 401 for unauthenticated requests", async ({
      browser,
      baseURL,
    }) => {
      const unauthCtx = await browser.newContext({ storageState: undefined });
      const unauthRequest = unauthCtx.request;

      let response: Awaited<ReturnType<typeof unauthRequest.post>> | undefined;
      await test.step("Send unauthenticated generate-test-cases request", async () => {
        response = await unauthRequest.post(
          `${baseURL}/api/llm/generate-test-cases`,
          {
            data: {
              projectId: 1,
              issue: { key: "TEST-1", title: "Test", status: "Open" },
              template: { id: 1, name: "Default", fields: [] },
              context: { folderContext: 0 },
            },
          }
        );
      });

      await test.step("Verify 401 Unauthorized and close context", async () => {
        expect(response!.status()).toBe(401);
        const body = await response!.json();
        expect(body.error).toBe("Unauthorized");
        await unauthCtx.close();
      });
    });

    test("returns 400 for missing required parameters (no issue)", async ({
      request,
      baseURL,
    }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Send generate-test-cases request without issue", async () => {
        response = await request.post(
          `${baseURL}/api/llm/generate-test-cases`,
          {
            data: {
              projectId: 1,
              // issue is missing
              template: { id: 1, name: "Default", fields: [] },
              context: { folderContext: 0 },
            },
          }
        );
      });

      await test.step("Verify 400 Missing required parameters", async () => {
        expect(response!.status()).toBe(400);
        const body = await response!.json();
        expect(body.error).toBe("Missing required parameters");
      });
    });

    test("returns 400 for missing required parameters (no template)", async ({
      request,
      baseURL,
    }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Send generate-test-cases request without template", async () => {
        response = await request.post(
          `${baseURL}/api/llm/generate-test-cases`,
          {
            data: {
              projectId: 1,
              issue: {
                key: "TEST-1",
                title: "Login feature",
                description: "Implement login",
                status: "Open",
              },
              // template is missing
              context: { folderContext: 0 },
            },
          }
        );
      });

      await test.step("Verify 400 Missing required parameters", async () => {
        expect(response!.status()).toBe(400);
        const body = await response!.json();
        expect(body.error).toBe("Missing required parameters");
      });
    });

    test("returns 404 for non-existent project", async ({
      request,
      baseURL,
    }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Send generate-test-cases request for a non-existent project", async () => {
        response = await request.post(
          `${baseURL}/api/llm/generate-test-cases`,
          {
            data: {
              projectId: 99999999,
              issue: {
                key: "TEST-1",
                title: "Login feature",
                description: "Implement login",
                status: "Open",
              },
              template: {
                id: 1,
                name: "Default",
                fields: [
                  {
                    id: 1,
                    name: "Description",
                    type: "Text Long",
                    required: false,
                  },
                ],
              },
              context: { folderContext: 0 },
            },
          }
        );
      });

      await test.step("Verify 404 Project not found or access denied", async () => {
        expect(response!.status()).toBe(404);
        const body = await response!.json();
        expect(body.error).toBe("Project not found or access denied");
      });
    });

    test("returns 400 when no active LLM integration exists for project", async ({
      request,
      baseURL,
      api,
    }) => {
      // Create a real project (which won't have an LLM integration in test env)
      let projectId: number | undefined;
      await test.step("Create a project with no LLM integration", async () => {
        projectId = await api.createProject(
          `E2E LLM Generate Test ${Date.now()}`
        );
      });

      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Send generate-test-cases request for the project", async () => {
        response = await request.post(
          `${baseURL}/api/llm/generate-test-cases`,
          {
            data: {
              projectId,
              issue: {
                key: "TEST-1",
                title: "Login feature",
                description: "Implement login",
                status: "Open",
              },
              template: {
                id: 1,
                name: "Default",
                fields: [
                  {
                    id: 1,
                    name: "Description",
                    type: "Text Long",
                    required: false,
                  },
                ],
              },
              context: { folderContext: 0 },
            },
          }
        );
      });

      await test.step("Verify 400 No active LLM integration found", async () => {
        expect(response!.status()).toBe(400);
        const body = await response!.json();
        expect(body.error).toBe(
          "No active LLM integration found for this project"
        );
      });
    });
  });

  /**
   * POST /api/llm/magic-select-cases
   */
  test.describe("POST /api/llm/magic-select-cases", () => {
    test("returns 401 for unauthenticated requests", async ({
      browser,
      baseURL,
    }) => {
      const unauthCtx = await browser.newContext({ storageState: undefined });
      const unauthRequest = unauthCtx.request;

      let response: Awaited<ReturnType<typeof unauthRequest.post>> | undefined;
      await test.step("Send unauthenticated magic-select-cases request", async () => {
        response = await unauthRequest.post(
          `${baseURL}/api/llm/magic-select-cases`,
          {
            data: {
              projectId: 1,
              testRunMetadata: {
                name: "Test Run",
                description: null,
                docs: null,
                linkedIssueIds: [],
              },
            },
          }
        );
      });

      await test.step("Verify 401 Unauthorized and close context", async () => {
        expect(response!.status()).toBe(401);
        const body = await response!.json();
        expect(body.error).toBe("Unauthorized");
        await unauthCtx.close();
      });
    });

    test("returns 400 for invalid request body (Zod validation - missing name)", async ({
      request,
      baseURL,
    }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Send magic-select-cases request with missing name", async () => {
        response = await request.post(
          `${baseURL}/api/llm/magic-select-cases`,
          {
            data: {
              projectId: 1,
              testRunMetadata: {
                // name is missing (required by Zod schema)
                description: null,
                docs: null,
                linkedIssueIds: [],
              },
            },
          }
        );
      });

      await test.step("Verify 400 Invalid request with details", async () => {
        expect(response!.status()).toBe(400);
        const body = await response!.json();
        expect(body.error).toBe("Invalid request");
        expect(body.details).toBeDefined();
      });
    });

    test("returns 400 for invalid request body (missing projectId)", async ({
      request,
      baseURL,
    }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Send magic-select-cases request with missing projectId", async () => {
        response = await request.post(
          `${baseURL}/api/llm/magic-select-cases`,
          {
            data: {
              // projectId is missing
              testRunMetadata: {
                name: "Test Run",
                description: null,
                docs: null,
                linkedIssueIds: [],
              },
            },
          }
        );
      });

      await test.step("Verify 400 Invalid request", async () => {
        expect(response!.status()).toBe(400);
        const body = await response!.json();
        expect(body.error).toBe("Invalid request");
      });
    });

    test("returns 404 for non-existent project", async ({
      request,
      baseURL,
    }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Send magic-select-cases request for a non-existent project", async () => {
        response = await request.post(
          `${baseURL}/api/llm/magic-select-cases`,
          {
            data: {
              projectId: 99999999,
              testRunMetadata: {
                name: "Test Run",
                description: null,
                docs: null,
                linkedIssueIds: [],
              },
            },
          }
        );
      });

      await test.step("Verify 404 Project not found or access denied", async () => {
        expect(response!.status()).toBe(404);
        const body = await response!.json();
        expect(body.error).toBe("Project not found or access denied");
      });
    });

    test("returns 410 when full analysis requested (moved to background processing)", async ({
      request,
      baseURL,
      api,
    }) => {
      let projectId: number | undefined;
      await test.step("Create a project for the full-analysis request", async () => {
        projectId = await api.createProject(
          `E2E LLM MagicSelect Test ${Date.now()}`
        );
      });

      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Send full-analysis magic-select-cases request", async () => {
        response = await request.post(
          `${baseURL}/api/llm/magic-select-cases`,
          {
            data: {
              projectId,
              testRunMetadata: {
                name: "Sprint 1 Regression",
                description: null,
                docs: null,
                linkedIssueIds: [],
              },
            },
          }
        );
      });

      await test.step("Verify 410 moved to background processing", async () => {
        expect(response!.status()).toBe(410);
        const body = await response!.json();
        expect(body.error).toContain("background processing");
      });
    });

    test("returns countOnly response shape for countOnly=true", async ({
      request,
      baseURL,
      api,
    }) => {
      let projectId: number | undefined;
      await test.step("Create a project for the countOnly request", async () => {
        projectId = await api.createProject(
          `E2E LLM CountOnly Test ${Date.now()}`
        );
      });

      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Send countOnly magic-select-cases request", async () => {
        response = await request.post(
          `${baseURL}/api/llm/magic-select-cases`,
          {
            data: {
              projectId,
              testRunMetadata: {
                name: "Sprint 1",
                description: null,
                docs: null,
                linkedIssueIds: [],
              },
              countOnly: true,
            },
          }
        );
      });

      await test.step("Verify count response shape or no-integration error", async () => {
        // countOnly path also requires an active LLM integration (it checks before the count branch)
        // In test env with no LLM integration, expect 400
        expect([200, 400]).toContain(response!.status());
        const body = await response!.json();

        if (response!.status() === 200) {
          // If somehow an LLM integration exists, verify the count response shape
          expect(body.success).toBe(true);
          expect(typeof body.totalCaseCount).toBe("number");
          expect(typeof body.repositoryTotalCount).toBe("number");
        } else {
          // Expected: no LLM integration configured in test env
          expect(body.error).toBe(
            "No active LLM integration found for this project"
          );
        }
      });
    });
  });

  /**
   * POST /api/llm/chat
   */
  test.describe("POST /api/llm/chat", () => {
    test("returns 401 for unauthenticated requests", async ({
      browser,
      baseURL,
    }) => {
      const unauthCtx = await browser.newContext({ storageState: undefined });
      const unauthRequest = unauthCtx.request;

      let response: Awaited<ReturnType<typeof unauthRequest.post>> | undefined;
      await test.step("Send unauthenticated chat request", async () => {
        response = await unauthRequest.post(`${baseURL}/api/llm/chat`, {
          data: {
            llmIntegrationId: 1,
            message: "Hello",
            projectId: 1,
          },
        });
      });

      await test.step("Verify 401 Unauthorized and close context", async () => {
        expect(response!.status()).toBe(401);
        const body = await response!.json();
        expect(body.error).toBe("Unauthorized");
        await unauthCtx.close();
      });
    });

    test("returns 400 for missing llmIntegrationId", async ({
      request,
      baseURL,
    }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Send chat request without llmIntegrationId", async () => {
        response = await request.post(`${baseURL}/api/llm/chat`, {
          data: {
            // llmIntegrationId is missing
            message: "Hello, summarize this text",
            projectId: 1,
          },
        });
      });

      await test.step("Verify 400 integration ID and message required", async () => {
        expect(response!.status()).toBe(400);
        const body = await response!.json();
        expect(body.error).toBe("LLM integration ID and message are required");
      });
    });

    test("returns 400 for missing message", async ({ request, baseURL }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Send chat request without message", async () => {
        response = await request.post(`${baseURL}/api/llm/chat`, {
          data: {
            llmIntegrationId: 1,
            // message is missing
            projectId: 1,
          },
        });
      });

      await test.step("Verify 400 integration ID and message required", async () => {
        expect(response!.status()).toBe(400);
        const body = await response!.json();
        expect(body.error).toBe("LLM integration ID and message are required");
      });
    });

    test("returns 404 for non-existent project", async ({
      request,
      baseURL,
    }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Send chat request for a non-existent project", async () => {
        response = await request.post(`${baseURL}/api/llm/chat`, {
          data: {
            llmIntegrationId: 1,
            message: "Hello",
            projectId: 99999999,
          },
        });
      });

      await test.step("Verify 404 Project not found", async () => {
        expect(response!.status()).toBe(404);
        const body = await response!.json();
        expect(body.error).toBe("Project not found");
      });
    });

    test("returns 404 for LLM integration not found for project", async ({
      request,
      baseURL,
      api,
    }) => {
      let projectId: number | undefined;
      await test.step("Create a project with no LLM integration", async () => {
        projectId = await api.createProject(
          `E2E LLM Chat Test ${Date.now()}`
        );
      });

      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Send chat request with a non-existent integration ID", async () => {
        response = await request.post(`${baseURL}/api/llm/chat`, {
          data: {
            llmIntegrationId: 99999,
            message: "Help me write a test case",
            projectId: projectId!.toString(),
          },
        });
      });

      await test.step("Verify 404 LLM integration not found for project", async () => {
        expect(response!.status()).toBe(404);
        const body = await response!.json();
        expect(body.error).toBe("LLM integration not found for this project");
      });
    });
  });

  /**
   * POST /api/llm/parse-markdown-test-cases
   */
  test.describe("POST /api/llm/parse-markdown-test-cases", () => {
    test("returns 401 for unauthenticated requests", async ({
      browser,
      baseURL,
    }) => {
      const unauthCtx = await browser.newContext({ storageState: undefined });
      const unauthRequest = unauthCtx.request;

      let response: Awaited<ReturnType<typeof unauthRequest.post>> | undefined;
      await test.step("Send unauthenticated parse-markdown-test-cases request", async () => {
        response = await unauthRequest.post(
          `${baseURL}/api/llm/parse-markdown-test-cases`,
          {
            data: {
              projectId: 1,
              markdown:
                "# Test Case 1\n- Step 1: Do something\n- Expected: Something happens",
            },
          }
        );
      });

      await test.step("Verify 401 Unauthorized and close context", async () => {
        expect(response!.status()).toBe(401);
        const body = await response!.json();
        expect(body.error).toBe("Unauthorized");
        await unauthCtx.close();
      });
    });

    test("returns 400 for missing markdown", async ({ request, baseURL }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Send parse-markdown-test-cases request without markdown", async () => {
        response = await request.post(
          `${baseURL}/api/llm/parse-markdown-test-cases`,
          {
            data: {
              projectId: 1,
              // markdown is missing
            },
          }
        );
      });

      await test.step("Verify 400 Missing required parameters", async () => {
        expect(response!.status()).toBe(400);
        const body = await response!.json();
        expect(body.error).toBe(
          "Missing required parameters (projectId, markdown)"
        );
      });
    });

    test("returns 400 for missing projectId", async ({ request, baseURL }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Send parse-markdown-test-cases request without projectId", async () => {
        response = await request.post(
          `${baseURL}/api/llm/parse-markdown-test-cases`,
          {
            data: {
              // projectId is missing
              markdown: "# Test Case\n- Step 1: Click login",
            },
          }
        );
      });

      await test.step("Verify 400 Missing required parameters", async () => {
        expect(response!.status()).toBe(400);
        const body = await response!.json();
        expect(body.error).toBe(
          "Missing required parameters (projectId, markdown)"
        );
      });
    });

    test("returns 404 for non-existent project", async ({
      request,
      baseURL,
    }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Send parse-markdown-test-cases request for a non-existent project", async () => {
        response = await request.post(
          `${baseURL}/api/llm/parse-markdown-test-cases`,
          {
            data: {
              projectId: 99999999,
              markdown:
                "# Test Case 1\n- Step 1: Navigate to login page\n- Expected: Login page loads",
            },
          }
        );
      });

      await test.step("Verify 404 Project not found or access denied", async () => {
        expect(response!.status()).toBe(404);
        const body = await response!.json();
        expect(body.error).toBe("Project not found or access denied");
      });
    });

    test("returns 400 when no active LLM integration exists for project", async ({
      request,
      baseURL,
      api,
    }) => {
      let projectId: number | undefined;
      await test.step("Create a project with no LLM integration", async () => {
        projectId = await api.createProject(
          `E2E LLM ParseMarkdown Test ${Date.now()}`
        );
      });

      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Send parse-markdown-test-cases request for the project", async () => {
        response = await request.post(
          `${baseURL}/api/llm/parse-markdown-test-cases`,
          {
            data: {
              projectId,
              markdown:
                "# Login Test\n## Steps\n1. Navigate to /login\n2. Enter credentials\n## Expected\nUser is logged in",
            },
          }
        );
      });

      await test.step("Verify 400 No active LLM integration found", async () => {
        expect(response!.status()).toBe(400);
        const body = await response!.json();
        expect(body.error).toBe(
          "No active LLM integration found for this project"
        );
      });
    });
  });
});
