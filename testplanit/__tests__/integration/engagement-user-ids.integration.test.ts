// Live-DB proof for queryEngagementUserIds: each raw union branch binds to
// the right columns and honours project scope and soft deletes.
//
// Run against a scratch database only (never the worktree .env, which
// resolves to a shared database):
//   DATABASE_URL="<scratch url>" RUN_DB_INTEGRATION=1 pnpm exec vitest run \
//     __tests__/integration/engagement-user-ids.integration.test.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { queryEngagementUserIds } from "~/lib/engagementUserIdsQuery";
import { createRawDbClient } from "~/lib/rawDbClient";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `eui-${Date.now()}`;

const USER_KEYS = [
  "author",
  "runner",
  "automator",
  "sessioner",
  "outsider",
  "deletedRun",
  "idle",
] as const;

describeIntegration("queryEngagementUserIds (live DB)", () => {
  const users = {} as Record<(typeof USER_KEYS)[number], string>;
  const projectIds: number[] = [];
  const runIds: number[] = [];
  const suiteIds: number[] = [];
  const sessionIds: number[] = [];
  const caseIds: number[] = [];
  let repositoryIds: number[] = [];
  let folderIds: number[] = [];
  let projectId: number;
  let otherProjectId: number;

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
    const template = await db.templates.findFirst({ select: { id: true } });
    const caseWorkflow = await db.workflows.findFirst({
      where: { scope: "CASES", isDeleted: false, isEnabled: true },
      select: { id: true },
    });
    const runWorkflow = await db.workflows.findFirst({
      where: { scope: "RUNS", isDeleted: false, isEnabled: true },
      select: { id: true },
    });
    const sessionWorkflow = await db.workflows.findFirst({
      where: { scope: "SESSIONS", isDeleted: false, isEnabled: true },
      select: { id: true },
    });
    const passing = await db.status.findFirst({
      where: { isSuccess: true, isDeleted: false },
      select: { id: true },
    });
    if (
      !role ||
      !template ||
      !caseWorkflow ||
      !runWorkflow ||
      !sessionWorkflow ||
      !passing
    ) {
      throw new Error("Test prerequisite: seed data missing");
    }

    for (const key of USER_KEYS) {
      users[key] = (
        await db.user.create({
          data: {
            email: `${STAMP}-${key}@example.com`,
            name: `${STAMP} ${key}`,
            authMethod: "INTERNAL",
            access: "USER",
            accessSource: "MANUAL",
            roleId: role.id,
            password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
          },
          select: { id: true },
        })
      ).id;
    }

    const createProject = async (suffix: string) => {
      const id = (
        await db.projects.create({
          data: { name: `${STAMP}-${suffix}`, createdBy: users.idle },
          select: { id: true },
        })
      ).id;
      projectIds.push(id);
      return id;
    };
    projectId = await createProject("project");
    otherProjectId = await createProject("other");

    const repositoryId = (
      await db.repositories.create({
        data: { projectId },
        select: { id: true },
      })
    ).id;
    repositoryIds = [repositoryId];
    const folderId = (
      await db.repositoryFolders.create({
        data: {
          name: `${STAMP}-folder`,
          repositoryId,
          projectId,
          creatorId: users.author,
        },
        select: { id: true },
      })
    ).id;
    folderIds = [folderId];

    const caseId = (
      await db.repositoryCases.create({
        data: {
          projectId,
          repositoryId,
          folderId,
          templateId: template.id,
          name: `${STAMP}-case`,
          stateId: caseWorkflow.id,
          creatorId: users.author,
        },
        select: { id: true },
      })
    ).id;
    caseIds.push(caseId);

    const createRun = async (inProject: number, isDeleted = false) => {
      const id = (
        await db.testRuns.create({
          data: {
            projectId: inProject,
            name: `${STAMP}-run`,
            stateId: runWorkflow.id,
            createdById: users.idle,
            isDeleted,
          },
          select: { id: true },
        })
      ).id;
      runIds.push(id);
      return id;
    };
    const recordJunit = async (runId: number, userId: string) => {
      const suite = await db.jUnitTestSuite.create({
        data: { name: `${STAMP}-suite`, testRunId: runId, createdById: userId },
        select: { id: true },
      });
      suiteIds.push(suite.id);
      await db.jUnitTestResult.create({
        data: {
          type: "PASSED",
          repositoryCaseId: caseId,
          testSuiteId: suite.id,
          createdById: userId,
          executedAt: new Date(),
          time: 1,
        },
      });
    };

    const runId = await createRun(projectId);
    const runCase = await db.testRunCases.create({
      data: { testRunId: runId, repositoryCaseId: caseId },
      select: { id: true },
    });
    await db.testRunResults.create({
      data: {
        testRunId: runId,
        testRunCaseId: runCase.id,
        statusId: passing.id,
        executedById: users.runner,
        executedAt: new Date(),
      },
    });
    await recordJunit(runId, users.automator);
    await recordJunit(await createRun(otherProjectId), users.outsider);
    await recordJunit(await createRun(projectId, true), users.deletedRun);

    const sessionId = (
      await db.sessions.create({
        data: {
          projectId,
          templateId: template.id,
          name: `${STAMP}-session`,
          stateId: sessionWorkflow.id,
          createdById: users.idle,
        },
        select: { id: true },
      })
    ).id;
    sessionIds.push(sessionId);
    await db.sessionResults.create({
      data: {
        sessionId,
        createdById: users.sessioner,
        statusId: passing.id,
      },
    });
  });

  afterAll(async () => {
    await db.sessionResults.deleteMany({
      where: { sessionId: { in: sessionIds } },
    });
    await db.sessions.deleteMany({ where: { id: { in: sessionIds } } });
    await db.jUnitTestResult.deleteMany({
      where: { testSuiteId: { in: suiteIds } },
    });
    await db.jUnitTestSuite.deleteMany({ where: { id: { in: suiteIds } } });
    await db.testRunResults.deleteMany({
      where: { testRunId: { in: runIds } },
    });
    await db.testRunCases.deleteMany({ where: { testRunId: { in: runIds } } });
    await db.testRuns.deleteMany({ where: { id: { in: runIds } } });
    await db.repositoryCases.deleteMany({ where: { id: { in: caseIds } } });
    await db.repositoryFolders.deleteMany({ where: { id: { in: folderIds } } });
    await db.repositories.deleteMany({ where: { id: { in: repositoryIds } } });
    await db.projects.deleteMany({ where: { id: { in: projectIds } } });
    await db.user.deleteMany({
      where: { id: { in: Object.values(users) } },
    });
    await db.$disconnect();
  });

  const ours = (ids: string[]) =>
    ids.filter((id) => Object.values(users).includes(id)).sort();

  it("returns users with activity in the project, from every source", async () => {
    const ids = await queryEngagementUserIds(db, projectId);
    expect(ours(ids)).toEqual(
      [users.author, users.runner, users.automator, users.sessioner].sort()
    );
  });

  it("spans every project when unscoped, still skipping deleted runs", async () => {
    const ids = await queryEngagementUserIds(db, undefined);
    expect(ours(ids)).toEqual(
      [
        users.author,
        users.runner,
        users.automator,
        users.sessioner,
        users.outsider,
      ].sort()
    );
  });
});
