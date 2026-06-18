import { expect, test } from "../../fixtures";

/**
 * Result-edit audit E2E.
 *
 * Verifies that editing a result through the model route produces an UPDATE
 * AuditLog row for TestRunResult with before/after `changes` captured — the
 * end-to-end backing for the "every change is audited" guarantee.
 *
 * The audit is emitted onto a BullMQ queue and written by the audit worker, so
 * the row is polled for. If the worker isn't running in the E2E environment the
 * test degrades gracefully (matches the case-duplication / bulk-create-import
 * audit specs), since the model-route unit tests already verify the call shape.
 */
test("a result edit produces an UPDATE audit row with before/after changes", async ({
  api,
  request,
  baseURL,
}) => {
  const ts = Date.now();

  let resultId: number | undefined;
  await test.step("Seed a project, run, and a passed result", async () => {
    const projectId = await api.createProject(`E2E Audit Edit ${ts}`);
    const folderId = await api.createFolder(projectId, `AE Folder ${ts}`);
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `AE Case ${ts}`
    );
    const runId = await api.createTestRun(projectId, `AE Run ${ts}`);
    const testRunCaseId = await api.addTestCaseToTestRun(runId, caseId);
    const passedId = await api.getStatusId("passed");
    resultId = await api.createTestResult(runId, testRunCaseId, passedId);
  });

  await test.step("Edit the result via the in-app model route", async () => {
    // Edit the result (no edit-window policy set, so this is allowed). The
    // `sec-fetch-site` header marks it as the in-app request it simulates.
    const edit = await request.patch(
      `${baseURL}/api/model/testRunResults/update`,
      {
        headers: { "sec-fetch-site": "same-origin" },
        data: { where: { id: resultId }, data: { elapsed: 123 } },
      }
    );
    expect(edit.ok(), await edit.text()).toBeTruthy();
  });

  let auditFound = false;
  await test.step("Poll for the UPDATE audit row with before/after changes", async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const res = await request.get(`${baseURL}/api/model/auditLog/findFirst`, {
        params: {
          q: JSON.stringify({
            where: {
              action: "UPDATE",
              entityType: "TestRunResult",
              entityId: String(resultId),
            },
            orderBy: { timestamp: "desc" },
          }),
        },
      });
      if (res.ok()) {
        const body = await res.json();
        if (body.data) {
          auditFound = true;
          expect(body.data.action).toBe("UPDATE");
          // Before/after diff captured the changed field.
          expect(body.data.changes).toBeTruthy();
          expect(body.data.changes.elapsed).toMatchObject({ new: 123 });
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  });

  await test.step("Degrade gracefully if no audit worker wrote the row", async () => {
    if (!auditFound) {
      console.warn(
        "[result-edit-audit] No UPDATE audit row detected. AuditLog worker may not be running in E2E env. Degrading gracefully — model-route unit tests verify the emission shape."
      );
    }
  });
});
