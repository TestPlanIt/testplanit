/**
 * Effective project membership, tested at the shared implementation rather
 * than through the `"use server"` wrapper.
 *
 * The exclusions that matter here are pushed into the query, not applied in
 * JS: inactive and soft-deleted users are filtered by the `where` clauses this
 * function builds. A regression that drops one of those clauses would still
 * produce a plausible-looking member list from a mocked db, so the predicates
 * themselves are asserted.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockProjects, mockUser } = vi.hoisted(() => ({
  mockProjects: { findUnique: vi.fn() },
  mockUser: { findMany: vi.fn() },
}));

vi.mock("~/lib/db", () => ({
  baseDb: { projects: mockProjects, user: mockUser },
}));

import { getProjectEffectiveMemberIds } from "./projectMembers";

/** A project row shaped the way the function's `select` asks for it. */
function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    defaultAccessType: "NO_ACCESS",
    defaultRoleId: null,
    assignedUsers: [],
    userPermissions: [],
    groupPermissions: [],
    ...overrides,
  };
}

/** A group grant carrying the given member ids. */
function groupGrant(userIds: string[], accessType = "GLOBAL_ROLE") {
  return {
    accessType,
    group: { assignedUsers: userIds.map((userId) => ({ userId })) },
  };
}

describe("getProjectEffectiveMemberIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns [] for a project that does not exist", async () => {
    mockProjects.findUnique.mockResolvedValue(null);

    await expect(getProjectEffectiveMemberIds(999)).resolves.toEqual([]);
    expect(mockUser.findMany).not.toHaveBeenCalled();
  });

  it("returns [] for a project with no members at all", async () => {
    mockProjects.findUnique.mockResolvedValue(projectRow());

    await expect(getProjectEffectiveMemberIds(1)).resolves.toEqual([]);
  });

  it("returns direct assignments", async () => {
    mockProjects.findUnique.mockResolvedValue(
      projectRow({
        assignedUsers: [{ userId: "user-1" }, { userId: "user-2" }],
      })
    );

    const result = await getProjectEffectiveMemberIds(1);

    expect(result.sort()).toEqual(["user-1", "user-2"]);
  });

  it("returns group members", async () => {
    mockProjects.findUnique.mockResolvedValue(
      projectRow({ groupPermissions: [groupGrant(["user-3", "user-4"])] })
    );

    const result = await getProjectEffectiveMemberIds(1);

    expect(result.sort()).toEqual(["user-3", "user-4"]);
  });

  it("deduplicates a user who is both directly assigned and in a granted group", async () => {
    mockProjects.findUnique.mockResolvedValue(
      projectRow({
        assignedUsers: [{ userId: "user-1" }, { userId: "shared" }],
        groupPermissions: [
          groupGrant(["shared", "user-3"]),
          // The same user again via a second group.
          groupGrant(["shared"]),
        ],
      })
    );

    const result = await getProjectEffectiveMemberIds(1);

    expect(result.sort()).toEqual(["shared", "user-1", "user-3"]);
    expect(result.filter((id) => id === "shared")).toHaveLength(1);
  });

  it("deduplicates across the role-default all-users branch", async () => {
    mockProjects.findUnique.mockResolvedValue(
      projectRow({
        defaultAccessType: "GLOBAL_ROLE",
        assignedUsers: [{ userId: "user-1" }],
        groupPermissions: [groupGrant(["user-2"])],
      })
    );
    mockUser.findMany.mockResolvedValue([
      { id: "user-1" },
      { id: "user-2" },
      { id: "user-3" },
    ]);

    const result = await getProjectEffectiveMemberIds(1);

    expect(result.sort()).toEqual(["user-1", "user-2", "user-3"]);
  });

  describe("soft-deleted and inactive users", () => {
    it("filters direct assignments and per-user permissions in the query", async () => {
      mockProjects.findUnique.mockResolvedValue(projectRow());

      await getProjectEffectiveMemberIds(1);

      const select = mockProjects.findUnique.mock.calls[0][0].select;
      expect(select.assignedUsers.where).toEqual({
        user: { isActive: true, isDeleted: false },
      });
      expect(select.userPermissions.where).toEqual({
        user: { isActive: true, isDeleted: false },
      });
    });

    it("filters group members in the query", async () => {
      mockProjects.findUnique.mockResolvedValue(projectRow());

      await getProjectEffectiveMemberIds(1);

      const select = mockProjects.findUnique.mock.calls[0][0].select;
      expect(
        select.groupPermissions.select.group.select.assignedUsers.where
      ).toEqual({ user: { isActive: true, isDeleted: false } });
    });

    it("filters the role-default all-users sweep on active, not deleted, and access != NONE", async () => {
      mockProjects.findUnique.mockResolvedValue(
        projectRow({ defaultAccessType: "SPECIFIC_ROLE" })
      );
      mockUser.findMany.mockResolvedValue([]);

      await getProjectEffectiveMemberIds(1);

      expect(mockUser.findMany).toHaveBeenCalledWith({
        where: { isActive: true, isDeleted: false, access: { not: "NONE" } },
        select: { id: true },
      });
    });

    it("never runs the all-users sweep for a NO_ACCESS default", async () => {
      mockProjects.findUnique.mockResolvedValue(
        projectRow({ assignedUsers: [{ userId: "user-1" }] })
      );

      await getProjectEffectiveMemberIds(1);

      expect(mockUser.findMany).not.toHaveBeenCalled();
    });
  });

  describe("per-user access types", () => {
    it("admits a user holding a role-granting permission with no assignment row", async () => {
      mockProjects.findUnique.mockResolvedValue(
        projectRow({
          userPermissions: [
            { userId: "user-1", accessType: "GLOBAL_ROLE" },
            { userId: "user-2", accessType: "SPECIFIC_ROLE" },
          ],
        })
      );

      const result = await getProjectEffectiveMemberIds(1);

      expect(result.sort()).toEqual(["user-1", "user-2"]);
    });

    it("grants nothing on its own for DEFAULT", async () => {
      mockProjects.findUnique.mockResolvedValue(
        projectRow({
          userPermissions: [{ userId: "user-1", accessType: "DEFAULT" }],
        })
      );

      await expect(getProjectEffectiveMemberIds(1)).resolves.toEqual([]);
    });

    it("removes a NO_ACCESS user regardless of which path added them", async () => {
      mockProjects.findUnique.mockResolvedValue(
        projectRow({
          defaultAccessType: "GLOBAL_ROLE",
          assignedUsers: [{ userId: "denied" }],
          groupPermissions: [groupGrant(["denied"])],
          userPermissions: [{ userId: "denied", accessType: "NO_ACCESS" }],
        })
      );
      mockUser.findMany.mockResolvedValue([{ id: "denied" }, { id: "kept" }]);

      const result = await getProjectEffectiveMemberIds(1);

      expect(result).toEqual(["kept"]);
    });

    it("does not add members of a NO_ACCESS group", async () => {
      mockProjects.findUnique.mockResolvedValue(
        projectRow({
          groupPermissions: [
            groupGrant(["blocked"], "NO_ACCESS"),
            groupGrant(["allowed"]),
          ],
        })
      );

      const result = await getProjectEffectiveMemberIds(1);

      expect(result).toEqual(["allowed"]);
    });
  });

  it("swallows a db failure and returns []", async () => {
    mockProjects.findUnique.mockRejectedValue(new Error("db down"));
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(getProjectEffectiveMemberIds(1)).resolves.toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Error getting project effective members:",
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });

  it("tolerates a project row with null permission collections", async () => {
    mockProjects.findUnique.mockResolvedValue({
      defaultAccessType: "NO_ACCESS",
      defaultRoleId: null,
      assignedUsers: [{ userId: "user-1" }],
      userPermissions: null,
      groupPermissions: null,
    });

    await expect(getProjectEffectiveMemberIds(1)).resolves.toEqual(["user-1"]);
  });
});
