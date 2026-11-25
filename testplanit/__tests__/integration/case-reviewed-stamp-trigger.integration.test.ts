// Live-DB proof for the tpl_case_reviewed_stamp_upd trigger: a person moving
// a test case out of an AI-draft workflow state is recorded as its reviewer.
//
// Run against a seeded scratch database, never the default .env one:
//   cd testplanit && DATABASE_URL=<scratch tpi_case_upkeep URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/case-reviewed-stamp-trigger.integration.test.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { CASE_REVIEWED_STAMP_TRIGGER_SQL } from "~/scripts/apply-triggers";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const DB_URL = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const describeIntegration =
  RUN_INTEGRATION && process.env.DATABASE_URL ? describe : describe.skip;

const SYSTEM_USER_ID = "system-automation-user";

describeIntegration("Case reviewer stamp trigger (live DB)", () => {
  let client: Client;
  let personId: string;
  let caseId: number;
  let projectId = 0;
  let originalStateId: number;
  let iconId: number;
  let colorId: number;

  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();
    const { rows } = await client.query<{ current_database: string }>(
      "select current_database()"
    );
    const dbName = rows[0]?.current_database;
    if (dbName !== "tpi_case_upkeep" && dbName !== "tpi_test") {
      await client.end();
      throw new Error(
        `Refusing to run against database "${dbName}": this suite only runs against tpi_case_upkeep or tpi_test.`
      );
    }
    await client.query(CASE_REVIEWED_STAMP_TRIGGER_SQL);

    const person = await client.query<{ id: string }>(
      `select "id" from "User" where "id" <> $1 and "isDeleted" = false limit 1`,
      [SYSTEM_USER_ID]
    );
    const look = await client.query<{
      id: number;
      iconId: number;
      colorId: number;
    }>(
      `select "id", "iconId", "colorId" from "Workflows" where "scope" = 'CASES' and "isDeleted" = false and "isAiDraft" = false limit 1`
    );
    if (!person.rows[0] || !look.rows[0]) {
      throw new Error(
        "Seed the database first: a user and a test case state are needed."
      );
    }
    personId = person.rows[0].id;
    originalStateId = look.rows[0].id;
    iconId = look.rows[0].iconId;
    colorId = look.rows[0].colorId;

    // The suite's own case, so it runs on a database with none.
    const { rawDb } = await import("~/lib/rawDb");
    const stamp = `crs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const template = await rawDb.templates.findFirst({
      where: { isDeleted: false },
      select: { id: true },
    });
    if (!template) throw new Error("Seed the database first: no template.");
    const project = await rawDb.projects.create({
      data: { name: stamp, createdBy: personId },
      select: { id: true },
    });
    projectId = project.id;
    const repository = await rawDb.repositories.create({
      data: { projectId },
      select: { id: true },
    });
    const folder = await rawDb.repositoryFolders.create({
      data: {
        name: stamp,
        projectId,
        repositoryId: repository.id,
        creatorId: personId,
      },
      select: { id: true },
    });
    const testCase = await rawDb.repositoryCases.create({
      data: {
        name: stamp,
        projectId,
        repositoryId: repository.id,
        folderId: folder.id,
        templateId: template.id,
        stateId: originalStateId,
        creatorId: personId,
      },
      select: { id: true },
    });
    caseId = testCase.id;
  });

  afterAll(async () => {
    if (projectId) {
      const { rawDb } = await import("~/lib/rawDb");
      await rawDb.projects
        .delete({ where: { id: projectId } })
        .catch((error: unknown) => console.warn("cleanup project", error));
    }
    await client?.end();
  });

  async function addState(aiDraft: boolean): Promise<number> {
    const { rows } = await client.query<{ id: number }>(
      `insert into "Workflows" ("name", "iconId", "colorId", "scope", "isAiDraft")
       values ($1, $2, $3, 'CASES', $4) returning "id"`,
      [
        `crs-${Math.random().toString(36).slice(2, 10)}`,
        iconId,
        colorId,
        aiDraft,
      ]
    );
    return rows[0].id;
  }

  async function actAs(userId: string | null): Promise<void> {
    await client.query(`select set_config('app.audit_context', $1, true)`, [
      userId === null ? "" : JSON.stringify({ userId }),
    ]);
  }

  async function move(toStateId: number, extra = ""): Promise<void> {
    await client.query(
      `update "RepositoryCases" set "stateId" = $1${extra} where "id" = $2`,
      [toStateId, caseId]
    );
  }

  async function reviewer(): Promise<{ id: string | null; at: Date | null }> {
    const { rows } = await client.query<{
      reviewedById: string | null;
      reviewedAt: Date | null;
    }>(
      `select "reviewedById", "reviewedAt" from "RepositoryCases" where "id" = $1`,
      [caseId]
    );
    return { id: rows[0].reviewedById, at: rows[0].reviewedAt };
  }

  /** Each scenario runs in a transaction that is rolled back. */
  async function scenario(body: () => Promise<void>): Promise<void> {
    await client.query("begin");
    try {
      await client.query(
        `update "RepositoryCases" set "reviewedById" = null, "reviewedAt" = null where "id" = $1`,
        [caseId]
      );
      await body();
    } finally {
      await client.query("rollback");
    }
  }

  it("records the person who moves a case out of an AI-draft state", async () => {
    await scenario(async () => {
      const aiState = await addState(true);
      const reviewed = await addState(false);
      await actAs(null);
      await move(aiState);
      await actAs(personId);
      await move(reviewed);
      const result = await reviewer();
      expect(result.id).toBe(personId);
      expect(result.at).toBeInstanceOf(Date);
    });
  });

  it("records nothing for a move between two ordinary states", async () => {
    await scenario(async () => {
      const other = await addState(false);
      await actAs(personId);
      await move(other);
      expect((await reviewer()).id).toBeNull();
    });
  });

  it("records nothing for a move into an AI-draft state", async () => {
    await scenario(async () => {
      const aiState = await addState(true);
      await actAs(personId);
      await move(aiState);
      expect((await reviewer()).id).toBeNull();
    });
  });

  it("records nothing for a move from one AI-draft state to another", async () => {
    await scenario(async () => {
      const first = await addState(true);
      const second = await addState(true);
      await actAs(null);
      await move(first);
      await actAs(personId);
      await move(second);
      expect((await reviewer()).id).toBeNull();
    });
  });

  it("records nothing when no person is acting", async () => {
    await scenario(async () => {
      const aiState = await addState(true);
      const reviewed = await addState(false);
      await actAs(null);
      await move(aiState);
      await move(reviewed);
      expect((await reviewer()).id).toBeNull();
    });
  });

  it("records nothing for the System user or an unknown user", async () => {
    await scenario(async () => {
      const aiState = await addState(true);
      const reviewed = await addState(false);
      await actAs(null);
      await move(aiState);
      await actAs(SYSTEM_USER_ID);
      await move(reviewed);
      expect((await reviewer()).id).toBeNull();
      await actAs(null);
      await move(aiState);
      await actAs("no-such-user");
      await move(reviewed);
      expect((await reviewer()).id).toBeNull();
    });
  });

  it("keeps a reviewer the write sets itself", async () => {
    await scenario(async () => {
      const aiState = await addState(true);
      const reviewed = await addState(false);
      await actAs(null);
      await move(aiState);
      await actAs(personId);
      await client.query(
        `update "RepositoryCases" set "stateId" = $1, "reviewedById" = $2 where "id" = $3`,
        [reviewed, "someone-else", caseId]
      );
      expect((await reviewer()).id).toBe("someone-else");
    });
  });

  it("leaves the case as it was", async () => {
    const { rows } = await client.query<{ stateId: number }>(
      `select "stateId" from "RepositoryCases" where "id" = $1`,
      [caseId]
    );
    expect(rows[0].stateId).toBe(originalStateId);
  });
});
