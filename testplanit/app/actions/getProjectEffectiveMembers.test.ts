import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Use vi.hoisted to ensure mocks are available before the vi.mock factory runs
const { mockProjects, mockUser } = vi.hoisted(() => ({
  mockProjects: { findUnique: vi.fn() },
  mockUser: { findMany: vi.fn() },
}));

// Mock the prisma singleton
vi.mock("~/lib/prisma", () => ({
  prisma: {
    projects: mockProjects,
    user: mockUser,
  },
}));

// Mock ProjectAccessType enum from @prisma/client
vi.mock("@prisma/client", () => ({
  ProjectAccessType: {
    NO_ACCESS: "NO_ACCESS",
    GLOBAL_ROLE: "GLOBAL_ROLE",
    SPECIFIC_ROLE: "SPECIFIC_ROLE",
  },
}));

// Import after mocking
import { getProjectEffectiveMembers } from "./getProjectEffectiveMembers";

describe("getProjectEffectiveMembers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("project not found", () => {
    it("should return empty array when project does not exist", async () => {
      mockProjects.findUnique.mockResolvedValue(null);

      const result = await getProjectEffectiveMembers(999);

      expect(result).toEqual([]);
    });
  });

  describe("NO_ACCESS default access type", () => {
    it("should return only directly assigned users", async () => {
      mockProjects.findUnique.mockResolvedValue({
        defaultAccessType: "NO_ACCESS",
        defaultRoleId: null,
        assignedUsers: [{ userId: "user-1" }, { userId: "user-2" }],
        groupPermissions: [],
      });

      const result = await getProjectEffectiveMembers(1);

      expect(result).toContain("user-1");
      expect(result).toContain("user-2");
      expect(result).toHaveLength(2);
    });

    it("should include users from groups with non-NO_ACCESS permission", async () => {
      mockProjects.findUnique.mockResolvedValue({
        defaultAccessType: "NO_ACCESS",
        defaultRoleId: null,
        assignedUsers: [{ userId: "user-1" }],
        groupPermissions: [
          {
            accessType: "GLOBAL_ROLE",
            group: {
              assignedUsers: [{ userId: "user-2" }, { userId: "user-3" }],
            },
          },
        ],
      });

      const result = await getProjectEffectiveMembers(1);

      expect(result).toContain("user-1");
      expect(result).toContain("user-2");
      expect(result).toContain("user-3");
      expect(result).toHaveLength(3);
    });

    it("should exclude users from groups with NO_ACCESS permission", async () => {
      mockProjects.findUnique.mockResolvedValue({
        defaultAccessType: "NO_ACCESS",
        defaultRoleId: null,
        assignedUsers: [{ userId: "user-1" }],
        groupPermissions: [
          {
            accessType: "NO_ACCESS",
            group: {
              assignedUsers: [{ userId: "user-2" }],
            },
          },
        ],
      });

      const result = await getProjectEffectiveMembers(1);

      expect(result).toContain("user-1");
      expect(result).not.toContain("user-2");
      expect(result).toHaveLength(1);
    });

    it("should not fetch all users when NO_ACCESS", async () => {
      mockProjects.findUnique.mockResolvedValue({
        defaultAccessType: "NO_ACCESS",
        defaultRoleId: null,
        assignedUsers: [],
        groupPermissions: [],
      });

      await getProjectEffectiveMembers(1);

      expect(mockUser.findMany).not.toHaveBeenCalled();
    });
  });

  describe("GLOBAL_ROLE default access type", () => {
    it("should include all active users except NONE access", async () => {
      mockProjects.findUnique.mockResolvedValue({
        defaultAccessType: "GLOBAL_ROLE",
        defaultRoleId: 1,
        assignedUsers: [],
        groupPermissions: [],
      });
      mockUser.findMany.mockResolvedValue([
        { id: "user-1" },
        { id: "user-2" },
        { id: "user-3" },
      ]);

      const result = await getProjectEffectiveMembers(1);

      expect(result).toContain("user-1");
      expect(result).toContain("user-2");
      expect(result).toContain("user-3");
      expect(mockUser.findMany).toHaveBeenCalledWith({
        where: {
          isActive: true,
          isDeleted: false,
          access: { not: "NONE" },
        },
        select: { id: true },
      });
    });

    it("should merge directly assigned users with all users", async () => {
      mockProjects.findUnique.mockResolvedValue({
        defaultAccessType: "GLOBAL_ROLE",
        defaultRoleId: 1,
        assignedUsers: [{ userId: "user-direct" }],
        groupPermissions: [],
      });
      mockUser.findMany.mockResolvedValue([
        { id: "user-1" },
        { id: "user-2" },
      ]);

      const result = await getProjectEffectiveMembers(1);

      expect(result).toContain("user-direct");
      expect(result).toContain("user-1");
      expect(result).toContain("user-2");
      expect(result).toHaveLength(3);
    });
  });

  describe("SPECIFIC_ROLE default access type", () => {
    it("should include all active users except NONE access", async () => {
      mockProjects.findUnique.mockResolvedValue({
        defaultAccessType: "SPECIFIC_ROLE",
        defaultRoleId: 2,
        assignedUsers: [],
        groupPermissions: [],
      });
      mockUser.findMany.mockResolvedValue([{ id: "user-1" }, { id: "user-2" }]);

      const result = await getProjectEffectiveMembers(1);

      expect(result).toContain("user-1");
      expect(result).toContain("user-2");
      expect(mockUser.findMany).toHaveBeenCalled();
    });

    it("should include users from groups as well", async () => {
      mockProjects.findUnique.mockResolvedValue({
        defaultAccessType: "SPECIFIC_ROLE",
        defaultRoleId: 2,
        assignedUsers: [],
        groupPermissions: [
          {
            accessType: "SPECIFIC_ROLE",
            group: {
              assignedUsers: [{ userId: "group-user" }],
            },
          },
        ],
      });
      mockUser.findMany.mockResolvedValue([{ id: "all-user" }]);

      const result = await getProjectEffectiveMembers(1);

      expect(result).toContain("group-user");
      expect(result).toContain("all-user");
    });
  });

  describe("deduplication", () => {
    it("should not return duplicate user IDs", async () => {
      mockProjects.findUnique.mockResolvedValue({
        defaultAccessType: "GLOBAL_ROLE",
        defaultRoleId: 1,
        assignedUsers: [{ userId: "user-1" }],
        groupPermissions: [
          {
            accessType: "GLOBAL_ROLE",
            group: {
              assignedUsers: [{ userId: "user-1" }], // Same user
            },
          },
        ],
      });
      mockUser.findMany.mockResolvedValue([
        { id: "user-1" }, // Same user again
      ]);

      const result = await getProjectEffectiveMembers(1);

      expect(result).toEqual(["user-1"]);
    });
  });

  describe("edge cases", () => {
    it("should handle empty assigned users", async () => {
      mockProjects.findUnique.mockResolvedValue({
        defaultAccessType: "NO_ACCESS",
        defaultRoleId: null,
        assignedUsers: [],
        groupPermissions: [],
      });

      const result = await getProjectEffectiveMembers(1);

      expect(result).toEqual([]);
    });

    it("should handle null group permissions", async () => {
      mockProjects.findUnique.mockResolvedValue({
        defaultAccessType: "NO_ACCESS",
        defaultRoleId: null,
        assignedUsers: [{ userId: "user-1" }],
        groupPermissions: null,
      });

      const result = await getProjectEffectiveMembers(1);

      expect(result).toEqual(["user-1"]);
    });

    it("should handle empty group assigned users", async () => {
      mockProjects.findUnique.mockResolvedValue({
        defaultAccessType: "NO_ACCESS",
        defaultRoleId: null,
        assignedUsers: [],
        groupPermissions: [
          {
            accessType: "GLOBAL_ROLE",
            group: {
              assignedUsers: [],
            },
          },
        ],
      });

      const result = await getProjectEffectiveMembers(1);

      expect(result).toEqual([]);
    });

    it("should handle null group in group permission", async () => {
      mockProjects.findUnique.mockResolvedValue({
        defaultAccessType: "NO_ACCESS",
        defaultRoleId: null,
        assignedUsers: [{ userId: "user-1" }],
        groupPermissions: [
          {
            accessType: "GLOBAL_ROLE",
            group: null,
          },
        ],
      });

      const result = await getProjectEffectiveMembers(1);

      expect(result).toEqual(["user-1"]);
    });

    it("should handle null assignedUsers in group", async () => {
      mockProjects.findUnique.mockResolvedValue({
        defaultAccessType: "NO_ACCESS",
        defaultRoleId: null,
        assignedUsers: [{ userId: "user-1" }],
        groupPermissions: [
          {
            accessType: "GLOBAL_ROLE",
            group: {
              assignedUsers: null,
            },
          },
        ],
      });

      const result = await getProjectEffectiveMembers(1);

      expect(result).toEqual(["user-1"]);
    });

    it("should return empty when no users found for GLOBAL_ROLE", async () => {
      mockProjects.findUnique.mockResolvedValue({
        defaultAccessType: "GLOBAL_ROLE",
        defaultRoleId: 1,
        assignedUsers: [],
        groupPermissions: [],
      });
      mockUser.findMany.mockResolvedValue([]);

      const result = await getProjectEffectiveMembers(1);

      expect(result).toEqual([]);
    });
  });

  describe("error handling", () => {
    it("should return empty array and log error on exception", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockProjects.findUnique.mockRejectedValue(new Error("Database error"));

      const result = await getProjectEffectiveMembers(1);

      expect(result).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Error getting project effective members:",
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it("should return empty array when findMany fails for GLOBAL_ROLE", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockProjects.findUnique.mockResolvedValue({
        defaultAccessType: "GLOBAL_ROLE",
        defaultRoleId: 1,
        assignedUsers: [],
        groupPermissions: [],
      });
      mockUser.findMany.mockRejectedValue(new Error("User query failed"));

      const result = await getProjectEffectiveMembers(1);

      expect(result).toEqual([]);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("multiple group permissions", () => {
    it("should include users from multiple groups with access", async () => {
      mockProjects.findUnique.mockResolvedValue({
        defaultAccessType: "NO_ACCESS",
        defaultRoleId: null,
        assignedUsers: [],
        groupPermissions: [
          {
            accessType: "GLOBAL_ROLE",
            group: {
              assignedUsers: [{ userId: "group1-user" }],
            },
          },
          {
            accessType: "SPECIFIC_ROLE",
            group: {
              assignedUsers: [{ userId: "group2-user" }],
            },
          },
          {
            accessType: "NO_ACCESS",
            group: {
              assignedUsers: [{ userId: "no-access-user" }],
            },
          },
        ],
      });

      const result = await getProjectEffectiveMembers(1);

      expect(result).toContain("group1-user");
      expect(result).toContain("group2-user");
      expect(result).not.toContain("no-access-user");
      expect(result).toHaveLength(2);
    });
  });
});
