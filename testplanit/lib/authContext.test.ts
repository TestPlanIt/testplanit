import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { resolveAccessibleProjectIds, type UserForAuth } from "./authContext";

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
