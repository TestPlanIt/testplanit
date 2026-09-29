/**
 * Live-DB proof for the write paths API clients (the MCP server, the REST
 * bulk-create route) use, where the web UI goes another way.
 *
 * Each case below was a bug that mocked tests passed: they asserted the
 * payload the client sent, not what the real ORM and Postgres did with it.
 * So these tests send the same payloads through the real clients and read
 * the rows back from Postgres.
 *
 * Run:
 *   cd testplanit && DATABASE_URL=<scratch URL> RUN_DB_INTEGRATION=1 \
 *     pnpm exec vitest run __tests__/integration/api-write-paths.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { tryFastPathCreate } from "~/lib/access-fast-path";
import { injectUserFields } from "~/lib/api/injectUserFields";
import { baseDb } from "~/lib/db";
import { getAuthDb } from "~/lib/zenstack";
import { createRawDbClient } from "~/lib/rawDbClient";
import { loadTemplateData } from "~/lib/services/jira-panel-generation";
import { createSessionVersionInTransaction } from "~/lib/services/sessionVersionService";
import { persistGeneratedTestCases } from "~/lib/services/testCaseImport";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const raw = createRawDbClient();
const STAMP = `awp-${Date.now()}`;

describeIntegration("API write paths (live DB)", () => {
  let userId: string;
  let projectId: number;
  let repositoryId: number;
  let folderId: number;
  let stateId: number;
  let templateId: number;
  let milestoneTypeId: number;
  const caseIds: number[] = [];
  const folderIds: number[] = [];
  const issueIds: number[] = [];
  const milestoneIds: number[] = [];

  beforeAll(async () => {
    // The worktree .env DATABASE_URL resolves to `ew`; this suite creates and
    // hard-deletes fixtures, so refuse anything but a scratch database.
    const [{ current_database: dbName }] = await raw.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (dbName !== "tpi_caseversions" && dbName !== "tpi_test") {
      throw new Error(
        `refusing to run against database "${dbName}" — use the tpi_caseversions scratch DB (or tpi_test in CI)`
      );
    }

    const admin = await raw.user.findFirst({ where: { access: "ADMIN" } });
    if (!admin) throw new Error("Test prerequisite: no ADMIN user");
    userId = admin.id;

    const project = await raw.projects.findFirst({
      where: { isDeleted: false },
    });
    if (!project) throw new Error("Test prerequisite: no seeded project");
    projectId = project.id;

    const repository = await raw.repositories.findFirst({
      where: { projectId, isActive: true, isDeleted: false },
    });
    if (!repository) throw new Error("Test prerequisite: no repository");
    repositoryId = repository.id;

    const folder = await raw.repositoryFolders.findFirst({
      where: { projectId, isDeleted: false },
    });
    if (!folder) throw new Error("Test prerequisite: no folder");
    folderId = folder.id;

    const state = await raw.workflows.findFirst({
      where: { scope: "CASES", isEnabled: true, isDeleted: false },
      orderBy: { order: "asc" },
    });
    if (!state) throw new Error("Test prerequisite: no CASES state");
    stateId = state.id;

    const template = await raw.templates.findUnique({
      where: { templateName: "Default Template" },
    });
    if (!template) throw new Error("Test prerequisite: no Default Template");
    templateId = template.id;

    const milestoneType = await raw.milestoneTypes.findFirst({});
    if (!milestoneType) throw new Error("Test prerequisite: no milestone type");
    milestoneTypeId = milestoneType.id;
  });

  afterAll(async () => {
    for (const caseId of caseIds) {
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
      await raw.steps.deleteMany({ where: { testCaseId: caseId } });
      await raw.repositoryCaseTag.deleteMany({ where: { caseId } });
      await raw.repositoryCaseIssue.deleteMany({ where: { caseId } });
    }
    await raw.repositoryCases.deleteMany({ where: { id: { in: caseIds } } });
    await raw.issue.deleteMany({ where: { id: { in: issueIds } } });
    await raw.milestones.deleteMany({ where: { id: { in: milestoneIds } } });
    // Children first: parentId has no cascade.
    for (const id of [...folderIds].reverse()) {
      await raw.repositoryFolders.deleteMany({ where: { id } });
    }
    await raw.$disconnect();
  });

  async function createCase(name: string): Promise<number> {
    const created = await raw.repositoryCases.create({
      data: {
        projectId,
        repositoryId,
        folderId,
        templateId,
        stateId,
        name,
        creatorId: userId,
      },
      select: { id: true },
    });
    caseIds.push(created.id);
    return created.id;
  }

  async function createFolder(
    name: string,
    parentId: number | null,
    isDeleted = false
  ): Promise<number> {
    const created = await raw.repositoryFolders.create({
      data: {
        name,
        projectId,
        repositoryId,
        parentId,
        creatorId: userId,
        isDeleted,
      },
      select: { id: true },
    });
    folderIds.push(created.id);
    return created.id;
  }

  describe("issue links on test cases", () => {
    it("links, lists and unlinks through the RepositoryCaseIssue join", async () => {
      const caseId = await createCase(`${STAMP}-linked`);
      const issue = await raw.issue.create({
        data: {
          name: `${STAMP}-BUG`,
          title: "A bug",
          projectId,
          createdById: userId,
        },
        select: { id: true },
      });
      issueIds.push(issue.id);

      // The MCP `issues_link` payload, sent twice: a repeat link is a no-op.
      for (let i = 0; i < 2; i++) {
        await baseDb.repositoryCaseIssue.createMany({
          data: [{ issueId: issue.id, caseId }],
          skipDuplicates: true,
        });
      }

      // `issues_list_links` in both directions.
      const cases = await baseDb.repositoryCases.findMany({
        where: {
          isDeleted: false,
          caseIssues: { some: { issue: { id: issue.id, isDeleted: false } } },
        },
        select: { id: true },
      });
      expect(cases.map((c) => c.id)).toEqual([caseId]);
      const issues = await baseDb.issue.findMany({
        where: {
          isDeleted: false,
          caseIssues: { some: { case: { id: caseId, isDeleted: false } } },
        },
        select: { id: true },
      });
      expect(issues.map((i) => i.id)).toEqual([issue.id]);

      // `issues_unlink`.
      await baseDb.repositoryCaseIssue.deleteMany({
        where: { issueId: issue.id, caseId: { in: [caseId] } },
      });
      expect(await raw.repositoryCaseIssue.count({ where: { caseId } })).toBe(
        0
      );
    });

    it("rejects the relation the tool used to send", async () => {
      const caseId = await createCase(`${STAMP}-old-shape`);
      const issue = await raw.issue.create({
        data: {
          name: `${STAMP}-OLD`,
          title: "x",
          projectId,
          createdById: userId,
        },
        select: { id: true },
      });
      issueIds.push(issue.id);

      await expect(
        baseDb.issue.update({
          where: { id: issue.id },
          data: { repositoryCases: { connect: [{ id: caseId }] } } as never,
        })
      ).rejects.toThrow();
    });
  });

  describe("milestone creator", () => {
    it("creates a milestone when the client leaves the creator out", async () => {
      const body = injectUserFields(
        "milestones",
        "create",
        {
          data: {
            name: `${STAMP}-milestone`,
            project: { connect: { id: projectId } },
            milestoneType: { connect: { id: milestoneTypeId } },
          },
        },
        userId
      );
      const created = await baseDb.milestones.create({
        ...body,
        select: { id: true, createdBy: true },
      });
      milestoneIds.push(created.id);
      expect(created.createdBy).toBe(userId);
    });
  });

  describe("bulk import transaction", () => {
    const input = (names: string[], badTagFor?: string) => ({
      projectId,
      projectName: "Project",
      repositoryId,
      folderId,
      folderName: "Folder",
      templateId,
      templateName: "Default Template",
      stateId,
      stateName: "Draft",
      maxOrder: 0,
      autoGenerateTags: false,
      source: "MANUAL" as const,
      fieldMappings: [],
      testCases: names.map((name) => ({
        id: name,
        name,
        fieldValues: {},
        // A tag id with no row fails the join insert with an FK violation.
        ...(name === badTagFor ? { tagIds: [2_000_000_000] } : {}),
      })),
    });

    async function persistedIds(names: string[]): Promise<number[]> {
      const rows = await raw.repositoryCases.findMany({
        where: { projectId, name: { in: names }, isDeleted: false },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    }

    it("keeps the other cases when one fails", async () => {
      const names = ["A", "B", "C"].map((n) => `${STAMP}-${n}`);
      const result = await persistGeneratedTestCases(input(names, names[1]), {
        userId,
        userName: "Integration Runner",
      });
      const ids = await persistedIds(names);
      caseIds.push(...ids);

      expect(result.results.map((r) => r.status)).toEqual([
        "success",
        "error",
        "success",
      ]);
      // Every case reported as created exists; the failed one left nothing.
      const reported = result.results
        .filter((r) => r.status === "success")
        .map((r) => r.caseId);
      expect(ids.sort()).toEqual((reported as number[]).sort());
    });

    it("creates a new case when a deleted case has the same name", async () => {
      const name = `${STAMP}-reused`;
      const first = await persistGeneratedTestCases(input([name]), {
        userId,
        userName: "Integration Runner",
      });
      const firstId = first.results[0].caseId as number;
      caseIds.push(firstId);
      await raw.repositoryCases.update({
        where: { id: firstId },
        data: { isDeleted: true },
      });

      const second = await persistGeneratedTestCases(input([name]), {
        userId,
        userName: "Integration Runner",
      });
      expect(second.results[0].status).toBe("success");
      const secondId = second.results[0].caseId as number;
      caseIds.push(secondId);
      expect(secondId).not.toBe(firstId);
    });
  });

  describe("custom field values from API writers", () => {
    it("stores values in the web UI's shapes, from the real template", async () => {
      const loaded = await loadTemplateData(templateId);
      if (!loaded) throw new Error("Default Template did not load");
      // Steps are never a field value; the filter is by type, not by name.
      expect(loaded.fieldMappings.some((m) => m.fieldType === "Steps")).toBe(
        false
      );

      const name = `${STAMP}-fields`;
      const result = await persistGeneratedTestCases(
        {
          projectId,
          projectName: "Project",
          repositoryId,
          folderId,
          folderName: "Folder",
          templateId,
          templateName: loaded.template.name,
          stateId,
          stateName: "Draft",
          maxOrder: 0,
          autoGenerateTags: false,
          source: "MANUAL",
          strictFieldValues: true,
          fieldMappings: loaded.fieldMappings,
          testCases: [
            {
              id: name,
              name,
              fieldValues: { Priority: " high ", Description: "Use **care**" },
            },
          ],
        },
        { userId, userName: "Integration Runner" }
      );
      expect(result.results[0].status).toBe("success");
      const caseId = result.results[0].caseId as number;
      caseIds.push(caseId);

      const rows = await raw.$queryRawUnsafe<
        Array<{ name: string; shape: string; value: unknown }>
      >(
        `SELECT f."displayName" AS name, jsonb_typeof(v.value) AS shape, v.value
           FROM "CaseFieldValues" v JOIN "CaseFields" f ON f.id = v."fieldId"
          WHERE v."testCaseId" = $1`,
        caseId
      );
      const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
      const high = await raw.fieldOptions.findFirst({
        where: { name: "High" },
      });
      expect(byName.Priority).toMatchObject({
        shape: "number",
        value: high?.id,
      });
      expect(byName.Description.shape).toBe("string");
      expect(byName.Description.value as string).toContain('"bold"');
    });

    it("fails only the case whose value the field cannot hold", async () => {
      const loaded = await loadTemplateData(templateId);
      const names = [`${STAMP}-bad-priority`, `${STAMP}-ok-priority`];
      const result = await persistGeneratedTestCases(
        {
          projectId,
          projectName: "Project",
          repositoryId,
          folderId,
          folderName: "Folder",
          templateId,
          templateName: "Default Template",
          stateId,
          stateName: "Draft",
          maxOrder: 0,
          autoGenerateTags: false,
          source: "MANUAL",
          strictFieldValues: true,
          fieldMappings: loaded!.fieldMappings,
          testCases: [
            { id: "a", name: names[0], fieldValues: { Priority: "Urgent" } },
            { id: "b", name: names[1], fieldValues: { Priority: "Low" } },
          ],
        },
        { userId, userName: "Integration Runner" }
      );
      caseIds.push(
        ...result.results
          .filter((r) => r.caseId != null)
          .map((r) => r.caseId as number)
      );
      expect(result.results.map((r) => r.status)).toEqual(["error", "success"]);
      expect(result.results[0].error).toMatch(/Priority/);
      expect(
        await raw.repositoryCases.count({ where: { name: names[0] } })
      ).toBe(0);
    });
  });

  describe("restricted custom fields", () => {
    it("lets a user re-save a restricted value but not change it without permission", async () => {
      const textString = await raw.caseFieldTypes.findFirst({
        where: { type: "Text String" },
        select: { id: true },
      });
      const field = await raw.caseFields.create({
        data: {
          displayName: `${STAMP} secret`,
          systemName: `${STAMP.replace(/-/g, "_")}_secret`,
          typeId: textString!.id,
          isRestricted: true,
        },
        select: { id: true },
      });
      // Add/edit on the repository, nothing on restricted fields.
      const role = await raw.roles.create({
        data: {
          name: `${STAMP}-editor`,
          rolePermissions: {
            create: [{ area: "TestCaseRepository", canAddEdit: true }],
          },
        },
        include: { rolePermissions: true },
      });
      const editor = await raw.user.create({
        data: {
          email: `${STAMP}-editor@example.com`,
          name: "Editor",
          authMethod: "INTERNAL",
          access: "USER",
          accessSource: "MANUAL",
          roleId: role.id,
          password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
        },
        select: { id: true },
      });
      await raw.userProjectPermission.create({
        data: {
          userId: editor.id,
          projectId,
          accessType: "SPECIFIC_ROLE",
          roleId: role.id,
        },
      });
      const caseId = await createCase(`${STAMP}-restricted`);
      const value = await raw.caseFieldValues.create({
        data: { testCaseId: caseId, fieldId: field.id, value: "original" },
        select: { id: true },
      });

      try {
        const asEditor = await getAuthDb({
          id: editor.id,
          access: "USER",
          roleId: role.id,
          role: {
            id: role.id,
            name: role.name,
            rolePermissions: role.rolePermissions,
          },
        } as never);

        // The web UI re-saves every field, restricted ones included.
        await asEditor.caseFieldValues.update({
          where: { id: value.id },
          data: { value: "original" },
        });
        await expect(
          asEditor.caseFieldValues.update({
            where: { id: value.id },
            data: { value: "changed" },
          })
        ).rejects.toThrow(/restricted/);

        const stored = await raw.caseFieldValues.findUnique({
          where: { id: value.id },
          select: { value: true },
        });
        expect(stored?.value).toBe("original");
      } finally {
        await raw.caseFieldValues.deleteMany({ where: { id: value.id } });
        await raw.userProjectPermission.deleteMany({
          where: { userId: editor.id },
        });
        await raw.user.deleteMany({ where: { id: editor.id } });
        await raw.rolePermission.deleteMany({ where: { roleId: role.id } });
        await raw.roles.deleteMany({ where: { id: role.id } });
        await raw.caseFields.deleteMany({ where: { id: field.id } });
      }
    });
  });

  describe("session versions", () => {
    it("snapshots a session, then a bumped edit, from the database", async () => {
      const state = await raw.workflows.findFirst({
        where: { scope: "SESSIONS", isEnabled: true, isDeleted: false },
        select: { id: true, name: true },
      });
      if (!state) throw new Error("Test prerequisite: no SESSIONS state");
      const tag = await raw.tags.create({
        data: { name: `${STAMP}-session-tag` },
        select: { id: true },
      });
      const session = await raw.sessions.create({
        data: {
          name: `${STAMP}-session`,
          projectId,
          templateId,
          stateId: state.id,
          createdById: userId,
          tags: { connect: [{ id: tag.id }] },
        },
        select: { id: true },
      });

      try {
        const v1 = await baseDb.$transaction((tx) =>
          createSessionVersionInTransaction(tx as never, session.id, {
            actor: { id: userId, name: "Integration Runner" },
          })
        );
        expect(v1.version).toBe(1);

        await raw.sessions.update({
          where: { id: session.id },
          data: { name: `${STAMP}-session-renamed` },
        });
        const v2 = await baseDb.$transaction((tx) =>
          createSessionVersionInTransaction(tx as never, session.id, {
            bumpVersion: true,
            actor: { id: userId, name: "Integration Runner" },
          })
        );
        expect(v2.version).toBe(2);

        const rows = await raw.sessionVersions.findMany({
          where: { sessionId: session.id },
          orderBy: { version: "asc" },
          select: {
            version: true,
            name: true,
            stateName: true,
            templateName: true,
            tags: true,
          },
        });
        expect(rows.map((r) => [r.version, r.name])).toEqual([
          [1, `${STAMP}-session`],
          [2, `${STAMP}-session-renamed`],
        ]);
        expect(rows[0].stateName).toBe(state.name);
        expect(rows[0].templateName).toBe("Default Template");
        expect(JSON.parse(rows[0].tags as string)).toEqual([
          { id: tag.id, name: `${STAMP}-session-tag` },
        ]);
        const current = await raw.sessions.findUnique({
          where: { id: session.id },
          select: { currentVersion: true },
        });
        expect(current?.currentVersion).toBe(2);
      } finally {
        await raw.sessionVersions.deleteMany({
          where: { sessionId: session.id },
        });
        await raw.sessions.deleteMany({ where: { id: session.id } });
        await raw.tags.deleteMany({ where: { id: tag.id } });
      }
    });
  });

  describe("folder parents", () => {
    it("rejects a move into the folder's own subtree and allows a real move", async () => {
      const top = await createFolder(`${STAMP}-top`, null);
      const child = await createFolder(`${STAMP}-child`, top);
      const other = await createFolder(`${STAMP}-other`, null);

      await expect(
        baseDb.repositoryFolders.update({
          where: { id: top },
          data: { parent: { connect: { id: child } } },
        })
      ).rejects.toThrow(/itself or one of its subfolders/);

      await baseDb.repositoryFolders.update({
        where: { id: child },
        data: { parentId: other },
      });
      const moved = await raw.repositoryFolders.findUnique({
        where: { id: child },
        select: { parentId: true },
      });
      expect(moved?.parentId).toBe(other);
    });

    it("rejects a deleted parent", async () => {
      const gone = await createFolder(`${STAMP}-gone`, null, true);
      const folder = await createFolder(`${STAMP}-orphan`, null);
      await expect(
        baseDb.repositoryFolders.update({
          where: { id: folder },
          data: { parentId: gone },
        })
      ).rejects.toThrow(/does not exist/);
    });
  });

  describe("model route create fast path", () => {
    it("converts Markdown step text written through a testCase connect", async () => {
      const caseId = await createCase(`${STAMP}-fast-steps`);
      const res = await tryFastPathCreate({
        parsedPath: { model: "steps", operation: "create" },
        requestBody: {
          data: {
            testCase: { connect: { id: caseId } },
            order: 0,
            step: "Open the **New leads** board",
          },
        },
        userId,
      });
      expect(res?.status).toBe(201);

      const [row] = await raw.$queryRawUnsafe<
        Array<{ shape: string; bold: unknown }>
      >(
        `SELECT jsonb_typeof(step) AS shape,
                step #> '{content,0,content,1,marks}' AS bold
           FROM "Steps" WHERE "testCaseId" = $1`,
        caseId
      );
      expect(row.shape).toBe("object");
      expect(row.bold).toEqual([{ type: "bold" }]);
    });

    it("rejects a new folder under a deleted parent", async () => {
      const gone = await createFolder(`${STAMP}-fast-gone`, null, true);
      const res = await tryFastPathCreate({
        parsedPath: { model: "repositoryFolders", operation: "create" },
        requestBody: {
          data: {
            name: `${STAMP}-fast-child`,
            project: { connect: { id: projectId } },
            repository: { connect: { id: repositoryId } },
            parent: { connect: { id: gone } },
            creator: { connect: { id: userId } },
          },
        },
        userId,
      });
      expect(res?.status).toBe(422);
    });
  });
});
