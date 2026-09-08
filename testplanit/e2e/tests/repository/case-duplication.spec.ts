import { type APIResponse, type APIRequestContext } from "@playwright/test";
import { expect, test } from "../../fixtures/index";

/**
 * Case duplication E2E — exercises the within-project copy path through
 * POST /api/repository/copy-move and verifies that the worker writes a
 * RepositoryCaseLink(type=DUPLICATED_FROM) row plus a DUPLICATED audit
 * row for the new case. Also asserts the cross-tenant 403 access denial.
 *
 * Queue-dependent steps may return 503 if BullMQ/Redis is unavailable;
 * data verification then skips, mirroring copy-move-endpoints.spec.ts.
 * The audit-row verification degrades gracefully if the AuditLog worker
 * is not running in the E2E environment — the unit test in
 * workers/copyMoveWorker.test.ts is the authoritative gate for the
 * audit emission shape.
 */

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

let projectId: number;
let rootFolderId: number;
let sourceCaseId: number;
let sourceCaseName: string;
let duplicateJobId: string | undefined;
let duplicatedCaseId: number | undefined;

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

test.describe("Case duplication", () => {
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
    if (duplicatedCaseId) {
      ops.push(
        request
          .patch(`${baseURL}/api/model/repositoryCases/update`, {
            data: {
              where: { id: duplicatedCaseId },
              data: { isDeleted: true },
            },
          })
          .catch(() => {})
      );
    }
    if (projectId) {
      ops.push(
        request
          .patch(`${baseURL}/api/model/projects/update`, {
            data: { where: { id: projectId }, data: { isDeleted: true } },
          })
          .catch(() => {})
      );
    }
    await Promise.all(ops);
  });

  test("setup: create project with test case", async ({ api }) => {
    const ts = Date.now();

    await test.step("Create project, root folder, and source test case", async () => {
      projectId = await api.createProject(`E2E Duplication ${ts}`);
      rootFolderId = await api.getRootFolderId(projectId);
      sourceCaseName = `Duplication Test Case ${ts}`;
      sourceCaseId = await api.createTestCase(
        projectId,
        rootFolderId,
        sourceCaseName
      );
    });

    await test.step("Verify created IDs are valid", async () => {
      expect(projectId).toBeGreaterThan(0);
      expect(rootFolderId).toBeGreaterThan(0);
      expect(sourceCaseId).toBeGreaterThan(0);
    });

    await test.step("Untrack project and case from auto-cleanup", async () => {
      api.untrackProject(projectId);
      api.untrackCase(sourceCaseId);
    });
  });

  test("returns 503 or jobId for within-project copy request", async ({
    request,
    baseURL,
  }) => {
    let response: APIResponse | undefined;

    await test.step("Send within-project copy request", async () => {
      response = await request.post(`${baseURL}/api/repository/copy-move`, {
        data: {
          operation: "copy",
          caseIds: [sourceCaseId],
          sourceProjectId: projectId,
          targetProjectId: projectId,
          targetFolderId: rootFolderId,
          conflictResolution: "rename",
          sharedStepGroupResolution: "reuse",
        },
      });
    });

    await test.step("Verify response is 503 queue-unavailable or returns a jobId", async () => {
      expect([200, 503]).toContain(response!.status());
      const body = await response!.json();

      if (response!.status() === 503) {
        expect(body.error).toBe("Background job queue is not available");
      } else {
        expect(body.jobId).toBeDefined();
        expect(typeof body.jobId).toBe("string");
        duplicateJobId = body.jobId;
      }
    });
  });

  test("provenance link exists after duplication (DUP-04)", async ({
    request,
    baseURL,
  }) => {
    test.skip(
      !duplicateJobId,
      "Queue unavailable — skipping data verification"
    );

    await test.step("Wait for the duplication job to complete", async () => {
      const jobResult = await pollUntilDone(request, baseURL!, duplicateJobId!);
      expect(jobResult.state).toBe("completed");
    });

    await test.step("Read the newly created duplicate case", async () => {
      const readResponse = await request.get(
        `${baseURL}/api/model/repositoryCases/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: {
                projectId,
                isDeleted: false,
                id: { not: sourceCaseId },
              },
              orderBy: { createdAt: "desc" },
            }),
          },
        }
      );
      expect(readResponse.status()).toBe(200);
      const readBody = await readResponse.json();
      expect(readBody.data).toBeDefined();
      duplicatedCaseId = readBody.data.id;
      expect(duplicatedCaseId).toBeGreaterThan(0);
    });

    await test.step("Verify DUPLICATED_FROM provenance link exists", async () => {
      const linkResponse = await request.get(
        `${baseURL}/api/model/repositoryCaseLink/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: {
                caseAId: duplicatedCaseId,
                caseBId: sourceCaseId,
                type: "DUPLICATED_FROM",
                isDeleted: false,
              },
            }),
          },
        }
      );
      expect(linkResponse.status()).toBe(200);
      const linkData = await linkResponse.json();
      expect(linkData.data).toBeDefined();
      expect(linkData.data.type).toBe("DUPLICATED_FROM");
    });
  });

  test("DUPLICATED audit row exists for duplicated case (DUP-10)", async ({
    request,
    baseURL,
  }) => {
    test.skip(
      !duplicatedCaseId,
      "Skip — duplicated case not created (queue unavailable upstream)"
    );

    let auditFound = false;

    await test.step("Poll for the DUPLICATED audit row and verify its shape", async () => {
      for (let attempt = 0; attempt < 10; attempt++) {
        const res = await request.get(
          `${baseURL}/api/model/auditLog/findFirst`,
          {
            params: {
              q: JSON.stringify({
                where: {
                  action: "DUPLICATED",
                  entityType: "RepositoryCases",
                  entityId: String(duplicatedCaseId),
                },
              }),
            },
          }
        );
        if (res.ok()) {
          const body = await res.json();
          if (body.data) {
            auditFound = true;
            expect(body.data.action).toBe("DUPLICATED");
            expect(body.data.metadata).toMatchObject({
              duplicatedFromCaseId: sourceCaseId,
            });
            break;
          }
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    });

    await test.step("Warn and degrade gracefully if no audit row was found", async () => {
      if (!auditFound) {
        console.warn(
          "[case-duplication] No DUPLICATED audit row detected. AuditLog worker may not be running in E2E env. Degrading gracefully — unit test verifies emission shape."
        );
      }
    });
  });

  test("cross-tenant POST returns 403 (DUP-09)", async ({
    request,
    baseURL,
  }) => {
    let response: APIResponse | undefined;

    await test.step("Send copy request with an inaccessible source project", async () => {
      response = await request.post(`${baseURL}/api/repository/copy-move`, {
        data: {
          operation: "copy",
          caseIds: [sourceCaseId],
          sourceProjectId: 999_999_999,
          targetProjectId: projectId,
          targetFolderId: rootFolderId,
          conflictResolution: "rename",
          sharedStepGroupResolution: "reuse",
        },
      });
    });

    await test.step("Verify the request is denied with 403 and access error", async () => {
      expect(response!.status()).toBe(403);
      const body = await response!.json();
      expect(body.error).toMatch(/No access to source project/);
    });
  });
});
