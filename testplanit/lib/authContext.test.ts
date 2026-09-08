import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Differential test for resolveAccessibleProjectIds.
 *
 * The resolver replaced a per-row ZenStack read policy. To trust it we prove it
 * returns exactly the set of projects the ORIGINAL 8-branch @@allow('read')
 * predicate would have matched — encoded here as an independent reference
 * oracle taken verbatim from schema.zmodel @ 152eccb41 — across the full
 * permission matrix (4 access levels x role x 4 default types x default-role x
 * creator x 4 user-perm states x assignment x 4 group-grant states = 4096
 * combinations).
 *
 * The oracle is the raw @@allow read set. It deliberately does NOT apply the
 * model-level @@deny('all', auth().access == 'NONE'): that deny is retained on
 * each model and applied by the policy layer per model, so accessibleProjectIds
 * must equal the @@allow set alone. This is why NONE users are not special-cased
 * (ProjectIntegration, which lacks the NONE deny, relied on that).
 */

const mockProjectsFindMany = vi.fn();
const mockUppFindMany = vi.fn();
const mockGppFindMany = vi.fn();
const mockAssignmentFindMany = vi.fn();

/**
 * Valkey null so the differential matrix below runs UNCACHED.
 *
 * It sweeps 4096 permission combinations through the same user id, so a live
 * cache would serve combination 1's answer for all of them and the oracle
 * comparison would be meaningless. Previously this held only because VALKEY_URL
 * happens to be unset in the test environment — pinning it makes the matrix
 * deterministic regardless of environment. The cache itself is covered by the
 * block at the bottom of this file, which injects its own client.
 */
vi.mock("./valkey", () => ({ default: null }));

vi.mock("~/lib/db", () => ({
  baseDb: {
    projects: { findMany: (...a: unknown[]) => mockProjectsFindMany(...a) },
    userProjectPermission: {
      findMany: (...a: unknown[]) => mockUppFindMany(...a),
    },
    groupProjectPermission: {
      findMany: (...a: unknown[]) => mockGppFindMany(...a),
    },
    projectAssignment: {
      findMany: (...a: unknown[]) => mockAssignmentFindMany(...a),
    },
  },
}));

import {
  collaboratorScopeIncludes,
  resolveAccessibleProjectIds,
  resolveCollaboratorScope,
  type UserForAuth,
} from "./authContext";

type Access = "NONE" | "USER" | "PROJECTADMIN" | "ADMIN";
type DefaultType = "NO_ACCESS" | "GLOBAL_ROLE" | "SPECIFIC_ROLE" | "DEFAULT";
type UserPerm = "none" | "NO_ACCESS" | "SPECIFIC_ROLE" | "GLOBAL_ROLE";
type GroupGrant =
  "none" | "SPECIFIC_ROLE+role" | "SPECIFIC_ROLE+norole" | "GLOBAL_ROLE";

interface ProjectCase {
  id: number;
  defaultAccessType: DefaultType;
  defaultRoleId: number | null;
  isCreator: boolean;
  userPerm: UserPerm;
  assigned: boolean;
  groupGrant: GroupGrant;
}

/**
 * Reference oracle — the original per-row read predicate, transcribed branch for
 * branch. `accessible` == `@@allow` holds AND NOT `@@deny(NO_ACCESS userPerm)`.
 */
function oracleAccessible(user: UserForAuth, p: ProjectCase): boolean {
  const hasRole = user.roleId != null;
  const notNone = user.access !== "NONE";

  // @@deny('read', userPermissions?[… NO_ACCESS]) — outranks every allow.
  if (p.userPerm === "NO_ACCESS") return false;

  const groupAllows =
    p.groupGrant === "SPECIFIC_ROLE+role" || // SPECIFIC_ROLE && role != null
    (p.groupGrant === "GLOBAL_ROLE" && hasRole); // GLOBAL_ROLE && auth().role != null
  // SPECIFIC_ROLE+norole → role == null → branch fails (matches `role != null`)

  return (
    p.isCreator || // project.creator == auth()
    p.userPerm === "SPECIFIC_ROLE" || // userPermissions?[… SPECIFIC_ROLE]
    p.userPerm === "GLOBAL_ROLE" || // userPermissions?[… GLOBAL_ROLE] (no role check)
    groupAllows ||
    (p.defaultAccessType === "GLOBAL_ROLE" && hasRole && notNone) ||
    (p.assigned &&
      p.defaultAccessType === "SPECIFIC_ROLE" &&
      p.defaultRoleId != null) ||
    (p.defaultAccessType === "SPECIFIC_ROLE" &&
      p.defaultRoleId != null &&
      notNone) ||
    (p.defaultAccessType === "DEFAULT" && notNone)
  );
}

const ACCESS: Access[] = ["NONE", "USER", "PROJECTADMIN", "ADMIN"];
const DEFAULTS: DefaultType[] = [
  "NO_ACCESS",
  "GLOBAL_ROLE",
  "SPECIFIC_ROLE",
  "DEFAULT",
];
const USER_PERMS: UserPerm[] = [
  "none",
  "NO_ACCESS",
  "SPECIFIC_ROLE",
  "GLOBAL_ROLE",
];
const GROUP_GRANTS: GroupGrant[] = [
  "none",
  "SPECIFIC_ROLE+role",
  "SPECIFIC_ROLE+norole",
  "GLOBAL_ROLE",
];

const USER_ID = "user-under-test";

/** Wire the four mocked baseDb reads from a set of project cases. */
function wireMocks(user: UserForAuth, cases: ProjectCase[]) {
  mockProjectsFindMany.mockResolvedValue(
    cases.map((c) => ({
      id: c.id,
      createdBy: c.isCreator ? user.id : "someone-else",
      defaultAccessType: c.defaultAccessType,
      defaultRoleId: c.defaultRoleId,
    }))
  );
  mockUppFindMany.mockResolvedValue(
    cases
      .filter((c) => c.userPerm !== "none")
      .map((c) => ({ projectId: c.id, accessType: c.userPerm }))
  );
  mockGppFindMany.mockResolvedValue(
    cases
      .filter((c) => c.groupGrant !== "none")
      .map((c) => ({
        projectId: c.id,
        accessType: c.groupGrant.startsWith("SPECIFIC_ROLE")
          ? "SPECIFIC_ROLE"
          : "GLOBAL_ROLE",
        roleId: c.groupGrant === "SPECIFIC_ROLE+role" ? 5 : null,
      }))
  );
  mockAssignmentFindMany.mockResolvedValue(
    cases.filter((c) => c.assigned).map((c) => ({ projectId: c.id }))
  );
}

describe("resolveAccessibleProjectIds — differential vs original read policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Enumerate every project shape once per user shape. Each combination is a
  // single project fed through the resolver; assert membership matches the
  // oracle. Reported as one test per (access, roleId) so a failure localizes.
  for (const access of ACCESS) {
    for (const roleId of [null, 7] as const) {
      it(`matches the oracle for access=${access} role=${roleId ?? "null"} across all 512 project shapes`, async () => {
        const user: UserForAuth = {
          id: USER_ID,
          access,
          roleId,
          role: roleId ? { id: roleId, name: "r", rolePermissions: [] } : null,
        };

        const cases: ProjectCase[] = [];
        let id = 1;
        for (const defaultAccessType of DEFAULTS)
          for (const defaultRoleId of [null, 5] as const)
            for (const isCreator of [false, true])
              for (const userPerm of USER_PERMS)
                for (const assigned of [false, true])
                  for (const groupGrant of GROUP_GRANTS)
                    cases.push({
                      id: id++,
                      defaultAccessType,
                      defaultRoleId,
                      isCreator,
                      userPerm,
                      assigned,
                      groupGrant,
                    });

        wireMocks(user, cases);
        const got = new Set(await resolveAccessibleProjectIds(user));
        const expected = new Set(
          cases.filter((c) => oracleAccessible(user, c)).map((c) => c.id)
        );

        // Precise diff on failure.
        const missing = [...expected].filter((x) => !got.has(x));
        const extra = [...got].filter((x) => !expected.has(x));
        const describe = (pid: number) => {
          const c = cases.find((x) => x.id === pid)!;
          return `#${pid}{${c.defaultAccessType},defaultRole=${c.defaultRoleId},creator=${c.isCreator},userPerm=${c.userPerm},assigned=${c.assigned},group=${c.groupGrant}}`;
        };
        expect(
          missing.map(describe),
          "granted by oracle, denied by resolver"
        ).toEqual([]);
        expect(
          extra.map(describe),
          "granted by resolver, denied by oracle"
        ).toEqual([]);
      });
    }
  }
});

describe("resolveAccessibleProjectIds — named scenarios from the permissions guide", () => {
  beforeEach(() => vi.clearAllMocks());

  const user = (over: Partial<UserForAuth> = {}): UserForAuth => ({
    id: USER_ID,
    access: "USER",
    roleId: 7,
    role: { id: 7, name: "Dev", rolePermissions: [] },
    ...over,
  });

  async function resolveFor(
    u: UserForAuth,
    project: {
      id?: number;
      defaultAccessType: DefaultType;
      defaultRoleId?: number | null;
      createdBy?: string;
    },
    opts: {
      userPerm?: UserPerm;
      assigned?: boolean;
      group?: {
        accessType: "SPECIFIC_ROLE" | "GLOBAL_ROLE";
        roleId: number | null;
      };
    } = {}
  ) {
    const id = project.id ?? 1;
    mockProjectsFindMany.mockResolvedValue([
      {
        id,
        createdBy: project.createdBy ?? "owner",
        defaultAccessType: project.defaultAccessType,
        defaultRoleId: project.defaultRoleId ?? null,
      },
    ]);
    mockUppFindMany.mockResolvedValue(
      opts.userPerm && opts.userPerm !== "none"
        ? [{ projectId: id, accessType: opts.userPerm }]
        : []
    );
    mockGppFindMany.mockResolvedValue(
      opts.group
        ? [
            {
              projectId: id,
              accessType: opts.group.accessType,
              roleId: opts.group.roleId,
            },
          ]
        : []
    );
    mockAssignmentFindMany.mockResolvedValue(
      opts.assigned ? [{ projectId: id }] : []
    );
    return new Set(await resolveAccessibleProjectIds(u));
  }

  it("NO_ACCESS default with no explicit grant → denied", async () => {
    expect(
      await resolveFor(user(), { defaultAccessType: "NO_ACCESS" })
    ).not.toContain(1);
  });

  it("per-user NO_ACCESS overrides an otherwise-granting default", async () => {
    const got = await resolveFor(
      user(),
      { defaultAccessType: "GLOBAL_ROLE" },
      { userPerm: "NO_ACCESS" }
    );
    expect(got).not.toContain(1);
  });

  it("project creator is granted even on a NO_ACCESS project", async () => {
    const got = await resolveFor(user(), {
      defaultAccessType: "NO_ACCESS",
      createdBy: USER_ID,
    });
    expect(got).toContain(1);
  });

  it("GLOBAL_ROLE default requires the user to hold a global role", async () => {
    expect(
      await resolveFor(user({ roleId: null, role: null }), {
        defaultAccessType: "GLOBAL_ROLE",
      })
    ).not.toContain(1);
    expect(
      await resolveFor(user(), { defaultAccessType: "GLOBAL_ROLE" })
    ).toContain(1);
  });

  it("SPECIFIC_ROLE default grants only when a default role is set", async () => {
    expect(
      await resolveFor(user(), {
        defaultAccessType: "SPECIFIC_ROLE",
        defaultRoleId: null,
      })
    ).not.toContain(1);
    expect(
      await resolveFor(user(), {
        defaultAccessType: "SPECIFIC_ROLE",
        defaultRoleId: 5,
      })
    ).toContain(1);
  });

  it("group SPECIFIC_ROLE grants only with a role; GLOBAL_ROLE needs the user's global role", async () => {
    // SPECIFIC_ROLE with a null role → no grant (matches `role != null`)
    expect(
      await resolveFor(
        user(),
        { defaultAccessType: "NO_ACCESS" },
        { group: { accessType: "SPECIFIC_ROLE", roleId: null } }
      )
    ).not.toContain(1);
    // SPECIFIC_ROLE with a role → grant
    expect(
      await resolveFor(
        user(),
        { defaultAccessType: "NO_ACCESS" },
        { group: { accessType: "SPECIFIC_ROLE", roleId: 5 } }
      )
    ).toContain(1);
    // GLOBAL_ROLE + user has a role → grant
    expect(
      await resolveFor(
        user(),
        { defaultAccessType: "NO_ACCESS" },
        { group: { accessType: "GLOBAL_ROLE", roleId: null } }
      )
    ).toContain(1);
    // GLOBAL_ROLE + user has NO role → no grant
    expect(
      await resolveFor(
        user({ roleId: null, role: null }),
        { defaultAccessType: "NO_ACCESS" },
        { group: { accessType: "GLOBAL_ROLE", roleId: null } }
      )
    ).not.toContain(1);
  });

  it("an explicit GLOBAL_ROLE user permission grants even without a global role (asymmetry vs default)", async () => {
    // Mirrors the original: the userPermissions GLOBAL_ROLE branch has no
    // `auth().role != null` guard, unlike the GLOBAL_ROLE *default* branch.
    const got = await resolveFor(
      user({ roleId: null, role: null }),
      { defaultAccessType: "NO_ACCESS" },
      { userPerm: "GLOBAL_ROLE" }
    );
    expect(got).toContain(1);
  });

  it("DEFAULT-type project grants any non-NONE user", async () => {
    expect(
      await resolveFor(user(), { defaultAccessType: "DEFAULT" })
    ).toContain(1);
    expect(
      await resolveFor(user({ access: "NONE" }), {
        defaultAccessType: "DEFAULT",
      })
    ).not.toContain(1);
  });
});

/**
 * Differential test for resolveCollaboratorScope + collaboratorScopeIncludes.
 *
 * The reference semantics: target is visible to viewer iff their EFFECTIVE
 * project sets intersect — where each side's effective set is the ladder the
 * oracle above transcribes, except that ADMIN access reaches every project
 * (the model policies' blanket ADMIN allow). The scope representation
 * (explicit ids + default-class flags + denial carve-outs) must reproduce
 * that intersection exactly for every relationship shape.
 *
 * The mocks here honor the queries' where-clauses against an in-memory
 * fixture, because computeCollaboratorScope's correctness depends on its
 * queries being scoped to the viewer's accessible projects.
 */
interface FixtureDb {
  projects: Array<{
    id: number;
    createdBy: string | null;
    defaultAccessType: DefaultType;
    defaultRoleId: number | null;
  }>;
  upp: Array<{ userId: string; projectId: number; accessType: UserPerm }>;
  gpp: Array<{
    projectId: number;
    accessType: "SPECIFIC_ROLE" | "GLOBAL_ROLE";
    roleId: number | null;
    members: string[];
  }>;
  assignments: Array<{ userId: string; projectId: number }>;
}

function wireFixtureDb(db: FixtureDb) {
  mockProjectsFindMany.mockImplementation(async (args?: any) => {
    const ids: number[] | undefined = args?.where?.id?.in;
    return db.projects.filter((p) => !ids || ids.includes(p.id));
  });
  mockUppFindMany.mockImplementation(async (args?: any) => {
    const w = args?.where ?? {};
    return db.upp.filter(
      (r) =>
        (w.userId === undefined || r.userId === w.userId) &&
        (w.projectId?.in === undefined || w.projectId.in.includes(r.projectId))
    );
  });
  mockGppFindMany.mockImplementation(async (args?: any) => {
    const w = args?.where ?? {};
    // Inverse-resolver shape: rows on a project set, with group members.
    if (w.projectId?.in !== undefined) {
      return db.gpp
        .filter((r) => w.projectId.in.includes(r.projectId))
        .map((r) => ({
          projectId: r.projectId,
          accessType: r.accessType,
          roleId: r.roleId,
          group: { assignedUsers: r.members.map((userId) => ({ userId })) },
        }));
    }
    // Forward-resolver shape: rows of groups containing one user.
    const uid = w.group?.assignedUsers?.some?.userId;
    return db.gpp
      .filter((r) => uid !== undefined && r.members.includes(uid))
      .map((r) => ({
        projectId: r.projectId,
        accessType: r.accessType,
        roleId: r.roleId,
      }));
  });
  mockAssignmentFindMany.mockImplementation(async (args?: any) => {
    const w = args?.where ?? {};
    return db.assignments
      .filter(
        (r) =>
          (w.userId === undefined || r.userId === w.userId) &&
          (w.projectId?.in === undefined ||
            w.projectId.in.includes(r.projectId))
      )
      .map((r) => ({ userId: r.userId, projectId: r.projectId }));
  });
}

const VIEWER_ID = "viewer-under-test";
const TARGET_ID = "target-under-test";

/** Relationship of one user to one project, matching the matrix axes above. */
interface Rel {
  creator: boolean;
  userPerm: UserPerm;
  assigned: boolean;
  groupGrant: GroupGrant;
}

function addRelToFixture(
  db: FixtureDb,
  userId: string,
  projectId: number,
  rel: Rel
) {
  if (rel.creator) {
    db.projects.find((p) => p.id === projectId)!.createdBy = userId;
  }
  if (rel.userPerm !== "none") {
    db.upp.push({ userId, projectId, accessType: rel.userPerm });
  }
  if (rel.assigned) {
    db.assignments.push({ userId, projectId });
  }
  if (rel.groupGrant !== "none") {
    db.gpp.push({
      projectId,
      accessType: rel.groupGrant.startsWith("SPECIFIC_ROLE")
        ? "SPECIFIC_ROLE"
        : "GLOBAL_ROLE",
      roleId: rel.groupGrant === "SPECIFIC_ROLE+role" ? 5 : null,
      members: [userId],
    });
  }
}

describe("resolveCollaboratorScope — differential vs shared-project oracle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const ALL_RELS: Rel[] = [];
  for (const creator of [false, true])
    for (const userPerm of USER_PERMS)
      for (const assigned of [false, true])
        for (const groupGrant of GROUP_GRANTS)
          ALL_RELS.push({ creator, userPerm, assigned, groupGrant });

  // Viewer relationship collapses to has-access / no-access: the forward
  // resolver deriving the viewer's set is already differentially tested above.
  const VIEWER_RELS: Array<{ label: string; rel: Rel }> = [
    {
      label: "viewer-has-project",
      rel: {
        creator: false,
        userPerm: "SPECIFIC_ROLE",
        assigned: false,
        groupGrant: "none",
      },
    },
    {
      label: "viewer-has-nothing",
      rel: {
        creator: false,
        userPerm: "none",
        assigned: false,
        groupGrant: "none",
      },
    },
  ];

  for (const { label, rel: viewerRel } of VIEWER_RELS) {
    for (const targetAccess of ["USER", "NONE", "ADMIN"] as const) {
      it(`matches the oracle for ${label}, target access=${targetAccess}, across all 512 (default × target-rel) shapes`, async () => {
        const viewer: UserForAuth = {
          id: VIEWER_ID,
          access: "USER",
          roleId: 7,
          role: null,
        };
        // Targets always carry a global role: User.roleId is non-nullable.
        const target: UserForAuth = {
          id: TARGET_ID,
          access: targetAccess,
          roleId: 7,
          role: null,
        };

        const mismatches: string[] = [];
        for (const defaultAccessType of DEFAULTS) {
          for (const defaultRoleId of [null, 5] as const) {
            for (const targetRel of ALL_RELS) {
              // A project has a single creator column.
              if (viewerRel.creator && targetRel.creator) continue;

              const db: FixtureDb = {
                projects: [
                  {
                    id: 1,
                    createdBy: "someone-else",
                    defaultAccessType,
                    defaultRoleId,
                  },
                ],
                upp: [],
                gpp: [],
                assignments: [],
              };
              addRelToFixture(db, VIEWER_ID, 1, viewerRel);
              addRelToFixture(db, TARGET_ID, 1, targetRel);
              wireFixtureDb(db);

              const scope = await resolveCollaboratorScope(viewer);
              const visible = collaboratorScopeIncludes(scope, {
                id: TARGET_ID,
                access: targetAccess,
              });

              const asCase = (rel: Rel): ProjectCase => ({
                id: 1,
                defaultAccessType,
                defaultRoleId,
                isCreator: rel.creator,
                userPerm: rel.userPerm,
                assigned: rel.assigned,
                groupGrant: rel.groupGrant,
              });
              const viewerHas = oracleAccessible(viewer, asCase(viewerRel));
              // ADMIN reaches every project via the blanket policy allow, so
              // the target shares whatever the viewer has.
              const targetHas =
                targetAccess === "ADMIN"
                  ? viewerHas
                  : oracleAccessible(target, asCase(targetRel));
              const expected = viewerHas && targetHas;

              if (visible !== expected) {
                mismatches.push(
                  `default=${defaultAccessType}/${defaultRoleId} targetRel=${JSON.stringify(
                    targetRel
                  )} → got ${visible}, oracle ${expected}`
                );
              }
            }
          }
        }
        expect(mismatches).toEqual([]);
      });
    }
  }
});

describe("resolveCollaboratorScope — named scenarios", () => {
  beforeEach(() => vi.clearAllMocks());

  const viewer: UserForAuth = {
    id: VIEWER_ID,
    access: "USER",
    roleId: 7,
    role: null,
  };

  /** Viewer holds an explicit permission on every listed project. */
  function fixtureWithViewerOn(projectIds: number[]): FixtureDb {
    const db: FixtureDb = {
      projects: projectIds.map((id) => ({
        id,
        createdBy: "someone-else",
        defaultAccessType: "NO_ACCESS",
        defaultRoleId: null,
      })),
      upp: projectIds.map((projectId) => ({
        userId: VIEWER_ID,
        projectId,
        accessType: "SPECIFIC_ROLE" as UserPerm,
      })),
      gpp: [],
      assignments: [],
    };
    return db;
  }

  it("a NO_ACCESS row on one of two open-default shared projects still leaves the target visible", async () => {
    const db = fixtureWithViewerOn([1, 2]);
    db.projects[0].defaultAccessType = "DEFAULT";
    db.projects[1].defaultAccessType = "DEFAULT";
    db.upp.push({ userId: TARGET_ID, projectId: 1, accessType: "NO_ACCESS" });
    wireFixtureDb(db);

    const scope = await resolveCollaboratorScope(viewer);
    expect(scope.viaOpenDefault).toBe(true);
    expect(scope.openDefaultDenied).not.toContain(TARGET_ID);
    expect(
      collaboratorScopeIncludes(scope, { id: TARGET_ID, access: "USER" })
    ).toBe(true);
  });

  it("NO_ACCESS rows covering every open-default shared project hide the target", async () => {
    const db = fixtureWithViewerOn([1, 2]);
    db.projects[0].defaultAccessType = "DEFAULT";
    db.projects[1].defaultAccessType = "DEFAULT";
    db.upp.push(
      { userId: TARGET_ID, projectId: 1, accessType: "NO_ACCESS" },
      { userId: TARGET_ID, projectId: 2, accessType: "NO_ACCESS" }
    );
    wireFixtureDb(db);

    const scope = await resolveCollaboratorScope(viewer);
    expect(scope.openDefaultDenied).toContain(TARGET_ID);
    expect(
      collaboratorScopeIncludes(scope, { id: TARGET_ID, access: "USER" })
    ).toBe(false);
  });

  it("an explicit grant elsewhere overrides a full default-class denial", async () => {
    const db = fixtureWithViewerOn([1, 2, 3]);
    db.projects[0].defaultAccessType = "DEFAULT";
    db.projects[1].defaultAccessType = "DEFAULT";
    db.upp.push(
      { userId: TARGET_ID, projectId: 1, accessType: "NO_ACCESS" },
      { userId: TARGET_ID, projectId: 2, accessType: "NO_ACCESS" },
      { userId: TARGET_ID, projectId: 3, accessType: "SPECIFIC_ROLE" }
    );
    wireFixtureDb(db);

    const scope = await resolveCollaboratorScope(viewer);
    expect(scope.userIds).toContain(TARGET_ID);
    expect(
      collaboratorScopeIncludes(scope, { id: TARGET_ID, access: "USER" })
    ).toBe(true);
  });

  it("an assignment on a SPECIFIC_ROLE-default project grants even a NONE-access target", async () => {
    const db = fixtureWithViewerOn([1]);
    db.projects[0].defaultAccessType = "SPECIFIC_ROLE";
    db.projects[0].defaultRoleId = 5;
    db.assignments.push({ userId: TARGET_ID, projectId: 1 });
    wireFixtureDb(db);

    const scope = await resolveCollaboratorScope(viewer);
    expect(scope.userIds).toContain(TARGET_ID);
    expect(
      collaboratorScopeIncludes(scope, { id: TARGET_ID, access: "NONE" })
    ).toBe(true);
  });

  it("the viewer is not listed among their own collaborator ids", async () => {
    const db = fixtureWithViewerOn([1]);
    wireFixtureDb(db);

    const scope = await resolveCollaboratorScope(viewer);
    expect(scope.userIds).not.toContain(VIEWER_ID);
  });

  it("a viewer with no accessible projects shares nothing — not even admins", async () => {
    const db: FixtureDb = {
      projects: [
        {
          id: 1,
          createdBy: "someone-else",
          defaultAccessType: "NO_ACCESS",
          defaultRoleId: null,
        },
      ],
      upp: [],
      gpp: [],
      assignments: [],
    };
    wireFixtureDb(db);

    const scope = await resolveCollaboratorScope(viewer);
    expect(scope).toMatchObject({
      all: false,
      userIds: [],
      viaOpenDefault: false,
      viaGlobalRoleDefault: false,
      viaAdminAccess: false,
    });
    expect(
      collaboratorScopeIncludes(scope, { id: "some-admin", access: "ADMIN" })
    ).toBe(false);
  });

  it("an ADMIN viewer sees everyone without touching the database", async () => {
    const scope = await resolveCollaboratorScope({
      id: VIEWER_ID,
      access: "ADMIN",
      roleId: 7,
      role: null,
    });
    expect(scope.all).toBe(true);
    expect(
      collaboratorScopeIncludes(scope, { id: "anyone", access: "NONE" })
    ).toBe(true);
    expect(mockProjectsFindMany).not.toHaveBeenCalled();
  });

  it("a GLOBAL_ROLE-default shared project exposes role-holders but not NONE users", async () => {
    const db = fixtureWithViewerOn([1]);
    db.projects[0].defaultAccessType = "GLOBAL_ROLE";
    wireFixtureDb(db);

    const scope = await resolveCollaboratorScope(viewer);
    expect(scope.viaGlobalRoleDefault).toBe(true);
    expect(
      collaboratorScopeIncludes(scope, { id: TARGET_ID, access: "USER" })
    ).toBe(true);
    expect(
      collaboratorScopeIncludes(scope, { id: TARGET_ID, access: "NONE" })
    ).toBe(false);
  });

  it("a group SPECIFIC_ROLE grant without a role does not expose its members", async () => {
    const db = fixtureWithViewerOn([1]);
    db.gpp.push({
      projectId: 1,
      accessType: "SPECIFIC_ROLE",
      roleId: null,
      members: [TARGET_ID],
    });
    wireFixtureDb(db);

    const scope = await resolveCollaboratorScope(viewer);
    expect(scope.userIds).not.toContain(TARGET_ID);
  });
});

/**
 * The 60s Valkey cache added 2026-08-13.
 *
 * Why it exists: the four queries computeAccessibleProjectIds fans out to were
 * 37% of ALL database queries on the instance (permission checks of all kinds
 * were 69%). Each is sub-millisecond, so the cost was never Postgres CPU — it
 * was that every one is a round trip whose Prisma serialization runs on the
 * single Next.js JS thread, the resource that was actually saturating.
 *
 * These inject their own client via resetModules + doMock, because the module
 * reads valkeyConnection at import time.
 */
describe("resolveAccessibleProjectIds — Valkey cache", () => {
  function makeFakeValkey() {
    const store = new Map<string, string>();
    const ttls = new Map<string, number>();
    const globToRe = (p: string) =>
      new RegExp(
        "^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"
      );
    return {
      store,
      ttls,
      redis: {
        get: vi.fn(async (k: string) => store.get(k) ?? null),
        mget: vi.fn(async (...ks: string[]) =>
          ks.map((k) => store.get(k) ?? null)
        ),
        set: vi.fn(async (k: string, v: string, _ex: string, ttl: number) => {
          store.set(k, v);
          ttls.set(k, ttl);
          return "OK";
        }),
        keys: vi.fn(async (pattern: string) =>
          [...store.keys()].filter((k) => globToRe(pattern).test(k))
        ),
        del: vi.fn(async (...ks: string[]) => {
          let n = 0;
          for (const k of ks) if (store.delete(k)) n++;
          return n;
        }),
      },
    };
  }

  // One project, created by the user, so the answer is unambiguously [1].
  function primeDb() {
    mockProjectsFindMany.mockResolvedValue([
      {
        id: 1,
        createdBy: "u1",
        defaultAccessType: "NO_ACCESS",
        defaultRoleId: null,
      },
    ]);
    mockUppFindMany.mockResolvedValue([]);
    mockGppFindMany.mockResolvedValue([]);
    mockAssignmentFindMany.mockResolvedValue([]);
  }

  async function withValkey(redis: unknown) {
    vi.resetModules();
    vi.doMock("./valkey", () => ({ default: redis }));
    return import("./authContext");
  }

  const viewer: UserForAuth = {
    id: "u1",
    access: "USER",
    roleId: 7,
    role: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    primeDb();
  });

  afterEach(() => {
    vi.doUnmock("./valkey");
  });

  it("serves the second call from cache without touching the database", async () => {
    const { redis } = makeFakeValkey();
    const mod = await withValkey(redis);

    expect(await mod.resolveAccessibleProjectIds(viewer)).toEqual([1]);
    expect(mockProjectsFindMany).toHaveBeenCalledTimes(1);

    expect(await mod.resolveAccessibleProjectIds(viewer)).toEqual([1]);
    // Still 1: the four-query fan-out did not run again.
    expect(mockProjectsFindMany).toHaveBeenCalledTimes(1);
    expect(mockGppFindMany).toHaveBeenCalledTimes(1);
  });

  it("expires the entry after 60s, matching the access-manifest cache", async () => {
    const { redis, ttls } = makeFakeValkey();
    const mod = await withValkey(redis);

    await mod.resolveAccessibleProjectIds(viewer);

    expect([...ttls.values()]).toEqual([60]);
  });

  it("takes a role or access change into account immediately", async () => {
    const { redis } = makeFakeValkey();
    const mod = await withValkey(redis);

    await mod.resolveAccessibleProjectIds(viewer);
    expect(mockProjectsFindMany).toHaveBeenCalledTimes(1);

    // roleId and access are part of the cache key, so these must NOT be served
    // the previous answer — a demoted user would otherwise keep their old
    // project list for up to a minute.
    await mod.resolveAccessibleProjectIds({ ...viewer, roleId: 9 });
    expect(mockProjectsFindMany).toHaveBeenCalledTimes(2);

    await mod.resolveAccessibleProjectIds({ ...viewer, access: "NONE" });
    expect(mockProjectsFindMany).toHaveBeenCalledTimes(3);
  });

  it("falls through to the database when Valkey fails, rather than denying access", async () => {
    const boom = {
      get: vi.fn(async () => {
        throw new Error("valkey down");
      }),
      set: vi.fn(async () => {
        throw new Error("valkey down");
      }),
      keys: vi.fn(async () => []),
      del: vi.fn(async () => 0),
    };
    const mod = await withValkey(boom);

    // Fails OPEN: an empty list here would silently deny every project-scoped
    // read for the request.
    expect(await mod.resolveAccessibleProjectIds(viewer)).toEqual([1]);
    expect(mockProjectsFindMany).toHaveBeenCalledTimes(1);
  });

  it("invalidateAccessibleProjectIds drops every entry for that user", async () => {
    const { redis, store } = makeFakeValkey();
    const mod = await withValkey(redis);

    await mod.resolveAccessibleProjectIds(viewer);
    await mod.resolveAccessibleProjectIds({ ...viewer, roleId: 9 });
    expect(store.size).toBe(2);

    await mod.invalidateAccessibleProjectIds("u1");
    expect(store.size).toBe(0);

    // And the next call recomputes.
    await mod.resolveAccessibleProjectIds(viewer);
    expect(mockProjectsFindMany).toHaveBeenCalledTimes(3);
  });

  it("caches the collaborator scope on the same 60s clock, keyed by access and role", async () => {
    const { redis, store, ttls } = makeFakeValkey();
    const mod = await withValkey(redis);

    // First call: project-id resolution (4 queries) + scope inversion
    // (4 more) — the projects table is read once by each.
    expect(await mod.resolveCollaboratorScope(viewer)).toMatchObject({
      all: false,
      userIds: [],
      viaAdminAccess: true,
    });
    expect(mockProjectsFindMany).toHaveBeenCalledTimes(2);

    // Second call: served from cache.
    await mod.resolveCollaboratorScope(viewer);
    expect(mockProjectsFindMany).toHaveBeenCalledTimes(2);
    expect([...ttls.values()]).toEqual([60, 60]);

    // A role change lands on a different key and recomputes immediately.
    await mod.resolveCollaboratorScope({ ...viewer, roleId: 9 });
    expect(mockProjectsFindMany).toHaveBeenCalledTimes(4);
    expect(
      [...store.keys()].filter((k) => k.startsWith("acl:collab:")).length
    ).toBe(2);
  });

  it("invalidateAccessibleProjectIds drops the collaborator scope too", async () => {
    const { redis, store } = makeFakeValkey();
    const mod = await withValkey(redis);

    await mod.resolveCollaboratorScope(viewer);
    expect(store.size).toBe(2); // acl:projectids:* + acl:collab:*

    await mod.invalidateAccessibleProjectIds("u1");
    expect(store.size).toBe(0);
  });

  it("buildAuthContext reads both scopes with one mget and threads the collab fields", async () => {
    const { redis } = makeFakeValkey();
    const mod = await withValkey(redis);

    const ctx = await mod.buildAuthContext(viewer);
    expect(ctx).toMatchObject({
      accessibleProjectIds: [1],
      collabUserIds: [],
      collabViaOpenDefault: false,
      collabViaGlobalRoleDefault: false,
      collabViaAdminAccess: true,
      collabOpenDefaultDenied: [],
      collabGlobalRoleDefaultDenied: [],
    });
    const dbCallsAfterFirst = mockProjectsFindMany.mock.calls.length;

    // Warm path: a single mget serves both scopes — no further db reads and
    // no per-key gets.
    (redis.get as ReturnType<typeof vi.fn>).mockClear();
    const again = await mod.buildAuthContext(viewer);
    expect(again.accessibleProjectIds).toEqual([1]);
    expect(again.collabViaAdminAccess).toBe(true);
    expect(mockProjectsFindMany).toHaveBeenCalledTimes(dbCallsAfterFirst);
    expect(redis.mget).toHaveBeenCalled();
    expect(redis.get).not.toHaveBeenCalled();
  });

  it("buildAuthContext survives a total cache outage", async () => {
    const boom = {
      get: vi.fn(async () => {
        throw new Error("valkey down");
      }),
      mget: vi.fn(async () => {
        throw new Error("valkey down");
      }),
      set: vi.fn(async () => {
        throw new Error("valkey down");
      }),
      keys: vi.fn(async () => []),
      del: vi.fn(async () => 0),
    };
    const mod = await withValkey(boom);

    const ctx = await mod.buildAuthContext(viewer);
    expect(ctx.accessibleProjectIds).toEqual([1]);
    expect(ctx.collabViaAdminAccess).toBe(true);
  });
});
