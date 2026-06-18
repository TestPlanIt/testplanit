import { expect, test } from "../../fixtures";

/**
 * Require-Issue-On-Failure E2E
 *
 * With the per-project `requireIssueOnFailure` setting on, recording or editing
 * a failure-class result (a status whose isFailure flag is set, not a hardcoded
 * name) requires at least one linked Issue. Enforced server-side on both
 * submit-result and edit-result (`ISSUE_REQUIRED_ON_FAILURE`). All calls send
 * `sec-fetch-site: same-origin` (the proxy blocks header-less calls as external
 * API).
 */
const sameOrigin = { "sec-fetch-site": "same-origin" };

test("submit-result requires a linked issue on failure when enabled", async ({
  api,
  request,
  baseURL,
}) => {
  const ts = Date.now();
  let projectId: number | undefined;
  let runId: number | undefined;
  let testRunCaseId: number | undefined;
  let passedId: number | undefined;
  let failedId: number | undefined;
  let issueId: number | undefined;

  await test.step("Set up project with issue integration, run, case, and statuses", async () => {
    projectId = await api.createProject(`E2E IssueOnFail ${ts}`);
    // The gate only fires when the project has an active issue integration.
    await api.setupProjectIssueIntegration(projectId, "JIRA");
    const folderId = await api.createFolder(projectId, `IOF Folder ${ts}`);
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `IOF Case ${ts}`
    );
    runId = await api.createTestRun(projectId, `IOF Run ${ts}`);
    testRunCaseId = await api.addTestCaseToTestRun(runId, caseId);
    passedId = await api.getStatusId("passed");
    failedId = await api.getStatusId("failed");
    issueId = await api.createIssue(projectId, `IOF Issue ${ts}`, "Defect");
  });

  await test.step("Enable require-issue-on-failure for the project", async () => {
    await request.patch(`${baseURL}/api/model/projects/update`, {
      headers: sameOrigin,
      data: {
        where: { id: projectId },
        data: { requireIssueOnFailure: true },
      },
    });
  });

  const base = {
    testRunId: runId,
    testRunCaseId,
    attempt: 1,
    testRunCaseVersion: 1,
  };

  await test.step("Reject failure result with no linked issue", async () => {
    // Failure with no linked issue → rejected.
    const blocked = await request.post(
      `${baseURL}/api/test-runs/submit-result`,
      {
        headers: sameOrigin,
        data: { ...base, statusId: failedId },
      }
    );
    expect(blocked.status()).toBe(400);
    expect((await blocked.json())?.code).toBe("ISSUE_REQUIRED_ON_FAILURE");
  });

  await test.step("Accept failure result with a linked issue", async () => {
    // Failure with a linked issue → accepted.
    const ok = await request.post(`${baseURL}/api/test-runs/submit-result`, {
      headers: sameOrigin,
      data: { ...base, statusId: failedId, issueIds: [issueId] },
    });
    expect(ok.status(), await ok.text()).toBe(200);
  });

  await test.step("Accept failure result with only a step-level issue", async () => {
    // Failure with only a step-level issue (no result-level issue) → accepted.
    // The client reports step/shared issues via stepIssueCount; the gate counts
    // them alongside result-level issues.
    const stepOk = await request.post(
      `${baseURL}/api/test-runs/submit-result`,
      {
        headers: sameOrigin,
        data: { ...base, statusId: failedId, stepIssueCount: 1 },
      }
    );
    expect(stepOk.status(), await stepOk.text()).toBe(200);
  });

  await test.step("Accept non-failure result with no issue", async () => {
    // Non-failure (passed) with no issue → accepted (gate doesn't apply).
    const passOk = await request.post(
      `${baseURL}/api/test-runs/submit-result`,
      {
        headers: sameOrigin,
        data: { ...base, statusId: passedId },
      }
    );
    expect(passOk.status(), await passOk.text()).toBe(200);
  });
});

test("edit-result requires a linked issue on failure when enabled", async ({
  api,
  request,
  baseURL,
}) => {
  const ts = Date.now();
  let projectId: number | undefined;
  let failedId: number | undefined;
  let resultId: number | undefined;
  let issueId: number | undefined;

  await test.step("Set up project with integration, run, case, and a passed result", async () => {
    projectId = await api.createProject(`E2E EditIssueOnFail ${ts}`);
    await api.setupProjectIssueIntegration(projectId, "JIRA");
    const folderId = await api.createFolder(projectId, `EIOF Folder ${ts}`);
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `EIOF Case ${ts}`
    );
    const runId = await api.createTestRun(projectId, `EIOF Run ${ts}`);
    const testRunCaseId = await api.addTestCaseToTestRun(runId, caseId);
    const passedId = await api.getStatusId("passed");
    failedId = await api.getStatusId("failed");
    resultId = await api.createTestResult(runId, testRunCaseId, passedId);
    issueId = await api.createIssue(projectId, `EIOF Issue ${ts}`, "Defect");
  });

  await test.step("Enable require-issue-on-failure for the project", async () => {
    await request.patch(`${baseURL}/api/model/projects/update`, {
      headers: sameOrigin,
      data: {
        where: { id: projectId },
        data: { requireIssueOnFailure: true },
      },
    });
  });

  await test.step("Reject edit to a failure status with no linked issue", async () => {
    // Edit to a failure status with no linked issue → rejected.
    const blocked = await request.post(`${baseURL}/api/test-runs/edit-result`, {
      headers: sameOrigin,
      data: { resultId, statusId: failedId },
    });
    expect(blocked.status()).toBe(400);
    expect((await blocked.json())?.code).toBe("ISSUE_REQUIRED_ON_FAILURE");
  });

  await test.step("Accept edit to a failure status with a linked issue", async () => {
    // Edit to a failure status with a linked issue → accepted.
    const ok = await request.post(`${baseURL}/api/test-runs/edit-result`, {
      headers: sameOrigin,
      data: { resultId, statusId: failedId, issueIds: [issueId] },
    });
    expect(ok.status(), await ok.text()).toBe(200);
  });
});

test("require-issue-on-failure is inert without an issue integration", async ({
  api,
  request,
  baseURL,
}) => {
  const ts = Date.now();
  let projectId: number | undefined;
  let runId: number | undefined;
  let testRunCaseId: number | undefined;
  let failedId: number | undefined;

  await test.step("Set up project, run, and case without any issue integration", async () => {
    // No issue integration assigned to this project.
    projectId = await api.createProject(`E2E NoIntegration ${ts}`);
    const folderId = await api.createFolder(projectId, `NI Folder ${ts}`);
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `NI Case ${ts}`
    );
    runId = await api.createTestRun(projectId, `NI Run ${ts}`);
    testRunCaseId = await api.addTestCaseToTestRun(runId, caseId);
    failedId = await api.getStatusId("failed");
  });

  await test.step("Force require-issue-on-failure on without an integration", async () => {
    // Even with the setting forced on, no integration means the gate can't fire.
    await request.patch(`${baseURL}/api/model/projects/update`, {
      headers: sameOrigin,
      data: {
        where: { id: projectId },
        data: { requireIssueOnFailure: true },
      },
    });
  });

  await test.step("Accept failure result with no issue when no integration exists", async () => {
    const accepted = await request.post(
      `${baseURL}/api/test-runs/submit-result`,
      {
        headers: sameOrigin,
        data: {
          testRunId: runId,
          testRunCaseId,
          statusId: failedId,
          attempt: 1,
          testRunCaseVersion: 1,
        },
      }
    );
    expect(accepted.status(), await accepted.text()).toBe(200);
  });
});
