import { expect, test } from "../../fixtures";

/**
 * Completed Test Run immutability (structural)
 *
 * Once a run is completed, its composition (test cases) and results are frozen
 * at the policy layer (ZenStack `@@deny` keyed on `TestRuns.isCompleted`), with
 * the raw-client result routes enforcing the same lock. This verifies, against
 * a live database:
 *  - before completion, adding cases and recording results works;
 *  - after completion, adding / reordering / removing cases is rejected, and
 *    recording results (model API and the submit-result route) is rejected;
 *  - completing and deleting the run still work.
 *
 * Model-API calls send `sec-fetch-site: same-origin` (the proxy blocks
 * header-less calls as external API).
 */
const sameOrigin = { "sec-fetch-site": "same-origin" };

test("completed runs structurally reject composition and result changes", async ({
  api,
  request,
  baseURL,
}) => {
  const ts = Date.now();
  const projectId = await api.createProject(`E2E CompletedLock ${ts}`);
  const folderId = await api.createFolder(projectId, `CL Folder ${ts}`);
  const case1 = await api.createTestCase(
    projectId,
    folderId,
    `CL Case A ${ts}`
  );
  const case2 = await api.createTestCase(
    projectId,
    folderId,
    `CL Case B ${ts}`
  );
  const runId = await api.createTestRun(projectId, `CL Run ${ts}`);
  const passedId = await api.getStatusId("passed");

  // Before completion: adding a case and recording a result both work.
  const trc1 = await api.addTestCaseToTestRun(runId, case1);
  await api.createTestResult(runId, trc1, passedId);

  // Complete the run.
  const complete = await request.patch(`${baseURL}/api/model/testRuns/update`, {
    headers: sameOrigin,
    data: {
      where: { id: runId },
      data: { isCompleted: true, completedAt: new Date().toISOString() },
    },
  });
  expect(complete.status(), await complete.text()).toBeLessThan(300);

  // Composition is frozen ----------------------------------------------------

  // Add a case (model API create) → policy-denied.
  await expect(api.addTestCaseToTestRun(runId, case2)).rejects.toThrow();

  // Reorder a case (update order) → policy-denied.
  const reorder = await request.patch(
    `${baseURL}/api/model/testRunCases/update`,
    { headers: sameOrigin, data: { where: { id: trc1 }, data: { order: 5 } } }
  );
  expect(reorder.status()).toBeGreaterThanOrEqual(400);

  // Remove a case (soft-delete) → policy-denied.
  const remove = await request.patch(
    `${baseURL}/api/model/testRunCases/update`,
    {
      headers: sameOrigin,
      data: { where: { id: trc1 }, data: { isDeleted: true } },
    }
  );
  expect(remove.status()).toBeGreaterThanOrEqual(400);

  // Results are frozen -------------------------------------------------------

  // Recording a result via the model API → policy-denied.
  await expect(api.createTestResult(runId, trc1, passedId)).rejects.toThrow();

  // Recording via the submit-result route → 409 RUN_COMPLETED.
  const submit = await request.post(`${baseURL}/api/test-runs/submit-result`, {
    headers: sameOrigin,
    data: {
      testRunId: runId,
      testRunCaseId: trc1,
      statusId: passedId,
      attempt: 2,
      testRunCaseVersion: 1,
    },
  });
  expect(submit.status()).toBe(409);
  expect((await submit.json())?.code).toBe("RUN_COMPLETED");

  // Completing-related lifecycle still works: the run can still be deleted.
  const del = await request.patch(`${baseURL}/api/model/testRuns/update`, {
    headers: sameOrigin,
    data: { where: { id: runId }, data: { isDeleted: true } },
  });
  expect(del.status(), await del.text()).toBeLessThan(300);
});
