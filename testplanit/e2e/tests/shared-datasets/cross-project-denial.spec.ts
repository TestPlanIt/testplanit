import { expect, test } from "../../fixtures";

/**
 * E2E spec — Cross-project shared dataset denial
 *
 * Locked CONTEXT.md success criterion #4 (ROADMAP): a shared dataset in
 * project B can never be assigned to a case in project A. The denial
 * lives in three layers:
 *   1. Schema — `@@deny` on `CaseSharedDataSetAssignment` blocks the
 *      cross-project upsert at the policy layer (defense-in-depth).
 *   2. Route — the assignment endpoint runs an explicit
 *      `sharedDataSet.projectId !== case.projectId` check and returns
 *      422 `cross_project` BEFORE the upsert.
 *   3. UI — the AssignSharedDatasetDialog populates its dataset
 *      selector from `useFindManyDataSet({ projectId, isShared: true })`
 *      so the cross-project dataset never appears in the picker.
 *
 * This spec hits the route layer directly (the cheapest, most explicit
 * surface to lock down).
 *
 * NOTE on storage state: the suite runs as the seeded admin user. The
 * admin has cross-project read access, so the schema-policy and
 * project-membership angles cannot be exercised by this user from this
 * fixture. The 422 cross_project check IS exercised — it does not rely
 * on read denial. A multi-tenant denial run lives in the live-DB
 * integration tests (Plan 04-02 Task 2.1) where we can construct a user
 * without cross-project access.
 */
test.describe("Shared datasets - cross-project denial @shared-datasets", () => {
  test("PUT shared-dataset with cross-project sharedDataSetId returns 422 cross_project", async ({
    api,
    request,
    baseURL,
  }) => {
    let caseAId: number | undefined;
    let dataSet: { id: number } | undefined;

    // Create project A with a target case
    await test.step("Create project A with a target case", async () => {
      // Project A: contains the case the assignment will target.
      const projectAId = await api.createProject(
        `E2E Cross-project A ${Date.now()}`
      );
      const folderAId = await api.createFolder(projectAId, "A");
      caseAId = await api.createTestCase(
        projectAId,
        folderAId,
        "Login (case A)"
      );
    });

    // Create project B with a shared dataset
    await test.step("Create project B with a shared dataset", async () => {
      // Project B: contains the shared dataset the cross-project assign
      // attempt will reference.
      const projectBId = await api.createProject(
        `E2E Cross-project B ${Date.now()}`
      );

      // Create a shared dataset directly under project B via the
      // project-scoped POST endpoint (the same endpoint the UI uses).
      const createRes = await request.post(
        `${baseURL}/api/projects/${projectBId}/datasets`,
        {
          data: { name: `Project B users ${Date.now()}` },
        }
      );
      expect(createRes.status()).toBe(200);
      ({ dataSet } = await createRes.json());
      expect(dataSet?.id).toBeGreaterThan(0);
    });

    // Attempt the cross-project assignment and expect 422 cross_project
    await test.step("Attempt the cross-project assignment and expect 422 cross_project", async () => {
      // Cross-project assignment attempt — point project A's case at
      // project B's shared dataset. The route enforces the
      // `sharedDataSet.projectId !== case.projectId` guard and returns
      // 422 with `error: "cross_project"`.
      const assignRes = await request.put(
        `${baseURL}/api/repository/cases/${caseAId}/shared-dataset`,
        {
          data: {
            sharedDataSetId: dataSet!.id,
            pinnedVersionId: null,
            mappingJson: {},
          },
        }
      );
      expect(assignRes.status()).toBe(422);
      const body = await assignRes.json();
      expect(body.error).toBe("cross_project");
    });
  });
});
