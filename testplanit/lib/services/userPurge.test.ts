import {
  type CompiledQuery,
  type Driver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult,
} from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getElasticsearchClient } = vi.hoisted(() => ({
  getElasticsearchClient: vi.fn(),
}));

vi.mock("~/lib/audit/gucContext", () => ({
  buildGucPayload: () => ({ userId: "admin" }),
  withAuditGuc: (
    client: unknown,
    _payload: unknown,
    fn: (tx: unknown) => Promise<unknown>
  ) => fn(client),
}));
vi.mock("~/services/unifiedElasticsearchService", () => ({
  getElasticsearchClient,
  getEntityIndexName: (entityType: string, tenantId?: string) =>
    tenantId
      ? `testplanit-${tenantId}-${entityType}`
      : `testplanit-${entityType}`,
}));

import { SYSTEM_AUTOMATION_USER_ID } from "~/lib/automationUser";
import { DELETED_USER_ID, DELETED_USER_NAME } from "~/lib/deletedUser";
import { SCIM_SYSTEM_USER_ID } from "~/lib/scim/constants";
import { schema } from "~/zenstack/schema";
import {
  purgeUser,
  reassignPurgedUserInSearch,
  restrictingUserReferences,
  userPurgePlan,
} from "./userPurge";

type Respond = (sql: string) => Partial<QueryResult<unknown>> | undefined;

// A transaction client whose queries are recorded instead of run.
function recordingClient(respond: Respond) {
  const statements: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const connection = {
    executeQuery: async (compiled: CompiledQuery) => {
      const sql = compiled.sql.replace(/\s+/g, " ").trim();
      statements.push({ sql, parameters: compiled.parameters });
      return { rows: [], ...respond(sql) };
    },
    streamQuery: async function* () {},
  };
  const driver: Driver = {
    init: async () => {},
    acquireConnection: async () => connection as never,
    beginTransaction: async () => {},
    commitTransaction: async () => {},
    rollbackTransaction: async () => {},
    releaseConnection: async () => {},
    destroy: async () => {},
  };
  const $qb = new Kysely<unknown>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return { client: { $qb } as never, statements };
}

const trashedUser = {
  id: "u1",
  name: "Dana",
  email: "dana@example.com",
  isDeleted: true,
};

const key = (ref: { model: string; column: string }) =>
  `${ref.model}.${ref.column}`;

describe("user purge plan", () => {
  it("covers every column the database refuses to orphan", () => {
    expect(restrictingUserReferences.map(key)).toEqual(
      expect.arrayContaining([
        "AlertRule.createdById",
        "Attachments.createdById",
        "CaseQuarantine.createdById",
        "CaseSharedDataSetAssignment.createdById",
        "Comment.creatorId",
        "DataSet.createdById",
        "DataSetVersion.createdById",
        "ExecutionTarget.createdById",
        "ImpactAnalysis.createdById",
        "Issue.createdById",
        "JUnitAttachment.createdById",
        "JUnitProperty.createdById",
        "JUnitTestResult.createdById",
        "JUnitTestStep.createdById",
        "JUnitTestSuite.createdById",
        "LlmReportSnapshot.generatedById",
        "LlmUsage.userId",
        "Milestones.createdBy",
        "ProjectAssignment.userId",
        "Projects.createdBy",
        "RepositoryCaseCodePin.createdById",
        "RepositoryCaseLink.createdById",
        "RepositoryCases.creatorId",
        "RepositoryFolders.creatorId",
        "RequirementTraceabilitySnapshot.capturedById",
        "ReviewRequest.requestedByUserId",
        "ScimToken.createdById",
        "ScimToken.systemUserId",
        "SessionResults.createdById",
        "Sessions.createdById",
        "SharedStepGroup.createdById",
        "TestRunExecution.requestedById",
        "TestRunResults.executedById",
        "TestRuns.createdById",
        "TestmoImportJob.createdById",
      ])
    );
  });

  it("handles every such column, leaving only the SCIM system user alone", () => {
    const handled = [...userPurgePlan.reassign, ...userPurgePlan.remove].map(
      key
    );
    const unhandled = restrictingUserReferences
      .map(key)
      .filter((ref) => !handled.includes(ref));

    expect(unhandled).toEqual(["ScimToken.systemUserId"]);
    expect(userPurgePlan.remove.map(key)).toEqual(["ProjectAssignment.userId"]);
  });

  // Two purged users' rows end up on the same "Deleted User" row, so a
  // reassigned column inside a key would collide on the second purge.
  it("never reassigns a column that is part of a key", () => {
    const models = schema.models as unknown as Record<
      string,
      {
        idFields?: readonly string[];
        uniqueFields?: Record<string, Record<string, unknown>>;
      }
    >;
    const keyed = userPurgePlan.reassign.filter(({ model, column }) => {
      const def = models[model];
      return (
        def.idFields?.includes(column) ||
        Object.entries(def.uniqueFields ?? {}).some(
          ([name, fields]) => name === column || column in fields
        )
      );
    });

    expect(keyed.map(key)).toEqual([]);
  });
});

describe("purgeUser", () => {
  it("reassigns owned content, drops memberships, then deletes the user", async () => {
    const { client, statements } = recordingClient((sql) => {
      if (sql.startsWith("SELECT")) return { rows: [trashedUser] };
      if (sql.startsWith('UPDATE "Comment"')) return { numAffectedRows: 2n };
      if (sql.startsWith('UPDATE "TestRuns"')) return { numAffectedRows: 1n };
      return { numAffectedRows: 0n };
    });

    const result = await purgeUser(client, "u1");

    expect(result).toEqual({
      user: { id: "u1", name: "Dana", email: "dana@example.com" },
      reassigned: { Comment: 2, TestRuns: 1 },
    });

    const sqls = statements.map((statement) => statement.sql);
    expect(sqls[0]).toMatch(/^SELECT .* FROM "User" .* FOR UPDATE$/);
    expect(sqls[1]).toMatch(
      /^INSERT INTO "User" .* ON CONFLICT \("id"\) DO NOTHING$/
    );
    expect(statements[1].parameters).toContain(DELETED_USER_ID);

    const updates = statements.slice(2, 2 + userPurgePlan.reassign.length);
    expect(updates.map((statement) => statement.sql)).toEqual(
      userPurgePlan.reassign.map(
        ({ model, column }) =>
          `UPDATE "${model}" SET "${column}" = $1 WHERE "${column}" = $2`
      )
    );
    for (const update of updates) {
      expect(update.parameters).toEqual([DELETED_USER_ID, "u1"]);
    }

    expect(sqls.slice(2 + userPurgePlan.reassign.length)).toEqual([
      'DELETE FROM "ProjectAssignment" WHERE "userId" = $1',
      'DELETE FROM "User" WHERE "id" = $1',
    ]);
  });

  it("purges a user who owns nothing", async () => {
    const { client, statements } = recordingClient((sql) =>
      sql.startsWith("SELECT")
        ? { rows: [trashedUser] }
        : { numAffectedRows: 0n }
    );

    const result = await purgeUser(client, "u1");

    expect(result.reassigned).toEqual({});
    expect(statements.at(-1)?.sql).toBe('DELETE FROM "User" WHERE "id" = $1');
  });

  it("writes nothing when the user does not exist", async () => {
    const { client, statements } = recordingClient(() => ({ rows: [] }));

    await expect(purgeUser(client, "missing")).rejects.toMatchObject({
      name: "UserPurgeError",
      status: 404,
    });
    expect(statements).toHaveLength(1);
  });

  it("writes nothing when the user is not in Trash", async () => {
    const { client, statements } = recordingClient(() => ({
      rows: [{ ...trashedUser, isDeleted: false }],
    }));

    await expect(purgeUser(client, "u1")).rejects.toMatchObject({
      name: "UserPurgeError",
      status: 400,
    });
    expect(statements).toHaveLength(1);
  });

  it.each([DELETED_USER_ID, SCIM_SYSTEM_USER_ID, SYSTEM_AUTOMATION_USER_ID])(
    "refuses to purge the system user %s",
    async (id) => {
      const { client, statements } = recordingClient(() => ({ rows: [] }));

      await expect(purgeUser(client, id)).rejects.toMatchObject({
        name: "UserPurgeError",
        status: 400,
      });
      expect(statements).toHaveLength(0);
    }
  );
});

describe("reassignPurgedUserInSearch", () => {
  beforeEach(() => {
    getElasticsearchClient.mockReset();
  });

  it("does nothing when search is not configured", async () => {
    getElasticsearchClient.mockReturnValue(null);

    await expect(reassignPurgedUserInSearch("u1")).resolves.toBeUndefined();
  });

  it("rewrites the user's documents in every index of the tenant", async () => {
    const updateByQuery = vi.fn().mockResolvedValue({});
    getElasticsearchClient.mockReturnValue({ updateByQuery });

    await reassignPurgedUserInSearch("u1", "acme");

    expect(updateByQuery).toHaveBeenCalledTimes(1);
    const request = updateByQuery.mock.calls[0][0];
    expect(request.index).toEqual([
      "testplanit-acme-repository_case",
      "testplanit-acme-shared_step",
      "testplanit-acme-test_run",
      "testplanit-acme-session",
      "testplanit-acme-project",
      "testplanit-acme-issue",
      "testplanit-acme-milestone",
    ]);
    expect(request.query.bool.should).toEqual([
      { term: { createdById: "u1" } },
      { term: { creatorId: "u1" } },
      { term: { assignedToId: "u1" } },
    ]);
    expect(request.wait_for_completion).toBe(false);
    expect(request.script.params).toEqual({
      from: "u1",
      to: DELETED_USER_ID,
      name: DELETED_USER_NAME,
    });
  });
});
