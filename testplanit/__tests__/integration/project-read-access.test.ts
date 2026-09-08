// End-to-end validation of the AuthCtx / accessibleProjectIds read policy.
//
// The mocked differential test (lib/authContext.test.ts) proves the resolver
// computes the right project set. This proves the other half: that the set is
// actually built per request, threaded into the policy as
// `projectId in auth().accessibleProjectIds`, and filters rows in real SQL —
// and that the retained ADMIN grant and NO_ACCESS denial still hold at the row
// level. A NO_ACCESS-default project is used so every visible row comes from an
// explicit grant, never a permissive default.
//
// Run via:
//   cd testplanit && RUN_DB_INTEGRATION=1 pnpm test project-read-access --run

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRawDbClient } from "~/lib/rawDbClient";
import { WorkflowScope } from "~/zenstack/models";

import { getAuthDb } from "~/lib/zenstack";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const TAG = `pra-${Date.now()}`;

type AuthUser = Awaited<ReturnType<typeof fetchAuthUser>>;

async function fetchAuthUser(userId: string) {
  return db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { role: { include: { rolePermissions: true } } },
  });
}

interface Fixture {
  projectId: number;
  runId: number;
  suiteId: number; // JUnitTestSuite under the run — a one-hop child (testRun.projectId)
  creator: AuthUser;
  groupGlobalMember: AuthUser; // access purely via a group with GLOBAL_ROLE
  deniedMember: AuthUser; // in the same group, but per-user NO_ACCESS
  outsider: AuthUser; // no path to the project
  admin: AuthUser; // system ADMIN, no explicit project grant
}

let fixture: Fixture | null = null;

async function setupFixture(): Promise<Fixture> {
  const userRole = await db.roles.findFirst({ where: { name: "user" } });
  if (!userRole) {
    throw new Error(
      "Dev DB missing seeded `user` role. Run `pnpm tsx db/seed.ts` first."
    );
  }
  const runWorkflow = await db.workflows.findFirst({
    where: { scope: WorkflowScope.RUNS, isDeleted: false, isEnabled: true },
  });
  if (!runWorkflow)
    throw new Error("Dev DB missing RUNS-scoped Workflows row.");

  const mkUser = async (label: string, access: "USER" | "ADMIN") =>
    db.user.create({
      data: {
        email: `${TAG}-${label}@example.test`,
        name: `${TAG} ${label}`,
        access,
        roleId: userRole.id,
      },
    });

  const creatorRow = await mkUser("creator", "USER");
  const groupGlobalRow = await mkUser("groupGlobal", "USER");
  const deniedRow = await mkUser("denied", "USER");
  const outsiderRow = await mkUser("outsider", "USER");
  const adminRow = await mkUser("admin", "ADMIN");

  // NO_ACCESS default: nothing is visible without an explicit grant.
  const project = await db.projects.create({
    data: {
      name: `${TAG}-project`,
      createdBy: creatorRow.id,
      defaultAccessType: "NO_ACCESS",
      defaultRoleId: null,
    },
  });

  // A group holding GLOBAL_ROLE on the project — members reach it through their
  // own global role. This is the path that regressed before AuthCtx and the
  // reason the group branch is exercised explicitly here.
  const group = await db.groups.create({
    data: {
      name: `${TAG}-group`,
      assignedUsers: {
        create: [{ userId: groupGlobalRow.id }, { userId: deniedRow.id }],
      },
    },
  });
  await db.groupProjectPermission.create({
    data: {
      groupId: group.id,
      projectId: project.id,
      accessType: "GLOBAL_ROLE",
      roleId: null,
    },
  });

  // deniedRow is in the granting group but carries a per-user NO_ACCESS row,
  // which must override the group grant.
  await db.userProjectPermission.create({
    data: {
      userId: deniedRow.id,
      projectId: project.id,
      accessType: "NO_ACCESS",
    },
  });

  const run = await db.testRuns.create({
    data: {
      projectId: project.id,
      name: `${TAG}-run`,
      stateId: runWorkflow.id,
      createdById: creatorRow.id,
    },
  });

  // A one-hop child of the run. Its read rule is
  // `testRun.projectId in auth().accessibleProjectIds` — it has no projectId of
  // its own, so this proves the Phase 2 traversal rewrite inherits the parent
  // project's access.
  const suite = await db.jUnitTestSuite.create({
    data: {
      name: `${TAG}-suite`,
      testRunId: run.id,
      createdById: creatorRow.id,
    },
  });

  return {
    projectId: project.id,
    runId: run.id,
    suiteId: suite.id,
    creator: await fetchAuthUser(creatorRow.id),
    groupGlobalMember: await fetchAuthUser(groupGlobalRow.id),
    deniedMember: await fetchAuthUser(deniedRow.id),
    outsider: await fetchAuthUser(outsiderRow.id),
    admin: await fetchAuthUser(adminRow.id),
  };
}

async function cleanupFixture(f: Fixture | null): Promise<void> {
  if (!f) return;
  const safe = async (op: () => Promise<unknown>) => {
    try {
      await op();
    } catch {
      /* best-effort */
    }
  };
  await safe(() =>
    db.jUnitTestSuite.deleteMany({
      where: { name: { startsWith: TAG } },
    })
  );
  await safe(() =>
    db.testRuns.updateMany({
      where: { name: { startsWith: TAG } },
      data: { isDeleted: true },
    })
  );
  await safe(() =>
    db.userProjectPermission.deleteMany({
      where: { project: { name: { startsWith: TAG } } },
    })
  );
  await safe(() =>
    db.groupProjectPermission.deleteMany({
      where: { project: { name: { startsWith: TAG } } },
    })
  );
  await safe(() =>
    db.groupAssignment.deleteMany({
      where: { group: { name: { startsWith: TAG } } },
    })
  );
  await safe(() =>
    db.groups.updateMany({
      where: { name: { startsWith: TAG } },
      data: { isDeleted: true },
    })
  );
  await safe(() =>
    db.projects.updateMany({
      where: { name: { startsWith: TAG } },
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

describeIntegration("project read access via accessibleProjectIds", () => {
  const canSeeRun = async (user: AuthUser) => {
    if (!fixture) throw new Error("fixture not initialized");
    const enhanced = await getAuthDb(user);
    const row = await enhanced.testRuns.findUnique({
      where: { id: fixture.runId },
    });
    return row !== null;
  };

  it("the creator sees runs in their NO_ACCESS project", async () => {
    expect(await canSeeRun(fixture!.creator)).toBe(true);
  });

  it("a group GLOBAL_ROLE member sees runs (the path that regressed pre-AuthCtx)", async () => {
    expect(await canSeeRun(fixture!.groupGlobalMember)).toBe(true);
  });

  it("a per-user NO_ACCESS row overrides the group grant — denied", async () => {
    expect(await canSeeRun(fixture!.deniedMember)).toBe(false);
  });

  it("an unrelated user sees nothing", async () => {
    expect(await canSeeRun(fixture!.outsider)).toBe(false);
  });

  it("a system ADMIN sees runs despite NO_ACCESS (retained ADMIN grant)", async () => {
    expect(await canSeeRun(fixture!.admin)).toBe(true);
  });

  it("findMany is filtered to the accessible project set, not just findUnique", async () => {
    if (!fixture) throw new Error("fixture not initialized");
    const outsiderDb = await getAuthDb(fixture.outsider);
    const rows = await outsiderDb.testRuns.findMany({
      where: { name: { startsWith: TAG } },
    });
    expect(rows.map((r) => r.id)).not.toContain(fixture.runId);

    const memberDb = await getAuthDb(fixture.groupGlobalMember);
    const memberRows = await memberDb.testRuns.findMany({
      where: { name: { startsWith: TAG } },
    });
    expect(memberRows.map((r) => r.id)).toContain(fixture.runId);
  });
});

// Phase 2: child models with no projectId of their own inherit the parent
// project's access via `<relation>.projectId in auth().accessibleProjectIds`.
// A JUnitTestSuite (one-hop child of TestRuns) must be visible to exactly the
// same users as its parent run.
describeIntegration(
  "child-model read access via parent-project traversal",
  () => {
    const canSeeSuite = async (user: AuthUser) => {
      if (!fixture) throw new Error("fixture not initialized");
      const enhanced = await getAuthDb(user);
      const row = await enhanced.jUnitTestSuite.findUnique({
        where: { id: fixture.suiteId },
      });
      return row !== null;
    };

    it("a group GLOBAL_ROLE member sees the child suite (inherits the run's project access)", async () => {
      expect(await canSeeSuite(fixture!.groupGlobalMember)).toBe(true);
    });

    it("a per-user NO_ACCESS row hides the child suite too", async () => {
      expect(await canSeeSuite(fixture!.deniedMember)).toBe(false);
    });

    it("an outsider cannot see the child suite", async () => {
      expect(await canSeeSuite(fixture!.outsider)).toBe(false);
    });

    it("a system ADMIN sees the child suite", async () => {
      expect(await canSeeSuite(fixture!.admin)).toBe(true);
    });
  }
);
