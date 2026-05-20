/**
 * Live-DB integration test for the shared-dataset branch of
 * `materializeForOneCase`.
 *
 * This is the highest-risk seam in the Shared Datasets feature: the
 * resolver decides which dataset version drives each parameterized
 * iteration, applies the column→parameter mapping, and writes the
 * snapshot row that the run will use forever after. A regression here
 * surfaces as silent data corruption (wrong values per iteration), so
 * we exercise it against a real prisma.$transaction.
 *
 * Execution model mirrors `iterationFanOut.integration.test.ts`:
 *   - Skipped by default; opt-in with `RUN_DB_INTEGRATION=1`.
 *   - Each test runs inside a `prisma.$transaction` that is forced to
 *     roll back at the end. The DB is never mutated.
 *   - Lazy-import Prisma so the module stays cheap when skipped.
 */

import { afterAll, describe, expect, it } from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);

const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration(
  "materializeForOneCase shared-dataset branch (live DB)",
  () => {
    const importDeps = async () => {
      const { prisma } = await import("~/lib/prisma");
      const { materializeForOneCase } = await import("./iterationFanOut");
      return { prisma, materializeForOneCase };
    };

    const ROLLBACK_SENTINEL = "__SHARED_DATASET_TEST_ROLLBACK__";

    async function withRollback<T>(
      prisma: any,
      body: (tx: any) => Promise<T>,
      timeoutMs = 60_000
    ): Promise<T> {
      let captured: T | undefined;
      let captureErr: unknown;
      try {
        await prisma.$transaction(
          async (tx: any) => {
            try {
              captured = await body(tx);
            } catch (err) {
              captureErr = err;
            }
            throw new Error(ROLLBACK_SENTINEL);
          },
          { timeout: timeoutMs }
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes(ROLLBACK_SENTINEL)) throw err;
      }
      if (captureErr) throw captureErr;
      return captured as T;
    }

    /**
     * Seeds a project + repository + folder + parameterized case with two
     * parameters (`email`, `password`). The case has neither owner dataset
     * nor shared assignment yet — tests add those as needed.
     */
    async function seedBaseFixture(tx: any) {
      const creator = await tx.user.findFirst({ select: { id: true } });
      if (!creator) {
        throw new Error("No User row available — seed the DB first");
      }
      const state = await tx.workflows.findFirst({ select: { id: true } });
      if (!state) {
        throw new Error("No Workflows row available — seed the DB first");
      }
      const template = await tx.templates.findFirst({ select: { id: true } });
      if (!template) {
        throw new Error("No Templates row available — seed the DB first");
      }

      const project = await tx.projects.create({
        data: {
          name: `shared-fanout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdBy: creator.id,
        },
        select: { id: true },
      });
      const repo = await tx.repositories.create({
        data: { projectId: project.id },
        select: { id: true },
      });
      const folder = await tx.repositoryFolders.create({
        data: {
          name: `f-${Date.now()}`,
          repositoryId: repo.id,
          projectId: project.id,
          creatorId: creator.id,
        },
        select: { id: true },
      });

      const testCase = await tx.repositoryCases.create({
        data: {
          projectId: project.id,
          repositoryId: repo.id,
          folderId: folder.id,
          templateId: template.id,
          name: `Shared Param Case ${Date.now()}`,
          stateId: state.id,
          creatorId: creator.id,
          hasParameters: true,
        },
        select: { id: true },
      });

      await tx.testCaseParameter.createMany({
        data: [
          {
            testCaseId: testCase.id,
            name: "email",
            type: "STRING",
            sensitive: false,
            required: true,
            order: 0,
          },
          {
            testCaseId: testCase.id,
            name: "password",
            type: "STRING",
            sensitive: true,
            required: true,
            order: 1,
          },
        ],
      });

      const testRun = await tx.testRuns.create({
        data: {
          name: `run-${Date.now()}`,
          projectId: project.id,
          stateId: state.id,
          createdById: creator.id,
          testRunType: "REGULAR",
        },
        select: { id: true },
      });
      const testRunCase = await tx.testRunCases.create({
        data: {
          testRunId: testRun.id,
          repositoryCaseId: testCase.id,
          order: 0,
        },
        select: { id: true },
      });

      return {
        creatorId: creator.id,
        projectId: project.id,
        repositoryCaseId: testCase.id,
        testRunId: testRun.id,
        testRunCaseId: testRunCase.id,
      };
    }

    /**
     * Create a project-scoped shared dataset (no ownerCaseId).
     */
    async function createSharedDataset(
      tx: any,
      projectId: number,
      creatorId: string,
      name: string
    ) {
      return tx.dataSet.create({
        data: {
          name,
          projectId,
          createdById: creatorId,
        },
        select: { id: true },
      });
    }

    /**
     * Create a DataSetVersion for a dataset.
     */
    async function createVersion(
      tx: any,
      dataSetId: number,
      createdById: string,
      version: number,
      rowsJson: unknown[],
      parametersJson: unknown[] = []
    ) {
      return tx.dataSetVersion.create({
        data: {
          dataSetId,
          version,
          rowsJson,
          rowCount: rowsJson.length,
          parametersJson,
          createdById,
        },
        select: { id: true },
      });
    }

    afterAll(async () => {
      if (RUN_INTEGRATION && HAS_DB_URL) {
        const { prisma } = await import("~/lib/prisma");
        await prisma.$disconnect();
      }
    });

    it("owner-only path stays bit-for-bit (PARAM-07): sourceVersionId is null and rowsJson columns are owner columns", async () => {
      const { prisma, materializeForOneCase } = await importDeps();
      await withRollback(prisma, async (tx) => {
        const fx = await seedBaseFixture(tx);
        // Owner dataset with three rows.
        const ownerDs = await tx.dataSet.create({
          data: {
            name: `owner-ds-${Date.now()}`,
            ownerCaseId: fx.repositoryCaseId,
            projectId: fx.projectId,
            createdById: fx.creatorId,
          },
          select: { id: true },
        });
        await tx.dataSetRow.createMany({
          data: [
            {
              dataSetId: ownerDs.id,
              rowIndex: 0,
              label: "alice",
              valuesJson: { email: "alice@example.com", password: "p1" },
            },
            {
              dataSetId: ownerDs.id,
              rowIndex: 1,
              label: "bob",
              valuesJson: { email: "bob@example.com", password: "p2" },
            },
            {
              dataSetId: ownerDs.id,
              rowIndex: 2,
              label: "carol",
              valuesJson: { email: "carol@example.com", password: "p3" },
            },
          ],
        });

        const result = await materializeForOneCase(
          fx.projectId,
          fx.testRunCaseId,
          fx.repositoryCaseId,
          tx
        );
        expect(result.iterationCount).toBe(3);

        const snapshot = await tx.testRunCaseDataSetSnapshot.findUnique({
          where: { testRunCaseId: fx.testRunCaseId },
        });
        expect(snapshot).toMatchObject({
          sourceVersionId: null,
          sourceDataSetId: ownerDs.id,
        });

        const rows = snapshot.rowsJson as Array<{
          valuesJson: Record<string, unknown>;
          rowIndex: number;
          label: string | null;
        }>;
        expect(rows).toHaveLength(3);
        expect(rows[0].valuesJson).toEqual({
          email: "alice@example.com",
          password: "p1",
        });

        const runCase = await tx.testRunCases.findUnique({
          where: { id: fx.testRunCaseId },
          select: { totalIterations: true },
        });
        expect(runCase.totalIterations).toBe(3);
      });
    });

    it("shared assignment with pinned version + mapping: snapshot rows are parameter-keyed and sourceVersionId points to the pinned version", async () => {
      const { prisma, materializeForOneCase } = await importDeps();
      await withRollback(prisma, async (tx) => {
        const fx = await seedBaseFixture(tx);
        const sharedDs = await createSharedDataset(
          tx,
          fx.projectId,
          fx.creatorId,
          `shared-ds-${Date.now()}`
        );
        const v1 = await createVersion(tx, sharedDs.id, fx.creatorId, 1, [
          { user_email: "v1-alice@example.com", user_password: "v1-p1" },
          { user_email: "v1-bob@example.com", user_password: "v1-p2" },
        ]);

        await tx.caseSharedDataSetAssignment.create({
          data: {
            caseId: fx.repositoryCaseId,
            sharedDataSetId: sharedDs.id,
            pinnedVersionId: v1.id,
            mappingJson: {
              user_email: "email",
              user_password: "password",
            },
            createdById: fx.creatorId,
          },
        });

        const result = await materializeForOneCase(
          fx.projectId,
          fx.testRunCaseId,
          fx.repositoryCaseId,
          tx
        );
        expect(result.iterationCount).toBe(2);

        const snapshot = await tx.testRunCaseDataSetSnapshot.findUnique({
          where: { testRunCaseId: fx.testRunCaseId },
        });
        expect(snapshot).toMatchObject({
          sourceVersionId: v1.id,
          sourceDataSetId: sharedDs.id,
        });

        const rows = snapshot.rowsJson as Array<{
          valuesJson: Record<string, unknown>;
          rowIndex: number;
        }>;
        expect(rows).toHaveLength(2);
        // Critical: keys must be parameter names (email/password), NOT
        // source-column names (user_email/user_password). RESEARCH.md Pitfall 3.
        expect(Object.keys(rows[0].valuesJson).sort()).toEqual([
          "email",
          "password",
        ]);
        expect(rows[0].valuesJson.email).toBe("v1-alice@example.com");
        expect(rows[0].valuesJson.password).toBe("v1-p1");
        expect(rows[0].valuesJson).not.toHaveProperty("user_email");
        expect(rows[0].valuesJson).not.toHaveProperty("user_password");

        // Iteration row mirrors the snapshot row by rowIndex.
        const iterations = await tx.testRunCaseIteration.findMany({
          where: { testRunCaseId: fx.testRunCaseId },
          orderBy: { rowIndex: "asc" },
        });
        expect(iterations[0].valuesJson).toEqual({
          email: "v1-alice@example.com",
          password: "v1-p1",
        });
      });
    });

    it("follow-latest assignment (pinnedVersionId=null): resolver picks the highest-version row", async () => {
      const { prisma, materializeForOneCase } = await importDeps();
      await withRollback(prisma, async (tx) => {
        const fx = await seedBaseFixture(tx);
        const sharedDs = await createSharedDataset(
          tx,
          fx.projectId,
          fx.creatorId,
          `shared-latest-${Date.now()}`
        );
        await createVersion(tx, sharedDs.id, fx.creatorId, 1, [
          { user_email: "v1-only@example.com", user_password: "v1-pw" },
        ]);
        const v2 = await createVersion(tx, sharedDs.id, fx.creatorId, 2, [
          { user_email: "v2-a@example.com", user_password: "v2-pa" },
          { user_email: "v2-b@example.com", user_password: "v2-pb" },
          { user_email: "v2-c@example.com", user_password: "v2-pc" },
        ]);

        await tx.caseSharedDataSetAssignment.create({
          data: {
            caseId: fx.repositoryCaseId,
            sharedDataSetId: sharedDs.id,
            pinnedVersionId: null,
            mappingJson: {
              user_email: "email",
              user_password: "password",
            },
            createdById: fx.creatorId,
          },
        });

        await materializeForOneCase(
          fx.projectId,
          fx.testRunCaseId,
          fx.repositoryCaseId,
          tx
        );

        const snapshot = await tx.testRunCaseDataSetSnapshot.findUnique({
          where: { testRunCaseId: fx.testRunCaseId },
        });
        expect(snapshot).toMatchObject({
          sourceVersionId: v2.id,
          sourceDataSetId: sharedDs.id,
        });
        const rows = snapshot.rowsJson as Array<{
          valuesJson: Record<string, unknown>;
        }>;
        expect(rows).toHaveLength(3);
        expect(rows.map((r) => r.valuesJson.email)).toEqual([
          "v2-a@example.com",
          "v2-b@example.com",
          "v2-c@example.com",
        ]);
      });
    });

    it("skip sentinel in mapping: dropped columns are absent from the parameter-keyed valuesJson", async () => {
      const { prisma, materializeForOneCase } = await importDeps();
      await withRollback(prisma, async (tx) => {
        const fx = await seedBaseFixture(tx);
        const sharedDs = await createSharedDataset(
          tx,
          fx.projectId,
          fx.creatorId,
          `shared-skip-${Date.now()}`
        );
        const v1 = await createVersion(tx, sharedDs.id, fx.creatorId, 1, [
          {
            user_email: "skip@example.com",
            user_password: "secret",
            extra_col: "junk",
          },
        ]);

        await tx.caseSharedDataSetAssignment.create({
          data: {
            caseId: fx.repositoryCaseId,
            sharedDataSetId: sharedDs.id,
            pinnedVersionId: v1.id,
            mappingJson: {
              user_email: "email",
              user_password: "__skip__",
              extra_col: "__skip__",
            },
            createdById: fx.creatorId,
          },
        });

        await materializeForOneCase(
          fx.projectId,
          fx.testRunCaseId,
          fx.repositoryCaseId,
          tx
        );

        const snapshot = await tx.testRunCaseDataSetSnapshot.findUnique({
          where: { testRunCaseId: fx.testRunCaseId },
        });
        const rows = snapshot.rowsJson as Array<{
          valuesJson: Record<string, unknown>;
        }>;
        expect(rows[0].valuesJson).toEqual({ email: "skip@example.com" });
        expect(rows[0].valuesJson).not.toHaveProperty("password");
        expect(rows[0].valuesJson).not.toHaveProperty("extra_col");
      });
    });

    it("owner + shared on the same case: owner wins (Amendment A); shared assignment is ignored at iteration time", async () => {
      const { prisma, materializeForOneCase } = await importDeps();
      await withRollback(prisma, async (tx) => {
        const fx = await seedBaseFixture(tx);

        // Owner dataset (2 rows).
        const ownerDs = await tx.dataSet.create({
          data: {
            name: `owner-${Date.now()}`,
            ownerCaseId: fx.repositoryCaseId,
            projectId: fx.projectId,
            createdById: fx.creatorId,
          },
          select: { id: true },
        });
        await tx.dataSetRow.createMany({
          data: [
            {
              dataSetId: ownerDs.id,
              rowIndex: 0,
              label: "owner-1",
              valuesJson: { email: "owner1@example.com", password: "ow1" },
            },
            {
              dataSetId: ownerDs.id,
              rowIndex: 1,
              label: "owner-2",
              valuesJson: { email: "owner2@example.com", password: "ow2" },
            },
          ],
        });

        // Shared dataset + assignment (5 rows, different mapping).
        const sharedDs = await createSharedDataset(
          tx,
          fx.projectId,
          fx.creatorId,
          `shared-coexist-${Date.now()}`
        );
        const v1 = await createVersion(tx, sharedDs.id, fx.creatorId, 1, [
          { user_email: "s1@example.com", user_password: "sp1" },
          { user_email: "s2@example.com", user_password: "sp2" },
          { user_email: "s3@example.com", user_password: "sp3" },
          { user_email: "s4@example.com", user_password: "sp4" },
          { user_email: "s5@example.com", user_password: "sp5" },
        ]);
        await tx.caseSharedDataSetAssignment.create({
          data: {
            caseId: fx.repositoryCaseId,
            sharedDataSetId: sharedDs.id,
            pinnedVersionId: v1.id,
            mappingJson: {
              user_email: "email",
              user_password: "password",
            },
            createdById: fx.creatorId,
          },
        });

        const result = await materializeForOneCase(
          fx.projectId,
          fx.testRunCaseId,
          fx.repositoryCaseId,
          tx
        );
        expect(result.iterationCount).toBe(2);

        const snapshot = await tx.testRunCaseDataSetSnapshot.findUnique({
          where: { testRunCaseId: fx.testRunCaseId },
        });
        // Owner-wins: sourceVersionId is null and the dataset id is the
        // owner dataset, NOT the shared dataset.
        expect(snapshot).toMatchObject({
          sourceVersionId: null,
          sourceDataSetId: ownerDs.id,
        });
        const rows = snapshot.rowsJson as Array<{
          valuesJson: Record<string, unknown>;
        }>;
        expect(rows).toHaveLength(2);
        expect(rows[0].valuesJson).toEqual({
          email: "owner1@example.com",
          password: "ow1",
        });
      });
    });

    it("cross-project shared assignment is rejected by the resolver (defense-in-depth)", async () => {
      const { prisma, materializeForOneCase } = await importDeps();
      await withRollback(prisma, async (tx) => {
        const fx = await seedBaseFixture(tx);

        // Build a SECOND project and a shared dataset that lives in it.
        const otherProject = await tx.projects.create({
          data: {
            name: `other-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            createdBy: fx.creatorId,
          },
          select: { id: true },
        });
        const otherSharedDs = await createSharedDataset(
          tx,
          otherProject.id,
          fx.creatorId,
          `cross-${Date.now()}`
        );
        const v1 = await createVersion(tx, otherSharedDs.id, fx.creatorId, 1, [
          { user_email: "cross@example.com", user_password: "x" },
        ]);

        // Bypass the schema @@deny by writing the assignment row directly
        // through the transaction client (which is unenhanced — the @@deny
        // only fires on the policy-enhanced client). This mirrors how the
        // resolver itself runs, so the cross-project guard inside
        // materializeForOneCase is the line we want to verify.
        await tx.caseSharedDataSetAssignment.create({
          data: {
            caseId: fx.repositoryCaseId,
            sharedDataSetId: otherSharedDs.id,
            pinnedVersionId: v1.id,
            mappingJson: { user_email: "email", user_password: "password" },
            createdById: fx.creatorId,
          },
        });

        // Run materialization against fx.projectId — the assignment's
        // sharedDataSet.projectId is otherProject.id, so the cross-project
        // guard must reject it.
        const result = await materializeForOneCase(
          fx.projectId,
          fx.testRunCaseId,
          fx.repositoryCaseId,
          tx
        );
        expect(result.iterationCount).toBe(0);

        const snapshot = await tx.testRunCaseDataSetSnapshot.findUnique({
          where: { testRunCaseId: fx.testRunCaseId },
        });
        expect(snapshot).toMatchObject({
          sourceVersionId: null,
          sourceDataSetId: null,
          sourceDataSetName: "(no dataset)",
        });
        expect(snapshot.rowsJson).toEqual([]);
      });
    });

    it("no assignment and no owner dataset: snapshot has the canonical no-dataset shape (PARAM-07 unchanged)", async () => {
      const { prisma, materializeForOneCase } = await importDeps();
      await withRollback(prisma, async (tx) => {
        const fx = await seedBaseFixture(tx);

        const result = await materializeForOneCase(
          fx.projectId,
          fx.testRunCaseId,
          fx.repositoryCaseId,
          tx
        );
        expect(result.iterationCount).toBe(0);

        const snapshot = await tx.testRunCaseDataSetSnapshot.findUnique({
          where: { testRunCaseId: fx.testRunCaseId },
        });
        expect(snapshot).toMatchObject({
          sourceVersionId: null,
          sourceDataSetId: null,
          sourceDataSetName: "(no dataset)",
        });
        expect(snapshot.rowsJson).toEqual([]);
        const iterations = await tx.testRunCaseIteration.count({
          where: { testRunCaseId: fx.testRunCaseId },
        });
        expect(iterations).toBe(0);
      });
    });
  }
);
