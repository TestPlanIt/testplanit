// Access-policy contract for project-scoped ShareLink rows.
//
// A per-user NO_ACCESS override on a project must keep that user from reading
// or creating the project's share links, even when the project's default
// access or a project assignment would otherwise let them in. A share link is
// always created in the name of the signed-in user.
//
// Run via:
//   cd testplanit && RUN_DB_INTEGRATION=1 pnpm test share-link-access --run

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRawDbClient } from "~/lib/rawDbClient";
import { getAuthDb } from "~/lib/zenstack";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const TAG = `sla-${Date.now()}`;

type AuthUser = Awaited<ReturnType<typeof fetchAuthUser>>;

async function fetchAuthUser(userId: string) {
  return db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { role: { include: { rolePermissions: true } } },
  });
}

/** True when the operation was refused, or silently filtered to nothing. */
async function isDenied(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    const result = await fn();
    if (result === null || result === undefined) return true;
    if (Array.isArray(result)) return result.length === 0;
    return false;
  } catch {
    return true;
  }
}

let keySeq = 0;
const shareData = (projectId: number | null, createdById: string) => ({
  shareKey: `${TAG}-${++keySeq}`.padEnd(32, "x"),
  entityType: "REPORT" as const,
  entityConfig: {},
  projectId,
  createdById,
  mode: "AUTHENTICATED" as const,
  title: `${TAG} share`,
});

interface Fixture {
  projectId: number;
  member: AuthUser; // reaches the project through its GLOBAL_ROLE default
  assignedBlocked: AuthUser; // assigned to the project, with NO_ACCESS
  defaultBlocked: AuthUser; // NO_ACCESS override on the GLOBAL_ROLE default
  memberShareId: string;
}

let fixture: Fixture | undefined;

async function setupFixture(): Promise<Fixture> {
  const role = await db.roles.create({
    data: {
      name: `${TAG}-role`,
      rolePermissions: { create: [{ area: "Reporting", canAddEdit: true }] },
    },
  });
  const mkUser = (label: string) =>
    db.user.create({
      data: {
        email: `${TAG}-${label}@example.test`,
        name: `${TAG} ${label}`,
        access: "USER",
        roleId: role.id,
      },
    });

  const creator = await mkUser("creator");
  const member = await mkUser("member");
  const assignedBlocked = await mkUser("assigned");
  const defaultBlocked = await mkUser("default");

  const project = await db.projects.create({
    data: {
      name: `${TAG}-project`,
      createdBy: creator.id,
      defaultAccessType: "GLOBAL_ROLE",
      defaultRoleId: null,
    },
  });
  await db.projectAssignment.createMany({
    data: [
      { userId: member.id, projectId: project.id },
      { userId: assignedBlocked.id, projectId: project.id },
    ],
  });
  await db.userProjectPermission.createMany({
    data: [assignedBlocked.id, defaultBlocked.id].map((userId) => ({
      userId,
      projectId: project.id,
      accessType: "NO_ACCESS" as const,
      roleId: null,
    })),
  });

  const memberShare = await db.shareLink.create({
    data: shareData(project.id, member.id),
  });

  return {
    projectId: project.id,
    member: await fetchAuthUser(member.id),
    assignedBlocked: await fetchAuthUser(assignedBlocked.id),
    defaultBlocked: await fetchAuthUser(defaultBlocked.id),
    memberShareId: memberShare.id,
  };
}

async function teardown() {
  await db.shareLink.deleteMany({ where: { title: `${TAG} share` } });
  if (fixture) {
    await db.userProjectPermission.deleteMany({
      where: { projectId: fixture.projectId },
    });
    await db.projectAssignment.deleteMany({
      where: { projectId: fixture.projectId },
    });
    await db.projects.deleteMany({ where: { id: fixture.projectId } });
  }
  await db.user.deleteMany({ where: { email: { startsWith: TAG } } });
  await db.roles.deleteMany({ where: { name: { startsWith: TAG } } });
}

describeIntegration("ShareLink access policy", () => {
  beforeAll(async () => {
    fixture = await setupFixture();
  }, 60_000);

  afterAll(async () => {
    await teardown();
  }, 60_000);

  it("lets a project member create and read project share links", async () => {
    const f = fixture!;
    const memberDb = (await getAuthDb(f.member)) as any;

    const created = await memberDb.shareLink.create({
      data: shareData(f.projectId, f.member.id),
    });
    expect(created.id).toBeTruthy();

    const found = await memberDb.shareLink.findFirst({
      where: { id: f.memberShareId },
    });
    expect(found?.id).toBe(f.memberShareId);
  });

  it("hides project share links from an assigned user with NO_ACCESS", async () => {
    const f = fixture!;
    const blockedDb = (await getAuthDb(f.assignedBlocked)) as any;

    expect(
      await isDenied(() =>
        blockedDb.shareLink.findFirst({ where: { id: f.memberShareId } })
      )
    ).toBe(true);
  });

  it("refuses project share links from users with a NO_ACCESS override", async () => {
    const f = fixture!;
    for (const user of [f.defaultBlocked, f.assignedBlocked]) {
      const blockedDb = (await getAuthDb(user)) as any;
      expect(
        await isDenied(() =>
          blockedDb.shareLink.create({
            data: shareData(f.projectId, user.id),
          })
        )
      ).toBe(true);
    }
  });

  it("refuses share links created in someone else's name", async () => {
    const f = fixture!;
    const blockedDb = (await getAuthDb(f.defaultBlocked)) as any;
    const memberDb = (await getAuthDb(f.member)) as any;

    expect(
      await isDenied(() =>
        blockedDb.shareLink.create({ data: shareData(null, f.member.id) })
      )
    ).toBe(true);
    expect(
      await isDenied(() =>
        memberDb.shareLink.create({
          data: shareData(f.projectId, f.defaultBlocked.id),
        })
      )
    ).toBe(true);
  });

  it("still lets a user create a cross-project share link", async () => {
    const f = fixture!;
    const blockedDb = (await getAuthDb(f.defaultBlocked)) as any;

    const created = await blockedDb.shareLink.create({
      data: shareData(null, f.defaultBlocked.id),
    });
    expect(created.id).toBeTruthy();
  });
});
