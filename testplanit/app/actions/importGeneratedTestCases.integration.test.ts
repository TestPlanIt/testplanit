/**
 * Live-DB integration test for the parameters + datasetRows branches of
 * `importGeneratedTestCases`. The mocked-Prisma path can't catch the kinds
 * of bugs this branch is most exposed to:
 *
 *   - `TestCaseParameter` column-name drift (e.g. `description` removed)
 *   - `DataSetVersion.createdById` required-field surprises
 *   - `DataSetRow.valuesJson` Json-column quoting
 *   - The (testCaseId, name) unique on TestCaseParameter rejecting duplicates
 *     mid-batch and rolling back the whole case
 *
 * Skipped by default. Opt-in with `RUN_DB_INTEGRATION=1`. Requires
 * `DATABASE_URL` pointing at a dev/test DB. Manual id-tracked cleanup since
 * the action opens its own `$transaction` (we can't roll back the outer
 * test transaction to undo committed rows).
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The action imports `~/server/auth`, which transitively triggers
// `~/server/db`'s server-only env guard from a non-SSR runtime. Mock the
// session to a real seeded user so the action's internal
// `await getServerAuthSession()` returns a usable identity without dragging
// the env shim into the test process.
const fixtureUserId = { current: null as string | null };
vi.mock("~/server/auth", () => ({
  getServerAuthSession: () =>
    Promise.resolve(
      fixtureUserId.current
        ? {
            user: {
              id: fixtureUserId.current,
              name: "Integration Test",
              email: "integration-test@example.com",
            },
          }
        : null
    ),
  authOptions: {},
}));

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);

const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration(
  "importGeneratedTestCases — inline parameters + dataset",
  () => {
    const importPrisma = async () => {
      const { baseDb } = await import("~/lib/db");
      return baseDb;
    };

    beforeAll(async () => {
      const baseDb = await importPrisma();
      const user = await baseDb.user.findFirst({ select: { id: true } });
      if (!user) throw new Error("Seed DB before running this test");
      fixtureUserId.current = user.id;
    });

    const cleanup: {
      dataSetRowIds: number[];
      dataSetVersionIds: number[];
      dataSetIds: number[];
      testCaseParameterIds: number[];
      repositoryCaseIds: number[];
      repositoryFolderIds: number[];
      repositoryIds: number[];
      workflowIds: number[];
      templateIds: number[];
      projectIds: number[];
    } = {
      dataSetRowIds: [],
      dataSetVersionIds: [],
      dataSetIds: [],
      testCaseParameterIds: [],
      repositoryCaseIds: [],
      repositoryFolderIds: [],
      repositoryIds: [],
      workflowIds: [],
      templateIds: [],
      projectIds: [],
    };

    afterEach(async () => {
      const baseDb = await importPrisma();
      for (const [model, ids] of [
        ["dataSetRow", cleanup.dataSetRowIds],
        ["dataSetVersion", cleanup.dataSetVersionIds],
        ["dataSet", cleanup.dataSetIds],
        ["testCaseParameter", cleanup.testCaseParameterIds],
        ["repositoryCases", cleanup.repositoryCaseIds],
        ["repositoryFolders", cleanup.repositoryFolderIds],
        ["repositories", cleanup.repositoryIds],
        ["workflows", cleanup.workflowIds],
        ["templates", cleanup.templateIds],
        ["projects", cleanup.projectIds],
      ] as const) {
        if (ids.length) {
          await (baseDb as any)[model]
            .deleteMany({ where: { id: { in: ids } } })
            .catch(() => {});
        }
      }
      for (const k of Object.keys(cleanup) as Array<keyof typeof cleanup>) {
        cleanup[k].length = 0;
      }
    });

    async function seedFixture(baseDb: any) {
      const creator = await baseDb.user.findFirst({ select: { id: true } });
      if (!creator) throw new Error("Seed DB before running this test");
      const anyColor = await baseDb.color.findFirst({ select: { id: true } });
      const anyIcon = await baseDb.fieldIcon.findFirst({
        select: { id: true },
      });
      if (!anyColor || !anyIcon)
        throw new Error("Seed Color/FieldIcon rows before running this test");

      const tag = `import-params-test-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

      const project = await baseDb.projects.create({
        data: { name: tag, createdBy: creator.id },
        select: { id: true, name: true },
      });
      cleanup.projectIds.push(project.id);

      const template = await baseDb.templates.create({
        data: {
          templateName: `${tag}-tpl`,
          isEnabled: true,
          isDefault: false,
        },
        select: { id: true, templateName: true },
      });
      cleanup.templateIds.push(template.id);

      const workflow = await baseDb.workflows.create({
        data: {
          name: `${tag}-state`,
          order: 0,
          iconId: anyIcon.id,
          colorId: anyColor.id,
          workflowType: "IN_PROGRESS",
          scope: "CASES",
        },
        select: { id: true, name: true },
      });
      cleanup.workflowIds.push(workflow.id);

      const repo = await baseDb.repositories.create({
        data: { projectId: project.id },
        select: { id: true },
      });
      cleanup.repositoryIds.push(repo.id);

      const folder = await baseDb.repositoryFolders.create({
        data: {
          name: `${tag}-folder`,
          repositoryId: repo.id,
          projectId: project.id,
          creatorId: creator.id,
        },
        select: { id: true, name: true },
      });
      cleanup.repositoryFolderIds.push(folder.id);

      return { tag, creator, project, template, workflow, repo, folder };
    }

    it(
      "persists TestCaseParameter + DataSet + DataSetVersion + DataSetRow when both are provided",
      { timeout: 60_000 },
      async () => {
        const baseDb = await importPrisma();
        const { importGeneratedTestCases } =
          await import("./importGeneratedTestCases");
        const { tag, project, template, workflow, repo, folder } =
          await seedFixture(baseDb);

        const result = await importGeneratedTestCases({
          projectId: project.id,
          projectName: project.name,
          repositoryId: repo.id,
          folderId: folder.id,
          folderName: folder.name,
          templateId: template.id,
          templateName: template.templateName,
          stateId: workflow.id,
          stateName: workflow.name,
          maxOrder: 0,
          autoGenerateTags: false,
          source: "MANUAL",
          testCases: [
            {
              id: `${tag}-case-0`,
              name: `${tag}-case`,
              fieldValues: {},
              steps: [],
              parameters: [
                { name: "user", type: "STRING", required: true },
                { name: "balance", type: "INTEGER", sensitive: true },
              ],
              datasetRows: [
                {
                  rowIndex: 0,
                  label: "happy path",
                  values: { user: "alice", balance: 100 },
                },
                {
                  rowIndex: 1,
                  label: "empty",
                  values: { user: "", balance: 0 },
                },
              ],
            },
          ],
          fieldMappings: [],
        } as any);

        expect(result.status).toBe("success");
        expect(result.importedIds.length).toBe(1);
        const caseId = result.importedIds[0];
        cleanup.repositoryCaseIds.push(caseId);

        const params = await baseDb.testCaseParameter.findMany({
          where: { testCaseId: caseId },
          orderBy: { order: "asc" },
          select: {
            id: true,
            name: true,
            type: true,
            required: true,
            sensitive: true,
          },
        });
        cleanup.testCaseParameterIds.push(...params.map((p: any) => p.id));
        expect(params.map((p: any) => p.name)).toEqual(["user", "balance"]);
        expect(params[0].required).toBe(true);
        expect(params[1].sensitive).toBe(true);

        const dataset = await baseDb.dataSet.findFirst({
          where: { ownerCaseId: caseId },
          select: { id: true },
        });
        expect(dataset).not.toBeNull();
        cleanup.dataSetIds.push(dataset!.id);

        const version = await baseDb.dataSetVersion.findFirst({
          where: { dataSetId: dataset!.id, version: 1 },
          select: { id: true, rowCount: true },
        });
        expect(version).not.toBeNull();
        expect(version!.rowCount).toBe(2);
        cleanup.dataSetVersionIds.push(version!.id);

        const rows = await baseDb.dataSetRow.findMany({
          where: { dataSetId: dataset!.id },
          orderBy: { rowIndex: "asc" },
          select: { id: true, rowIndex: true, label: true },
        });
        cleanup.dataSetRowIds.push(...rows.map((r: any) => r.id));
        expect(rows.map((r: any) => r.rowIndex)).toEqual([0, 1]);
        expect(rows[0].label).toBe("happy path");

        const caseRow = await baseDb.repositoryCases.findUnique({
          where: { id: caseId },
          select: { hasParameters: true },
        });
        expect(caseRow?.hasParameters).toBe(true);
      }
    );

    it(
      "rejects datasetRows without parameters and rolls back the whole case",
      { timeout: 60_000 },
      async () => {
        const baseDb = await importPrisma();
        const { importGeneratedTestCases } =
          await import("./importGeneratedTestCases");
        const { tag, project, template, workflow, repo, folder } =
          await seedFixture(baseDb);

        const result = await importGeneratedTestCases({
          projectId: project.id,
          projectName: project.name,
          repositoryId: repo.id,
          folderId: folder.id,
          folderName: folder.name,
          templateId: template.id,
          templateName: template.templateName,
          stateId: workflow.id,
          stateName: workflow.name,
          maxOrder: 0,
          autoGenerateTags: false,
          source: "MANUAL",
          testCases: [
            {
              id: `${tag}-bad-0`,
              name: `${tag}-bad`,
              fieldValues: {},
              steps: [],
              datasetRows: [{ rowIndex: 0, values: { whatever: 1 } }],
            },
          ],
          fieldMappings: [],
        } as any);

        // The per-case try/catch in the action records the error and skips the
        // case; importedCount stays at 0. The whole transaction commits but the
        // bad case never lands.
        expect(result.importedCount).toBe(0);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toMatch(/datasetRows/i);
      }
    );

    it(
      "rejects duplicate parameter names and rolls back the case",
      { timeout: 60_000 },
      async () => {
        const baseDb = await importPrisma();
        const { importGeneratedTestCases } =
          await import("./importGeneratedTestCases");
        const { tag, project, template, workflow, repo, folder } =
          await seedFixture(baseDb);

        const result = await importGeneratedTestCases({
          projectId: project.id,
          projectName: project.name,
          repositoryId: repo.id,
          folderId: folder.id,
          folderName: folder.name,
          templateId: template.id,
          templateName: template.templateName,
          stateId: workflow.id,
          stateName: workflow.name,
          maxOrder: 0,
          autoGenerateTags: false,
          source: "MANUAL",
          testCases: [
            {
              id: `${tag}-dup-0`,
              name: `${tag}-dup`,
              fieldValues: {},
              steps: [],
              parameters: [
                { name: "user", type: "STRING" },
                { name: "user", type: "STRING" },
              ],
            },
          ],
          fieldMappings: [],
        } as any);

        expect(result.importedCount).toBe(0);
        expect(result.errors[0]).toMatch(/duplicate parameter name/i);
      }
    );
  }
);
