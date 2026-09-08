/**
 * Live-DB integration test for project *default access* propagation to
 * project-scoped child models (RepositoryCases here as the representative).
 *
 * Background: the `Projects` model grants read to any non-NONE user when the
 * project sets a default access type ("default access for all users, not just
 * assigned"). That same path must hold on the child models — otherwise a user
 * who can SEE a project (via its default access) cannot open its test-case
 * repository. A customer hit exactly this with a project whose default access
 * was a "Read-only" role (defaultAccessType = SPECIFIC_ROLE, defaultRole set)
 * and a user with no explicit/group permission and no assignment.
 *
 * These ACL rules compile to SQL and are only truly enforced at runtime by the
 * enhanced (policy-applying) client — a mocked Prisma cannot catch a regression
 * here. So this test drives the REAL `getEnhancedDb` client against the test DB.
 *
 * Execution model:
 *   - Skipped by default. Opt-in with `RUN_DB_INTEGRATION=1`.
 *   - Requires DATABASE_URL pointing at a development/test database that has
 *     been seeded (needs at least one Workflows + Templates row).
 *   - Creates committed fixtures in `beforeAll` and removes them in `afterAll`.
 *     The rollback-in-a-transaction trick does NOT work here: `getEnhancedDb`
 *     resolves the acting user via the OUTER baseDb client, which cannot see an
 *     uncommitted transactional user.
 *
 * The "fix" cases (allowed reads/writes via SPECIFIC_ROLE/DEFAULT defaults) fail
 * before the schema fix and pass after it. The "guard" cases (NONE tier,
 * explicit NO_ACCESS, null default role, read-only role) must hold either way.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);

const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration(
  "project default access → RepositoryCases (live DB)",
  () => {
    const importDeps = async () => {
      const { baseDb } = await import("~/lib/db");
      const { getEnhancedDb } = await import("~/lib/auth/utils");
      return { baseDb, getEnhancedDb };
    };

    interface SeedCtx {
      // Projects keyed by the default-access scenario they exercise.
      pReadOnly: number; // SPECIFIC_ROLE, defaultRole has NO canAddEdit
      pEditor: number; // SPECIFIC_ROLE, defaultRole HAS canAddEdit
      pDefault: number; // DEFAULT access type, no default role
      pNullRole: number; // SPECIFIC_ROLE but defaultRole is null
      pNoAccess: number; // like pReadOnly, but uUser has explicit NO_ACCESS
      caseReadOnly: number;
      caseEditor: number;
      caseDefault: number;
      caseNullRole: number;
      caseNoAccess: number;
      uUser: string; // access USER, no project grant, not a creator
      uNone: string; // access NONE
      // cleanup bookkeeping
      projectIds: number[];
      roleIds: number[];
      userIds: string[];
    }

    let ctx: SeedCtx;

    async function seed(baseDb: any): Promise<SeedCtx> {
      const wf = await baseDb.workflows.findFirst({ select: { id: true } });
      if (!wf) throw new Error("Seed the DB first (no Workflows row)");
      const tpl = await baseDb.templates.findFirst({ select: { id: true } });
      if (!tpl) throw new Error("Seed the DB first (no Templates row)");

      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Role WITHOUT repository edit permission ("Read-only"-style default).
      const roleReadOnly = await baseDb.roles.create({
        data: {
          name: `PDA-ReadOnly-${stamp}`,
          rolePermissions: {
            create: { area: "TestCaseRepository", canAddEdit: false },
          },
        },
        select: { id: true },
      });
      // Role WITH repository edit permission ("Editor"-style default).
      const roleEditor = await baseDb.roles.create({
        data: {
          name: `PDA-Editor-${stamp}`,
          rolePermissions: {
            create: { area: "TestCaseRepository", canAddEdit: true },
          },
        },
        select: { id: true },
      });

      // Project owner — distinct from the test users so they are never creators
      // (which would grant access independently of default-access rules).
      const owner = await baseDb.user.create({
        data: {
          name: `PDA-Owner-${stamp}`,
          email: `pda-owner-${stamp}@example.com`,
          access: "USER",
          roleId: roleReadOnly.id,
        },
        select: { id: true },
      });
      // The user under test: USER tier, a global role that has NO bearing on
      // SPECIFIC_ROLE/DEFAULT default access, no assignment, no explicit grant.
      const uUser = await baseDb.user.create({
        data: {
          name: `PDA-User-${stamp}`,
          email: `pda-user-${stamp}@example.com`,
          access: "USER",
          roleId: roleReadOnly.id,
        },
        select: { id: true },
      });
      // NONE-tier user — must be denied everywhere.
      const uNone = await baseDb.user.create({
        data: {
          name: `PDA-None-${stamp}`,
          email: `pda-none-${stamp}@example.com`,
          access: "NONE",
          roleId: roleReadOnly.id,
        },
        select: { id: true },
      });

      async function setupProject(
        prefix: string,
        defaultAccessType: string,
        defaultRoleId: number | null
      ): Promise<{ projectId: number; caseId: number }> {
        const project = await baseDb.projects.create({
          data: {
            name: `${prefix}-${stamp}`,
            createdBy: owner.id,
            defaultAccessType,
            defaultRoleId,
          },
          select: { id: true },
        });
        const repo = await baseDb.repositories.create({
          data: { projectId: project.id },
          select: { id: true },
        });
        const folder = await baseDb.repositoryFolders.create({
          data: {
            name: `f-${stamp}`,
            repositoryId: repo.id,
            projectId: project.id,
            creatorId: owner.id,
          },
          select: { id: true },
        });
        const c = await baseDb.repositoryCases.create({
          data: {
            projectId: project.id,
            repositoryId: repo.id,
            folderId: folder.id,
            templateId: tpl.id,
            name: `${prefix}-Case`,
            stateId: wf.id,
            creatorId: owner.id,
            hasParameters: false,
          },
          select: { id: true },
        });
        return { projectId: project.id, caseId: c.id };
      }

      const pReadOnly = await setupProject(
        "PDA-ReadOnly",
        "SPECIFIC_ROLE",
        roleReadOnly.id
      );
      const pEditor = await setupProject(
        "PDA-Editor",
        "SPECIFIC_ROLE",
        roleEditor.id
      );
      const pDefault = await setupProject("PDA-Default", "DEFAULT", null);
      const pNullRole = await setupProject(
        "PDA-NullRole",
        "SPECIFIC_ROLE",
        null
      );
      const pNoAccess = await setupProject(
        "PDA-NoAccess",
        "SPECIFIC_ROLE",
        roleReadOnly.id
      );

      // Explicit NO_ACCESS for uUser on pNoAccess — must override default access.
      await baseDb.userProjectPermission.create({
        data: {
          projectId: pNoAccess.projectId,
          userId: uUser.id,
          accessType: "NO_ACCESS",
        },
      });

      return {
        pReadOnly: pReadOnly.projectId,
        pEditor: pEditor.projectId,
        pDefault: pDefault.projectId,
        pNullRole: pNullRole.projectId,
        pNoAccess: pNoAccess.projectId,
        caseReadOnly: pReadOnly.caseId,
        caseEditor: pEditor.caseId,
        caseDefault: pDefault.caseId,
        caseNullRole: pNullRole.caseId,
        caseNoAccess: pNoAccess.caseId,
        uUser: uUser.id,
        uNone: uNone.id,
        projectIds: [
          pReadOnly.projectId,
          pEditor.projectId,
          pDefault.projectId,
          pNullRole.projectId,
          pNoAccess.projectId,
        ],
        roleIds: [roleReadOnly.id, roleEditor.id],
        userIds: [owner.id, uUser.id, uNone.id],
      };
    }

    async function cleanup(baseDb: any, c: SeedCtx) {
      try {
        await baseDb.repositoryCases.deleteMany({
          where: { projectId: { in: c.projectIds } },
        });
        await baseDb.repositoryFolders.deleteMany({
          where: { projectId: { in: c.projectIds } },
        });
        await baseDb.repositories.deleteMany({
          where: { projectId: { in: c.projectIds } },
        });
        await baseDb.userProjectPermission.deleteMany({
          where: { projectId: { in: c.projectIds } },
        });
        await baseDb.projects.deleteMany({
          where: { id: { in: c.projectIds } },
        });
        // Users (FK from Projects.createdBy) and RolePermission/Roles last.
        await baseDb.user.deleteMany({ where: { id: { in: c.userIds } } });
        await baseDb.rolePermission.deleteMany({
          where: { roleId: { in: c.roleIds } },
        });
        await baseDb.roles.deleteMany({ where: { id: { in: c.roleIds } } });
      } catch (err) {
        console.warn("[project default access integration cleanup]", err);
      }
    }

    // Build the real, policy-applying client for a given acting user.
    let edbUser: any;
    let edbNone: any;

    beforeAll(async () => {
      const { baseDb, getEnhancedDb } = await importDeps();
      ctx = await seed(baseDb);
      edbUser = await getEnhancedDb({ user: { id: ctx.uUser } } as any);
      edbNone = await getEnhancedDb({ user: { id: ctx.uNone } } as any);
    });

    afterAll(async () => {
      if (RUN_INTEGRATION && HAS_DB_URL) {
        const { baseDb } = await import("~/lib/db");
        if (ctx) await cleanup(baseDb, ctx);
        await baseDb.$disconnect();
      }
    });

    // ---- The fix: default access reaches the repository ----

    it("[fix] SPECIFIC_ROLE default + non-assigned USER → CAN read the case", async () => {
      const found = await edbUser.repositoryCases.findUnique({
        where: { id: ctx.caseReadOnly },
        select: { id: true },
      });
      expect(found?.id).toBe(ctx.caseReadOnly);
    });

    it("[fix] DEFAULT access type + non-assigned USER → CAN read the case", async () => {
      const found = await edbUser.repositoryCases.findUnique({
        where: { id: ctx.caseDefault },
        select: { id: true },
      });
      expect(found?.id).toBe(ctx.caseDefault);
    });

    it("[fix] SPECIFIC_ROLE default whose role grants edit → CAN update the case", async () => {
      const updated = await edbUser.repositoryCases.update({
        where: { id: ctx.caseEditor },
        data: { name: `PDA-Editor-Case-upd-${Date.now()}` },
        select: { id: true, name: true },
      });
      expect(updated.id).toBe(ctx.caseEditor);
      expect(updated.name).toContain("upd");
    });

    // ---- Guards: behavior that must not regress ----

    it("[guard] NONE-tier user → CANNOT read even with SPECIFIC_ROLE default", async () => {
      const found = await edbNone.repositoryCases.findUnique({
        where: { id: ctx.caseReadOnly },
        select: { id: true },
      });
      expect(found).toBeNull();
    });

    it("[guard] explicit NO_ACCESS overrides default access → CANNOT read", async () => {
      const found = await edbUser.repositoryCases.findUnique({
        where: { id: ctx.caseNoAccess },
        select: { id: true },
      });
      expect(found).toBeNull();
    });

    it("[guard] SPECIFIC_ROLE default with a NULL default role → CANNOT read", async () => {
      const found = await edbUser.repositoryCases.findUnique({
        where: { id: ctx.caseNullRole },
        select: { id: true },
      });
      expect(found).toBeNull();
    });

    it("[guard] read-only default role → CAN read but CANNOT update", async () => {
      const found = await edbUser.repositoryCases.findUnique({
        where: { id: ctx.caseReadOnly },
        select: { id: true },
      });
      expect(found?.id).toBe(ctx.caseReadOnly);

      await expect(
        edbUser.repositoryCases.update({
          where: { id: ctx.caseReadOnly },
          data: { name: "should-be-denied" },
        })
      ).rejects.toThrow();
    });
  }
);
