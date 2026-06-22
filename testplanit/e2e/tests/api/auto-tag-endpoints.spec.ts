import { expect, test } from "../../fixtures/index";

/**
 * Auto-Tag API Endpoint Tests
 *
 * Verifies auth, validation, and end-to-end tag application for all auto-tag endpoints.
 * Tests use the Playwright request fixture (not browser navigation).
 *
 * Queue-dependent endpoints (submit, status, cancel) may return 503 if BullMQ/Redis
 * is unavailable in the test environment — both outcomes are treated as acceptable.
 * The apply endpoint has no queue dependency and is fully testable end-to-end.
 */
test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Auto-Tag API Endpoints", () => {
  /**
   * POST /api/auto-tag/submit
   */
  test.describe("POST /api/auto-tag/submit", () => {
    test("returns 401 for unauthenticated requests", async ({
      browser,
      baseURL,
    }) => {
      const unauthCtx = await browser.newContext({ storageState: undefined });
      const unauthRequest = unauthCtx.request;

      let response: Awaited<ReturnType<typeof unauthRequest.post>> | undefined;
      await test.step("Submit auto-tag request without authentication", async () => {
        response = await unauthRequest.post(`${baseURL}/api/auto-tag/submit`, {
          data: {
            entityIds: [1],
            entityType: "repositoryCase",
            projectId: 1,
          },
        });
      });

      await test.step("Verify request is rejected as unauthorized", async () => {
        expect(response!.status()).toBe(401);
        const body = await response!.json();
        expect(body.error).toBe("Unauthorized");
        await unauthCtx.close();
      });
    });

    test("returns 400 for missing entityIds", async ({ request, baseURL }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Submit auto-tag request with entityIds omitted", async () => {
        response = await request.post(`${baseURL}/api/auto-tag/submit`, {
          data: {
            // entityIds is missing
            entityType: "repositoryCase",
            projectId: 1,
          },
        });
      });

      await test.step("Verify request fails validation", async () => {
        expect(response!.status()).toBe(400);
        const body = await response!.json();
        expect(body.error).toBe("Invalid request");
        expect(body.details).toBeDefined();
      });
    });

    test("returns 400 for empty entityIds array", async ({
      request,
      baseURL,
    }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Submit auto-tag request with an empty entityIds array", async () => {
        response = await request.post(`${baseURL}/api/auto-tag/submit`, {
          data: {
            entityIds: [], // min(1) fails
            entityType: "repositoryCase",
            projectId: 1,
          },
        });
      });

      await test.step("Verify request fails validation", async () => {
        expect(response!.status()).toBe(400);
        const body = await response!.json();
        expect(body.error).toBe("Invalid request");
      });
    });

    test("returns 400 for invalid entityType", async ({ request, baseURL }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Submit auto-tag request with an invalid entityType", async () => {
        response = await request.post(`${baseURL}/api/auto-tag/submit`, {
          data: {
            entityIds: [1],
            entityType: "invalidType", // not in enum
            projectId: 1,
          },
        });
      });

      await test.step("Verify request fails validation", async () => {
        expect(response!.status()).toBe(400);
        const body = await response!.json();
        expect(body.error).toBe("Invalid request");
      });
    });

    test("returns 503 or jobId for valid submit request", async ({
      request,
      baseURL,
    }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Submit a valid auto-tag request", async () => {
        response = await request.post(`${baseURL}/api/auto-tag/submit`, {
          data: {
            entityIds: [1],
            entityType: "repositoryCase",
            projectId: 1,
          },
        });
      });

      await test.step("Verify response is either queue-unavailable or a jobId", async () => {
        // Either 503 (queue unavailable) or 200 (with jobId) are valid responses
        expect([200, 503]).toContain(response!.status());
        const body = await response!.json();

        if (response!.status() === 503) {
          expect(body.error).toBe("Background job queue is not available");
        } else {
          expect(body.jobId).toBeDefined();
          expect(typeof body.jobId).toBe("string");
        }
      });
    });
  });

  /**
   * GET /api/auto-tag/status/:jobId
   */
  test.describe("GET /api/auto-tag/status/:jobId", () => {
    test("returns 401 for unauthenticated requests", async ({
      browser,
      baseURL,
    }) => {
      const unauthCtx = await browser.newContext({ storageState: undefined });
      const unauthRequest = unauthCtx.request;

      let response: Awaited<ReturnType<typeof unauthRequest.get>> | undefined;
      await test.step("Request job status without authentication", async () => {
        response = await unauthRequest.get(
          `${baseURL}/api/auto-tag/status/nonexistent-job-123`
        );
      });

      await test.step("Verify request is rejected as unauthorized", async () => {
        expect(response!.status()).toBe(401);
        const body = await response!.json();
        expect(body.error).toBe("Unauthorized");
        await unauthCtx.close();
      });
    });

    test("returns 503 or 404 for non-existent job ID", async ({
      request,
      baseURL,
    }) => {
      let response: Awaited<ReturnType<typeof request.get>> | undefined;
      await test.step("Request status for a non-existent job ID", async () => {
        response = await request.get(
          `${baseURL}/api/auto-tag/status/nonexistent-job-e2e-99999`
        );
      });

      await test.step("Verify response is queue-unavailable or job-not-found", async () => {
        // If queue is unavailable, returns 503; if available but job not found, returns 404
        expect([404, 503]).toContain(response!.status());
        const body = await response!.json();

        if (response!.status() === 404) {
          expect(body.error).toBe("Job not found");
        } else {
          expect(body.error).toBe("Background job queue is not available");
        }
      });
    });
  });

  /**
   * POST /api/auto-tag/cancel/:jobId
   */
  test.describe("POST /api/auto-tag/cancel/:jobId", () => {
    test("returns 401 for unauthenticated requests", async ({
      browser,
      baseURL,
    }) => {
      const unauthCtx = await browser.newContext({ storageState: undefined });
      const unauthRequest = unauthCtx.request;

      let response: Awaited<ReturnType<typeof unauthRequest.post>> | undefined;
      await test.step("Cancel job without authentication", async () => {
        response = await unauthRequest.post(
          `${baseURL}/api/auto-tag/cancel/nonexistent-job-123`
        );
      });

      await test.step("Verify request is rejected as unauthorized", async () => {
        expect(response!.status()).toBe(401);
        const body = await response!.json();
        expect(body.error).toBe("Unauthorized");
        await unauthCtx.close();
      });
    });

    test("returns 503 or 404 for non-existent job ID", async ({
      request,
      baseURL,
    }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Cancel a non-existent job ID", async () => {
        response = await request.post(
          `${baseURL}/api/auto-tag/cancel/nonexistent-job-e2e-99999`
        );
      });

      await test.step("Verify response is queue-unavailable or job-not-found", async () => {
        // If queue is unavailable, returns 503; if available but job not found, returns 404
        expect([404, 503]).toContain(response!.status());
        const body = await response!.json();

        if (response!.status() === 404) {
          expect(body.error).toBe("Job not found");
        } else {
          expect(body.error).toBe("Background job queue is not available");
        }
      });
    });
  });

  /**
   * POST /api/auto-tag/apply
   *
   * This endpoint has no queue dependency and is fully testable end-to-end.
   */
  test.describe("POST /api/auto-tag/apply", () => {
    test("returns 401 for unauthenticated requests", async ({
      browser,
      baseURL,
    }) => {
      const unauthCtx = await browser.newContext({ storageState: undefined });
      const unauthRequest = unauthCtx.request;

      let response: Awaited<ReturnType<typeof unauthRequest.post>> | undefined;
      await test.step("Apply a tag suggestion without authentication", async () => {
        response = await unauthRequest.post(`${baseURL}/api/auto-tag/apply`, {
          data: {
            suggestions: [
              {
                entityId: 1,
                entityType: "repositoryCase",
                tagName: "TestTag",
              },
            ],
          },
        });
      });

      await test.step("Verify request is rejected as unauthorized", async () => {
        expect(response!.status()).toBe(401);
        const body = await response!.json();
        expect(body.error).toBe("Unauthorized");
        await unauthCtx.close();
      });
    });

    test("returns 400 for empty suggestions array", async ({
      request,
      baseURL,
    }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Apply with an empty suggestions array", async () => {
        response = await request.post(`${baseURL}/api/auto-tag/apply`, {
          data: {
            suggestions: [], // min(1) Zod validation fails
          },
        });
      });

      await test.step("Verify request fails validation", async () => {
        expect(response!.status()).toBe(400);
        const body = await response!.json();
        expect(body.error).toBe("Invalid request");
      });
    });

    test("returns 400 for missing suggestions field", async ({
      request,
      baseURL,
    }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Apply with the suggestions field omitted", async () => {
        response = await request.post(`${baseURL}/api/auto-tag/apply`, {
          data: {
            // suggestions is missing entirely
          },
        });
      });

      await test.step("Verify request fails validation", async () => {
        expect(response!.status()).toBe(400);
        const body = await response!.json();
        expect(body.error).toBe("Invalid request");
      });
    });

    test("returns 400 for invalid entityType in suggestions", async ({
      request,
      baseURL,
    }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Apply a suggestion with an invalid entityType", async () => {
        response = await request.post(`${baseURL}/api/auto-tag/apply`, {
          data: {
            suggestions: [
              {
                entityId: 1,
                entityType: "invalidType",
                tagName: "TestTag",
              },
            ],
          },
        });
      });

      await test.step("Verify request fails validation", async () => {
        expect(response!.status()).toBe(400);
        const body = await response!.json();
        expect(body.error).toBe("Invalid request");
      });
    });

    test("successfully applies a tag to an existing case and verifies it is connected", async ({
      request,
      baseURL,
      api,
    }) => {
      const ts = Date.now();
      const tagName = `E2E-AutoTag-${ts}`;

      let caseId: number | undefined;
      await test.step("Create a project, folder, and test case", async () => {
        const projectId = await api.createProject(
          `E2E AutoTag Apply Test ${ts}`
        );
        const folderId = await api.getRootFolderId(projectId);
        caseId = await api.createTestCase(
          projectId,
          folderId,
          `Auto Tag Test Case ${ts}`
        );
      });

      await test.step("Apply the tag suggestion to the case", async () => {
        const applyResponse = await request.post(
          `${baseURL}/api/auto-tag/apply`,
          {
            data: {
              suggestions: [
                {
                  entityId: caseId!,
                  entityType: "repositoryCase",
                  tagName,
                },
              ],
            },
          }
        );

        expect(applyResponse.status()).toBe(200);
        const applyBody = await applyResponse.json();
        expect(applyBody.applied).toBe(1);
        expect(applyBody.tagsCreated).toBe(1);
        expect(applyBody.tagsReused).toBe(0);
      });

      await test.step("Verify the tag is connected to the case", async () => {
        // Verify tag was actually connected to the case
        const readResponse = await request.get(
          `${baseURL}/api/model/repositoryCases/findFirst`,
          {
            params: {
              q: JSON.stringify({
                where: { id: caseId! },
                include: { tags: true },
              }),
            },
          }
        );

        expect(readResponse.status()).toBe(200);
        const caseData = await readResponse.json();
        expect(caseData.data.tags).toBeDefined();
        const linkedTag = caseData.data.tags.find(
          (t: { name: string }) => t.name === tagName
        );
        expect(linkedTag).toBeDefined();
      });
    });

    test("reuses existing tag when applied a second time (tagsReused increments)", async ({
      request,
      baseURL,
      api,
    }) => {
      const ts = Date.now();
      const tagName = `E2E-Reuse-${ts}`;

      let caseId: number | undefined;
      await test.step("Create a project, folder, and test case", async () => {
        const projectId = await api.createProject(
          `E2E AutoTag Reuse Test ${ts}`
        );
        const folderId = await api.getRootFolderId(projectId);
        caseId = await api.createTestCase(
          projectId,
          folderId,
          `Reuse Tag Case ${ts}`
        );
      });

      await test.step("Apply the tag the first time and confirm it is created", async () => {
        // Apply tag first time — creates the tag
        const firstApply = await request.post(`${baseURL}/api/auto-tag/apply`, {
          data: {
            suggestions: [
              { entityId: caseId!, entityType: "repositoryCase", tagName },
            ],
          },
        });

        expect(firstApply.status()).toBe(200);
        const firstBody = await firstApply.json();
        expect(firstBody.tagsCreated).toBe(1);
        expect(firstBody.tagsReused).toBe(0);
      });

      await test.step("Apply the same tag again and confirm it is reused", async () => {
        // Apply same tag again — reuses the existing tag
        const secondApply = await request.post(
          `${baseURL}/api/auto-tag/apply`,
          {
            data: {
              suggestions: [
                { entityId: caseId!, entityType: "repositoryCase", tagName },
              ],
            },
          }
        );

        expect(secondApply.status()).toBe(200);
        const secondBody = await secondApply.json();
        expect(secondBody.applied).toBe(1);
        expect(secondBody.tagsCreated).toBe(0);
        expect(secondBody.tagsReused).toBe(1);
      });
    });

    test("returns 400 when entity not found (non-existent case ID)", async ({
      request,
      baseURL,
    }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Apply a tag to a non-existent case ID", async () => {
        response = await request.post(`${baseURL}/api/auto-tag/apply`, {
          data: {
            suggestions: [
              {
                entityId: 999999999,
                entityType: "repositoryCase",
                tagName: "TestTag",
              },
            ],
          },
        });
      });

      await test.step("Verify the entity-not-found error is returned", async () => {
        expect(response!.status()).toBe(400);
        const body = await response!.json();
        expect(body.error).toBe("One or more entities not found");
      });
    });
  });
});
