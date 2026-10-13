// Live-DB proof for the Flaky Tests report's filters on
// queryLatestTestResults. The case filters (tags, project) and the run
// filters (tags, milestone subtree, configuration) are raw SQL over a
// Prisma implicit join table and a recursive CTE — only real Postgres can
// prove they bind to the right columns and scope BOTH the manual and the
// JUnit branch.
//
// Run against a scratch database only (never the worktree .env, which
// resolves to a shared database):
//   DATABASE_URL="<scratch url>" RUN_DB_INTEGRATION=1 pnpm exec vitest run \
//     __tests__/integration/flaky-report-filters.integration.test.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";
import { resolveReportFolderFilter } from "~/utils/reportGrouping";
import {
  queryLatestTestResults,
  type RawExecutionResult,
} from "~/lib/services/latestTestResults";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `frf-${Date.now()}`;

describeIntegration("flaky report filters (live DB)", () => {
  let adminUserId: string;
  let projectId: number;
  let repositoryId: number;
  let folderId: number;
  let childFolderId: number;

  let caseTaggedId: number;
  let casePlainId: number;
  let caseTagId: number;
  let runTagId: number;
  let parentMilestoneId: number;
  let childMilestoneId: number;
  let configRegressionId: number;
  let configSmokeId: number;
  let runRegressionId: number;
  let runSmokeId: number;

  const allRunIds: number[] = [];
  const allSuiteIds: number[] = [];

  const query = (
    options: Partial<Parameters<typeof queryLatestTestResults>[0]>
  ) =>
    queryLatestTestResults({
      limit: 30,
      caseIds: [caseTaggedId, casePlainId],
      ...options,
    });

  const pairs = (rows: RawExecutionResult[]) =>
    rows
      .map((row) => `${row.test_case_id}:${row.test_run_id}`)
      .sort()
      .filter((pair, i, all) => all.indexOf(pair) === i);

  beforeAll(async () => {
    const [{ current_database: dbName }] = await db.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (dbName === "ew") {
      throw new Error(
        `refusing to run against database "${dbName}" — use a scratch database`
      );
    }

    const role = await db.roles.findFirst({
      where: { isDefault: true, isDeleted: false },
    });
    if (!role) throw new Error("Test prerequisite: no default role row");
    const admin = await db.user.create({
      data: {
        email: `${STAMP}-admin@example.com`,
        name: `Flaky Filters Admin ${STAMP}`,
        authMethod: "INTERNAL",
        access: "ADMIN",
        accessSource: "MANUAL",
        roleId: role.id,
        password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
      },
      select: { id: true },
    });
    adminUserId = admin.id;

    projectId = (
      await db.projects.create({
        data: { name: `${STAMP}-project`, createdBy: adminUserId },
        select: { id: true },
      })
    ).id;
    repositoryId = (
      await db.repositories.create({
        data: { projectId },
        select: { id: true },
      })
    ).id;
    folderId = (
      await db.repositoryFolders.create({
        data: {
          name: `${STAMP}-folder`,
          repositoryId,
          projectId,
          creatorId: adminUserId,
        },
        select: { id: true },
      })
    ).id;

    const template = await db.templates.findFirst({ select: { id: true } });
    const caseWorkflow = await db.workflows.findFirst({
      where: { scope: "CASES", isDeleted: false, isEnabled: true },
      select: { id: true },
    });
    const runWorkflow = await db.workflows.findFirst({
      where: { scope: "RUNS", isDeleted: false, isEnabled: true },
      select: { id: true },
    });
    const milestoneType = await db.milestoneTypes.findFirst({
      select: { id: true },
    });
    const passing = await db.status.findFirst({
      where: { isSuccess: true, isDeleted: false },
      select: { id: true },
    });
    const failing = await db.status.findFirst({
      where: { isFailure: true, isDeleted: false },
      select: { id: true },
    });
    if (
      !template ||
      !caseWorkflow ||
      !runWorkflow ||
      !milestoneType ||
      !passing ||
      !failing
    ) {
      throw new Error("Test prerequisite: seed data missing");
    }

    caseTagId = (
      await db.tags.create({
        data: { name: `${STAMP}-case-tag` },
        select: { id: true },
      })
    ).id;
    runTagId = (
      await db.tags.create({
        data: { name: `${STAMP}-run-tag` },
        select: { id: true },
      })
    ).id;

    // The plain case lives in a child folder, so the Folders filter's
    // subtree expansion has something to find.
    childFolderId = (
      await db.repositoryFolders.create({
        data: {
          name: `${STAMP}-child-folder`,
          repositoryId,
          projectId,
          creatorId: adminUserId,
          parentId: folderId,
        },
        select: { id: true },
      })
    ).id;

    const createCase = async (name: string, inFolder = folderId) =>
      (
        await db.repositoryCases.create({
          data: {
            projectId,
            repositoryId,
            folderId: inFolder,
            templateId: template.id,
            name: `${STAMP}-${name}`,
            stateId: caseWorkflow.id,
            creatorId: adminUserId,
          },
          select: { id: true },
        })
      ).id;
    caseTaggedId = await createCase("tagged");
    casePlainId = await createCase("plain", childFolderId);
    await db.repositoryCaseTag.create({
      data: { caseId: caseTaggedId, tagId: caseTagId },
    });

    // The regression run hangs off a CHILD milestone, so filtering by the
    // parent proves the subtree expansion.
    parentMilestoneId = (
      await db.milestones.create({
        data: {
          projectId,
          milestoneTypesId: milestoneType.id,
          name: `${STAMP}-release`,
          createdBy: adminUserId,
        },
        select: { id: true },
      })
    ).id;
    childMilestoneId = (
      await db.milestones.create({
        data: {
          projectId,
          milestoneTypesId: milestoneType.id,
          name: `${STAMP}-sprint`,
          createdBy: adminUserId,
          parentId: parentMilestoneId,
        },
        select: { id: true },
      })
    ).id;

    configRegressionId = (
      await db.configurations.create({
        data: { name: `${STAMP}-chrome` },
        select: { id: true },
      })
    ).id;
    configSmokeId = (
      await db.configurations.create({
        data: { name: `${STAMP}-firefox` },
        select: { id: true },
      })
    ).id;

    const createRun = async (
      name: string,
      data: { milestoneId?: number; configId: number; tagIds: number[] }
    ) => {
      const run = await db.testRuns.create({
        data: {
          projectId,
          name: `${STAMP}-${name}`,
          stateId: runWorkflow.id,
          createdById: adminUserId,
          milestoneId: data.milestoneId,
          configId: data.configId,
          tags: { connect: data.tagIds.map((id) => ({ id })) },
        },
        select: { id: true },
      });
      allRunIds.push(run.id);
      return run.id;
    };
    runRegressionId = await createRun("regression", {
      milestoneId: childMilestoneId,
      configId: configRegressionId,
      tagIds: [runTagId],
    });
    runSmokeId = await createRun("smoke", {
      configId: configSmokeId,
      tagIds: [],
    });

    const now = Date.now();
    const recordManual = async (
      runId: number,
      repositoryCaseId: number,
      statusId: number,
      minutesAgo: number
    ) => {
      const runCase = await db.testRunCases.create({
        data: { testRunId: runId, repositoryCaseId },
        select: { id: true },
      });
      await db.testRunResults.create({
        data: {
          testRunId: runId,
          testRunCaseId: runCase.id,
          statusId,
          executedById: adminUserId,
          executedAt: new Date(now - minutesAgo * 60_000),
        },
      });
    };
    const recordJunit = async (
      runId: number,
      repositoryCaseId: number,
      type: "PASSED" | "FAILURE",
      minutesAgo: number
    ) => {
      const suite = await db.jUnitTestSuite.create({
        data: {
          name: `${STAMP}-suite`,
          testRunId: runId,
          createdById: adminUserId,
        },
        select: { id: true },
      });
      allSuiteIds.push(suite.id);
      await db.jUnitTestResult.create({
        data: {
          type,
          repositoryCaseId,
          testSuiteId: suite.id,
          createdById: adminUserId,
          executedAt: new Date(now - minutesAgo * 60_000),
          time: 1,
        },
      });
    };

    // Tagged case: manual results in both runs, plus a JUnit result in
    // each run so the automated branch is filtered too.
    await recordManual(runRegressionId, caseTaggedId, passing.id, 40);
    await recordManual(runSmokeId, caseTaggedId, failing.id, 30);
    await recordJunit(runRegressionId, caseTaggedId, "FAILURE", 20);
    await recordJunit(runSmokeId, caseTaggedId, "PASSED", 10);
    // Plain case: manual results in both runs.
    await recordManual(runRegressionId, casePlainId, failing.id, 35);
    await recordManual(runSmokeId, casePlainId, passing.id, 25);
  });

  afterAll(async () => {
    await db.jUnitTestResult.deleteMany({
      where: { testSuiteId: { in: allSuiteIds } },
    });
    await db.jUnitTestSuite.deleteMany({ where: { id: { in: allSuiteIds } } });
    await db.testRunResults.deleteMany({
      where: { testRunId: { in: allRunIds } },
    });
    await db.testRunCases.deleteMany({
      where: { testRunId: { in: allRunIds } },
    });
    await db.testRuns.deleteMany({ where: { id: { in: allRunIds } } });
    await db.repositoryCaseTag.deleteMany({
      where: { caseId: { in: [caseTaggedId, casePlainId] } },
    });
    await db.repositoryCases.deleteMany({
      where: { id: { in: [caseTaggedId, casePlainId] } },
    });
    await db.milestones.deleteMany({
      where: { id: { in: [childMilestoneId, parentMilestoneId] } },
    });
    await db.configurations.deleteMany({
      where: { id: { in: [configRegressionId, configSmokeId] } },
    });
    await db.tags.deleteMany({ where: { id: { in: [caseTagId, runTagId] } } });
    await db.repositoryFolders.delete({ where: { id: childFolderId } });
    await db.repositoryFolders.delete({ where: { id: folderId } });
    await db.repositories.delete({ where: { id: repositoryId } });
    await db.projects.delete({ where: { id: projectId } });
    await db.user.delete({ where: { id: adminUserId } });
    await db.$disconnect();
  });

  it("returns every execution when no filter is active", async () => {
    const rows = await query({});
    expect(rows).toHaveLength(6);
    expect(
      rows.filter((row) => row.execution_source === "automated")
    ).toHaveLength(2);
  });

  it("case tags narrow the case list", async () => {
    const rows = await query({ caseTagIds: [caseTagId] });
    expect(new Set(rows.map((row) => row.test_case_id))).toEqual(
      new Set([caseTaggedId])
    );
    expect(rows).toHaveLength(4);
  });

  it("run tags keep only executions from tagged runs, manual and JUnit", async () => {
    const rows = await query({ runTagIds: [runTagId] });
    expect(pairs(rows)).toEqual(
      [
        `${caseTaggedId}:${runRegressionId}`,
        `${casePlainId}:${runRegressionId}`,
      ].sort()
    );
    expect(rows).toHaveLength(3);
    expect(rows.some((row) => row.execution_source === "automated")).toBe(true);
  });

  it("a parent milestone includes runs in its child milestones", async () => {
    const rows = await query({ milestoneIds: [parentMilestoneId] });
    expect(rows.every((row) => row.test_run_id === runRegressionId)).toBe(true);
    expect(rows).toHaveLength(3);
  });

  it("configurations keep only executions from matching runs", async () => {
    const rows = await query({ configIds: [configSmokeId] });
    expect(rows.every((row) => row.test_run_id === runSmokeId)).toBe(true);
    expect(rows).toHaveLength(3);
  });

  it("run filters combine with AND across axes", async () => {
    const rows = await query({
      runTagIds: [runTagId],
      configIds: [configSmokeId],
    });
    expect(rows).toHaveLength(0);
  });

  it("case and run filters combine", async () => {
    const rows = await query({
      caseTagIds: [caseTagId],
      milestoneIds: [childMilestoneId],
    });
    expect(pairs(rows)).toEqual([`${caseTaggedId}:${runRegressionId}`]);
    expect(rows).toHaveLength(2);
  });

  it("a parent folder covers its subfolders unless subfolders are off", async () => {
    const withSubfolders = await resolveReportFolderFilter(
      db,
      [folderId],
      true
    );
    expect(new Set(withSubfolders)).toEqual(new Set([folderId, childFolderId]));
    const all = await query({ folderIds: withSubfolders });
    expect(new Set(all.map((row) => row.test_case_id))).toEqual(
      new Set([caseTaggedId, casePlainId])
    );

    const parentOnly = await resolveReportFolderFilter(db, [folderId], false);
    expect(parentOnly).toEqual([folderId]);
    const direct = await query({ folderIds: parentOnly });
    expect(new Set(direct.map((row) => row.test_case_id))).toEqual(
      new Set([caseTaggedId])
    );

    const child = await query({
      folderIds: await resolveReportFolderFilter(db, [childFolderId], true),
    });
    expect(new Set(child.map((row) => row.test_case_id))).toEqual(
      new Set([casePlainId])
    );
    expect(await resolveReportFolderFilter(db, [], true)).toBeNull();
  });

  it("the project filter scopes the cross-project query", async () => {
    expect(await query({ projectIds: [projectId] })).toHaveLength(6);
    expect(await query({ projectIds: [projectId + 1_000_000] })).toHaveLength(
      0
    );
  });
});
