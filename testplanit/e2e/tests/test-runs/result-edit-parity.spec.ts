import { expect, stubBellSSE, test } from "../../fixtures";

/**
 * Edit-Result Parity E2E
 *
 * The guarded `edit-result` endpoint applies the same governance as recording a
 * result (`submit-result`): required result fields, flip justification, and the
 * edit window are all enforced server-side on edits, closing the bypass where
 * recording then editing skipped the gates. All edit calls send
 * `sec-fetch-site: same-origin` (the proxy treats header-less calls as external
 * API and blocks them).
 */
const sameOrigin = { "sec-fetch-site": "same-origin" };

test("edit-result enforces a required result field", async ({
  api,
  request,
  baseURL,
}) => {
  const ts = Date.now();
  let projectId: number | undefined;
  let resultFieldId: number | undefined;
  let passedId: number | undefined;
  let resultId: number | undefined;

  await test.step("Seed a project, run, and result with a required result field", async () => {
    projectId = await api.createProject(`E2E Edit Required ${ts}`);
    const folderId = await api.createFolder(projectId, `ER Folder ${ts}`);
    resultFieldId = await api.createResultField({
      displayName: `Edit Reason ${ts}`,
      systemName: `edit_reason_${ts}`,
      typeName: "Text String",
      isRequired: true,
    });
    const templateId = await api.createTemplate({
      name: `ER Template ${ts}`,
      projectIds: [projectId],
    });
    await api.assignResultFieldToTemplate(templateId, resultFieldId);
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `ER Case ${ts}`,
      templateId
    );
    const runId = await api.createTestRun(projectId, `ER Run ${ts}`);
    const testRunCaseId = await api.addTestCaseToTestRun(runId, caseId);
    passedId = await api.getStatusId("passed");
    resultId = await api.createTestResult(runId, testRunCaseId, passedId);
  });

  await test.step("Reject an edit that omits the required field", async () => {
    const missing = await request.post(`${baseURL}/api/test-runs/edit-result`, {
      headers: sameOrigin,
      data: { resultId, statusId: passedId },
    });
    expect(missing.status()).toBe(400);
    expect((await missing.json())?.code).toBe("REQUIRED_FIELDS_MISSING");
  });

  await test.step("Accept an edit that provides the required field", async () => {
    const ok = await request.post(`${baseURL}/api/test-runs/edit-result`, {
      headers: sameOrigin,
      data: {
        resultId,
        statusId: passedId,
        fieldValues: [{ fieldId: resultFieldId, value: "Build 42" }],
      },
    });
    expect(ok.status(), await ok.text()).toBe(200);
  });
});

test("edit-result requires justification when an edit flips the outcome", async ({
  api,
  request,
  baseURL,
}) => {
  const ts = Date.now();
  let projectId: number | undefined;
  let failedId: number | undefined;
  let resultId: number | undefined;

  await test.step("Seed a project, run, and a passed result", async () => {
    projectId = await api.createProject(`E2E Edit Flip ${ts}`);
    const folderId = await api.createFolder(projectId, `EF Folder ${ts}`);
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `EF Case ${ts}`
    );
    const runId = await api.createTestRun(projectId, `EF Run ${ts}`);
    const testRunCaseId = await api.addTestCaseToTestRun(runId, caseId);
    const passedId = await api.getStatusId("passed");
    failedId = await api.getStatusId("failed");
    resultId = await api.createTestResult(runId, testRunCaseId, passedId);
  });

  await test.step("Opt the project into flip justification", async () => {
    await request.patch(`${baseURL}/api/model/projects/update`, {
      headers: sameOrigin,
      data: {
        where: { id: projectId },
        data: { requireResultFlipJustification: true },
      },
    });
  });

  await test.step("Reject flipping Passed to Failed without Result Details", async () => {
    const blocked = await request.post(`${baseURL}/api/test-runs/edit-result`, {
      headers: sameOrigin,
      data: { resultId, statusId: failedId },
    });
    expect(blocked.status()).toBe(400);
    expect((await blocked.json())?.code).toBe("JUSTIFICATION_REQUIRED");
  });

  await test.step("Accept the flip when a justification is provided", async () => {
    const ok = await request.post(`${baseURL}/api/test-runs/edit-result`, {
      headers: sameOrigin,
      data: {
        resultId,
        statusId: failedId,
        notes: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Regression" }],
            },
          ],
        },
      },
    });
    expect(ok.status(), await ok.text()).toBe(200);
  });
});

test("edit-result enforces the edit window for non-admins; admin bypasses", async ({
  api,
  request,
  baseURL,
  browser,
}) => {
  const ts = Date.now();
  let projectId: number | undefined;
  let passedId: number | undefined;
  let resultId: number | undefined;
  let email: string | undefined;
  let password: string | undefined;

  await test.step("Seed a project, run, and a passed result", async () => {
    projectId = await api.createProject(`E2E Edit Window ${ts}`);
    const folderId = await api.createFolder(projectId, `EW2 Folder ${ts}`);
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `EW2 Case ${ts}`
    );
    const runId = await api.createTestRun(projectId, `EW2 Run ${ts}`);
    const testRunCaseId = await api.addTestCaseToTestRun(runId, caseId);
    passedId = await api.getStatusId("passed");
    resultId = await api.createTestResult(runId, testRunCaseId, passedId);
  });

  await test.step("Disable in-place editing for this project (window = 0)", async () => {
    await request.patch(`${baseURL}/api/model/projects/update`, {
      headers: sameOrigin,
      data: {
        where: { id: projectId },
        data: { editResultsDurationSeconds: 0 },
      },
    });
  });

  await test.step("Create a non-admin user with project access", async () => {
    const roleId = await api.createRole(`ew2_role_${ts}`);
    for (const area of ["TestCaseRepository", "TestRuns", "TestRunResults"]) {
      await api.setRolePermission({ roleId, area, canAddEdit: true });
    }
    email = `ew2-user-${ts}@example.com`;
    password = "testpassword123";
    const userResult = await api.createUser({
      name: "Edit Window User 2",
      email,
      password,
      access: "USER",
      roleId,
    });
    await api.giveUserProjectAccess({
      userId: userResult.data.id,
      projectId,
      accessType: "GLOBAL_ROLE",
    });
    await api.updateUserPreferences({
      userId: userResult.data.id,
      hasCompletedWelcomeTour: true,
    });
  });

  const userContext = await browser.newContext();
  try {
    await test.step("Sign in as the non-admin user", async () => {
      const userPage = await userContext.newPage();
      await stubBellSSE(userPage);
      await userPage.goto(`${baseURL}/en-US/signin`);
      await userPage.waitForLoadState("networkidle");
      await userPage.getByTestId("email-input").fill(email!);
      await userPage.getByTestId("password-input").fill(password!);
      await userPage.getByTestId("signin-button").click();
      await userPage.waitForURL(/\/en-US\/?$/, { timeout: 30000 });
    });

    await test.step("Block the non-admin edit via the window guard", async () => {
      const blocked = await userContext.request.post(
        `${baseURL}/api/test-runs/edit-result`,
        {
          headers: sameOrigin,
          data: { resultId, statusId: passedId, elapsed: 42 },
        }
      );
      expect(blocked.status()).toBe(403);
      expect((await blocked.json())?.code).toBe("EDIT_WINDOW_EXPIRED");
    });

    await test.step("Let the admin bypass the window", async () => {
      const allowed = await request.post(
        `${baseURL}/api/test-runs/edit-result`,
        {
          headers: sameOrigin,
          data: { resultId, statusId: passedId, elapsed: 99 },
        }
      );
      expect(allowed.status(), await allowed.text()).toBe(200);
    });
  } finally {
    await userContext.close();
  }
});
