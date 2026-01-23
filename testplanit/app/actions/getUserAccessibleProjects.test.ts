import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Use vi.hoisted to ensure mocks are available before the vi.mock factory runs
const { mockUser, mockProjects, mockUserProjectPermission, mockProjectAssignment } = vi.hoisted(() => ({
  mockUser: { findUnique: vi.fn() },
  mockProjects: { findMany: vi.fn() },
  mockUserProjectPermission: { findMany: vi.fn() },
  mockProjectAssignment: { findMany: vi.fn() },
}));

// Mock the prisma singleton
vi.mock("~/lib/prisma", () => ({
  prisma: {
    user: mockUser,
    projects: mockProjects,
    userProjectPermission: mockUserProjectPermission,
    projectAssignment: mockProjectAssignment,
  },
}));

// Import after mocking
import { getUserAccessibleProjects } from "./getUserAccessibleProjects";

describe("getUserAccessibleProjects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("user not found", () => {
    it("should return empty array when user does not exist", async () => {
      mockUser.findUnique.mockResolvedValue(null);

      const result = await getUserAccessibleProjects("nonexistent-user");

      expect(result).toEqual([]);
    });
  });

  describe("NONE access users", () => {
    it("should return empty array when user has NONE system access", async () => {
      mockUser.findUnique.mockResolvedValue({
        id: "user-123",
        access: "NONE",
        roleId: 5,
        role: { id: 5 },
        groups: [],
      });

      const result = await getUserAccessibleProjects("user-123");

      expect(result).toEqual([]);
    });
  });

  describe("ADMIN access users", () => {
    it("should return all projects when user has ADMIN access", async () => {
      mockUser.findUnique.mockResolvedValue({
        id: "admin-user",
        access: "ADMIN",
        roleId: 1,
        role: { id: 1 },
        groups: [],
      });
      mockProjects.findMany.mockResolvedValue([
        { id: 1 },
        { id: 2 },
        { id: 3 },
      ]);

      const result = await getUserAccessibleProjects("admin-user");

      expect(result).toEqual([
        { projectId: 1 },
        { projectId: 2 },
        { projectId: 3 },
      ]);
    });

    it("should return empty array when no projects exist for ADMIN", async () => {
      mockUser.findUnique.mockResolvedValue({
        id: "admin-user",
        access: "ADMIN",
        roleId: 1,
        role: { id: 1 },
        groups: [],
      });
      mockProjects.findMany.mockResolvedValue([]);

      const result = await getUserAccessibleProjects("admin-user");

      expect(result).toEqual([]);
    });
  });

  describe("regular user access sources", () => {
    const mockUserData = {
      id: "user-123",
      access: "USER",
      roleId: 5,
      role: { id: 5 },
      groups: [],
    };

    it("should include projects user created", async () => {
      mockUser.findUnique.mockResolvedValue(mockUserData);
      // Projects user created
      mockProjects.findMany
        .mockResolvedValueOnce([{ id: 1 }, { id: 2 }]) // Created projects
        .mockResolvedValueOnce([]) // GLOBAL_ROLE projects
        .mockResolvedValueOnce([]) // SPECIFIC_ROLE projects
        .mockResolvedValueOnce([]); // DEFAULT projects
      mockUserProjectPermission.findMany
        .mockResolvedValueOnce([]) // User permissions
        .mockResolvedValueOnce([]); // Explicit denials
      mockProjectAssignment.findMany.mockResolvedValue([]);

      const result = await getUserAccessibleProjects("user-123");

      expect(result).toEqual([{ projectId: 1 }, { projectId: 2 }]);
    });

    it("should include projects with explicit user permissions (not NO_ACCESS)", async () => {
      mockUser.findUnique.mockResolvedValue(mockUserData);
      mockProjects.findMany.mockResolvedValue([]);
      mockUserProjectPermission.findMany
        .mockResolvedValueOnce([{ projectId: 10 }, { projectId: 11 }]) // User permissions
        .mockResolvedValueOnce([]); // Explicit denials
      mockProjectAssignment.findMany.mockResolvedValue([]);

      const result = await getUserAccessibleProjects("user-123");

      expect(result).toContainEqual({ projectId: 10 });
      expect(result).toContainEqual({ projectId: 11 });
    });

    it("should include projects user is assigned to", async () => {
      mockUser.findUnique.mockResolvedValue(mockUserData);
      mockProjects.findMany.mockResolvedValue([]);
      mockUserProjectPermission.findMany.mockResolvedValue([]);
      mockProjectAssignment.findMany.mockResolvedValue([
        { projectId: 20 },
        { projectId: 21 },
      ]);

      const result = await getUserAccessibleProjects("user-123");

      expect(result).toContainEqual({ projectId: 20 });
      expect(result).toContainEqual({ projectId: 21 });
    });

    it("should include projects accessible through groups", async () => {
      mockUser.findUnique.mockResolvedValue({
        ...mockUserData,
        groups: [
          {
            group: {
              projectPermissions: [
                {
                  projectId: 30,
                  accessType: "SPECIFIC_ROLE",
                  project: { id: 30, isDeleted: false },
                },
                {
                  projectId: 31,
                  accessType: "GLOBAL_ROLE",
                  project: { id: 31, isDeleted: false },
                },
              ],
            },
          },
        ],
      });
      mockProjects.findMany.mockResolvedValue([]);
      mockUserProjectPermission.findMany.mockResolvedValue([]);
      mockProjectAssignment.findMany.mockResolvedValue([]);

      const result = await getUserAccessibleProjects("user-123");

      expect(result).toContainEqual({ projectId: 30 });
      expect(result).toContainEqual({ projectId: 31 });
    });

    it("should exclude group projects with NO_ACCESS permission", async () => {
      mockUser.findUnique.mockResolvedValue({
        ...mockUserData,
        groups: [
          {
            group: {
              projectPermissions: [
                {
                  projectId: 30,
                  accessType: "NO_ACCESS",
                  project: { id: 30, isDeleted: false },
                },
              ],
            },
          },
        ],
      });
      mockProjects.findMany.mockResolvedValue([]);
      mockUserProjectPermission.findMany.mockResolvedValue([]);
      mockProjectAssignment.findMany.mockResolvedValue([]);

      const result = await getUserAccessibleProjects("user-123");

      expect(result).not.toContainEqual({ projectId: 30 });
    });

    it("should exclude deleted projects from groups", async () => {
      mockUser.findUnique.mockResolvedValue({
        ...mockUserData,
        groups: [
          {
            group: {
              projectPermissions: [
                {
                  projectId: 30,
                  accessType: "SPECIFIC_ROLE",
                  project: { id: 30, isDeleted: true },
                },
              ],
            },
          },
        ],
      });
      mockProjects.findMany.mockResolvedValue([]);
      mockUserProjectPermission.findMany.mockResolvedValue([]);
      mockProjectAssignment.findMany.mockResolvedValue([]);

      const result = await getUserAccessibleProjects("user-123");

      expect(result).not.toContainEqual({ projectId: 30 });
    });
  });

  describe("explicit denial override", () => {
    const mockUserData = {
      id: "user-123",
      access: "USER",
      roleId: 5,
      role: { id: 5 },
      groups: [
        {
          group: {
            projectPermissions: [
              {
                projectId: 100,
                accessType: "SPECIFIC_ROLE",
                project: { id: 100, isDeleted: false },
              },
            ],
          },
        },
      ],
    };

    it("should exclude group projects when user has explicit NO_ACCESS", async () => {
      mockUser.findUnique.mockResolvedValue(mockUserData);
      mockProjects.findMany.mockResolvedValue([]);
      mockUserProjectPermission.findMany
        .mockResolvedValueOnce([]) // User permissions (not NO_ACCESS)
        .mockResolvedValueOnce([{ projectId: 100 }]); // Explicit denials
      mockProjectAssignment.findMany.mockResolvedValue([]);

      const result = await getUserAccessibleProjects("user-123");

      expect(result).not.toContainEqual({ projectId: 100 });
    });

    it("should exclude GLOBAL_ROLE default projects when user has explicit NO_ACCESS", async () => {
      mockUser.findUnique.mockResolvedValue({
        id: "user-123",
        access: "USER",
        roleId: 5,
        role: { id: 5 },
        groups: [],
      });
      mockProjects.findMany
        .mockResolvedValueOnce([]) // Created projects
        .mockResolvedValueOnce([{ id: 200 }]) // GLOBAL_ROLE projects
        .mockResolvedValueOnce([]) // SPECIFIC_ROLE projects
        .mockResolvedValueOnce([]); // DEFAULT projects
      mockUserProjectPermission.findMany
        .mockResolvedValueOnce([]) // User permissions
        .mockResolvedValueOnce([{ projectId: 200 }]); // Explicit denials
      mockProjectAssignment.findMany.mockResolvedValue([]);

      const result = await getUserAccessibleProjects("user-123");

      expect(result).not.toContainEqual({ projectId: 200 });
    });

    it("should exclude SPECIFIC_ROLE default projects when user has explicit NO_ACCESS", async () => {
      mockUser.findUnique.mockResolvedValue({
        id: "user-123",
        access: "USER",
        roleId: 5,
        role: { id: 5 },
        groups: [],
      });
      mockProjects.findMany
        .mockResolvedValueOnce([]) // Created projects
        .mockResolvedValueOnce([]) // GLOBAL_ROLE projects
        .mockResolvedValueOnce([{ id: 300 }]) // SPECIFIC_ROLE projects
        .mockResolvedValueOnce([]); // DEFAULT projects
      mockUserProjectPermission.findMany
        .mockResolvedValueOnce([]) // User permissions
        .mockResolvedValueOnce([{ projectId: 300 }]); // Explicit denials
      mockProjectAssignment.findMany.mockResolvedValue([]);

      const result = await getUserAccessibleProjects("user-123");

      expect(result).not.toContainEqual({ projectId: 300 });
    });

    it("should exclude DEFAULT access projects when user has explicit NO_ACCESS", async () => {
      mockUser.findUnique.mockResolvedValue({
        id: "user-123",
        access: "USER",
        roleId: 5,
        role: { id: 5 },
        groups: [],
      });
      mockProjects.findMany
        .mockResolvedValueOnce([]) // Created projects
        .mockResolvedValueOnce([]) // GLOBAL_ROLE projects
        .mockResolvedValueOnce([]) // SPECIFIC_ROLE projects
        .mockResolvedValueOnce([{ id: 400 }]); // DEFAULT projects
      mockUserProjectPermission.findMany
        .mockResolvedValueOnce([]) // User permissions
        .mockResolvedValueOnce([{ projectId: 400 }]); // Explicit denials
      mockProjectAssignment.findMany.mockResolvedValue([]);

      const result = await getUserAccessibleProjects("user-123");

      expect(result).not.toContainEqual({ projectId: 400 });
    });
  });

  describe("project default access types", () => {
    it("should include GLOBAL_ROLE default projects when user has a role", async () => {
      mockUser.findUnique.mockResolvedValue({
        id: "user-123",
        access: "USER",
        roleId: 5,
        role: { id: 5 },
        groups: [],
      });
      mockProjects.findMany
        .mockResolvedValueOnce([]) // Created projects
        .mockResolvedValueOnce([{ id: 50 }]) // GLOBAL_ROLE projects
        .mockResolvedValueOnce([]) // SPECIFIC_ROLE projects
        .mockResolvedValueOnce([]); // DEFAULT projects
      mockUserProjectPermission.findMany.mockResolvedValue([]);
      mockProjectAssignment.findMany.mockResolvedValue([]);

      const result = await getUserAccessibleProjects("user-123");

      expect(result).toContainEqual({ projectId: 50 });
    });

    it("should NOT include GLOBAL_ROLE default projects when user has no role", async () => {
      mockUser.findUnique.mockResolvedValue({
        id: "user-123",
        access: "USER",
        roleId: null,
        role: null,
        groups: [],
      });
      mockProjects.findMany
        .mockResolvedValueOnce([]) // Created projects
        .mockResolvedValueOnce([]) // SPECIFIC_ROLE projects (GLOBAL_ROLE query skipped)
        .mockResolvedValueOnce([]); // DEFAULT projects
      mockUserProjectPermission.findMany.mockResolvedValue([]);
      mockProjectAssignment.findMany.mockResolvedValue([]);

      const result = await getUserAccessibleProjects("user-123");

      // Should not have any projects since roleId is null
      expect(result).toEqual([]);
    });

    it("should include SPECIFIC_ROLE default projects", async () => {
      mockUser.findUnique.mockResolvedValue({
        id: "user-123",
        access: "USER",
        roleId: 5,
        role: { id: 5 },
        groups: [],
      });
      mockProjects.findMany
        .mockResolvedValueOnce([]) // Created projects
        .mockResolvedValueOnce([]) // GLOBAL_ROLE projects
        .mockResolvedValueOnce([{ id: 60 }]) // SPECIFIC_ROLE projects
        .mockResolvedValueOnce([]); // DEFAULT projects
      mockUserProjectPermission.findMany.mockResolvedValue([]);
      mockProjectAssignment.findMany.mockResolvedValue([]);

      const result = await getUserAccessibleProjects("user-123");

      expect(result).toContainEqual({ projectId: 60 });
    });

    it("should include DEFAULT access type projects (legacy)", async () => {
      mockUser.findUnique.mockResolvedValue({
        id: "user-123",
        access: "USER",
        roleId: 5,
        role: { id: 5 },
        groups: [],
      });
      mockProjects.findMany
        .mockResolvedValueOnce([]) // Created projects
        .mockResolvedValueOnce([]) // GLOBAL_ROLE projects
        .mockResolvedValueOnce([]) // SPECIFIC_ROLE projects
        .mockResolvedValueOnce([{ id: 70 }]); // DEFAULT projects
      mockUserProjectPermission.findMany.mockResolvedValue([]);
      mockProjectAssignment.findMany.mockResolvedValue([]);

      const result = await getUserAccessibleProjects("user-123");

      expect(result).toContainEqual({ projectId: 70 });
    });
  });

  describe("deduplication", () => {
    it("should not return duplicate project IDs", async () => {
      mockUser.findUnique.mockResolvedValue({
        id: "user-123",
        access: "USER",
        roleId: 5,
        role: { id: 5 },
        groups: [
          {
            group: {
              projectPermissions: [
                {
                  projectId: 1,
                  accessType: "SPECIFIC_ROLE",
                  project: { id: 1, isDeleted: false },
                },
              ],
            },
          },
        ],
      });
      mockProjects.findMany
        .mockResolvedValueOnce([{ id: 1 }]) // Created projects (same ID)
        .mockResolvedValueOnce([{ id: 1 }]) // GLOBAL_ROLE projects (same ID)
        .mockResolvedValueOnce([]) // SPECIFIC_ROLE projects
        .mockResolvedValueOnce([]); // DEFAULT projects
      mockUserProjectPermission.findMany
        .mockResolvedValueOnce([{ projectId: 1 }]) // User permissions (same ID)
        .mockResolvedValueOnce([]);
      mockProjectAssignment.findMany.mockResolvedValue([{ projectId: 1 }]); // Assignments (same ID)

      const result = await getUserAccessibleProjects("user-123");

      // Should only have project 1 once
      expect(result).toEqual([{ projectId: 1 }]);
    });
  });

  describe("error handling", () => {
    it("should return empty array and log error on exception", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockUser.findUnique.mockRejectedValue(new Error("Database error"));

      const result = await getUserAccessibleProjects("user-123");

      expect(result).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Error getting user accessible projects:",
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });
});
