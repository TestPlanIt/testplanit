import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Use vi.hoisted to ensure mocks are available before the vi.mock factory runs
const { mockProjects, mockUser, mockUserProjectPermission, mockGroupProjectPermission, mockProjectAssignment } = vi.hoisted(() => ({
  mockProjects: { findUnique: vi.fn() },
  mockUser: { findUnique: vi.fn(), findMany: vi.fn() },
  mockUserProjectPermission: { findUnique: vi.fn(), findMany: vi.fn() },
  mockGroupProjectPermission: { findFirst: vi.fn(), findMany: vi.fn() },
  mockProjectAssignment: { findUnique: vi.fn(), findMany: vi.fn() },
}));

// Mock the prisma singleton
vi.mock("~/lib/prisma", () => ({
  prisma: {
    projects: mockProjects,
    user: mockUser,
    userProjectPermission: mockUserProjectPermission,
    groupProjectPermission: mockGroupProjectPermission,
    projectAssignment: mockProjectAssignment,
  },
}));

// Mock ProjectAccessType enum from @prisma/client
vi.mock("@prisma/client", () => ({
  ProjectAccessType: {
    NO_ACCESS: "NO_ACCESS",
    GLOBAL_ROLE: "GLOBAL_ROLE",
    SPECIFIC_ROLE: "SPECIFIC_ROLE",
    DEFAULT: "DEFAULT",
  },
}));

// Import after mocking
import { ProjectAccessType } from "@prisma/client";
import {
  getUserEffectiveProjectAccess,
  getBatchUserEffectiveProjectAccess,
} from "./getUserEffectiveProjectAccess";

describe("getUserEffectiveProjectAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getUserEffectiveProjectAccess", () => {
    const mockProject = {
      defaultAccessType: ProjectAccessType.GLOBAL_ROLE,
      defaultRoleId: 10,
    };

    const mockUserData = {
      id: "user-123",
      roleId: 5,
      access: "USER",
    };

    describe("project or user not found", () => {
      it("should return null when project does not exist", async () => {
        mockProjects.findUnique.mockResolvedValue(null);

        const result = await getUserEffectiveProjectAccess(999, "user-123");

        expect(result).toBeNull();
      });

      it("should return null when user does not exist", async () => {
        mockProjects.findUnique.mockResolvedValue(mockProject);
        mockUser.findUnique.mockResolvedValue(null);

        const result = await getUserEffectiveProjectAccess(1, "nonexistent-user");

        expect(result).toBeNull();
      });
    });

    describe("explicit user permission", () => {
      it("should return user permission with SPECIFIC_ROLE", async () => {
        mockProjects.findUnique.mockResolvedValue(mockProject);
        mockUser.findUnique.mockResolvedValue(mockUserData);
        mockUserProjectPermission.findUnique.mockResolvedValue({
          accessType: ProjectAccessType.SPECIFIC_ROLE,
          roleId: 20,
        });

        const result = await getUserEffectiveProjectAccess(1, "user-123");

        expect(result).toEqual({
          userId: "user-123",
          accessType: ProjectAccessType.SPECIFIC_ROLE,
          roleId: 20,
          effectiveAccessType: ProjectAccessType.SPECIFIC_ROLE,
          effectiveRoleId: 20,
        });
      });

      it("should use user global role when permission is GLOBAL_ROLE", async () => {
        mockProjects.findUnique.mockResolvedValue(mockProject);
        mockUser.findUnique.mockResolvedValue(mockUserData);
        mockUserProjectPermission.findUnique.mockResolvedValue({
          accessType: ProjectAccessType.GLOBAL_ROLE,
          roleId: null,
        });

        const result = await getUserEffectiveProjectAccess(1, "user-123");

        expect(result).toEqual({
          userId: "user-123",
          accessType: ProjectAccessType.GLOBAL_ROLE,
          roleId: null,
          effectiveAccessType: ProjectAccessType.GLOBAL_ROLE,
          effectiveRoleId: 5, // User's global roleId
        });
      });

      it("should return NO_ACCESS when user has explicit no access", async () => {
        mockProjects.findUnique.mockResolvedValue(mockProject);
        mockUser.findUnique.mockResolvedValue(mockUserData);
        mockUserProjectPermission.findUnique.mockResolvedValue({
          accessType: ProjectAccessType.NO_ACCESS,
          roleId: null,
        });

        const result = await getUserEffectiveProjectAccess(1, "user-123");

        expect(result).toEqual({
          userId: "user-123",
          accessType: ProjectAccessType.NO_ACCESS,
          roleId: null,
          effectiveAccessType: ProjectAccessType.NO_ACCESS,
          effectiveRoleId: null,
        });
      });
    });

    describe("group permission", () => {
      it("should use group permission when no explicit user permission", async () => {
        mockProjects.findUnique.mockResolvedValue(mockProject);
        mockUser.findUnique.mockResolvedValue(mockUserData);
        mockUserProjectPermission.findUnique.mockResolvedValue(null);
        mockGroupProjectPermission.findFirst.mockResolvedValue({
          accessType: ProjectAccessType.SPECIFIC_ROLE,
          roleId: 30,
        });

        const result = await getUserEffectiveProjectAccess(1, "user-123");

        expect(result).toEqual({
          userId: "user-123",
          accessType: ProjectAccessType.SPECIFIC_ROLE,
          roleId: 30,
          effectiveAccessType: ProjectAccessType.SPECIFIC_ROLE,
          effectiveRoleId: 30,
        });
      });

      it("should use user global role when group permission is GLOBAL_ROLE", async () => {
        mockProjects.findUnique.mockResolvedValue(mockProject);
        mockUser.findUnique.mockResolvedValue(mockUserData);
        mockUserProjectPermission.findUnique.mockResolvedValue(null);
        mockGroupProjectPermission.findFirst.mockResolvedValue({
          accessType: ProjectAccessType.GLOBAL_ROLE,
          roleId: null,
        });

        const result = await getUserEffectiveProjectAccess(1, "user-123");

        expect(result).toEqual({
          userId: "user-123",
          accessType: ProjectAccessType.GLOBAL_ROLE,
          roleId: null,
          effectiveAccessType: ProjectAccessType.GLOBAL_ROLE,
          effectiveRoleId: 5, // User's global roleId
        });
      });

      it("should skip group permission with NO_ACCESS and fall through", async () => {
        mockProjects.findUnique.mockResolvedValue(mockProject);
        mockUser.findUnique.mockResolvedValue(mockUserData);
        mockUserProjectPermission.findUnique.mockResolvedValue(null);
        mockGroupProjectPermission.findFirst.mockResolvedValue({
          accessType: ProjectAccessType.NO_ACCESS,
          roleId: null,
        });
        mockProjectAssignment.findUnique.mockResolvedValue({ userId: "user-123" });

        const result = await getUserEffectiveProjectAccess(1, "user-123");

        // Should fall through to project assignment since group has NO_ACCESS
        expect(result?.accessType).toBe("PROJECT_DEFAULT");
      });
    });

    describe("project assignment (uses project default)", () => {
      it("should use project default GLOBAL_ROLE when user is assigned", async () => {
        mockProjects.findUnique.mockResolvedValue({
          defaultAccessType: ProjectAccessType.GLOBAL_ROLE,
          defaultRoleId: null,
        });
        mockUser.findUnique.mockResolvedValue(mockUserData);
        mockUserProjectPermission.findUnique.mockResolvedValue(null);
        mockGroupProjectPermission.findFirst.mockResolvedValue(null);
        mockProjectAssignment.findUnique.mockResolvedValue({ userId: "user-123" });

        const result = await getUserEffectiveProjectAccess(1, "user-123");

        expect(result).toEqual({
          userId: "user-123",
          accessType: "PROJECT_DEFAULT",
          roleId: null,
          effectiveAccessType: ProjectAccessType.GLOBAL_ROLE,
          effectiveRoleId: 5, // User's global roleId
        });
      });

      it("should use project default SPECIFIC_ROLE when user is assigned", async () => {
        mockProjects.findUnique.mockResolvedValue({
          defaultAccessType: ProjectAccessType.SPECIFIC_ROLE,
          defaultRoleId: 15,
        });
        mockUser.findUnique.mockResolvedValue(mockUserData);
        mockUserProjectPermission.findUnique.mockResolvedValue(null);
        mockGroupProjectPermission.findFirst.mockResolvedValue(null);
        mockProjectAssignment.findUnique.mockResolvedValue({ userId: "user-123" });

        const result = await getUserEffectiveProjectAccess(1, "user-123");

        expect(result).toEqual({
          userId: "user-123",
          accessType: "PROJECT_DEFAULT",
          roleId: null,
          effectiveAccessType: ProjectAccessType.SPECIFIC_ROLE,
          effectiveRoleId: 15, // Project's default roleId
        });
      });

      it("should use project default NO_ACCESS when user is assigned", async () => {
        mockProjects.findUnique.mockResolvedValue({
          defaultAccessType: ProjectAccessType.NO_ACCESS,
          defaultRoleId: null,
        });
        mockUser.findUnique.mockResolvedValue(mockUserData);
        mockUserProjectPermission.findUnique.mockResolvedValue(null);
        mockGroupProjectPermission.findFirst.mockResolvedValue(null);
        mockProjectAssignment.findUnique.mockResolvedValue({ userId: "user-123" });

        const result = await getUserEffectiveProjectAccess(1, "user-123");

        expect(result).toEqual({
          userId: "user-123",
          accessType: "PROJECT_DEFAULT",
          roleId: null,
          effectiveAccessType: ProjectAccessType.NO_ACCESS,
          effectiveRoleId: null,
        });
      });
    });

    describe("user not assigned", () => {
      it("should return null when user is not assigned to project", async () => {
        mockProjects.findUnique.mockResolvedValue(mockProject);
        mockUser.findUnique.mockResolvedValue(mockUserData);
        mockUserProjectPermission.findUnique.mockResolvedValue(null);
        mockGroupProjectPermission.findFirst.mockResolvedValue(null);
        mockProjectAssignment.findUnique.mockResolvedValue(null);

        const result = await getUserEffectiveProjectAccess(1, "user-123");

        expect(result).toBeNull();
      });
    });

    describe("error handling", () => {
      it("should return null and log error on exception", async () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        mockProjects.findUnique.mockRejectedValue(new Error("Database error"));

        const result = await getUserEffectiveProjectAccess(1, "user-123");

        expect(result).toBeNull();
        expect(consoleSpy).toHaveBeenCalledWith(
          "Error getting user effective project access:",
          expect.any(Error)
        );
        consoleSpy.mockRestore();
      });
    });

    describe("permission priority", () => {
      it("should prioritize user permission over group permission", async () => {
        mockProjects.findUnique.mockResolvedValue(mockProject);
        mockUser.findUnique.mockResolvedValue(mockUserData);
        mockUserProjectPermission.findUnique.mockResolvedValue({
          accessType: ProjectAccessType.SPECIFIC_ROLE,
          roleId: 100,
        });
        // Group permission shouldn't be checked since user permission exists

        const result = await getUserEffectiveProjectAccess(1, "user-123");

        expect(result?.effectiveRoleId).toBe(100);
      });

      it("should prioritize group permission over project default", async () => {
        mockProjects.findUnique.mockResolvedValue({
          defaultAccessType: ProjectAccessType.SPECIFIC_ROLE,
          defaultRoleId: 300,
        });
        mockUser.findUnique.mockResolvedValue(mockUserData);
        mockUserProjectPermission.findUnique.mockResolvedValue(null);
        mockGroupProjectPermission.findFirst.mockResolvedValue({
          accessType: ProjectAccessType.SPECIFIC_ROLE,
          roleId: 200,
        });

        const result = await getUserEffectiveProjectAccess(1, "user-123");

        expect(result?.effectiveRoleId).toBe(200);
      });
    });
  });

  describe("getBatchUserEffectiveProjectAccess", () => {
    const mockProject = {
      defaultAccessType: ProjectAccessType.GLOBAL_ROLE,
      defaultRoleId: 10,
    };

    const mockUsers = [
      { id: "user-1", roleId: 5, access: "USER" },
      { id: "user-2", roleId: 6, access: "USER" },
      { id: "user-3", roleId: 7, access: "USER" },
    ];

    describe("project not found", () => {
      it("should return empty map when project does not exist", async () => {
        mockProjects.findUnique.mockResolvedValue(null);

        const result = await getBatchUserEffectiveProjectAccess(999, ["user-1", "user-2"]);

        expect(result.size).toBe(0);
      });
    });

    describe("batch processing", () => {
      it("should process multiple users with different permission types", async () => {
        mockProjects.findUnique.mockResolvedValue(mockProject);
        mockUser.findMany.mockResolvedValue(mockUsers);
        mockUserProjectPermission.findMany.mockResolvedValue([
          { userId: "user-1", accessType: ProjectAccessType.SPECIFIC_ROLE, roleId: 20 },
        ]);
        mockGroupProjectPermission.findMany.mockResolvedValue([
          {
            accessType: ProjectAccessType.SPECIFIC_ROLE,
            roleId: 30,
            group: { assignedUsers: [{ userId: "user-2" }] },
          },
        ]);
        mockProjectAssignment.findMany.mockResolvedValue([
          { userId: "user-3" },
        ]);

        const result = await getBatchUserEffectiveProjectAccess(1, ["user-1", "user-2", "user-3"]);

        expect(result.size).toBe(3);

        // User 1 has explicit permission
        expect(result.get("user-1")).toEqual({
          userId: "user-1",
          accessType: ProjectAccessType.SPECIFIC_ROLE,
          roleId: 20,
          effectiveAccessType: ProjectAccessType.SPECIFIC_ROLE,
          effectiveRoleId: 20,
        });

        // User 2 has group permission
        expect(result.get("user-2")).toEqual({
          userId: "user-2",
          accessType: ProjectAccessType.SPECIFIC_ROLE,
          roleId: 30,
          effectiveAccessType: ProjectAccessType.SPECIFIC_ROLE,
          effectiveRoleId: 30,
        });

        // User 3 has project assignment (uses default)
        expect(result.get("user-3")).toEqual({
          userId: "user-3",
          accessType: "PROJECT_DEFAULT",
          roleId: null,
          effectiveAccessType: ProjectAccessType.GLOBAL_ROLE,
          effectiveRoleId: 7, // User 3's global roleId
        });
      });

      it("should handle user with GLOBAL_ROLE permission", async () => {
        mockProjects.findUnique.mockResolvedValue(mockProject);
        mockUser.findMany.mockResolvedValue([mockUsers[0]]);
        mockUserProjectPermission.findMany.mockResolvedValue([
          { userId: "user-1", accessType: ProjectAccessType.GLOBAL_ROLE, roleId: null },
        ]);
        mockGroupProjectPermission.findMany.mockResolvedValue([]);
        mockProjectAssignment.findMany.mockResolvedValue([]);

        const result = await getBatchUserEffectiveProjectAccess(1, ["user-1"]);

        expect(result.get("user-1")?.effectiveRoleId).toBe(5); // User's global roleId
      });

      it("should skip users not in the database", async () => {
        mockProjects.findUnique.mockResolvedValue(mockProject);
        mockUser.findMany.mockResolvedValue([mockUsers[0]]); // Only user-1 exists
        mockUserProjectPermission.findMany.mockResolvedValue([]);
        mockGroupProjectPermission.findMany.mockResolvedValue([]);
        mockProjectAssignment.findMany.mockResolvedValue([{ userId: "user-1" }]);

        const result = await getBatchUserEffectiveProjectAccess(1, ["user-1", "user-nonexistent"]);

        expect(result.size).toBe(1);
        expect(result.has("user-nonexistent")).toBe(false);
      });

      it("should not include unassigned users without permissions", async () => {
        mockProjects.findUnique.mockResolvedValue(mockProject);
        mockUser.findMany.mockResolvedValue(mockUsers);
        mockUserProjectPermission.findMany.mockResolvedValue([]);
        mockGroupProjectPermission.findMany.mockResolvedValue([]);
        mockProjectAssignment.findMany.mockResolvedValue([]); // No assignments

        const result = await getBatchUserEffectiveProjectAccess(1, ["user-1", "user-2", "user-3"]);

        expect(result.size).toBe(0);
      });
    });

    describe("group permission handling", () => {
      it("should use first group permission when user is in multiple groups", async () => {
        mockProjects.findUnique.mockResolvedValue(mockProject);
        mockUser.findMany.mockResolvedValue([mockUsers[0]]);
        mockUserProjectPermission.findMany.mockResolvedValue([]);
        mockGroupProjectPermission.findMany.mockResolvedValue([
          {
            accessType: ProjectAccessType.SPECIFIC_ROLE,
            roleId: 100,
            group: { assignedUsers: [{ userId: "user-1" }] },
          },
          {
            accessType: ProjectAccessType.SPECIFIC_ROLE,
            roleId: 200,
            group: { assignedUsers: [{ userId: "user-1" }] },
          },
        ]);
        mockProjectAssignment.findMany.mockResolvedValue([]);

        const result = await getBatchUserEffectiveProjectAccess(1, ["user-1"]);

        // First group permission should win
        expect(result.get("user-1")?.effectiveRoleId).toBe(100);
      });

      it("should skip group permission with NO_ACCESS", async () => {
        mockProjects.findUnique.mockResolvedValue(mockProject);
        mockUser.findMany.mockResolvedValue([mockUsers[0]]);
        mockUserProjectPermission.findMany.mockResolvedValue([]);
        mockGroupProjectPermission.findMany.mockResolvedValue([
          {
            accessType: ProjectAccessType.NO_ACCESS,
            roleId: null,
            group: { assignedUsers: [{ userId: "user-1" }] },
          },
        ]);
        mockProjectAssignment.findMany.mockResolvedValue([{ userId: "user-1" }]);

        const result = await getBatchUserEffectiveProjectAccess(1, ["user-1"]);

        // Should fall through to project default since group has NO_ACCESS
        expect(result.get("user-1")?.accessType).toBe("PROJECT_DEFAULT");
      });

      it("should use user global role for group GLOBAL_ROLE permission", async () => {
        mockProjects.findUnique.mockResolvedValue(mockProject);
        mockUser.findMany.mockResolvedValue([mockUsers[0]]);
        mockUserProjectPermission.findMany.mockResolvedValue([]);
        mockGroupProjectPermission.findMany.mockResolvedValue([
          {
            accessType: ProjectAccessType.GLOBAL_ROLE,
            roleId: null,
            group: { assignedUsers: [{ userId: "user-1" }] },
          },
        ]);
        mockProjectAssignment.findMany.mockResolvedValue([]);

        const result = await getBatchUserEffectiveProjectAccess(1, ["user-1"]);

        expect(result.get("user-1")?.effectiveRoleId).toBe(5); // User's global roleId
      });
    });

    describe("project default handling", () => {
      it("should use project default SPECIFIC_ROLE for assigned users", async () => {
        mockProjects.findUnique.mockResolvedValue({
          defaultAccessType: ProjectAccessType.SPECIFIC_ROLE,
          defaultRoleId: 50,
        });
        mockUser.findMany.mockResolvedValue([mockUsers[0]]);
        mockUserProjectPermission.findMany.mockResolvedValue([]);
        mockGroupProjectPermission.findMany.mockResolvedValue([]);
        mockProjectAssignment.findMany.mockResolvedValue([{ userId: "user-1" }]);

        const result = await getBatchUserEffectiveProjectAccess(1, ["user-1"]);

        expect(result.get("user-1")).toEqual({
          userId: "user-1",
          accessType: "PROJECT_DEFAULT",
          roleId: null,
          effectiveAccessType: ProjectAccessType.SPECIFIC_ROLE,
          effectiveRoleId: 50,
        });
      });
    });

    describe("error handling", () => {
      it("should return empty map and log error on exception", async () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        mockProjects.findUnique.mockRejectedValue(new Error("Database error"));

        const result = await getBatchUserEffectiveProjectAccess(1, ["user-1"]);

        expect(result.size).toBe(0);
        expect(consoleSpy).toHaveBeenCalledWith(
          "Error getting batch user effective project access:",
          expect.any(Error)
        );
        consoleSpy.mockRestore();
      });
    });
  });
});
