/**
 * Live-DB proof that every hooked-client change to `RepositoryCases.automated`
 * lands a version snapshot — the thing Automation Trends actually reads.
 *
 * The mocked plugin test (sideEffectsPlugin.automatedFlip.test.ts) proves the
 * routing; what it cannot prove is that the nested bump + snapshot really run
 * inside the mutation's transaction, through the plugin-free client, under
 * the policy client as well as the base one, and that the snapshot carries
 * the case's field values. Those are exactly the properties the reporter
 * SDK's `updateTestCase` RPC and the JUnit import's match branches rely on.
 *
 * Run:
 *   cd testplanit && DATABASE_URL=<scratch URL> RUN_DB_INTEGRATION=1 \
 *     pnpm exec vitest run __tests__/integration/automated-flip-version.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { baseDb } from "~/lib/db";
import { createRawDbClient } from "~/lib/rawDbClient";
import { createTestCaseVersionInTransaction } from "~/lib/services/testCaseVersionService";
import { getAuthDb } from "~/lib/zenstack";
import { automatedStateAt } from "~/utils/automationTrendsUtils";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const raw = createRawDbClient();
const STAMP = `afv-${Date.now()}`;

describeIntegration("automated flag version snapshots (live DB)", () => {
  let admin: { id: string; email: string; access: string };
  let projectId: number;
  let repositoryId: number;
  let folderId: number;
  let templateId: number;
  let stateId: number;
  let priorityFieldId: number;
  let priorityOptionId: number;
  const createdCaseIds: number[] = [];

  beforeAll(async () => {
    const [{ current_database: dbName }] = await raw.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (dbName !== "tpi_caseversions" && dbName !== "tpi_test") {
      throw new Error(
        `refusing to run against database "${dbName}" — use the tpi_caseversions scratch DB (or tpi_test in CI)`
      );
    }

    const adminRow = await raw.user.findFirst({ where: { access: "ADMIN" } });
    if (!adminRow)
      throw new Error("Test prerequisite: no ADMIN user (run db/seed.ts)");
    admin = adminRow as typeof admin;

    const template = await raw.templates.findUnique({
      where: { templateName: "Default Template" },
    });
    if (!template)
      throw new Error(
        "Test prerequisite: no Default Template (run db/seed.ts)"
      );
    templateId = template.id;

    const priority = await raw.caseFields.findUnique({
      where: { systemName: "priority" },
    });
    if (!priority)
      throw new Error("Test prerequisite: no priority case field (db/seed.ts)");
    priorityFieldId = priority.id;
    const high = await raw.fieldOptions.findFirst({ where: { name: "High" } });
    if (!high)
      throw new Error(
        "Test prerequisite: no High priority option (db/seed.ts)"
      );
    priorityOptionId = high.id;

    const project = await raw.projects.findFirst({
      where: { isDeleted: false },
    });
    if (!project) throw new Error("Test prerequisite: no seeded project");
    projectId = project.id;

    const repository = await raw.repositories.findFirst({
      where: { projectId, isActive: true, isDeleted: false },
    });
    if (!repository) throw new Error("Test prerequisite: no active repository");
    repositoryId = repository.id;

    const folder = await raw.repositoryFolders.findFirst({
      where: { projectId, isDeleted: false },
    });
    if (!folder) throw new Error("Test prerequisite: no repository folder");
    folderId = folder.id;

    const state = await raw.workflows.findFirst({
      where: { scope: "CASES", isEnabled: true, isDeleted: false },
      orderBy: { order: "asc" },
    });
    if (!state) throw new Error("Test prerequisite: no CASES workflow state");
    stateId = state.id;
  });

  afterAll(async () => {
    for (const caseId of createdCaseIds) {
      const versions = await raw.repositoryCaseVersions.findMany({
        where: { repositoryCaseId: caseId },
        select: { id: true },
      });
      for (const v of versions) {
        await raw.caseFieldVersionValues.deleteMany({
          where: { versionId: v.id },
        });
      }
      await raw.repositoryCaseVersions.deleteMany({
        where: { repositoryCaseId: caseId },
      });
      await raw.caseFieldValues.deleteMany({ where: { testCaseId: caseId } });
      await raw.repositoryCases.deleteMany({ where: { id: caseId } });
    }
    await raw.$disconnect();
  });

  /** A manual case with version 1 and a Priority value, the way AddCase leaves it. */
  async function createManualCase(name: string): Promise<number> {
    const created = await raw.repositoryCases.create({
      data: {
        projectId,
        repositoryId,
        folderId,
        templateId,
        stateId,
        name: `${STAMP} ${name}`,
        automated: false,
        creatorId: admin.id,
        source: "MANUAL",
      },
    });
    createdCaseIds.push(created.id);
    await raw.caseFieldValues.create({
      data: {
        testCaseId: created.id,
        fieldId: priorityFieldId,
        value: priorityOptionId,
      },
    });
    await createTestCaseVersionInTransaction(raw, created.id, {
      copyFieldValues: true,
    });
    return created.id;
  }

  async function versionsOf(caseId: number) {
    return raw.repositoryCaseVersions.findMany({
      where: { repositoryCaseId: caseId },
      orderBy: { version: "asc" },
      select: {
        id: true,
        version: true,
        automated: true,
        createdAt: true,
        creatorId: true,
        caseFieldVersionValues: { select: { field: true, value: true } },
      },
    });
  }

  async function currentVersionOf(caseId: number) {
    const row = await raw.repositoryCases.findUnique({
      where: { id: caseId },
      select: { currentVersion: true, automated: true },
    });
    return row!;
  }

  it("a flag-only RPC-style update through the base client snapshots the flip with field values", async () => {
    const caseId = await createManualCase("base-client flip");

    await baseDb.repositoryCases.update({
      where: { id: caseId },
      data: { automated: true },
    });

    const versions = await versionsOf(caseId);
    expect(versions.map((v) => [v.version, v.automated])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(await currentVersionOf(caseId)).toEqual({
      currentVersion: 2,
      automated: true,
    });
    // copyFieldValues: the flip snapshot carries Priority, not "deleted".
    expect(versions[1].caseFieldVersionValues).toEqual([
      { field: "Priority", value: priorityOptionId },
    ]);
    expect(versions[1].creatorId).toBe(admin.id);
  });

  it("the same update again is a no-op for versions", async () => {
    const caseId = await createManualCase("idempotent");
    await baseDb.repositoryCases.update({
      where: { id: caseId },
      data: { automated: true },
    });
    await baseDb.repositoryCases.update({
      where: { id: caseId },
      data: { automated: true, isArchived: false },
    });
    expect((await versionsOf(caseId)).length).toBe(2);
    expect((await currentVersionOf(caseId)).currentVersion).toBe(2);
  });

  it("a revert through the policy client (the /api/model path) snapshots too", async () => {
    const caseId = await createManualCase("policy revert");
    const db = await getAuthDb(admin as never);

    await db.repositoryCases.update({
      where: { id: caseId },
      data: { automated: true },
    });
    await db.repositoryCases.update({
      where: { id: caseId },
      data: { automated: false },
    });

    const versions = await versionsOf(caseId);
    expect(versions.map((v) => [v.version, v.automated])).toEqual([
      [1, false],
      [2, true],
      [3, false],
    ]);
    expect((await currentVersionOf(caseId)).currentVersion).toBe(3);
  });

  it("a caller that bumps currentVersion in the same write gets no extra snapshot", async () => {
    const caseId = await createManualCase("caller snapshots");

    // What submit-result and the Testmo import do: bump, then snapshot.
    await baseDb.$transaction(async (tx) => {
      await tx.repositoryCases.update({
        where: { id: caseId },
        data: { automated: true, currentVersion: { increment: 1 } },
      });
      await createTestCaseVersionInTransaction(tx, caseId, {
        copyFieldValues: true,
      });
    });

    const versions = await versionsOf(caseId);
    expect(versions.map((v) => [v.version, v.automated])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect((await currentVersionOf(caseId)).currentVersion).toBe(2);
  });

  it("the JUnit import's match-branch write inside a transaction snapshots once, in that transaction", async () => {
    const caseId = await createManualCase("junit match");

    await baseDb.$transaction(async (tx) => {
      await tx.repositoryCases.update({
        where: { id: caseId },
        data: { automated: true, isDeleted: false, isArchived: false },
      });
      // Visible before commit: the hook ran on this transaction.
      const inTx = await tx.repositoryCaseVersions.count({
        where: { repositoryCaseId: caseId },
      });
      expect(inTx).toBe(2);
    });

    expect((await versionsOf(caseId)).length).toBe(2);
  });

  it("updateMany snapshots every case whose flag flipped and none that did not", async () => {
    const flipA = await createManualCase("many A");
    const flipB = await createManualCase("many B");
    const already = await createManualCase("many already");
    await baseDb.repositoryCases.update({
      where: { id: already },
      data: { automated: true },
    });

    await baseDb.repositoryCases.updateMany({
      where: { id: { in: [flipA, flipB, already] } },
      data: { automated: true },
    });

    expect((await versionsOf(flipA)).length).toBe(2);
    expect((await versionsOf(flipB)).length).toBe(2);
    expect((await versionsOf(already)).length).toBe(2);
  });

  it("Automation Trends counts the case as automated from the flip onward", async () => {
    const caseId = await createManualCase("trends");
    const beforeFlip = Date.now();
    await baseDb.repositoryCases.update({
      where: { id: caseId },
      data: { automated: true },
    });

    // Same timeline construction as handleAutomationTrendsPOST.
    const history = (await versionsOf(caseId)).map((v) => ({
      at: v.createdAt.getTime(),
      automated: v.automated,
    }));
    history.sort((a, b) => a.at - b.at);

    expect(automatedStateAt(history, Date.now() + 1000)).toEqual({
      existed: true,
      automated: true,
    });
    expect(automatedStateAt(history, beforeFlip - 1)).toEqual({
      existed: true,
      automated: false,
    });
  });
});
