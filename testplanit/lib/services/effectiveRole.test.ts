import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProjectAccessType } from "~/zenstack/models";
import {
  resolveEffectiveProjectRoleId,
  resolveEffectiveProjectRolesForUsers,
} from "./effectiveRole";

type StubClient = {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  userProjectPermission: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  groupProjectPermission: {
    findMany: ReturnType<typeof vi.fn>;
  };
  projects: {
    findUnique: ReturnType<typeof vi.fn>;
  };
};

function makeStub(): StubClient {
  return {
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    userProjectPermission: { findUnique: vi.fn(), findMany: vi.fn() },
    groupProjectPermission: { findMany: vi.fn() },
    projects: { findUnique: vi.fn() },
  };
}

describe("resolveEffectiveProjectRoleId", () => {
  let stub: StubClient;

  beforeEach(() => {
    stub = makeStub();
  });

  it("SPECIFIC_ROLE on user-specific permission returns that roleId", async () => {
    stub.userProjectPermission.findUnique.mockResolvedValue({
      accessType: ProjectAccessType.SPECIFIC_ROLE,
      roleId: 42,
    });
    stub.user.findUnique.mockResolvedValue({
      id: "u-1",
      roleId: 7,
      groups: [],
    });
    stub.projects.findUnique.mockResolvedValue({
      defaultAccessType: ProjectAccessType.NO_ACCESS,
      defaultRoleId: null,
    });

    const result = await resolveEffectiveProjectRoleId("u-1", 100, stub as any);
    expect(result).toBe(42);
  });

  it("GLOBAL_ROLE on user-specific permission returns the user's global roleId", async () => {
    stub.userProjectPermission.findUnique.mockResolvedValue({
      accessType: ProjectAccessType.GLOBAL_ROLE,
      roleId: null,
    });
    stub.user.findUnique.mockResolvedValue({
      id: "u-1",
      roleId: 7,
      groups: [],
    });
    stub.projects.findUnique.mockResolvedValue({
      defaultAccessType: ProjectAccessType.NO_ACCESS,
      defaultRoleId: null,
    });

    const result = await resolveEffectiveProjectRoleId("u-1", 100, stub as any);
    expect(result).toBe(7);
  });

  it("group SPECIFIC_ROLE fallback when user-specific is DEFAULT", async () => {
    stub.userProjectPermission.findUnique.mockResolvedValue({
      accessType: ProjectAccessType.DEFAULT,
      roleId: null,
    });
    stub.user.findUnique.mockResolvedValue({
      id: "u-1",
      roleId: 7,
      groups: [{ groupId: 10 }],
    });
    stub.groupProjectPermission.findMany.mockResolvedValue([
      { accessType: ProjectAccessType.SPECIFIC_ROLE, roleId: 99 },
    ]);
    stub.projects.findUnique.mockResolvedValue({
      defaultAccessType: ProjectAccessType.NO_ACCESS,
      defaultRoleId: null,
    });

    const result = await resolveEffectiveProjectRoleId("u-1", 100, stub as any);
    expect(result).toBe(99);
  });

  it("group GLOBAL_ROLE returns the user's global roleId on a NO_ACCESS project", async () => {
    stub.userProjectPermission.findUnique.mockResolvedValue(null);
    stub.user.findUnique.mockResolvedValue({
      id: "u-1",
      roleId: 7,
      groups: [{ groupId: 10 }],
    });
    stub.groupProjectPermission.findMany.mockResolvedValue([
      { accessType: ProjectAccessType.GLOBAL_ROLE, roleId: null },
    ]);
    stub.projects.findUnique.mockResolvedValue({
      defaultAccessType: ProjectAccessType.NO_ACCESS,
      defaultRoleId: null,
    });

    const result = await resolveEffectiveProjectRoleId("u-1", 100, stub as any);
    expect(result).toBe(7);
  });

  it("group SPECIFIC_ROLE outranks a group GLOBAL_ROLE grant", async () => {
    stub.userProjectPermission.findUnique.mockResolvedValue(null);
    stub.user.findUnique.mockResolvedValue({
      id: "u-1",
      roleId: 7,
      groups: [{ groupId: 10 }, { groupId: 11 }],
    });
    stub.groupProjectPermission.findMany.mockResolvedValue([
      { accessType: ProjectAccessType.GLOBAL_ROLE, roleId: null },
      { accessType: ProjectAccessType.SPECIFIC_ROLE, roleId: 99 },
    ]);
    stub.projects.findUnique.mockResolvedValue({
      defaultAccessType: ProjectAccessType.NO_ACCESS,
      defaultRoleId: null,
    });

    const result = await resolveEffectiveProjectRoleId("u-1", 100, stub as any);
    expect(result).toBe(99);
  });

  it("project DEFAULT GLOBAL_ROLE fallback", async () => {
    stub.userProjectPermission.findUnique.mockResolvedValue(null);
    stub.user.findUnique.mockResolvedValue({
      id: "u-1",
      roleId: 7,
      groups: [],
    });
    stub.projects.findUnique.mockResolvedValue({
      defaultAccessType: ProjectAccessType.GLOBAL_ROLE,
      defaultRoleId: null,
    });

    const result = await resolveEffectiveProjectRoleId("u-1", 100, stub as any);
    expect(result).toBe(7);
  });

  it("project DEFAULT SPECIFIC_ROLE fallback", async () => {
    stub.userProjectPermission.findUnique.mockResolvedValue(null);
    stub.user.findUnique.mockResolvedValue({
      id: "u-1",
      roleId: 7,
      groups: [],
    });
    stub.projects.findUnique.mockResolvedValue({
      defaultAccessType: ProjectAccessType.SPECIFIC_ROLE,
      defaultRoleId: 55,
    });

    const result = await resolveEffectiveProjectRoleId("u-1", 100, stub as any);
    expect(result).toBe(55);
  });

  it("user-specific NO_ACCESS returns null (no group/default fallthrough)", async () => {
    stub.userProjectPermission.findUnique.mockResolvedValue({
      accessType: ProjectAccessType.NO_ACCESS,
      roleId: null,
    });
    stub.user.findUnique.mockResolvedValue({
      id: "u-1",
      roleId: 7,
      groups: [],
    });
    stub.projects.findUnique.mockResolvedValue({
      defaultAccessType: ProjectAccessType.SPECIFIC_ROLE,
      defaultRoleId: 55,
    });

    const result = await resolveEffectiveProjectRoleId("u-1", 100, stub as any);
    expect(result).toBeNull();
  });

  it("missing user returns null", async () => {
    stub.userProjectPermission.findUnique.mockResolvedValue(null);
    stub.user.findUnique.mockResolvedValue(null);
    stub.projects.findUnique.mockResolvedValue({
      defaultAccessType: ProjectAccessType.GLOBAL_ROLE,
      defaultRoleId: null,
    });

    const result = await resolveEffectiveProjectRoleId("u-1", 100, stub as any);
    expect(result).toBeNull();
  });
});

describe("resolveEffectiveProjectRolesForUsers", () => {
  it("returns a Map keyed on userId with per-user precedence resolution", async () => {
    const stub = makeStub();
    // Three users with mixed precedence layers:
    //  - u-A: user-specific SPECIFIC_ROLE → 11
    //  - u-B: user-specific DEFAULT, then group SPECIFIC_ROLE → 22
    //  - u-C: no user-specific, no group, project default GLOBAL_ROLE → user's global 33
    stub.userProjectPermission.findMany.mockResolvedValue([
      {
        userId: "u-A",
        accessType: ProjectAccessType.SPECIFIC_ROLE,
        roleId: 11,
      },
      { userId: "u-B", accessType: ProjectAccessType.DEFAULT, roleId: null },
    ]);
    stub.user.findMany.mockResolvedValue([
      { id: "u-A", roleId: 99, groups: [] },
      { id: "u-B", roleId: 88, groups: [{ groupId: 10 }] },
      { id: "u-C", roleId: 33, groups: [] },
    ]);
    stub.groupProjectPermission.findMany.mockResolvedValue([
      { groupId: 10, accessType: ProjectAccessType.SPECIFIC_ROLE, roleId: 22 },
    ]);
    stub.projects.findUnique.mockResolvedValue({
      defaultAccessType: ProjectAccessType.GLOBAL_ROLE,
      defaultRoleId: null,
    });

    const result = await resolveEffectiveProjectRolesForUsers(
      ["u-A", "u-B", "u-C"],
      100,
      stub as any
    );
    expect(result.get("u-A")).toBe(11);
    expect(result.get("u-B")).toBe(22);
    expect(result.get("u-C")).toBe(33);
  });

  it("returns null for users with NO_ACCESS at any layer", async () => {
    const stub = makeStub();
    stub.userProjectPermission.findMany.mockResolvedValue([
      { userId: "u-X", accessType: ProjectAccessType.NO_ACCESS, roleId: null },
    ]);
    stub.user.findMany.mockResolvedValue([
      { id: "u-X", roleId: 1, groups: [] },
    ]);
    stub.groupProjectPermission.findMany.mockResolvedValue([]);
    stub.projects.findUnique.mockResolvedValue({
      defaultAccessType: ProjectAccessType.GLOBAL_ROLE,
      defaultRoleId: null,
    });

    const result = await resolveEffectiveProjectRolesForUsers(
      ["u-X"],
      100,
      stub as any
    );
    expect(result.get("u-X")).toBeNull();
  });

  it("resolves group GLOBAL_ROLE members to their own global role", async () => {
    const stub = makeStub();
    // u-A reaches the project only through a group holding GLOBAL_ROLE, and
    // u-B through a group holding SPECIFIC_ROLE. The project itself grants
    // nothing, so neither user may fall through to the project default.
    stub.userProjectPermission.findMany.mockResolvedValue([]);
    stub.user.findMany.mockResolvedValue([
      { id: "u-A", roleId: 44, groups: [{ groupId: 10 }] },
      { id: "u-B", roleId: 44, groups: [{ groupId: 11 }] },
    ]);
    stub.groupProjectPermission.findMany.mockResolvedValue([
      { groupId: 10, accessType: ProjectAccessType.GLOBAL_ROLE, roleId: null },
      { groupId: 11, accessType: ProjectAccessType.SPECIFIC_ROLE, roleId: 66 },
    ]);
    stub.projects.findUnique.mockResolvedValue({
      defaultAccessType: ProjectAccessType.NO_ACCESS,
      defaultRoleId: null,
    });

    const result = await resolveEffectiveProjectRolesForUsers(
      ["u-A", "u-B"],
      100,
      stub as any
    );
    expect(result.get("u-A")).toBe(44);
    expect(result.get("u-B")).toBe(66);
  });

  it("empty input returns an empty Map without querying", async () => {
    const stub = makeStub();
    const result = await resolveEffectiveProjectRolesForUsers(
      [],
      100,
      stub as any
    );
    expect(result.size).toBe(0);
    expect(stub.user.findMany).not.toHaveBeenCalled();
    expect(stub.userProjectPermission.findMany).not.toHaveBeenCalled();
  });
});
