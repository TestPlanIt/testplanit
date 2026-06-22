import { expect, stubBellSSE, test } from "../../fixtures";

/**
 * Result Edit-Window Server Guard E2E
 *
 * Verifies server-side enforcement of the result edit window: a non-admin
 * cannot edit a result through the model route when the window is closed, while
 * a system admin always can. The guard is a preflight before the ZenStack
 * handler, returning 403 EDIT_WINDOW_EXPIRED.
 *
 * Uses the per-project override (`editResultsDurationSeconds = 0`, editing
 * disabled for this project) rather than the global AppConfig, so the test is
 * fully isolated to its own project and safe under the parallel suite.
 */
test("blocks a non-admin result edit when the project disables editing; admin still edits", async ({
  api,
  request,
  baseURL,
  browser,
}) => {
  const ts = Date.now();
  const projectId = await api.createProject(`E2E EditWindow ${ts}`);
  const folderId = await api.createFolder(projectId, `EW Folder ${ts}`);
  const caseId = await api.createTestCase(projectId, folderId, `EW Case ${ts}`);
  const runId = await api.createTestRun(projectId, `EW Run ${ts}`);
  const testRunCaseId = await api.addTestCaseToTestRun(runId, caseId);
  const passedId = await api.getStatusId("passed");
  const resultId = await api.createTestResult(runId, testRunCaseId, passedId);

  // Disable in-place editing for this project (effective window = 0).
  await request.patch(`${baseURL}/api/model/projects/update`, {
    data: {
      where: { id: projectId },
      data: { editResultsDurationSeconds: 0 },
    },
  });

  // Non-admin user with result-edit permission and project access.
  const roleId = await api.createRole(`ew_role_${ts}`);
  for (const area of ["TestCaseRepository", "TestRuns", "TestRunResults"]) {
    await api.setRolePermission({ roleId, area, canAddEdit: true });
  }
  const email = `ew-user-${ts}@example.com`;
  const password = "testpassword123";
  const userResult = await api.createUser({
    name: "Edit Window User",
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

  const userContext = await browser.newContext();
  // `sec-fetch-site: same-origin` marks this as the in-app browser request it
  // simulates (the proxy otherwise treats header-less calls as external API).
  const sameOrigin = { "sec-fetch-site": "same-origin" };
  try {
    await test.step("Sign in as the non-admin user", async () => {
      const userPage = await userContext.newPage();
      await stubBellSSE(userPage);
      await userPage.goto(`${baseURL}/en-US/signin`);
      await userPage.waitForLoadState("networkidle");
      await userPage.getByTestId("email-input").fill(email);
      await userPage.getByTestId("password-input").fill(password);
      await userPage.getByTestId("signin-button").click();
      await userPage.waitForURL(/\/en-US\/?$/, { timeout: 30000 });
    });

    await test.step("Verify the non-admin result edit is blocked by the guard", async () => {
      // Non-admin edit through the model route is blocked by the guard.
      const blocked = await userContext.request.patch(
        `${baseURL}/api/model/testRunResults/update`,
        {
          headers: sameOrigin,
          data: { where: { id: resultId }, data: { elapsed: 42 } },
        }
      );
      expect(blocked.status()).toBe(403);
      expect((await blocked.json())?.error?.code).toBe("EDIT_WINDOW_EXPIRED");
    });

    await test.step("Verify the admin bypasses the edit window", async () => {
      // The admin (default request context) bypasses the window.
      const allowed = await request.patch(
        `${baseURL}/api/model/testRunResults/update`,
        {
          headers: sameOrigin,
          data: { where: { id: resultId }, data: { elapsed: 99 } },
        }
      );
      expect(allowed.ok()).toBeTruthy();
    });
  } finally {
    await userContext.close();
  }
});
