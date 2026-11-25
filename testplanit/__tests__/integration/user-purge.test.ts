// Live-DB proof that purging a user from Admin > Trash works when the user
// created content. A bare DELETE on "User" fails on the first RESTRICT foreign
// key (Comment_creatorId_fkey, TestRuns_createdById_fkey, ...), which only a
// real Postgres enforces.
//
// Run against a scratch database only (never the worktree .env, which
// resolves to a shared database):
//   DATABASE_URL="<scratch url>" RUN_DB_INTEGRATION=1 pnpm exec vitest run \
//     __tests__/integration/user-purge.test.ts

import { Decimal } from "decimal.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runWithAuditContext } from "~/lib/auditContext";
import {
  DELETED_USER_EMAIL,
  DELETED_USER_ID,
  DELETED_USER_NAME,
} from "~/lib/deletedUser";
import { createRawDbClient } from "~/lib/rawDbClient";
import { purgeUser, UserPurgeError } from "~/lib/services/userPurge";
import { isForeignKeyError } from "~/lib/utils/errors";
import { getAuthDb } from "~/lib/zenstack";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `upg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const USER_KEYS = ["author", "second", "idle", "live", "blocked"] as const;
const TRASHED: ReadonlyArray<(typeof USER_KEYS)[number]> = [
  "author",
  "second",
  "idle",
  "blocked",
];

describeIntegration("purgeUser (live DB)", () => {
  const users = {} as Record<(typeof USER_KEYS)[number], string>;
  const commentIds = {} as Record<"author" | "second" | "blocked", string>;
  let deletedUserExisted = false;
  let roleId: number;
  let projectId: number;
  let repositoryId: number;
  let folderId: number;
  let caseId: number;
  let runId: number;
  let runCaseId: number;
  let resultId: number;
  let llmUsageId: string;
  let scimTokenId: string;

  const comment = async (creatorId: string) =>
    (
      await db.comment.create({
        data: {
          projectId,
          testRunId: runId,
          creatorId,
          content: { type: "doc", content: [] },
        },
        select: { id: true },
      })
    ).id;

  beforeAll(async () => {
    const [{ current_database: dbName }] = await db.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (dbName === "ew") {
      throw new Error(
        `refusing to run against database "${dbName}" — use a scratch database`
      );
    }

    deletedUserExisted = Boolean(
      await db.user.findUnique({
        where: { id: DELETED_USER_ID },
        select: { id: true },
      })
    );

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
    const passing = await db.status.findFirst({
      where: { isSuccess: true, isDeleted: false },
      select: { id: true },
    });
    if (!role || !template || !caseWorkflow || !runWorkflow || !passing) {
      throw new Error("Test prerequisite: seed data missing");
    }
    roleId = role.id;

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

    // Everything below is authored by `author`, one row per kind.
    projectId = (
      await db.projects.create({
        data: {
          name: `${STAMP}-project`,
          createdBy: users.author,
          defaultAccessType: "NO_ACCESS",
        },
        select: { id: true },
      })
    ).id;
    // `live` reads the project as an ordinary member, not an administrator.
    await db.userProjectPermission.create({
      data: { userId: users.live, projectId, accessType: "GLOBAL_ROLE" },
    });
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
          creatorId: users.author,
        },
        select: { id: true },
      })
    ).id;
    caseId = (
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
    runId = (
      await db.testRuns.create({
        data: {
          projectId,
          name: `${STAMP}-run`,
          stateId: runWorkflow.id,
          createdById: users.author,
        },
        select: { id: true },
      })
    ).id;
    runCaseId = (
      await db.testRunCases.create({
        data: {
          testRunId: runId,
          repositoryCaseId: caseId,
          assignedToId: users.author,
        },
        select: { id: true },
      })
    ).id;
    resultId = (
      await db.testRunResults.create({
        data: {
          testRunId: runId,
          testRunCaseId: runCaseId,
          statusId: passing.id,
          executedById: users.author,
          executedAt: new Date(),
        },
        select: { id: true },
      })
    ).id;
    llmUsageId = (
      await db.llmUsage.create({
        data: {
          userId: users.author,
          feature: "test_case_generation",
          model: "test-model",
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2,
          inputCost: new Decimal("0"),
          outputCost: new Decimal("0"),
          totalCost: new Decimal("0"),
          latency: 1,
          success: true,
        },
        select: { id: true },
      })
    ).id;
    commentIds.author = await comment(users.author);
    commentIds.second = await comment(users.second);
    commentIds.blocked = await comment(users.blocked);

    // Both are members of the same project: reassigning these rows instead of
    // deleting them would collide on the (userId, projectId) key.
    await db.projectAssignment.createMany({
      data: [
        { userId: users.author, projectId },
        { userId: users.second, projectId },
      ],
    });

    // A reference purgeUser deliberately leaves alone, so `blocked` cannot be
    // deleted.
    scimTokenId = (
      await db.scimToken.create({
        data: {
          name: `${STAMP}-token`,
          idpName: "OTHER",
          token: `${STAMP}-hash`,
          tokenPrefix: "tps_test",
          secret: "encrypted",
          systemUserId: users.blocked,
          createdById: users.live,
        },
        select: { id: true },
      })
    ).id;

    await db.user.updateMany({
      where: { id: { in: TRASHED.map((key) => users[key]) } },
      data: { isDeleted: true },
    });
  });

  afterAll(async () => {
    await db.scimToken.deleteMany({ where: { id: scimTokenId } });
    await db.comment.deleteMany({ where: { projectId } });
    await db.llmUsage.deleteMany({ where: { id: llmUsageId } });
    await db.testRunResults.deleteMany({ where: { testRunId: runId } });
    await db.testRunCases.deleteMany({ where: { testRunId: runId } });
    await db.testRuns.deleteMany({ where: { id: runId } });
    await db.repositoryCases.deleteMany({ where: { id: caseId } });
    await db.repositoryFolders.deleteMany({ where: { id: folderId } });
    await db.repositories.deleteMany({ where: { id: repositoryId } });
    await db.projectAssignment.deleteMany({ where: { projectId } });
    await db.userProjectPermission.deleteMany({ where: { projectId } });
    await db.projects.deleteMany({ where: { id: projectId } });
    await db.user.deleteMany({
      where: { id: { in: Object.values(users) } },
    });
    if (!deletedUserExisted) {
      await db.user.deleteMany({ where: { id: DELETED_USER_ID } });
    }
    await db.$disconnect();
  });

  const exists = async (userId: string) =>
    Boolean(
      await db.user.findUnique({ where: { id: userId }, select: { id: true } })
    );
  const commentCreator = async (id: string) =>
    (
      await db.comment.findUniqueOrThrow({
        where: { id },
        select: { creatorId: true },
      })
    ).creatorId;

  it("purges a user who owns nothing", async () => {
    const result = await purgeUser(db, users.idle);

    expect(result.reassigned).toEqual({});
    expect(await exists(users.idle)).toBe(false);
  });

  it("refuses a user who is not in Trash", async () => {
    await expect(purgeUser(db, users.live)).rejects.toMatchObject({
      name: "UserPurgeError",
      status: 400,
    });
    await expect(purgeUser(db, users.live)).rejects.toBeInstanceOf(
      UserPurgeError
    );
    expect(await exists(users.live)).toBe(true);
  });

  it("keeps a purged user's content under the Deleted User row", async () => {
    // The route runs inside the request's audit context; `live` stands in
    // for the administrator.
    const result = await runWithAuditContext(
      { userId: users.live },
      async () => await purgeUser(db, users.author)
    );

    expect(result.user.id).toBe(users.author);
    expect(result.reassigned).toEqual({
      Comment: 1,
      LlmUsage: 1,
      Projects: 1,
      RepositoryCases: 1,
      RepositoryFolders: 1,
      TestRunResults: 1,
      TestRuns: 1,
    });
    expect(await exists(users.author)).toBe(false);

    const project = await db.projects.findUniqueOrThrow({
      where: { id: projectId },
      select: { createdBy: true },
    });
    const folder = await db.repositoryFolders.findUniqueOrThrow({
      where: { id: folderId },
      select: { creatorId: true },
    });
    const repoCase = await db.repositoryCases.findUniqueOrThrow({
      where: { id: caseId },
      select: { creatorId: true },
    });
    const run = await db.testRuns.findUniqueOrThrow({
      where: { id: runId },
      select: { createdById: true },
    });
    const runResult = await db.testRunResults.findUniqueOrThrow({
      where: { id: resultId },
      select: { executedById: true },
    });
    const usage = await db.llmUsage.findUniqueOrThrow({
      where: { id: llmUsageId },
      select: { userId: true },
    });
    expect({
      project: project.createdBy,
      folder: folder.creatorId,
      case: repoCase.creatorId,
      run: run.createdById,
      result: runResult.executedById,
      usage: usage.userId,
      comment: await commentCreator(commentIds.author),
    }).toEqual({
      project: DELETED_USER_ID,
      folder: DELETED_USER_ID,
      case: DELETED_USER_ID,
      run: DELETED_USER_ID,
      result: DELETED_USER_ID,
      usage: DELETED_USER_ID,
      comment: DELETED_USER_ID,
    });

    // Optional references are cleared by the database, memberships removed.
    const runCase = await db.testRunCases.findUniqueOrThrow({
      where: { id: runCaseId },
      select: { assignedToId: true },
    });
    expect(runCase.assignedToId).toBeNull();
    expect(
      await db.projectAssignment.count({ where: { userId: users.author } })
    ).toBe(0);
    expect(
      await db.projectAssignment.count({ where: { userId: DELETED_USER_ID } })
    ).toBe(0);

    // Each reassignment is in the change log, attributed to the administrator.
    const logged = await db.$queryRaw<
      Array<{ actor: string | null; changed_cols: unknown }>
    >`
      SELECT "actor", "changed_cols" FROM "DataChangeLog"
      WHERE "table" = 'Comment' AND "pk" = ${commentIds.author} AND "op" = 'U'
    `;
    expect(logged).toEqual([
      {
        actor: users.live,
        changed_cols: {
          creatorId: { old: users.author, new: DELETED_USER_ID },
        },
      },
    ]);

    const deletedUser = await db.user.findUniqueOrThrow({
      where: { id: DELETED_USER_ID },
      select: { email: true, isDeleted: true, isActive: true, access: true },
    });
    expect(deletedUser).toEqual({
      email: DELETED_USER_EMAIL,
      isDeleted: true,
      isActive: false,
      access: "NONE",
    });
  });

  it("shows the content to non-admins as created by Deleted User", async () => {
    const viewerDb = await getAuthDb({
      id: users.live,
      access: "USER",
      roleId,
    });

    const run = await viewerDb.testRuns.findFirst({
      where: { id: runId },
      select: { createdBy: { select: { name: true, isDeleted: true } } },
    });

    expect(run?.createdBy).toEqual({
      name: DELETED_USER_NAME,
      isDeleted: true,
    });
  });

  it("lets a second purged user share the Deleted User row", async () => {
    const result = await purgeUser(db, users.second);

    expect(result.reassigned).toEqual({ Comment: 1 });
    expect(await exists(users.second)).toBe(false);
    expect(await commentCreator(commentIds.second)).toBe(DELETED_USER_ID);
    expect(await db.projectAssignment.count({ where: { projectId } })).toBe(0);
  });

  it("changes nothing when the database refuses the delete", async () => {
    const failure = await purgeUser(db, users.blocked).catch(
      (error: unknown) => error
    );

    expect(isForeignKeyError(failure)).toBe(true);
    expect(await exists(users.blocked)).toBe(true);
    expect(await commentCreator(commentIds.blocked)).toBe(users.blocked);
  });

  it("refuses to purge the Deleted User row itself", async () => {
    await expect(purgeUser(db, DELETED_USER_ID)).rejects.toMatchObject({
      status: 400,
    });
    expect(await exists(DELETED_USER_ID)).toBe(true);
  });
});
