// Regression test for the test-run / session @@allow('update,delete', ...)
// rules. Before the fix, the rules omitted group-assigned access paths, so a
// user whose only permission flowed through a Group with a role that had
// TestRuns.canAddEdit could not edit a test run created by another user.
//
// This test asserts the positive case: User B, granted access purely via a
// Group with SPECIFIC_ROLE, can update a TestRun created by User A.
//
// Run via:
//   cd testplanit && RUN_DB_INTEGRATION=1 pnpm test testrun-group-permission-update --run

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRawDbClient } from "~/lib/rawDbClient";
import { WorkflowScope } from "~/zenstack/models";

import { getAuthDb } from "~/lib/zenstack";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const prisma = createRawDbClient();
const RUN_TAG = `tr-grp-${Date.now()}`;

type AuthUser = Awaited<ReturnType<typeof fetchAuthUser>>;

async function fetchAuthUser(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { role: { include: { rolePermissions: true } } },
  });
}

interface Fixture {
  project: { id: number };
  testRun: { id: number };
  groupMember: AuthUser;
  outsider: AuthUser;
}

let fixture: Fixture | null = null;

async function setupFixture(): Promise<Fixture> {
  const userRole = await prisma.roles.findFirst({ where: { name: "user" } });
  if (!userRole) {
    throw new Error(
      "Dev DB missing seeded `user` role. Run `pnpm tsx prisma/seed.ts` first."
    );
  }
  const runWorkflow = await prisma.workflows.findFirst({
    where: { scope: WorkflowScope.RUNS, isDeleted: false, isEnabled: true },
  });
  if (!runWorkflow) {
    throw new Error("Dev DB missing RUNS-scoped Workflows row.");
  }

  // A custom role granting TestRuns.canAddEdit (so we exercise the
  // rolePermissions[area == 'TestRuns' && canAddEdit] branch, not the
  // role.name == 'Project Admin' short-circuit).
  const editorRole = await prisma.roles.create({
    data: {
      name: `${RUN_TAG}-runEditor`,
      rolePermissions: {
        create: [{ area: "TestRuns", canAddEdit: true, canDelete: false }],
      },
    },
  });

  // Creator of the project + test run.
  const creatorCreated = await prisma.user.create({
    data: {
      email: `${RUN_TAG}-creator@example.test`,
      name: `${RUN_TAG} Creator`,
      access: "USER",
      roleId: userRole.id,
    },
  });

  // The user whose only path to the project is group membership.
  const groupMemberCreated = await prisma.user.create({
    data: {
      email: `${RUN_TAG}-groupMember@example.test`,
      name: `${RUN_TAG} Group Member`,
      access: "USER",
      roleId: userRole.id,
    },
  });

  // Negative control: not in the group, not the creator, no direct perms.
  // The project below also grants no blanket default access (see defaultRoleId:
  // null), so this user has NO path to the project at all.
  const outsiderCreated = await prisma.user.create({
    data: {
      email: `${RUN_TAG}-outsider@example.test`,
      name: `${RUN_TAG} Outsider`,
      access: "USER",
      roleId: userRole.id,
    },
  });

  const groupMember = await fetchAuthUser(groupMemberCreated.id);
  const outsider = await fetchAuthUser(outsiderCreated.id);

  // defaultRoleId is null on purpose: a project whose default *is* a granting
  // role (e.g. the seeded "user" role) confers that role's access on every
  // authenticated user, so the "outsider" below would no longer be an outsider.
  // A null default role grants nothing by default — access must come from the
  // explicit group permission, which is exactly what these tests exercise.
  const project = await prisma.projects.create({
    data: {
      name: `${RUN_TAG}-project`,
      createdBy: creatorCreated.id,
      defaultAccessType: "SPECIFIC_ROLE",
      defaultRoleId: null,
    },
  });

  const group = await prisma.groups.create({
    data: {
      name: `${RUN_TAG}-group`,
      assignedUsers: { create: [{ userId: groupMember.id }] },
    },
  });

  await prisma.groupProjectPermission.create({
    data: {
      groupId: group.id,
      projectId: project.id,
      accessType: "SPECIFIC_ROLE",
      roleId: editorRole.id,
    },
  });

  const testRun = await prisma.testRuns.create({
    data: {
      projectId: project.id,
      name: `${RUN_TAG}-run`,
      stateId: runWorkflow.id,
      createdById: creatorCreated.id,
    },
  });

  return {
    project: { id: project.id },
    testRun: { id: testRun.id },
    groupMember,
    outsider,
  };
}

async function cleanupFixture(f: Fixture | null): Promise<void> {
  if (!f) return;
  const safe = async (op: () => Promise<unknown>): Promise<void> => {
    try {
      await op();
    } catch {
      /* best-effort */
    }
  };

  await safe(() =>
    prisma.testRuns.updateMany({
      where: { name: { startsWith: RUN_TAG } },
      data: { isDeleted: true },
    })
  );
  await safe(() =>
    prisma.groupProjectPermission.deleteMany({
      where: { project: { name: { startsWith: RUN_TAG } } },
    })
  );
  await safe(() =>
    prisma.groupAssignment.deleteMany({
      where: { group: { name: { startsWith: RUN_TAG } } },
    })
  );
  await safe(() =>
    prisma.groups.updateMany({
      where: { name: { startsWith: RUN_TAG } },
      data: { isDeleted: true },
    })
  );
  await safe(() =>
    prisma.rolePermission.deleteMany({
      where: { role: { name: { startsWith: RUN_TAG } } },
    })
  );
  await safe(() =>
    prisma.roles.updateMany({
      where: { name: { startsWith: RUN_TAG } },
      data: { isDeleted: true },
    })
  );
  await safe(() =>
    prisma.projects.updateMany({
      where: { name: { startsWith: RUN_TAG } },
      data: { isDeleted: true },
    })
  );
  await safe(() =>
    prisma.user.updateMany({
      where: { email: { startsWith: RUN_TAG } },
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
  await prisma.$disconnect();
}, 30_000);

describeIntegration("TestRun update via group-assigned SPECIFIC_ROLE", () => {
  it("allows a user whose only access is through a group with TestRuns.canAddEdit to update a TestRun created by someone else", async () => {
    if (!fixture) throw new Error("fixture not initialized");
    const enhancedDb = getAuthDb(fixture.groupMember);

    const updated = await enhancedDb.testRuns.update({
      where: { id: fixture.testRun.id },
      data: { name: `${RUN_TAG}-renamed-by-group-member` },
    });

    expect(updated.name).toBe(`${RUN_TAG}-renamed-by-group-member`);
  });

  it("denies an outsider with no group, no direct permission, and no global role on the project", async () => {
    if (!fixture) throw new Error("fixture not initialized");
    const enhancedDb = getAuthDb(fixture.outsider);

    await expect(
      enhancedDb.testRuns.update({
        where: { id: fixture.testRun.id },
        data: { name: `${RUN_TAG}-should-not-stick` },
      })
    ).rejects.toThrow();
  });
});
