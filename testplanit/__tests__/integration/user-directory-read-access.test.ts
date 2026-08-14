// End-to-end validation of the User model's collaborator-scoped read policy.
//
// The mocked differential test (lib/authContext.test.ts) proves the scope
// resolver reproduces the shared-project intersection. This proves the other
// half: that the scope is threaded into AuthCtx per request and filters User
// rows in real SQL — admins read everyone, everyone else reads themselves and
// users sharing ≥1 effectively-accessible project, across explicit grants,
// group grants, permissive defaults, and per-user NO_ACCESS carve-outs. It
// also covers the getUsersAccessibleProjects server action's caller scoping.
//
// Seeded projects with permissive defaults are temporarily flipped to
// NO_ACCESS (and restored in afterAll) so the locked-world assertions hold on
// any database state; run this file on the scratch DB, never a live one:
//   cd testplanit && RUN_DB_INTEGRATION=1 pnpm test user-directory-read-access --run
//
// Phase order matters: the "locked world" tests run before any fixture
// project with a permissive default exists, because such a project enters
// EVERY non-NONE user's accessible set and would open the directory globally.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRawDbClient } from "~/lib/rawDbClient";
import type { ProjectAccessType } from "~/zenstack/models";

import { getAuthDb } from "~/lib/zenstack";

const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: (...a: unknown[]) => mockGetServerSession(...a),
}));
vi.mock("~/server/auth", () => ({ authOptions: {} }));

import { getUsersAccessibleProjects } from "~/app/actions/getUserAccessibleProjects";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const TAG = `udra-${Date.now()}`;

type AuthUser = Awaited<ReturnType<typeof fetchAuthUser>>;

async function fetchAuthUser(userId: string) {
  return db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { role: { include: { rolePermissions: true } } },
  });
}

interface Fixture {
  p1Id: number; // NO_ACCESS default — the locked shared project
  p4Id: number; // NO_ACCESS default — private to collabPerm
  userRoleId: number;
  viewerLocked: AuthUser; // explicit permission on P1 only
  creator: AuthUser; // created P1
  collabPerm: AuthUser; // explicit permission on P1, plus private P4
  collabGroup: AuthUser; // group GLOBAL_ROLE on P1
  deniedUser: AuthUser; // in the granting group, but per-user NO_ACCESS on P1
  outsider: AuthUser; // USER access, no grants anywhere
  noneUser: AuthUser; // access NONE, no grants
  viewerOpen: AuthUser; // no rows at all — reaches phase B projects via defaults
  deniedOnOpen: AuthUser; // NO_ACCESS on BOTH phase B open projects
  deniedPartial: AuthUser; // NO_ACCESS on one of the two open projects
  assignedNone: AuthUser; // access NONE, assignment on the SPECIFIC_ROLE project
  admin: AuthUser;
}

let fixture: Fixture | null = null;
interface NeutralizedProject {
  id: number;
  defaultAccessType: ProjectAccessType;
}
let neutralized: NeutralizedProject[] = [];

async function setupFixture(): Promise<Fixture> {
  const userRole = await db.roles.findFirst({ where: { name: "user" } });
  if (!userRole) {
    throw new Error(
      "Dev DB missing seeded `user` role. Run `pnpm tsx db/seed.ts` first."
    );
  }

  // Flip every project with a permissive default to NO_ACCESS for the
  // duration of the suite (restored in afterAll). Includes soft-deleted
  // projects: the accessible-set resolver deliberately does not filter them.
  neutralized = await db.projects.findMany({
    where: { defaultAccessType: { not: "NO_ACCESS" } },
    select: { id: true, defaultAccessType: true },
  });
  if (neutralized.length > 0) {
    await db.projects.updateMany({
      where: { id: { in: neutralized.map((p) => p.id) } },
      data: { defaultAccessType: "NO_ACCESS" },
    });
  }

  const mkUser = (label: string, access: "USER" | "ADMIN" | "NONE") =>
    db.user.create({
      data: {
        email: `${TAG}-${label}@example.test`,
        name: `${TAG} ${label}`,
        access,
        roleId: userRole.id,
      },
    });

  const viewerLocked = await mkUser("viewerLocked", "USER");
  const creator = await mkUser("creator", "USER");
  const collabPerm = await mkUser("collabPerm", "USER");
  const collabGroup = await mkUser("collabGroup", "USER");
  const deniedUser = await mkUser("denied", "USER");
  const outsider = await mkUser("outsider", "USER");
  const noneUser = await mkUser("noneUser", "NONE");
  const viewerOpen = await mkUser("viewerOpen", "USER");
  const deniedOnOpen = await mkUser("deniedOnOpen", "USER");
  const deniedPartial = await mkUser("deniedPartial", "USER");
  const assignedNone = await mkUser("assignedNone", "NONE");
  const admin = await mkUser("admin", "ADMIN");

  const p1 = await db.projects.create({
    data: {
      name: `${TAG}-project-1`,
      createdBy: creator.id,
      defaultAccessType: "NO_ACCESS",
      defaultRoleId: null,
    },
  });
  const p4 = await db.projects.create({
    data: {
      name: `${TAG}-project-4-private`,
      createdBy: collabPerm.id,
      defaultAccessType: "NO_ACCESS",
      defaultRoleId: null,
    },
  });

  await db.userProjectPermission.createMany({
    data: [
      {
        userId: viewerLocked.id,
        projectId: p1.id,
        accessType: "SPECIFIC_ROLE",
      },
      { userId: collabPerm.id, projectId: p1.id, accessType: "SPECIFIC_ROLE" },
      { userId: deniedUser.id, projectId: p1.id, accessType: "NO_ACCESS" },
    ],
  });

  const group = await db.groups.create({
    data: {
      name: `${TAG}-group`,
      assignedUsers: {
        create: [{ userId: collabGroup.id }, { userId: deniedUser.id }],
      },
    },
  });
  await db.groupProjectPermission.create({
    data: {
      groupId: group.id,
      projectId: p1.id,
      accessType: "GLOBAL_ROLE",
      roleId: null,
    },
  });

  return {
    p1Id: p1.id,
    p4Id: p4.id,
    userRoleId: userRole.id,
    viewerLocked: await fetchAuthUser(viewerLocked.id),
    creator: await fetchAuthUser(creator.id),
    collabPerm: await fetchAuthUser(collabPerm.id),
    collabGroup: await fetchAuthUser(collabGroup.id),
    deniedUser: await fetchAuthUser(deniedUser.id),
    outsider: await fetchAuthUser(outsider.id),
    noneUser: await fetchAuthUser(noneUser.id),
    viewerOpen: await fetchAuthUser(viewerOpen.id),
    deniedOnOpen: await fetchAuthUser(deniedOnOpen.id),
    deniedPartial: await fetchAuthUser(deniedPartial.id),
    assignedNone: await fetchAuthUser(assignedNone.id),
    admin: await fetchAuthUser(admin.id),
  };
}

async function cleanupFixture(): Promise<void> {
  const safe = async (op: () => Promise<unknown>) => {
    try {
      await op();
    } catch {
      /* best-effort */
    }
  };
  await safe(() =>
    db.userProjectPermission.deleteMany({
      where: { project: { name: { startsWith: TAG } } },
    })
  );
  await safe(() =>
    db.projectAssignment.deleteMany({
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
  // Restore the neutralized project defaults, grouped by original value.
  const byType = new Map<NeutralizedProject["defaultAccessType"], number[]>();
  for (const p of neutralized) {
    const ids = byType.get(p.defaultAccessType) ?? [];
    ids.push(p.id);
    byType.set(p.defaultAccessType, ids);
  }
  for (const [defaultAccessType, ids] of byType) {
    await safe(() =>
      db.projects.updateMany({
        where: { id: { in: ids } },
        data: { defaultAccessType },
      })
    );
  }
}

beforeAll(async () => {
  if (!RUN_INTEGRATION || !HAS_DB_URL) return;
  fixture = await setupFixture();
}, 30_000);

afterAll(async () => {
  if (!RUN_INTEGRATION || !HAS_DB_URL) return;
  await cleanupFixture();
  await db.$disconnect();
}, 30_000);

/** Names of TAG fixture users a viewer can read, as short labels. */
async function visibleLabels(viewer: AuthUser): Promise<string[]> {
  const enhanced = await getAuthDb(viewer);
  const rows = await enhanced.user.findMany({
    where: { email: { startsWith: TAG } },
    select: { email: true },
  });
  return rows
    .map((r) => r.email.replace(`${TAG}-`, "").replace("@example.test", ""))
    .sort();
}

describeIntegration("locked world: only explicit grants share projects", () => {
  it("a viewer with one explicit project sees exactly its collaborators, themself, and admins", async () => {
    expect(await visibleLabels(fixture!.viewerLocked)).toEqual([
      "admin",
      "collabGroup",
      "collabPerm",
      "creator",
      "viewerLocked",
    ]);
  });

  it("user.count agrees with the filtered findMany", async () => {
    const enhanced = await getAuthDb(fixture!.viewerLocked);
    expect(
      await enhanced.user.count({ where: { email: { startsWith: TAG } } })
    ).toBe(5);
  });

  it("findUnique on a non-collaborator returns null; on a collaborator, the row", async () => {
    const enhanced = await getAuthDb(fixture!.viewerLocked);
    expect(
      await enhanced.user.findUnique({ where: { id: fixture!.outsider.id } })
    ).toBeNull();
    expect(
      await enhanced.user.findUnique({ where: { id: fixture!.collabPerm.id } })
    ).not.toBeNull();
  });

  it("a user with no projects sees only themself — not even admins", async () => {
    expect(await visibleLabels(fixture!.outsider)).toEqual(["outsider"]);
  });

  it("a per-user NO_ACCESS row cancels the group grant — the denied user sees only themself", async () => {
    expect(await visibleLabels(fixture!.deniedUser)).toEqual(["denied"]);
  });

  it("an ADMIN reads every user", async () => {
    const labels = await visibleLabels(fixture!.admin);
    expect(labels).toHaveLength(12);
    expect(labels).toContain("outsider");
    expect(labels).toContain("noneUser");
  });

  it("the projects-column action hides non-collaborators and unshared project names", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: fixture!.viewerLocked.id },
    });
    const result = await getUsersAccessibleProjects([
      fixture!.creator.id,
      fixture!.collabPerm.id,
      fixture!.outsider.id,
      fixture!.viewerLocked.id,
    ]);
    expect(result[fixture!.creator.id].map((p) => p.id)).toEqual([
      fixture!.p1Id,
    ]);
    // collabPerm also owns the private P4 — its name must not leak.
    expect(result[fixture!.collabPerm.id].map((p) => p.id)).toEqual([
      fixture!.p1Id,
    ]);
    expect(result[fixture!.outsider.id]).toEqual([]);
    expect(result[fixture!.viewerLocked.id].map((p) => p.id)).toEqual([
      fixture!.p1Id,
    ]);
  });

  it("the projects-column action returns full lists to admins and nothing when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: fixture!.admin.id } });
    const asAdmin = await getUsersAccessibleProjects([fixture!.collabPerm.id]);
    expect(asAdmin[fixture!.collabPerm.id].map((p) => p.id).sort()).toEqual(
      [fixture!.p1Id, fixture!.p4Id].sort()
    );

    mockGetServerSession.mockResolvedValue(null);
    expect(await getUsersAccessibleProjects([fixture!.collabPerm.id])).toEqual(
      {}
    );
  });
});

describeIntegration(
  "open world: permissive defaults share projects broadly",
  () => {
    beforeAll(async () => {
      // P2 (DEFAULT) and P3 (SPECIFIC_ROLE + role) enter every non-NONE user's
      // accessible set; from here on the locked-world expectations no longer
      // apply, which is why this block runs last.
      const p2 = await db.projects.create({
        data: {
          name: `${TAG}-project-2-open`,
          createdBy: fixture!.creator.id,
          defaultAccessType: "DEFAULT",
          defaultRoleId: null,
        },
      });
      const p3 = await db.projects.create({
        data: {
          name: `${TAG}-project-3-role`,
          createdBy: fixture!.creator.id,
          defaultAccessType: "SPECIFIC_ROLE",
          defaultRoleId: fixture!.userRoleId,
        },
      });
      await db.userProjectPermission.createMany({
        data: [
          {
            userId: fixture!.deniedOnOpen.id,
            projectId: p2.id,
            accessType: "NO_ACCESS",
          },
          {
            userId: fixture!.deniedOnOpen.id,
            projectId: p3.id,
            accessType: "NO_ACCESS",
          },
          {
            userId: fixture!.deniedPartial.id,
            projectId: p2.id,
            accessType: "NO_ACCESS",
          },
        ],
      });
      await db.projectAssignment.create({
        data: { userId: fixture!.assignedNone.id, projectId: p3.id },
      });
    }, 30_000);

    it("open defaults expose every non-NONE user; full NO_ACCESS coverage and NONE access stay hidden", async () => {
      const labels = await visibleLabels(fixture!.viewerOpen);
      // Everyone with USER/ADMIN access shares P2/P3 via defaults, except
      // deniedOnOpen (NO_ACCESS on both open projects, no other source).
      // noneUser is filtered by access; assignedNone (also NONE) is visible
      // through the explicit assignment on the SPECIFIC_ROLE-default P3.
      expect(labels).toEqual([
        "admin",
        "assignedNone",
        "collabGroup",
        "collabPerm",
        "creator",
        "denied",
        "deniedPartial",
        "outsider",
        "viewerLocked",
        "viewerOpen",
      ]);
    });

    it("a NO_ACCESS row on only one of the open projects does not hide a user", async () => {
      const enhanced = await getAuthDb(fixture!.viewerOpen);
      expect(
        await enhanced.user.findUnique({
          where: { id: fixture!.deniedPartial.id },
        })
      ).not.toBeNull();
      expect(
        await enhanced.user.findUnique({
          where: { id: fixture!.deniedOnOpen.id },
        })
      ).toBeNull();
    });
  }
);
