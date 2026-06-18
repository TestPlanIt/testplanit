import { expect, test } from "../../fixtures";

/**
 * Required Result Fields — server-side enforcement (API contract).
 *
 * When a run-case's template has a required result field, submit-result rejects
 * a submission that omits it (REQUIRED_FIELDS_MISSING) and accepts one that
 * provides it, persisting the value atomically with the result. This holds for
 * every submit path (UI/CLI/MCP) since they all funnel through submit-result;
 * the client-side validation is only advisory.
 */
test("submit-result enforces a required result field", async ({
  api,
  request,
  baseURL,
}) => {
  const ts = Date.now();
  const sameOrigin = { "sec-fetch-site": "same-origin" };

  let resultFieldId: number | undefined;
  let baseSubmission:
    | {
        testRunId: number;
        testRunCaseId: number;
        statusId: number;
        attempt: number;
        testRunCaseVersion: number;
      }
    | undefined;

  await test.step("Create a test run with a case whose template has a required result field", async () => {
    const projectId = await api.createProject(`E2E Required Field ${ts}`);
    const folderId = await api.createFolder(projectId, `RF Folder ${ts}`);

    // A required result field assigned to a template the case uses.
    resultFieldId = await api.createResultField({
      displayName: `Required Reason ${ts}`,
      systemName: `required_reason_${ts}`,
      typeName: "Text String",
      isRequired: true,
    });
    const templateId = await api.createTemplate({
      name: `RF Template ${ts}`,
      projectIds: [projectId],
    });
    await api.assignResultFieldToTemplate(templateId, resultFieldId);

    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `RF Case ${ts}`,
      templateId
    );
    const runId = await api.createTestRun(projectId, `RF Run ${ts}`);
    const testRunCaseId = await api.addTestCaseToTestRun(runId, caseId);
    const passedId = await api.getStatusId("passed");

    baseSubmission = {
      testRunId: runId,
      testRunCaseId,
      statusId: passedId,
      attempt: 1,
      testRunCaseVersion: 1,
    };
  });

  await test.step("Submit a result without the required field and expect rejection", async () => {
    // Without the required field → rejected.
    const missing = await request.post(
      `${baseURL}/api/test-runs/submit-result`,
      {
        headers: sameOrigin,
        data: baseSubmission!,
      }
    );
    expect(missing.status()).toBe(400);
    expect((await missing.json())?.code).toBe("REQUIRED_FIELDS_MISSING");
  });

  await test.step("Submit a result with the required field and expect success", async () => {
    // With the required field → accepted.
    const ok = await request.post(`${baseURL}/api/test-runs/submit-result`, {
      headers: sameOrigin,
      data: {
        ...baseSubmission!,
        fieldValues: [{ fieldId: resultFieldId!, value: "Verified manually" }],
      },
    });
    expect(ok.status(), await ok.text()).toBe(200);
    expect((await ok.json())?.result?.id).toBeTruthy();
  });
});
