// End-to-end validation of write authorization under the AuthCtx rewrite.
//
// Phase 1 rewrote every `X == auth()` comparison to `X.id == auth().id` across
// create/update/delete rules on 124 models, and moved auth().role.rolePermissions
// evaluation in-memory against the supplied AuthCtx. The read tests prove reads
// are filtered correctly; this proves writes are still GATED correctly — both
// that legitimate writers are allowed and, more importantly, that read access
// (which the AuthCtx change widened for group-GLOBAL_ROLE members) does NOT leak
// into write access.
//
// Two nuances are asserted deliberately, matching the rules verbatim:
//   - Group GLOBAL_ROLE grants update/delete but NOT create (the create rule
//     only admits group SPECIFIC_ROLE). This asymmetry predates the refactor.
//   - A group member whose global role lacks TestRuns canAddEdit/canDelete can
//     READ a run but cannot UPDATE it — the role.rolePermissions negative case,
//     now evaluated from the AuthCtx rather than a subquery.
//
// Run via:
//   cd testplanit && RUN_DB_INTEGRATION=1 pnpm test project-write-access --run

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRawDbClient } from "~/lib/rawDbClient";
import { WorkflowScope } from "~/zenstack/models";

import { getAuthDb } from "~/lib/zenstack";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const TAG = `pwa-${Date.now()}`;

type AuthUser = Awaited<ReturnType<typeof fetchAuthUser>>;

async function fetchAuthUser(userId: string) {
  return db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { role: { include: { rolePermissions: true } } },
  });
}

/** True if the operation was blocked by policy (threw, or updated/returned nothing). */
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
  projectId: number;
  runId: number;
  runWorkflowId: number;
  groupGlobalWriter: AuthUser; // group GLOBAL_ROLE + global writer role
  groupSpecificWriter: AuthUser; // group SPECIFIC_ROLE (writer role on the grant)
  groupGlobalViewer: AuthUser; // group GLOBAL_ROLE + global viewer role (no write perm)
  deniedUser: AuthUser; // per-user NO_ACCESS
  outsider: AuthUser; // no path to the project
}

let fixture: Fixture | null = null;

async function setupFixture(): Promise<Fixture> {
  const runWorkflow = await db.workflows.findFirst({
    where: { scope: WorkflowScope.RUNS, isDeleted: false, isEnabled: true },
  });
  if (!runWorkflow)
    throw new Error("Dev DB missing RUNS-scoped Workflows row.");

  const writerRole = await db.roles.create({
    data: {
      name: `${TAG}-writer`,
      rolePermissions: {
        create: [{ area: "TestRuns", canAddEdit: true, canDelete: false }],
      },
    },
  });
  // A valid global role that grants NO TestRuns write permission.
  const viewerRole = await db.roles.create({ data: { name: `${TAG}-viewer` } });

  const mkUser = async (label: string, roleId: number) =>
    db.user.create({
      data: {
        email: `${TAG}-${label}@example.test`,
        name: `${TAG} ${label}`,
        access: "USER",
        roleId,
      },
    });

  const creatorRow = await mkUser("creator", writerRole.id);
  const globalWriterRow = await mkUser("globalWriter", writerRole.id);
  const specificWriterRow = await mkUser("specificWriter", viewerRole.id); // grant carries the writer role
  const globalViewerRow = await mkUser("globalViewer", viewerRole.id);
  const deniedRow = await mkUser("denied", writerRole.id); // has the perm but is NO_ACCESS
  const outsiderRow = await mkUser("outsider", writerRole.id);

  const project = await db.projects.create({
    data: {
      name: `${TAG}-project`,
      createdBy: creatorRow.id,
      defaultAccessType: "NO_ACCESS",
      defaultRoleId: null,
    },
  });

  // Group A: GLOBAL_ROLE — members act with their own global role.
  const globalGroup = await db.groups.create({
    data: {
      name: `${TAG}-globalGroup`,
      assignedUsers: {
        create: [
          { userId: globalWriterRow.id },
          { userId: globalViewerRow.id },
          { userId: deniedRow.id },
        ],
      },
    },
  });
  await db.groupProjectPermission.create({
    data: {
      groupId: globalGroup.id,
      projectId: project.id,
      accessType: "GLOBAL_ROLE",
      roleId: null,
    },
  });

  // Group B: SPECIFIC_ROLE — members act with the writer role carried by the grant.
  const specificGroup = await db.groups.create({
    data: {
      name: `${TAG}-specificGroup`,
      assignedUsers: { create: [{ userId: specificWriterRow.id }] },
    },
  });
  await db.groupProjectPermission.create({
    data: {
      groupId: specificGroup.id,
      projectId: project.id,
      accessType: "SPECIFIC_ROLE",
      roleId: writerRole.id,
    },
  });

  // deniedRow is in the granting global group but explicitly NO_ACCESS.
  await db.userProjectPermission.create({
    data: {
      userId: deniedRow.id,
      projectId: project.id,
      accessType: "NO_ACCESS",
    },
  });

  // Run created by the project creator, so no acting user below is the run's
  // own creator (which would grant write via `auth().id == createdById`).
  const run = await db.testRuns.create({
    data: {
      projectId: project.id,
      name: `${TAG}-run`,
      stateId: runWorkflow.id,
      createdById: creatorRow.id,
    },
  });

  return {
    projectId: project.id,
    runId: run.id,
    runWorkflowId: runWorkflow.id,
    groupGlobalWriter: await fetchAuthUser(globalWriterRow.id),
    groupSpecificWriter: await fetchAuthUser(specificWriterRow.id),
    groupGlobalViewer: await fetchAuthUser(globalViewerRow.id),
    deniedUser: await fetchAuthUser(deniedRow.id),
    outsider: await fetchAuthUser(outsiderRow.id),
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
    db.rolePermission.deleteMany({
      where: { role: { name: { startsWith: TAG } } },
    })
  );
  await safe(() =>
    db.roles.updateMany({
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

describeIntegration("write authorization under AuthCtx", () => {
  const tryUpdate = async (user: AuthUser) => {
    const enhanced = await getAuthDb(user);
    return enhanced.testRuns.update({
      where: { id: fixture!.runId },
      data: { name: `${TAG}-touched-${user.id.slice(0, 6)}` },
    });
  };
  const tryCreate = async (user: AuthUser) => {
    const enhanced = await getAuthDb(user);
    return enhanced.testRuns.create({
      data: {
        projectId: fixture!.projectId,
        name: `${TAG}-created-${user.id.slice(0, 6)}`,
        stateId: fixture!.runWorkflowId,
        createdById: user.id,
      },
    });
  };

  // --- Positive: legitimate writers are allowed (guards against over-denial) ---

  it("group GLOBAL_ROLE member with a writer global role CAN update", async () => {
    const updated = await tryUpdate(fixture!.groupGlobalWriter);
    expect(updated.name).toContain("touched");
  });

  it("group SPECIFIC_ROLE member with the writer role CAN create", async () => {
    expect(await isDenied(() => tryCreate(fixture!.groupSpecificWriter))).toBe(
      false
    );
  });

  // --- The gap: read access must not leak into write access ---

  it("group GLOBAL_ROLE member whose role lacks write perms can READ but NOT update", async () => {
    // Reads the run (widened by the AuthCtx change) …
    const viewerDb = await getAuthDb(fixture!.groupGlobalViewer);
    const seen = await viewerDb.testRuns.findUnique({
      where: { id: fixture!.runId },
    });
    expect(seen).not.toBeNull();
    // … but cannot modify it.
    expect(await isDenied(() => tryUpdate(fixture!.groupGlobalViewer))).toBe(
      true
    );
  });

  // --- Nuance: group GLOBAL_ROLE grants update/delete but NOT create ---

  it("group GLOBAL_ROLE member (writer) is still DENIED create — create admits only SPECIFIC_ROLE groups", async () => {
    expect(await isDenied(() => tryCreate(fixture!.groupGlobalWriter))).toBe(
      true
    );
  });

  // --- Denials: NO_ACCESS and outsiders ---

  it("a per-user NO_ACCESS row denies update even though the role has the permission", async () => {
    expect(await isDenied(() => tryUpdate(fixture!.deniedUser))).toBe(true);
  });

  it("an outsider is denied update", async () => {
    expect(await isDenied(() => tryUpdate(fixture!.outsider))).toBe(true);
  });

  it("an outsider is denied create", async () => {
    expect(await isDenied(() => tryCreate(fixture!.outsider))).toBe(true);
  });
});
