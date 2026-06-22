import { type APIRequestContext } from "@playwright/test";
import { expect, test } from "../../fixtures/index";

/**
 * Copy-Move API Endpoint Tests
 *
 * Verifies auth, validation, preflight compatibility checks, and end-to-end
 * copy/move operations for all copy-move endpoints.
 * Tests use the Playwright request fixture (not browser navigation).
 *
 * Queue-dependent endpoints (submit, status, cancel) may return 503 if BullMQ/Redis
 * is unavailable in the test environment — both outcomes are treated as acceptable.
 * Data verification tests are conditionally skipped when the queue is unavailable.
 */
test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

/**
 * Poll copy-move status until job is completed or failed.
 */
async function pollUntilDone(
  request: APIRequestContext,
  baseURL: string,
  jobId: string,
  maxAttempts = 60,
  intervalMs = 500
): Promise<{ state: string; result: any }> {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await request.get(
      `${baseURL}/api/repository/copy-move/status/${jobId}`
    );
    if (!res.ok()) throw new Error(`Status check failed: ${res.status()}`);
    const body = await res.json();
    if (body.state === "completed" || body.state === "failed") return body;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Job did not complete within timeout");
}

test.describe("Copy-Move API Endpoints", () => {
  // Shared state populated during setup tests
  let sourceProjectId: number;
  let targetProjectId: number;
  let sourceFolderId: number;
  let targetFolderId: number;
  let sourceCaseId: number;
  let sourceCaseName: string;
  let tagId: number;
  let copyJobId: string | undefined;
  let copiedCaseId: number | undefined;
  let moveCaseId: number | undefined;
  let moveJobId: string | undefined;

  // Clean up shared resources at the very end of the outer describe — the
  // setup test in the preflight inner describe detaches these from the api
  // fixture's per-test auto-cleanup so they survive across sibling
  // describes (preflight tests, copy-move submit tests, status/cancel
  // tests, folder-tree tests, etc.). Doing the cleanup here (outer
  // afterAll) ensures it runs only after every dependent test has finished.
  test.afterAll(async ({ request, baseURL }) => {
    const ops: Array<Promise<unknown>> = [];
    if (sourceCaseId) {
      ops.push(
        request
          .patch(`${baseURL}/api/model/repositoryCases/update`, {
            data: {
              where: { id: sourceCaseId },
              data: { isDeleted: true },
            },
          })
          .catch(() => {})
      );
    }
    for (const id of [sourceProjectId, targetProjectId]) {
      if (id) {
        ops.push(
          request
            .patch(`${baseURL}/api/model/projects/update`, {
              data: { where: { id }, data: { isDeleted: true } },
            })
            .catch(() => {})
        );
      }
    }
    await Promise.all(ops);
  });

  /**
   * POST /api/repository/copy-move/preflight (TEST-02)
   *
   * Validates template and workflow compatibility detection before initiating a copy/move.
   */
  test.describe("POST /api/repository/copy-move/preflight", () => {
    test("returns 401 for unauthenticated requests", async ({
      browser,
      baseURL,
    }) => {
      const unauthCtx = await browser.newContext({ storageState: undefined });
      const unauthRequest = unauthCtx.request;

      let response: Awaited<ReturnType<typeof unauthRequest.post>> | undefined;
      await test.step("Send preflight request without authentication", async () => {
        response = await unauthRequest.post(
          `${baseURL}/api/repository/copy-move/preflight`,
          {
            data: {
              operation: "copy",
              caseIds: [1],
              sourceProjectId: 1,
              targetProjectId: 2,
            },
          }
        );
      });

      await test.step("Verify request is rejected as unauthorized", async () => {
        expect(response!.status()).toBe(401);
        const body = await response!.json();
        expect(body.error).toBe("Unauthorized");
        await unauthCtx.close();
      });
    });

    test("returns 400 for missing caseIds", async ({ request, baseURL }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Send preflight request without caseIds", async () => {
        response = await request.post(
          `${baseURL}/api/repository/copy-move/preflight`,
          {
            data: {
              operation: "copy",
              // caseIds is missing
              sourceProjectId: 1,
              targetProjectId: 2,
            },
          }
        );
      });

      await test.step("Verify request is rejected as invalid", async () => {
        expect(response!.status()).toBe(400);
        const body = await response!.json();
        expect(body.error).toBe("Invalid request");
        expect(body.details).toBeDefined();
      });
    });

    test("returns 400 for empty caseIds array", async ({
      request,
      baseURL,
    }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Send preflight request with empty caseIds", async () => {
        response = await request.post(
          `${baseURL}/api/repository/copy-move/preflight`,
          {
            data: {
              operation: "copy",
              caseIds: [], // min(1) fails
              sourceProjectId: 1,
              targetProjectId: 2,
            },
          }
        );
      });

      await test.step("Verify request is rejected as invalid", async () => {
        expect(response!.status()).toBe(400);
        const body = await response!.json();
        expect(body.error).toBe("Invalid request");
      });
    });

    test("setup: create source and target projects with test case", async ({
      api,
      baseURL: _baseURL,
    }) => {
      const ts = Date.now();

      await test.step("Create source and target projects with root folders", async () => {
        sourceProjectId = await api.createProject(`E2E CopyMove Source ${ts}`);
        targetProjectId = await api.createProject(`E2E CopyMove Target ${ts}`);

        sourceFolderId = await api.getRootFolderId(sourceProjectId);
        targetFolderId = await api.getRootFolderId(targetProjectId);
      });

      await test.step("Create source test case with tag and steps", async () => {
        sourceCaseName = `CopyMove Test Case ${ts}`;
        sourceCaseId = await api.createTestCase(
          sourceProjectId,
          sourceFolderId,
          sourceCaseName
        );

        tagId = await api.createTag(`E2E-CopyMove-Tag-${ts}`);
        await api.addTagToTestCase(sourceCaseId, tagId);

        await api.addStepsToTestCase(sourceCaseId, [
          {
            step: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Step 1" }],
                },
              ],
            },
            expectedResult: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Expected 1" }],
                },
              ],
            },
            order: 1,
            sharedStepGroupId: null,
          },
          {
            step: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Step 2" }],
                },
              ],
            },
            expectedResult: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Expected 2" }],
                },
              ],
            },
            order: 2,
            sharedStepGroupId: null,
          },
        ]);
      });

      await test.step("Verify setup succeeded", async () => {
        expect(sourceProjectId).toBeGreaterThan(0);
        expect(targetProjectId).toBeGreaterThan(0);
        expect(sourceCaseId).toBeGreaterThan(0);
      });

      await test.step("Detach resources from per-test auto-cleanup", async () => {
        // Detach these resources from the api fixture's auto-cleanup so they
        // survive the setup test's teardown. Subsequent tests in this serial
        // describe rely on `sourceCaseId` etc. existing in the database; the
        // fire-and-forget delete-test-case call would otherwise race the next
        // test (e.g. the collision test reads sourceCases for the OR clause
        // and finds nothing once the source case has been soft-deleted). The
        // afterAll below cleans these up explicitly.
        api.untrackProject(sourceProjectId);
        api.untrackProject(targetProjectId);
        api.untrackCase(sourceCaseId);
        api.untrackTag(tagId);
      });
    });

    test("returns preflight response with access and compatibility info", async ({
      request,
      baseURL,
    }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Request preflight for copy from source to target", async () => {
        response = await request.post(
          `${baseURL}/api/repository/copy-move/preflight`,
          {
            data: {
              operation: "copy",
              caseIds: [sourceCaseId],
              sourceProjectId,
              targetProjectId,
            },
          }
        );
      });

      await test.step("Verify access and compatibility info in response", async () => {
        expect(response!.status()).toBe(200);
        const body = await response!.json();

        expect(body.hasSourceReadAccess).toBe(true);
        expect(body.hasTargetWriteAccess).toBe(true);
        expect(typeof body.templateMismatch).toBe("boolean");
        expect(Array.isArray(body.workflowMappings)).toBe(true);
        expect(Array.isArray(body.collisions)).toBe(true);
        expect(Array.isArray(body.missingTemplates)).toBe(true);
        expect(typeof body.targetRepositoryId).toBe("number");
        expect(typeof body.targetDefaultWorkflowStateId).toBe("number");
        expect(typeof body.targetTemplateId).toBe("number");
      });
    });

    test("detects collisions when target has case with same name", async ({
      request,
      baseURL,
      api,
    }) => {
      await test.step("Create colliding case with same name in target", async () => {
        // Create a case in the target project with the same name as the source case
        const collisionCaseId = await api.createTestCase(
          targetProjectId,
          targetFolderId,
          sourceCaseName
        );
        expect(collisionCaseId).toBeGreaterThan(0);

        // Give downstream indexing / cache layers a moment to observe the new
        // case — the preflight has read-your-writes issues under parallel load
        // and returns no collisions if it queries before the write is visible.
        await new Promise((resolve) => setTimeout(resolve, 1000));
      });

      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Request preflight for copy from source to target", async () => {
        response = await request.post(
          `${baseURL}/api/repository/copy-move/preflight`,
          {
            data: {
              operation: "copy",
              caseIds: [sourceCaseId],
              sourceProjectId,
              targetProjectId,
            },
          }
        );
      });

      await test.step("Verify collision for the duplicate case name is reported", async () => {
        expect(response!.status()).toBe(200);
        const body = await response!.json();

        expect(Array.isArray(body.collisions)).toBe(true);
        expect(body.collisions.length).toBeGreaterThanOrEqual(1);

        const collision = body.collisions.find(
          (c: { caseName: string }) => c.caseName === sourceCaseName
        );
        expect(collision).toBeDefined();
        expect(collision.caseName).toBe(sourceCaseName);
      });
    });

    test("returns canAutoAssignTemplates true for admin", async ({
      request,
      baseURL,
    }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Request preflight for copy from source to target", async () => {
        response = await request.post(
          `${baseURL}/api/repository/copy-move/preflight`,
          {
            data: {
              operation: "copy",
              caseIds: [sourceCaseId],
              sourceProjectId,
              targetProjectId,
            },
          }
        );
      });

      await test.step("Verify admin can auto-assign templates", async () => {
        expect(response!.status()).toBe(200);
        const body = await response!.json();
        expect(body.canAutoAssignTemplates).toBe(true);
      });
    });

    test("returns workflowMappings with name-matched states", async ({
      request,
      baseURL,
    }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Request preflight for copy from source to target", async () => {
        response = await request.post(
          `${baseURL}/api/repository/copy-move/preflight`,
          {
            data: {
              operation: "copy",
              caseIds: [sourceCaseId],
              sourceProjectId,
              targetProjectId,
            },
          }
        );
      });

      await test.step("Verify workflow mappings include name-matched states", async () => {
        expect(response!.status()).toBe(200);
        const body = await response!.json();

        expect(Array.isArray(body.workflowMappings)).toBe(true);
        expect(body.workflowMappings.length).toBeGreaterThan(0);

        const firstMapping = body.workflowMappings[0];
        expect(typeof firstMapping.sourceStateId).toBe("number");
        expect(typeof firstMapping.sourceStateName).toBe("string");
        expect(typeof firstMapping.targetStateId).toBe("number");
        expect(typeof firstMapping.targetStateName).toBe("string");
        expect(typeof firstMapping.isDefaultFallback).toBe("boolean");
      });
    });

    test("returns templateMismatch info correctly", async ({
      request,
      baseURL,
    }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Request preflight for copy from source to target", async () => {
        response = await request.post(
          `${baseURL}/api/repository/copy-move/preflight`,
          {
            data: {
              operation: "copy",
              caseIds: [sourceCaseId],
              sourceProjectId,
              targetProjectId,
            },
          }
        );
      });

      await test.step("Verify templateMismatch and missingTemplates info", async () => {
        expect(response!.status()).toBe(200);
        const body = await response!.json();

        // templateMismatch is a boolean; missingTemplates array present regardless of value
        expect(typeof body.templateMismatch).toBe("boolean");
        expect(Array.isArray(body.missingTemplates)).toBe(true);

        if (body.templateMismatch) {
          expect(body.missingTemplates.length).toBeGreaterThan(0);
          const firstMissing = body.missingTemplates[0];
          expect(typeof firstMissing.id).toBe("number");
          expect(typeof firstMissing.name).toBe("string");
        }
      });
    });
  });

  /**
   * POST /api/repository/copy-move (TEST-01 — submit)
   *
   * Enqueues a copy or move job. Returns jobId when queue is available,
   * or 503 when BullMQ/Redis is unavailable.
   */
  test.describe("POST /api/repository/copy-move", () => {
    test("returns 401 for unauthenticated requests", async ({
      browser,
      baseURL,
    }) => {
      const unauthCtx = await browser.newContext({ storageState: undefined });
      const unauthRequest = unauthCtx.request;

      let response: Awaited<ReturnType<typeof unauthRequest.post>> | undefined;
      await test.step("Submit copy-move request without authentication", async () => {
        response = await unauthRequest.post(
          `${baseURL}/api/repository/copy-move`,
          {
            data: {
              operation: "copy",
              caseIds: [1],
              sourceProjectId: 1,
              targetProjectId: 2,
              targetFolderId: 1,
              conflictResolution: "rename",
              sharedStepGroupResolution: "reuse",
            },
          }
        );
      });

      await test.step("Verify request is rejected as unauthorized", async () => {
        expect(response!.status()).toBe(401);
        const body = await response!.json();
        expect(body.error).toBe("Unauthorized");
        await unauthCtx.close();
      });
    });

    test("returns 400 for invalid body", async ({ request, baseURL }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Submit copy-move request missing required fields", async () => {
        response = await request.post(`${baseURL}/api/repository/copy-move`, {
          data: {
            // Missing required fields: caseIds, sourceProjectId, etc.
            operation: "copy",
          },
        });
      });

      await test.step("Verify request is rejected as invalid", async () => {
        expect(response!.status()).toBe(400);
        const body = await response!.json();
        expect(body.error).toBe("Invalid request");
        expect(body.details).toBeDefined();
      });
    });

    test("returns 400 for invalid operation value", async ({
      request,
      baseURL,
    }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Submit copy-move request with unsupported operation", async () => {
        response = await request.post(`${baseURL}/api/repository/copy-move`, {
          data: {
            operation: "clone", // not in enum
            caseIds: [1],
            sourceProjectId: 1,
            targetProjectId: 2,
            targetFolderId: 1,
            conflictResolution: "rename",
            sharedStepGroupResolution: "reuse",
          },
        });
      });

      await test.step("Verify request is rejected as invalid", async () => {
        expect(response!.status()).toBe(400);
        const body = await response!.json();
        expect(body.error).toBe("Invalid request");
      });
    });

    test("returns 503 or jobId for valid copy request", async ({
      request,
      baseURL,
    }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Submit valid copy request", async () => {
        response = await request.post(`${baseURL}/api/repository/copy-move`, {
          data: {
            operation: "copy",
            caseIds: [sourceCaseId],
            sourceProjectId,
            targetProjectId,
            targetFolderId,
            conflictResolution: "rename",
            sharedStepGroupResolution: "reuse",
            autoAssignTemplates: true,
          },
        });
      });

      await test.step("Verify job is enqueued or queue is unavailable", async () => {
        // Either 503 (queue unavailable) or 200 (with jobId) are valid responses
        expect([200, 503]).toContain(response!.status());
        const body = await response!.json();

        if (response!.status() === 503) {
          expect(body.error).toBe("Background job queue is not available");
        } else {
          expect(body.jobId).toBeDefined();
          expect(typeof body.jobId).toBe("string");
          copyJobId = body.jobId;
        }
      });
    });
  });

  /**
   * Copy data carry-over verification (TEST-01)
   *
   * Verifies that after a copy operation, the target project contains
   * the copied case with its tags and steps intact.
   */
  test.describe("Copy data carry-over verification", () => {
    test("copied case exists in target with correct name", async ({
      request,
      baseURL,
    }) => {
      test.skip(!copyJobId, "Queue unavailable — skipping data verification");

      await test.step("Wait for copy job to complete", async () => {
        const jobResult = await pollUntilDone(request, baseURL!, copyJobId!);
        expect(jobResult.state).toBe("completed");
      });

      let caseData: any;
      await test.step("Read most recently created case in target project", async () => {
        // Find the most recently created case in the target project
        const readResponse = await request.get(
          `${baseURL}/api/model/repositoryCases/findFirst`,
          {
            params: {
              q: JSON.stringify({
                where: { projectId: targetProjectId, isDeleted: false },
                orderBy: { createdAt: "desc" },
                include: { tags: true },
              }),
            },
          }
        );

        expect(readResponse.status()).toBe(200);
        caseData = await readResponse.json();
        expect(caseData.data).toBeDefined();
      });

      await test.step("Verify copied case has a name and carried-over tags", async () => {
        // Renamed with suffix on collision, or original name if no collision
        expect(typeof caseData.data.name).toBe("string");
        expect(caseData.data.name.length).toBeGreaterThan(0);

        // Tags should be copied
        expect(Array.isArray(caseData.data.tags)).toBe(true);
        expect(caseData.data.tags.length).toBeGreaterThan(0);

        copiedCaseId = caseData.data.id;
      });
    });

    test("copied case has steps in target", async ({ request, baseURL }) => {
      test.skip(
        !copyJobId || !copiedCaseId,
        "Queue unavailable — skipping data verification"
      );

      let stepsResponse: Awaited<ReturnType<typeof request.get>> | undefined;
      await test.step("Read steps for the copied case", async () => {
        stepsResponse = await request.get(
          `${baseURL}/api/model/steps/findMany`,
          {
            params: {
              q: JSON.stringify({
                where: { testCaseId: copiedCaseId, isDeleted: false },
              }),
            },
          }
        );
      });

      await test.step("Verify all source steps were preserved", async () => {
        expect(stepsResponse!.status()).toBe(200);
        const stepsData = await stepsResponse!.json();
        expect(Array.isArray(stepsData.data)).toBe(true);
        // Source had 2 steps — copy should preserve all steps
        expect(stepsData.data.length).toBe(2);
      });
    });

    test("source case still exists after copy (not deleted)", async ({
      request,
      baseURL,
    }) => {
      test.skip(!copyJobId, "Queue unavailable — skipping data verification");

      let readResponse: Awaited<ReturnType<typeof request.get>> | undefined;
      await test.step("Read source case after copy", async () => {
        readResponse = await request.get(
          `${baseURL}/api/model/repositoryCases/findFirst`,
          {
            params: {
              q: JSON.stringify({
                where: { id: sourceCaseId },
                select: { id: true, isDeleted: true },
              }),
            },
          }
        );
      });

      await test.step("Verify source case is still present and not deleted", async () => {
        expect(readResponse!.status()).toBe(200);
        const caseData = await readResponse!.json();
        expect(caseData.data).toBeDefined();
        expect(caseData.data.isDeleted).toBe(false);
      });
    });
  });

  /**
   * Move operation (TEST-01 — move)
   *
   * Verifies that a move operation soft-deletes the source case and
   * creates a copy in the target project.
   */
  test.describe("Move operation", () => {
    test("setup: create a new case for move test", async ({ api }) => {
      const ts = Date.now();
      moveCaseId = await api.createTestCase(
        sourceProjectId,
        sourceFolderId,
        `CopyMove Move Test Case ${ts}`
      );
      expect(moveCaseId).toBeGreaterThan(0);
    });

    test("returns 503 or jobId for valid move request", async ({
      request,
      baseURL,
    }) => {
      let response: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Submit valid move request", async () => {
        response = await request.post(`${baseURL}/api/repository/copy-move`, {
          data: {
            operation: "move",
            caseIds: [moveCaseId],
            sourceProjectId,
            targetProjectId,
            targetFolderId,
            conflictResolution: "rename",
            sharedStepGroupResolution: "reuse",
            autoAssignTemplates: true,
          },
        });
      });

      await test.step("Verify job is enqueued or queue is unavailable", async () => {
        // Either 503 (queue unavailable) or 200 (with jobId) are valid responses
        expect([200, 503]).toContain(response!.status());
        const body = await response!.json();

        if (response!.status() === 503) {
          expect(body.error).toBe("Background job queue is not available");
        } else {
          expect(body.jobId).toBeDefined();
          expect(typeof body.jobId).toBe("string");
          moveJobId = body.jobId;
        }
      });
    });

    test("moved case source is soft-deleted", async ({ request, baseURL }) => {
      test.skip(!moveJobId, "Queue unavailable — skipping move verification");

      await test.step("Wait for move job to complete", async () => {
        const jobResult = await pollUntilDone(request, baseURL!, moveJobId!);
        expect(jobResult.state).toBe("completed");
      });

      let readResponse: Awaited<ReturnType<typeof request.get>> | undefined;
      await test.step("Read moved source case filtered to non-deleted", async () => {
        // After move, the source case should not be visible via standard (policy-filtered) API
        // because it is soft-deleted (isDeleted: true)
        readResponse = await request.get(
          `${baseURL}/api/model/repositoryCases/findFirst`,
          {
            params: {
              q: JSON.stringify({
                where: { id: moveCaseId, isDeleted: false },
                select: { id: true, isDeleted: true },
              }),
            },
          }
        );
      });

      await test.step("Verify source case is soft-deleted and filtered out", async () => {
        expect(readResponse!.status()).toBe(200);
        const caseData = await readResponse!.json();
        // Source case should be null (soft-deleted and filtered out by isDeleted: false)
        expect(caseData.data).toBeNull();
      });
    });
  });

  /**
   * GET /api/repository/copy-move/status/:jobId
   *
   * Returns job state, progress, and result for a queued copy/move job.
   */
  test.describe("GET /api/repository/copy-move/status/:jobId", () => {
    test("returns 401 for unauthenticated requests", async ({
      browser,
      baseURL,
    }) => {
      const unauthCtx = await browser.newContext({ storageState: undefined });
      const unauthRequest = unauthCtx.request;

      let response: Awaited<ReturnType<typeof unauthRequest.get>> | undefined;
      await test.step("Request job status without authentication", async () => {
        response = await unauthRequest.get(
          `${baseURL}/api/repository/copy-move/status/nonexistent-job-123`
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
          `${baseURL}/api/repository/copy-move/status/nonexistent-copy-move-job-e2e-99999`
        );
      });

      await test.step("Verify response is job-not-found or queue-unavailable", async () => {
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

    test("returns structured response for existing job", async ({
      request,
      baseURL,
    }) => {
      test.skip(!copyJobId, "Queue unavailable — no jobId to check");

      let response: Awaited<ReturnType<typeof request.get>> | undefined;
      await test.step("Request status for the existing copy job", async () => {
        response = await request.get(
          `${baseURL}/api/repository/copy-move/status/${copyJobId}`
        );
      });

      await test.step("Verify structured status response", async () => {
        expect([200, 404]).toContain(response!.status());

        if (response!.status() === 200) {
          const body = await response!.json();
          expect(body.jobId).toBeDefined();
          expect(typeof body.state).toBe("string");
        }
      });
    });
  });

  /**
   * POST /api/repository/copy-move/cancel/:jobId
   *
   * Cancels an in-progress or waiting copy/move job.
   */
  test.describe("POST /api/repository/copy-move/cancel/:jobId", () => {
    test("returns 401 for unauthenticated requests", async ({
      browser,
      baseURL,
    }) => {
      const unauthCtx = await browser.newContext({ storageState: undefined });
      const unauthRequest = unauthCtx.request;

      let response: Awaited<ReturnType<typeof unauthRequest.post>> | undefined;
      await test.step("Request job cancel without authentication", async () => {
        response = await unauthRequest.post(
          `${baseURL}/api/repository/copy-move/cancel/nonexistent-job-123`
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
      await test.step("Request cancel for a non-existent job ID", async () => {
        response = await request.post(
          `${baseURL}/api/repository/copy-move/cancel/nonexistent-copy-move-job-e2e-99999`
        );
      });

      await test.step("Verify response is job-not-found or queue-unavailable", async () => {
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

  // ─── Folder Tree Copy/Move ─────────────────────────────────────────────────

  test.describe("folder tree copy/move", () => {
    test("submit with folderTree creates folders and maps cases to correct folders", async ({
      request,
      baseURL,
      api: apiHelper,
    }) => {
      let sourceProjectId: number | undefined;
      let sourceFolderId: number | undefined;
      let sourceSubfolderId: number | undefined;
      let parentCaseId: number | undefined;
      let childCaseId: number | undefined;
      let targetProjectId: number | undefined;
      let targetFolderId: number | undefined;

      await test.step("Create source project with nested folders and cases", async () => {
        // Create source project with a folder containing a subfolder
        sourceProjectId = await apiHelper.createProject(
          `FolderTreeSource ${Date.now()}`
        );
        sourceFolderId = await apiHelper.createFolder(
          sourceProjectId,
          "ParentFolder"
        );
        sourceSubfolderId = await apiHelper.createFolder(
          sourceProjectId,
          "ChildFolder",
          sourceFolderId
        );

        // Create a test case in each folder
        parentCaseId = await apiHelper.createTestCase(
          sourceProjectId,
          sourceFolderId,
          `ParentCase ${Date.now()}`
        );
        childCaseId = await apiHelper.createTestCase(
          sourceProjectId,
          sourceSubfolderId,
          `ChildCase ${Date.now()}`
        );
      });

      await test.step("Create target project with a destination folder", async () => {
        // Create target project with a destination folder
        targetProjectId = await apiHelper.createProject(
          `FolderTreeTarget ${Date.now()}`
        );
        targetFolderId = await apiHelper.createFolder(
          targetProjectId,
          "Destination"
        );
      });

      let submitRes: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Submit copy with folderTree and verify it is accepted", async () => {
        // Build the folderTree in BFS order
        const folderTree = [
          {
            localKey: String(sourceFolderId),
            sourceFolderId: sourceFolderId,
            name: "ParentFolder",
            parentLocalKey: null,
            caseIds: [parentCaseId],
          },
          {
            localKey: String(sourceSubfolderId),
            sourceFolderId: sourceSubfolderId,
            name: "ChildFolder",
            parentLocalKey: String(sourceFolderId),
            caseIds: [childCaseId],
          },
        ];

        // Submit with folderTree
        submitRes = await request.post(`${baseURL}/api/repository/copy-move`, {
          data: {
            operation: "copy",
            caseIds: [parentCaseId, childCaseId],
            sourceProjectId: sourceProjectId,
            targetProjectId: targetProjectId,
            targetFolderId: targetFolderId,
            conflictResolution: "skip",
            sharedStepGroupResolution: "reuse",
            folderTree,
          },
        });

        // Accept 200 (queue available) or 503 (queue unavailable)
        expect([200, 503]).toContain(submitRes.status());
      });

      if (submitRes!.status() === 200) {
        await test.step("Wait for copy job to complete with both cases copied", async () => {
          const { jobId } = await submitRes!.json();
          expect(jobId).toBeTruthy();

          // Poll until done
          const { state, result } = await pollUntilDone(
            request,
            baseURL!,
            jobId
          );
          expect(state).toBe("completed");
          expect(result.copiedCount).toBe(2);
        });

        await test.step("Verify recreated folder tree under target destination", async () => {
          // Verify folders were created under the target destination
          const foldersRes = await request.get(
            `${baseURL}/api/model/repositoryFolders/findMany?q=${encodeURIComponent(
              JSON.stringify({
                where: {
                  projectId: targetProjectId,
                  parentId: targetFolderId,
                  isDeleted: false,
                },
              })
            )}`
          );
          // ZenStack's RPC findMany wraps the rows in `{ data: [...] }`,
          // not a bare array.
          const targetFoldersBody = await foldersRes.json();
          const parentFolderInTarget = targetFoldersBody.data.find(
            (f: any) => f.name === "ParentFolder"
          );
          expect(parentFolderInTarget).toBeTruthy();

          // Verify subfolder exists under the recreated parent
          if (parentFolderInTarget) {
            const subFoldersRes = await request.get(
              `${baseURL}/api/model/repositoryFolders/findMany?q=${encodeURIComponent(
                JSON.stringify({
                  where: {
                    projectId: targetProjectId,
                    parentId: parentFolderInTarget.id,
                    isDeleted: false,
                  },
                })
              )}`
            );
            const subFoldersBody = await subFoldersRes.json();
            const childFolderInTarget = subFoldersBody.data.find(
              (f: any) => f.name === "ChildFolder"
            );
            expect(childFolderInTarget).toBeTruthy();
          }
        });
      }
    });

    test("move with folderTree soft-deletes source folders", async ({
      request,
      baseURL,
      api: apiHelper,
    }) => {
      let sourceProjectId: number | undefined;
      let sourceFolderId: number | undefined;
      let testCaseId: number | undefined;
      let targetProjectId: number | undefined;
      let targetFolderId: number | undefined;

      await test.step("Create source project, folder, and case to move", async () => {
        sourceProjectId = await apiHelper.createProject(
          `FolderMoveSource ${Date.now()}`
        );
        sourceFolderId = await apiHelper.createFolder(
          sourceProjectId,
          "MoveFolder"
        );
        testCaseId = await apiHelper.createTestCase(
          sourceProjectId,
          sourceFolderId,
          `MoveCase ${Date.now()}`
        );
      });

      await test.step("Create target project with a destination folder", async () => {
        targetProjectId = await apiHelper.createProject(
          `FolderMoveTarget ${Date.now()}`
        );
        targetFolderId = await apiHelper.createFolder(
          targetProjectId,
          "MoveDest"
        );
      });

      let submitRes: Awaited<ReturnType<typeof request.post>> | undefined;
      await test.step("Submit move with folderTree and verify it is accepted", async () => {
        const folderTree = [
          {
            localKey: String(sourceFolderId),
            sourceFolderId: sourceFolderId,
            name: "MoveFolder",
            parentLocalKey: null,
            caseIds: [testCaseId],
          },
        ];

        submitRes = await request.post(`${baseURL}/api/repository/copy-move`, {
          data: {
            operation: "move",
            caseIds: [testCaseId],
            sourceProjectId: sourceProjectId,
            targetProjectId: targetProjectId,
            targetFolderId: targetFolderId,
            conflictResolution: "skip",
            sharedStepGroupResolution: "reuse",
            folderTree,
          },
        });

        expect([200, 503]).toContain(submitRes.status());
      });

      if (submitRes!.status() === 200) {
        await test.step("Wait for move job to complete with one case moved", async () => {
          const { jobId } = await submitRes!.json();
          const { state, result } = await pollUntilDone(
            request,
            baseURL!,
            jobId
          );
          expect(state).toBe("completed");
          expect(result.movedCount).toBe(1);
        });

        await test.step("Verify source folder is soft-deleted", async () => {
          // Verify source folder is soft-deleted
          const sourceFolderRes = await request.get(
            `${baseURL}/api/model/repositoryFolders/findFirst?q=${encodeURIComponent(
              JSON.stringify({ where: { id: sourceFolderId } })
            )}`
          );
          // ZenStack's RPC findFirst wraps the row in `{ data: { ... } }`.
          const updatedSourceFolder = await sourceFolderRes.json();
          expect(updatedSourceFolder.data.isDeleted).toBe(true);
        });
      }
    });
  });
});
