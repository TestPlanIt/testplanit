/**
 * The Access roster: who is listed, what role they get, and which rung of
 * the ladder is reported for each of them.
 *
 * Membership and the ladder itself are tested where they live
 * (`projectMembers.test.ts`, `effectiveRole.test.ts`); this pins how the
 * roster composes them: system ADMINs join the list without being members,
 * ADMIN / PROJECTADMIN skip the ladder, and a member the ladder cannot
 * resolve to a role is left out.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUserFindMany, mockRolesFindMany, mockMemberIds, mockResolve } =
  vi.hoisted(() => ({
    mockUserFindMany: vi.fn(),
    mockRolesFindMany: vi.fn(),
    mockMemberIds: vi.fn(),
    mockResolve: vi.fn(),
  }));

vi.mock("~/lib/db", () => ({
  baseDb: {
    user: { findMany: mockUserFindMany },
    roles: { findMany: mockRolesFindMany },
  },
}));

vi.mock("~/lib/services/projectMembers", () => ({
  getProjectEffectiveMemberIds: mockMemberIds,
}));

vi.mock("~/lib/services/effectiveRole", () => ({
  resolveEffectiveProjectAccessForUsers: mockResolve,
}));

import { getProjectAccessRoster } from "./projectAccessRoster";

function user(id: string, access: string, name = id) {
  return { id, name, email: `${id}@example.com`, image: null, access };
}

describe("getProjectAccessRoster", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRolesFindMany.mockResolvedValue([
      { id: 1, name: "Tester" },
      { id: 2, name: "Lead" },
    ]);
  });

  it("lists members with their resolved role and source, sorted by name", async () => {
    mockMemberIds.mockResolvedValue(["u-b", "u-a"]);
    mockUserFindMany.mockResolvedValue([
      user("u-b", "USER", "Zed"),
      user("u-a", "USER", "Amy"),
    ]);
    mockResolve.mockResolvedValue(
      new Map([
        ["u-b", { roleId: 1, source: "PROJECT_DEFAULT" }],
        ["u-a", { roleId: 2, source: "GROUP_PERMISSION" }],
      ])
    );

    const roster = await getProjectAccessRoster(7);

    expect(roster.map((e) => e.name)).toEqual(["Amy", "Zed"]);
    expect(roster[0]).toMatchObject({
      userId: "u-a",
      systemAccess: "USER",
      effectiveRole: { id: 2, name: "Lead" },
      source: "GROUP_PERMISSION",
    });
    expect(roster[1]).toMatchObject({
      effectiveRole: { id: 1, name: "Tester" },
      source: "PROJECT_DEFAULT",
    });
    // Only USER-access members walk the ladder.
    expect(mockResolve).toHaveBeenCalledWith(
      ["u-b", "u-a"],
      7,
      expect.anything()
    );
  });

  it("includes every system ADMIN even when they are not a member", async () => {
    mockMemberIds.mockResolvedValue([]);
    mockUserFindMany.mockResolvedValue([user("admin", "ADMIN", "Root")]);
    mockResolve.mockResolvedValue(new Map());

    const roster = await getProjectAccessRoster(7);

    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          isDeleted: false,
          OR: [{ id: { in: [] } }, { access: "ADMIN" }],
        }),
      })
    );
    expect(roster).toEqual([
      expect.objectContaining({
        userId: "admin",
        systemAccess: "ADMIN",
        effectiveRole: null,
        source: "SYSTEM_ADMIN",
      }),
    ]);
    expect(mockResolve).toHaveBeenCalledWith([], 7, expect.anything());
  });

  it("reports PROJECTADMIN members by their system access, not a role", async () => {
    mockMemberIds.mockResolvedValue(["pa"]);
    mockUserFindMany.mockResolvedValue([user("pa", "PROJECTADMIN")]);
    mockResolve.mockResolvedValue(new Map());

    const roster = await getProjectAccessRoster(7);

    expect(roster).toEqual([
      expect.objectContaining({
        systemAccess: "PROJECTADMIN",
        effectiveRole: null,
        source: "SYSTEM_PROJECT_ADMIN",
      }),
    ]);
    expect(mockResolve).toHaveBeenCalledWith([], 7, expect.anything());
  });

  it("drops a member the ladder resolves to no role", async () => {
    mockMemberIds.mockResolvedValue(["assigned", "ok"]);
    mockUserFindMany.mockResolvedValue([
      user("assigned", "USER"),
      user("ok", "USER"),
    ]);
    mockResolve.mockResolvedValue(
      new Map([
        ["assigned", { roleId: null, source: "PROJECT_DEFAULT" }],
        ["ok", { roleId: 1, source: "USER_PERMISSION" }],
      ])
    );

    const roster = await getProjectAccessRoster(7);

    expect(roster.map((e) => e.userId)).toEqual(["ok"]);
    expect(mockRolesFindMany).toHaveBeenCalledWith({
      where: { id: { in: [1] } },
      select: { id: true, name: true },
    });
  });

  it("skips the role lookup when nobody resolves to a role", async () => {
    mockMemberIds.mockResolvedValue([]);
    mockUserFindMany.mockResolvedValue([]);
    mockResolve.mockResolvedValue(new Map());

    await expect(getProjectAccessRoster(7)).resolves.toEqual([]);
    expect(mockRolesFindMany).not.toHaveBeenCalled();
  });
});
