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
  maxAttempts = 30,
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

      const response = await unauthRequest.post(
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

      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.error).toBe("Unauthorized");
      await unauthCtx.close();
    });

    test("returns 400 for missing caseIds", async ({ request, baseURL }) => {
      const response = await request.post(
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

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Invalid request");
      expect(body.details).toBeDefined();
    });

    test("returns 400 for empty caseIds array", async ({ request, baseURL }) => {
      const response = await request.post(
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

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Invalid request");
    });

    test("setup: create source and target projects with test case", async ({
      api,
      baseURL: _baseURL,
    }) => {
      const ts = Date.now();
      sourceProjectId = await api.createProject(
        `E2E CopyMove Source ${ts}`
      );
      targetProjectId = await api.createProject(
        `E2E CopyMove Target ${ts}`
      );

      sourceFolderId = await api.getRootFolderId(sourceProjectId);
      targetFolderId = await api.getRootFolderId(targetProjectId);

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
          step: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Step 1" }] }] },
          expectedResult: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Expected 1" }] }] },
          order: 1,
          sharedStepGroupId: null,
        },
        {
          step: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Step 2" }] }] },
          expectedResult: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Expected 2" }] }] },
          order: 2,
          sharedStepGroupId: null,
        },
      ]);

      // Verify setup succeeded
      expect(sourceProjectId).toBeGreaterThan(0);
      expect(targetProjectId).toBeGreaterThan(0);
      expect(sourceCaseId).toBeGreaterThan(0);
    });

    test("returns preflight response with access and compatibility info", async ({
      request,
      baseURL,
    }) => {
      const response = await request.post(
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

      expect(response.status()).toBe(200);
      const body = await response.json();

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

    test("detects collisions when target has case with same name", async ({
      request,
      baseURL,
      api,
    }) => {
      // Create a case in the target project with the same name as the source case
      const collisionCaseId = await api.createTestCase(targetProjectId, targetFolderId, sourceCaseName);
      expect(collisionCaseId).toBeGreaterThan(0);

      const response = await request.post(
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

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(Array.isArray(body.collisions)).toBe(true);
      expect(body.collisions.length).toBeGreaterThanOrEqual(1);

      const collision = body.collisions.find(
        (c: { caseName: string }) => c.caseName === sourceCaseName
      );
      expect(collision).toBeDefined();
      expect(collision.caseName).toBe(sourceCaseName);
    });

    test("returns canAutoAssignTemplates true for admin", async ({
      request,
      baseURL,
    }) => {
      const response = await request.post(
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

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.canAutoAssignTemplates).toBe(true);
    });

    test("returns workflowMappings with name-matched states", async ({
      request,
      baseURL,
    }) => {
      const response = await request.post(
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

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(Array.isArray(body.workflowMappings)).toBe(true);
      expect(body.workflowMappings.length).toBeGreaterThan(0);

      const firstMapping = body.workflowMappings[0];
      expect(typeof firstMapping.sourceStateId).toBe("number");
      expect(typeof firstMapping.sourceStateName).toBe("string");
      expect(typeof firstMapping.targetStateId).toBe("number");
      expect(typeof firstMapping.targetStateName).toBe("string");
      expect(typeof firstMapping.isDefaultFallback).toBe("boolean");
    });

    test("returns templateMismatch info correctly", async ({
      request,
      baseURL,
    }) => {
      const response = await request.post(
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

      expect(response.status()).toBe(200);
      const body = await response.json();

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

      const response = await unauthRequest.post(
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

      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.error).toBe("Unauthorized");
      await unauthCtx.close();
    });

    test("returns 400 for invalid body", async ({ request, baseURL }) => {
      const response = await request.post(
        `${baseURL}/api/repository/copy-move`,
        {
          data: {
            // Missing required fields: caseIds, sourceProjectId, etc.
            operation: "copy",
          },
        }
      );

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Invalid request");
      expect(body.details).toBeDefined();
    });

    test("returns 400 for invalid operation value", async ({
      request,
      baseURL,
    }) => {
      const response = await request.post(
        `${baseURL}/api/repository/copy-move`,
        {
          data: {
            operation: "clone", // not in enum
            caseIds: [1],
            sourceProjectId: 1,
            targetProjectId: 2,
            targetFolderId: 1,
            conflictResolution: "rename",
            sharedStepGroupResolution: "reuse",
          },
        }
      );

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Invalid request");
    });

    test("returns 503 or jobId for valid copy request", async ({
      request,
      baseURL,
    }) => {
      const response = await request.post(
        `${baseURL}/api/repository/copy-move`,
        {
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
        }
      );

      // Either 503 (queue unavailable) or 200 (with jobId) are valid responses
      expect([200, 503]).toContain(response.status());
      const body = await response.json();

      if (response.status() === 503) {
        expect(body.error).toBe("Background job queue is not available");
      } else {
        expect(body.jobId).toBeDefined();
        expect(typeof body.jobId).toBe("string");
        copyJobId = body.jobId;
      }
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

      const jobResult = await pollUntilDone(request, baseURL!, copyJobId!);
      expect(jobResult.state).toBe("completed");

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
      const caseData = await readResponse.json();
      expect(caseData.data).toBeDefined();

      // Renamed with suffix on collision, or original name if no collision
      expect(typeof caseData.data.name).toBe("string");
      expect(caseData.data.name.length).toBeGreaterThan(0);

      // Tags should be copied
      expect(Array.isArray(caseData.data.tags)).toBe(true);
      expect(caseData.data.tags.length).toBeGreaterThan(0);

      copiedCaseId = caseData.data.id;
    });

    test("copied case has steps in target", async ({ request, baseURL }) => {
      test.skip(!copyJobId || !copiedCaseId, "Queue unavailable — skipping data verification");

      const stepsResponse = await request.get(
        `${baseURL}/api/model/steps/findMany`,
        {
          params: {
            q: JSON.stringify({
              where: { testCaseId: copiedCaseId, isDeleted: false },
            }),
          },
        }
      );

      expect(stepsResponse.status()).toBe(200);
      const stepsData = await stepsResponse.json();
      expect(Array.isArray(stepsData.data)).toBe(true);
      // Source had 2 steps — copy should preserve all steps
      expect(stepsData.data.length).toBe(2);
    });

    test("source case still exists after copy (not deleted)", async ({
      request,
      baseURL,
    }) => {
      test.skip(!copyJobId, "Queue unavailable — skipping data verification");

      const readResponse = await request.get(
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

      expect(readResponse.status()).toBe(200);
      const caseData = await readResponse.json();
      expect(caseData.data).toBeDefined();
      expect(caseData.data.isDeleted).toBe(false);
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
      const response = await request.post(
        `${baseURL}/api/repository/copy-move`,
        {
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
        }
      );

      // Either 503 (queue unavailable) or 200 (with jobId) are valid responses
      expect([200, 503]).toContain(response.status());
      const body = await response.json();

      if (response.status() === 503) {
        expect(body.error).toBe("Background job queue is not available");
      } else {
        expect(body.jobId).toBeDefined();
        expect(typeof body.jobId).toBe("string");
        moveJobId = body.jobId;
      }
    });

    test("moved case source is soft-deleted", async ({ request, baseURL }) => {
      test.skip(!moveJobId, "Queue unavailable — skipping move verification");

      const jobResult = await pollUntilDone(request, baseURL!, moveJobId!);
      expect(jobResult.state).toBe("completed");

      // After move, the source case should not be visible via standard (policy-filtered) API
      // because it is soft-deleted (isDeleted: true)
      const readResponse = await request.get(
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

      expect(readResponse.status()).toBe(200);
      const caseData = await readResponse.json();
      // Source case should be null (soft-deleted and filtered out by isDeleted: false)
      expect(caseData.data).toBeNull();
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

      const response = await unauthRequest.get(
        `${baseURL}/api/repository/copy-move/status/nonexistent-job-123`
      );

      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.error).toBe("Unauthorized");
      await unauthCtx.close();
    });

    test("returns 503 or 404 for non-existent job ID", async ({
      request,
      baseURL,
    }) => {
      const response = await request.get(
        `${baseURL}/api/repository/copy-move/status/nonexistent-copy-move-job-e2e-99999`
      );

      // If queue is unavailable, returns 503; if available but job not found, returns 404
      expect([404, 503]).toContain(response.status());
      const body = await response.json();

      if (response.status() === 404) {
        expect(body.error).toBe("Job not found");
      } else {
        expect(body.error).toBe("Background job queue is not available");
      }
    });

    test("returns structured response for existing job", async ({
      request,
      baseURL,
    }) => {
      test.skip(!copyJobId, "Queue unavailable — no jobId to check");

      const response = await request.get(
        `${baseURL}/api/repository/copy-move/status/${copyJobId}`
      );

      expect([200, 404]).toContain(response.status());

      if (response.status() === 200) {
        const body = await response.json();
        expect(body.jobId).toBeDefined();
        expect(typeof body.state).toBe("string");
      }
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

      const response = await unauthRequest.post(
        `${baseURL}/api/repository/copy-move/cancel/nonexistent-job-123`
      );

      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.error).toBe("Unauthorized");
      await unauthCtx.close();
    });

    test("returns 503 or 404 for non-existent job ID", async ({
      request,
      baseURL,
    }) => {
      const response = await request.post(
        `${baseURL}/api/repository/copy-move/cancel/nonexistent-copy-move-job-e2e-99999`
      );

      // If queue is unavailable, returns 503; if available but job not found, returns 404
      expect([404, 503]).toContain(response.status());
      const body = await response.json();

      if (response.status() === 404) {
        expect(body.error).toBe("Job not found");
      } else {
        expect(body.error).toBe("Background job queue is not available");
      }
    });
  });

  // ─── Folder Tree Copy/Move ─────────────────────────────────────────────────

  test.describe("folder tree copy/move", () => {
    test("submit with folderTree creates folders and maps cases to correct folders", async ({
      request,
      baseURL,
      api: apiHelper,
    }) => {
      // Create source project with a folder containing a subfolder
      const sourceProjectId = await apiHelper.createProject(
        `FolderTreeSource ${Date.now()}`
      );
      const sourceFolderId = await apiHelper.createFolder(
        sourceProjectId,
        "ParentFolder"
      );
      const sourceSubfolderId = await apiHelper.createFolder(
        sourceProjectId,
        "ChildFolder",
        sourceFolderId
      );

      // Create a test case in each folder
      const parentCaseId = await apiHelper.createTestCase(
        sourceProjectId,
        sourceFolderId,
        `ParentCase ${Date.now()}`
      );
      const childCaseId = await apiHelper.createTestCase(
        sourceProjectId,
        sourceSubfolderId,
        `ChildCase ${Date.now()}`
      );

      // Create target project with a destination folder
      const targetProjectId = await apiHelper.createProject(
        `FolderTreeTarget ${Date.now()}`
      );
      const targetFolderId = await apiHelper.createFolder(
        targetProjectId,
        "Destination"
      );

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
      const submitRes = await request.post(
        `${baseURL}/api/repository/copy-move`,
        {
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
        }
      );

      // Accept 200 (queue available) or 503 (queue unavailable)
      expect([200, 503]).toContain(submitRes.status());

      if (submitRes.status() === 200) {
        const { jobId } = await submitRes.json();
        expect(jobId).toBeTruthy();

        // Poll until done
        const { state, result } = await pollUntilDone(
          request,
          baseURL!,
          jobId
        );
        expect(state).toBe("completed");
        expect(result.copiedCount).toBe(2);

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
        const targetFolders = await foldersRes.json();
        const parentFolderInTarget = targetFolders.find(
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
          const subFolders = await subFoldersRes.json();
          const childFolderInTarget = subFolders.find(
            (f: any) => f.name === "ChildFolder"
          );
          expect(childFolderInTarget).toBeTruthy();
        }
      }
    });

    test("move with folderTree soft-deletes source folders", async ({
      request,
      baseURL,
      api: apiHelper,
    }) => {
      const sourceProjectId = await apiHelper.createProject(
        `FolderMoveSource ${Date.now()}`
      );
      const sourceFolderId = await apiHelper.createFolder(
        sourceProjectId,
        "MoveFolder"
      );
      const testCaseId = await apiHelper.createTestCase(
        sourceProjectId,
        sourceFolderId,
        `MoveCase ${Date.now()}`
      );

      const targetProjectId = await apiHelper.createProject(
        `FolderMoveTarget ${Date.now()}`
      );
      const targetFolderId = await apiHelper.createFolder(
        targetProjectId,
        "MoveDest"
      );

      const folderTree = [
        {
          localKey: String(sourceFolderId),
          sourceFolderId: sourceFolderId,
          name: "MoveFolder",
          parentLocalKey: null,
          caseIds: [testCaseId],
        },
      ];

      const submitRes = await request.post(
        `${baseURL}/api/repository/copy-move`,
        {
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
        }
      );

      expect([200, 503]).toContain(submitRes.status());

      if (submitRes.status() === 200) {
        const { jobId } = await submitRes.json();
        const { state, result } = await pollUntilDone(
          request,
          baseURL!,
          jobId
        );
        expect(state).toBe("completed");
        expect(result.movedCount).toBe(1);

        // Verify source folder is soft-deleted
        const sourceFolderRes = await request.get(
          `${baseURL}/api/model/repositoryFolders/findFirst?q=${encodeURIComponent(
            JSON.stringify({ where: { id: sourceFolderId } })
          )}`
        );
        const updatedSourceFolder = await sourceFolderRes.json();
        expect(updatedSourceFolder.isDeleted).toBe(true);
      }
    });
  });
});
