import { expect, test } from "../../fixtures";

/**
 * E2E spec — Cross-project denial across all four matrix endpoints.
 *
 * Covers ROADMAP success criterion 4 (cross-project denial; T-05-01).
 * Complements the unit-level (mocked Prisma) and route-level (live DB)
 * integration tests in
 * `testplanit/app/api/projects/[projectId]/matrix/aggregate/route.shared.integration.test.ts`.
 *
 * Setup: a NON-admin user who has no permission on the target project.
 * Direct API calls to all four endpoints should return 403 (or the
 * project-level access policy denial — whichever the framework returns
 * first).
 *
 * The seeded admin (storageState) creates the target project and the
 * non-admin user. The non-admin signs in via a fresh browser context to
 * obtain a session cookie, then drives request.* against the matrix
 * endpoints from that context.
 */
test.describe("Matrix view — cross-project denial @matrix", () => {
  test("non-admin user is denied on all four matrix endpoints", async ({
    api,
    browser,
    baseURL,
    request,
  }) => {
    const stamp = Date.now();
    const email = `matrix-noaccess-${stamp}@example.com`;
    const password = "Password123!";

    let targetProjectId: number | undefined;
    let noAccessUserId: string | undefined;

    await test.step("Create target project and a non-admin user with no project access", async () => {
      // Admin (default storageState) creates the target project.
      targetProjectId = await api.createProject(
        `Matrix Cross-Project ${Date.now()}`
      );

      // Create a non-admin user. The user is NOT assigned to the project
      // and has no UserProjectPermission entry — so the project's read-gate
      // should reject.
      const userResult = await api.createUser({
        name: `Matrix NoAccess ${stamp}`,
        email,
        password,
        access: "USER",
      });
      noAccessUserId = userResult.data.id;
    });

    await test.step("Restrict the project to SPECIFIC_ROLE access", async () => {
      // Set the project to SPECIFIC_ROLE access so the global-role default
      // grant doesn't apply — only the creator + explicit assignees can read.
      // (Default project access is GLOBAL_ROLE which would let any USER read.)
      const updateRes = await request.put(
        `${baseURL}/api/model/projects/update`,
        {
          data: {
            where: { id: targetProjectId },
            data: {
              defaultAccessType: "SPECIFIC_ROLE",
              defaultRoleId: null,
            },
          },
        }
      );
      expect(updateRes.status()).toBe(200);
    });

    // Sign the non-admin user into a fresh browser context.
    const userCtx = await browser.newContext({ storageState: undefined });
    try {
      await test.step("Sign in the non-admin user in a fresh browser context", async () => {
        const loginPage = await userCtx.newPage();
        await loginPage.goto(`${baseURL}/en-US/signin`, { waitUntil: "load" });
        await loginPage.getByTestId("email-input").fill(email);
        await loginPage.getByTestId("password-input").fill(password);
        await loginPage.locator('button[type="submit"]').first().click();
        await loginPage.waitForURL(/\/en-US\/?$/, { timeout: 30000 });
        await loginPage.close();
      });

      await test.step("Confirm the aggregate route (POST) rejects the non-member", async () => {
        // 1) Aggregate route — POST.
        const aggregateRes = await userCtx.request.post(
          `${baseURL}/api/projects/${targetProjectId}/matrix/aggregate`,
          { data: { filters: {} } }
        );
        expect(
          aggregateRes.status(),
          "aggregate POST must reject non-member"
        ).toBe(403);
      });

      await test.step("Confirm the cell-count route (POST) rejects the non-member", async () => {
        // 2) Cell-count route — POST.
        const cellCountRes = await userCtx.request.post(
          `${baseURL}/api/projects/${targetProjectId}/matrix/cell-count`,
          { data: { filters: {} } }
        );
        expect(
          cellCountRes.status(),
          "cell-count POST must reject non-member"
        ).toBe(403);
      });

      await test.step("Confirm the export route (GET) rejects the non-member", async () => {
        // 3) Export route — GET.
        const exportRes = await userCtx.request.get(
          `${baseURL}/api/projects/${targetProjectId}/matrix/export`
        );
        expect(exportRes.status(), "export GET must reject non-member").toBe(
          403
        );
      });

      await test.step("Confirm the report-builder proxy (POST) rejects a forged projectId", async () => {
        // 4) Report-builder proxy — POST with projectId in body.
        const proxyRes = await userCtx.request.post(
          `${baseURL}/api/report-builder/iteration-matrix`,
          { data: { projectId: targetProjectId, filters: {} } }
        );
        expect(
          proxyRes.status(),
          "report-builder proxy POST must reject non-member (forged projectId)"
        ).toBe(403);
      });
    } finally {
      await userCtx.close();
      // Cleanup: the api fixture's automatic cleanup tracks the project
      // and the user (via createUser) so we don't need to delete them
      // manually. Cleanup runs in the fixture's afterEach.
      void noAccessUserId; // referenced for clarity; user is auto-cleaned.
    }
  });
});
