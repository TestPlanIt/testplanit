// Live-DB proof of the automated-execution access rules (schema.zmodel:
// ExecutionTarget ~3995, TestRunExecution ~4030).
//
// Both models are written exclusively off the policy path — ExecutionTarget by
// app/actions/execution-targets.ts, TestRunExecution by the execute routes and
// the dispatch worker, both on the raw/base client — and both carry
// `@@deny('create, update, delete', true)`, so the RPC surface is read-only for
// EVERY caller, ADMIN included. ExecutionTarget additionally restricts read to
// ADMIN because the row carries an encrypted credential; TestRunExecution
// exposes read to the run's project members through
// `projectId in auth().accessibleProjectIds`.
//
// A compiled `@@deny` only takes effect through the real policy client, so a
// mocked-db unit test cannot catch a regression here.
//
// Run via (scratch DB only — never the .env DATABASE_URL):
//   DATABASE_URL=<scratch> RUN_DB_INTEGRATION=1 pnpm exec vitest run \
//     __tests__/integration/execution-access-rules.test.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";
import { getAuthDb } from "~/lib/zenstack";
import { WorkflowScope } from "~/zenstack/models";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const TAG = `exa-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

type AuthUser = Awaited<ReturnType<typeof fetchAuthUser>>;

async function fetchAuthUser(userId: string) {
  return db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { role: { include: { rolePermissions: true } } },
  });
}

/** True if the operation was blocked by policy (threw, or changed nothing). */
async function isDenied(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    const result = await fn();
    if (Array.isArray(result) && result.length === 0) return true;
    if (
      result &&
      typeof result === "object" &&
      "count" in result &&
      (result as { count: number }).count === 0
    )
      return true;
    return false;
  } catch {
    return true;
  }
}

interface Fixture {
  projectAId: number;
  projectBId: number;
  targetAId: number;
  targetBId: number;
  runAId: number;
  executionAId: number;
  executionBId: number;
  admin: AuthUser;
  memberA: AuthUser; // explicit grant on project A only
  memberB: AuthUser; // explicit grant on project B only
  noneUser: AuthUser; // explicit grant on project A, but access = NONE
  outsider: AuthUser; // no grant anywhere
}

let fixture: Fixture | null = null;

async function setupFixture(): Promise<Fixture> {
  const userRole = await db.roles.findFirst({
    where: { isDefault: true, isDeleted: false },
  });
  if (!userRole) throw new Error("Test prerequisite: no default role row");
  const runWorkflow = await db.workflows.findFirst({
    where: { scope: WorkflowScope.RUNS, isDeleted: false, isEnabled: true },
  });
  if (!runWorkflow)
    throw new Error("Test prerequisite: no RUNS-scoped Workflows row");

  const mkUser = async (
    label: string,
    access: "USER" | "ADMIN" | "NONE" = "USER"
  ) =>
    db.user.create({
      data: {
        email: `${TAG}-${label}@example.test`,
        name: `${TAG} ${label}`,
        authMethod: "INTERNAL",
        access,
        roleId: userRole.id,
      },
      select: { id: true },
    });

  const adminRow = await mkUser("admin", "ADMIN");
  const memberARow = await mkUser("memberA");
  const memberBRow = await mkUser("memberB");
  const noneRow = await mkUser("none", "NONE");
  const outsiderRow = await mkUser("outsider");

  // NO_ACCESS defaults, so every visible row below comes from an explicit
  // grant and never from a permissive project default.
  const mkProject = async (label: string) =>
    db.projects.create({
      data: {
        name: `${TAG}-${label}`,
        createdBy: adminRow.id,
        defaultAccessType: "NO_ACCESS",
        defaultRoleId: null,
      },
      select: { id: true },
    });
  const projectA = await mkProject("projectA");
  const projectB = await mkProject("projectB");

  await db.userProjectPermission.createMany({
    data: [
      {
        userId: memberARow.id,
        projectId: projectA.id,
        accessType: "SPECIFIC_ROLE",
        roleId: userRole.id,
      },
      {
        userId: memberBRow.id,
        projectId: projectB.id,
        accessType: "SPECIFIC_ROLE",
        roleId: userRole.id,
      },
      // A NONE user WITH an explicit grant: computeAccessibleProjectIds keeps
      // the project on the list (the explicit-grant branches do not test
      // access), so the model's `@@deny('all', auth().access == 'NONE')` is
      // what has to stop this read — not an empty project list.
      {
        userId: noneRow.id,
        projectId: projectA.id,
        accessType: "SPECIFIC_ROLE",
        roleId: userRole.id,
      },
    ],
  });

  const mkTarget = async (label: string, projectId: number) =>
    db.executionTarget.create({
      data: {
        projectId,
        name: `${TAG}-${label}`,
        provider: "GENERIC_WEBHOOK",
        url: "https://ci.example.test/hooks/tpi",
        staticInputs: {},
        createdById: adminRow.id,
      },
      select: { id: true },
    });
  const targetA = await mkTarget("targetA", projectA.id);
  const targetB = await mkTarget("targetB", projectB.id);

  const mkRun = async (label: string, projectId: number) =>
    db.testRuns.create({
      data: {
        projectId,
        name: `${TAG}-${label}`,
        stateId: runWorkflow.id,
        createdById: adminRow.id,
      },
      select: { id: true },
    });
  const runA = await mkRun("runA", projectA.id);
  const runB = await mkRun("runB", projectB.id);

  const mkExecution = async (
    runId: number,
    projectId: number,
    targetId: number
  ) =>
    db.testRunExecution.create({
      data: {
        testRunId: runId,
        projectId,
        targetId,
        provider: "GENERIC_WEBHOOK",
        requestedById: adminRow.id,
      },
      select: { id: true },
    });
  const executionA = await mkExecution(runA.id, projectA.id, targetA.id);
  const executionB = await mkExecution(runB.id, projectB.id, targetB.id);

  return {
    projectAId: projectA.id,
    projectBId: projectB.id,
    targetAId: targetA.id,
    targetBId: targetB.id,
    runAId: runA.id,
    executionAId: executionA.id,
    executionBId: executionB.id,
    admin: await fetchAuthUser(adminRow.id),
    memberA: await fetchAuthUser(memberARow.id),
    memberB: await fetchAuthUser(memberBRow.id),
    noneUser: await fetchAuthUser(noneRow.id),
    outsider: await fetchAuthUser(outsiderRow.id),
  };
}

async function cleanupFixture(f: Fixture | null): Promise<void> {
  if (!f) return;
  const projectIds = [f.projectAId, f.projectBId];
  const safe = async (op: () => Promise<unknown>) => {
    try {
      await op();
    } catch {
      /* best-effort */
    }
  };
  await safe(() =>
    db.testRunExecution.deleteMany({ where: { projectId: { in: projectIds } } })
  );
  await safe(() =>
    db.executionTarget.deleteMany({ where: { projectId: { in: projectIds } } })
  );
  await safe(() =>
    db.testRuns.deleteMany({ where: { name: { startsWith: TAG } } })
  );
  await safe(() =>
    db.userProjectPermission.deleteMany({
      where: { projectId: { in: projectIds } },
    })
  );
  await safe(() =>
    db.projects.updateMany({
      where: { id: { in: projectIds } },
      data: { isDeleted: true },
    })
  );
  await safe(() =>
    db.user.updateMany({
      where: { email: { startsWith: TAG } },
      data: { isDeleted: true, isActive: false },
    })
  );
}

beforeAll(async () => {
  if (!RUN_INTEGRATION || !HAS_DB_URL) return;
  fixture = await setupFixture();
}, 30_000);

afterAll(async () => {
  if (!RUN_INTEGRATION || !HAS_DB_URL) return;
  await cleanupFixture(fixture);
  await db.$disconnect();
}, 30_000);

describeIntegration(
  "ExecutionTarget policy (ADMIN-only read, no writes)",
  () => {
    const readTarget = async (user: AuthUser) => {
      const edb = await getAuthDb(user);
      return edb.executionTarget.findUnique({
        where: { id: fixture!.targetAId },
      });
    };

    it("an ADMIN reads the target", async () => {
      const row = await readTarget(fixture!.admin);
      expect(row).not.toBeNull();
      expect(row!.name).toBe(`${TAG}-targetA`);
    });

    it("a project member CANNOT read a target in their own project", async () => {
      expect(await readTarget(fixture!.memberA)).toBeNull();

      const edb = await getAuthDb(fixture!.memberA);
      const many = await edb.executionTarget.findMany({
        where: { projectId: fixture!.projectAId },
      });
      expect(many).toHaveLength(0);
    });

    it("a NONE-access user reads nothing", async () => {
      expect(await readTarget(fixture!.noneUser)).toBeNull();
    });

    it("an outsider reads nothing", async () => {
      expect(await readTarget(fixture!.outsider)).toBeNull();
    });

    it("an ADMIN CANNOT create a target through the policy client", async () => {
      const edb = await getAuthDb(fixture!.admin);
      expect(
        await isDenied(() =>
          edb.executionTarget.create({
            data: {
              projectId: fixture!.projectAId,
              name: `${TAG}-rpc-created`,
              provider: "GENERIC_WEBHOOK",
              url: "https://ci.example.test/hooks/rpc",
              createdById: fixture!.admin.id,
            },
          })
        )
      ).toBe(true);

      const leaked = await db.executionTarget.findFirst({
        where: { name: `${TAG}-rpc-created` },
      });
      expect(leaked).toBeNull();
    });

    it("an ADMIN CANNOT update a target through the policy client", async () => {
      const edb = await getAuthDb(fixture!.admin);
      expect(
        await isDenied(() =>
          edb.executionTarget.update({
            where: { id: fixture!.targetAId },
            data: { name: `${TAG}-renamed` },
          })
        )
      ).toBe(true);

      const row = await db.executionTarget.findUnique({
        where: { id: fixture!.targetAId },
        select: { name: true },
      });
      expect(row?.name).toBe(`${TAG}-targetA`);
    });

    it("an ADMIN CANNOT delete a target through the policy client", async () => {
      const edb = await getAuthDb(fixture!.admin);
      expect(
        await isDenied(() =>
          edb.executionTarget.delete({ where: { id: fixture!.targetAId } })
        )
      ).toBe(true);

      const row = await db.executionTarget.findUnique({
        where: { id: fixture!.targetAId },
        select: { id: true },
      });
      expect(row).not.toBeNull();
    });

    it("a project member CANNOT create a target", async () => {
      const edb = await getAuthDb(fixture!.memberA);
      expect(
        await isDenied(() =>
          edb.executionTarget.create({
            data: {
              projectId: fixture!.projectAId,
              name: `${TAG}-member-created`,
              provider: "GENERIC_WEBHOOK",
              url: "https://ci.example.test/hooks/member",
              createdById: fixture!.memberA.id,
            },
          })
        )
      ).toBe(true);
    });
  }
);

describeIntegration(
  "TestRunExecution policy (project-scoped read, no writes)",
  () => {
    const readExecution = async (user: AuthUser, id: number) => {
      const edb = await getAuthDb(user);
      return edb.testRunExecution.findUnique({ where: { id } });
    };

    it("a member of the run's project reads the execution", async () => {
      const row = await readExecution(fixture!.memberA, fixture!.executionAId);
      expect(row).not.toBeNull();
      expect(row!.projectId).toBe(fixture!.projectAId);
    });

    it("a member of project A CANNOT read project B's execution", async () => {
      expect(
        await readExecution(fixture!.memberA, fixture!.executionBId)
      ).toBeNull();

      const edb = await getAuthDb(fixture!.memberA);
      const many = await edb.testRunExecution.findMany({
        where: { id: { in: [fixture!.executionAId, fixture!.executionBId] } },
      });
      expect(many.map((e) => e.id)).toEqual([fixture!.executionAId]);
    });

    it("a member of project B reads only project B's execution", async () => {
      expect(
        await readExecution(fixture!.memberB, fixture!.executionBId)
      ).not.toBeNull();
      expect(
        await readExecution(fixture!.memberB, fixture!.executionAId)
      ).toBeNull();
    });

    it("a NONE-access user reads nothing despite an explicit project grant", async () => {
      // The grant puts project A on the user's accessibleProjectIds …
      const { resolveAccessibleProjectIds } = await import("~/lib/authContext");
      const ids = await resolveAccessibleProjectIds(fixture!.noneUser);
      expect(ids).toContain(fixture!.projectAId);
      // … and the NONE deny still blocks the read.
      expect(
        await readExecution(fixture!.noneUser, fixture!.executionAId)
      ).toBeNull();
    });

    it("an outsider reads nothing", async () => {
      expect(
        await readExecution(fixture!.outsider, fixture!.executionAId)
      ).toBeNull();
    });

    it("an ADMIN reads executions in every project", async () => {
      expect(
        await readExecution(fixture!.admin, fixture!.executionAId)
      ).not.toBeNull();
      expect(
        await readExecution(fixture!.admin, fixture!.executionBId)
      ).not.toBeNull();
    });

    it("an ADMIN CANNOT create an execution through the policy client", async () => {
      const edb = await getAuthDb(fixture!.admin);
      expect(
        await isDenied(() =>
          edb.testRunExecution.create({
            data: {
              testRunId: fixture!.runAId,
              projectId: fixture!.projectAId,
              targetId: fixture!.targetAId,
              provider: "GENERIC_WEBHOOK",
              requestedById: fixture!.admin.id,
            },
          })
        )
      ).toBe(true);

      const count = await db.testRunExecution.count({
        where: { testRunId: fixture!.runAId },
      });
      expect(count).toBe(1);
    });

    it("an ADMIN CANNOT update an execution's status through the policy client", async () => {
      const edb = await getAuthDb(fixture!.admin);
      expect(
        await isDenied(() =>
          edb.testRunExecution.update({
            where: { id: fixture!.executionAId },
            data: { status: "SUCCEEDED" },
          })
        )
      ).toBe(true);

      const row = await db.testRunExecution.findUnique({
        where: { id: fixture!.executionAId },
        select: { status: true },
      });
      expect(row?.status).toBe("PENDING");
    });

    it("an ADMIN CANNOT delete an execution through the policy client", async () => {
      const edb = await getAuthDb(fixture!.admin);
      expect(
        await isDenied(() =>
          edb.testRunExecution.delete({ where: { id: fixture!.executionAId } })
        )
      ).toBe(true);

      const row = await db.testRunExecution.findUnique({
        where: { id: fixture!.executionAId },
        select: { id: true },
      });
      expect(row).not.toBeNull();
    });

    // The two rules meet here: a member may read the execution, but the target
    // it points at is ADMIN-only. The relation does not throw and does not leak
    // — it comes back null, so anything rendering a target name for a member has
    // to source it from the sanitized server action, not from this include.
    it("a member's execution read returns a NULL target through the relation", async () => {
      const edb = await getAuthDb(fixture!.memberA);
      const row = await edb.testRunExecution.findUnique({
        where: { id: fixture!.executionAId },
        include: { target: true },
      });
      expect(row).not.toBeNull();
      expect(row!.target).toBeNull();

      const adminDb = await getAuthDb(fixture!.admin);
      const adminRow = await adminDb.testRunExecution.findUnique({
        where: { id: fixture!.executionAId },
        include: { target: true },
      });
      expect(adminRow!.target?.name).toBe(`${TAG}-targetA`);
    });

    it("a project member CANNOT update the execution they can read", async () => {
      const edb = await getAuthDb(fixture!.memberA);
      expect(
        await isDenied(() =>
          edb.testRunExecution.update({
            where: { id: fixture!.executionAId },
            data: { status: "CANCELLED" },
          })
        )
      ).toBe(true);
    });
  }
);
