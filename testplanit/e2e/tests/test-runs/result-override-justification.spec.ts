import { expect, test } from "../../fixtures";

/**
 * Result Override Justification E2E (API contract)
 *
 * Exercises the live submit-result route end to end: a non-empty justification
 * (notes) is required only when a submission changes the judgment between two
 * COMPLETED outcomes on the same run-case. First results, same-outcome
 * re-submissions, and clears to a non-completed status are unaffected.
 *
 * Prior attempts are seeded through the model route (api.createTestResult),
 * which is not gated, so each test sets up its starting state without tripping
 * the rule under test.
 */
test.describe("Result override justification", () => {
  const noteDoc = (text: string) => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });

  async function seedRunCase(api: any) {
    // Unique suffix (timestamp + random) so parallel workers never collide on
    // the unique project-name constraint.
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const projectId = await api.createProject(`E2E Justify ${uid}`);
    const folderId = await api.createFolder(projectId, `Justify Folder ${uid}`);
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `Justify Case ${uid}`
    );
    const runId = await api.createTestRun(projectId, `Justify Run ${uid}`);
    const testRunCaseId = await api.addTestCaseToTestRun(runId, caseId);
    return { runId, testRunCaseId };
  }

  test("rejects an outcome override submitted without a justification", async ({
    api,
    request,
    baseURL,
  }) => {
    const { runId, testRunCaseId } = await seedRunCase(api);
    const passedId = await api.getStatusId("passed");
    const failedId = await api.getStatusId("failed");

    // Prior completed result (Passed), seeded via the un-gated model route.
    await api.createTestResult(runId, testRunCaseId, passedId);

    const response = await request.post(
      `${baseURL}/api/test-runs/submit-result`,
      {
        data: {
          testRunId: runId,
          testRunCaseId,
          statusId: failedId,
          attempt: 2,
          testRunCaseVersion: 1,
        },
      }
    );

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("JUSTIFICATION_REQUIRED");
  });

  test("accepts an outcome override when a justification is provided", async ({
    api,
    request,
    baseURL,
  }) => {
    const { runId, testRunCaseId } = await seedRunCase(api);
    const passedId = await api.getStatusId("passed");
    const failedId = await api.getStatusId("failed");
    await api.createTestResult(runId, testRunCaseId, passedId);

    const response = await request.post(
      `${baseURL}/api/test-runs/submit-result`,
      {
        data: {
          testRunId: runId,
          testRunCaseId,
          statusId: failedId,
          attempt: 2,
          testRunCaseVersion: 1,
          notes: noteDoc("Overrode after re-running on a fixed environment"),
        },
      }
    );

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.result?.id).toBeTruthy();
  });

  test("accepts a same-outcome re-submission without a justification", async ({
    api,
    request,
    baseURL,
  }) => {
    const { runId, testRunCaseId } = await seedRunCase(api);
    const passedId = await api.getStatusId("passed");
    await api.createTestResult(runId, testRunCaseId, passedId);

    const response = await request.post(
      `${baseURL}/api/test-runs/submit-result`,
      {
        data: {
          testRunId: runId,
          testRunCaseId,
          statusId: passedId,
          attempt: 2,
          testRunCaseVersion: 1,
        },
      }
    );

    expect(response.status()).toBe(200);
  });

  test("accepts the first result without a justification", async ({
    api,
    request,
    baseURL,
  }) => {
    const { runId, testRunCaseId } = await seedRunCase(api);
    const failedId = await api.getStatusId("failed");

    // No prior attempt → the first result needs no justification, even Failed.
    const response = await request.post(
      `${baseURL}/api/test-runs/submit-result`,
      {
        data: {
          testRunId: runId,
          testRunCaseId,
          statusId: failedId,
          attempt: 1,
          testRunCaseVersion: 1,
        },
      }
    );

    expect(response.status()).toBe(200);
  });
});
