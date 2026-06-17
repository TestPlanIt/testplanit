import { expect, test } from "../../fixtures";

/**
 * E2E spec — PARAM-06: parameter add/remove/rename/retype bumps the test-case version
 *
 * The version-bump is the canonical contract; the SIDE-BY-SIDE DIFF UI
 * rendering parameter columns is a Phase 6 polish item (per RESEARCH.md A1
 * "known acceptable warning"). This spec asserts the API-level contract: a
 * new version exists after parameter mutation, and its `versionData` JSON
 * snapshot includes the parameter in the `parameters` array.
 */
test.describe("Parameters - version-history snapshot @parameters", () => {
  test("adding a parameter creates a new RepositoryCaseVersion containing the parameters array", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    let projectId: number | undefined;
    let caseId: number | undefined;

    await test.step("Create a project, folder, and test case", async () => {
      projectId = await api.createProject(`E2E Param Version ${Date.now()}`);
      const folderId = await api.createFolder(projectId, "Version");
      caseId = await api.createTestCase(
        projectId,
        folderId,
        "Param Version Case"
      );
    });

    await test.step("Open the test case in the repository", async () => {
      await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
      await page.waitForLoadState("load");
    });

    await test.step("Add a parameter via the Sheet to trigger a version bump", async () => {
      await page.getByTestId("configure-parameters-button").click();
      await expect(
        page.getByTestId("configure-parameters-sheet")
      ).toBeVisible();
      await page.getByTestId("parameter-form-name").fill("env");
      await page.getByTestId("parameter-form-submit").click();
      await expect(page.getByText("@env").first()).toBeVisible();
    });

    await test.step("Query the versions endpoint and confirm the latest version snapshot includes the new parameter", async () => {
      const url = `${baseURL || "http://localhost:3000"}/api/model/repositoryCaseVersions/findMany?q=${encodeURIComponent(
        JSON.stringify({
          where: {
            repositoryCaseId: caseId,
            isDeleted: false,
          },
          orderBy: { version: "desc" },
          take: 1,
        })
      )}`;
      const resp = await request.get(url);
      expect(resp.ok()).toBeTruthy();
      const json = await resp.json();
      const latest = (json.data?.[0] || json[0]) as {
        version: number;
        parameters?: unknown;
      };
      expect(latest).toBeDefined();
      // Latest version should be at least 2 (initial = 1, +1 after add).
      expect(latest.version).toBeGreaterThanOrEqual(2);

      // PARAM-06: the parameters array snapshot lives on the version's
      // top-level `parameters` Json column (RepositoryCaseVersions.parameters
      // per schema.zmodel).
      const params = latest.parameters as Array<{ name: string }> | undefined;
      expect(Array.isArray(params)).toBe(true);
      expect(params!.some((p) => p.name === "env")).toBe(true);
    });
  });
});
