import { ApplicationArea, ProjectAccessType } from "~/zenstack/models";
import type { Session } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkUserPermission, getUserProjectPermissions } from "./permissions";

// Mock baseDb
vi.mock("~/lib/db", () => ({
  baseDb: {
    user: {
      findUnique: vi.fn(),
    },
    projects: {
      findUnique: vi.fn(),
    },
    userProjectPermission: {
      findUnique: vi.fn(),
    },
    groupProjectPermission: {
      findMany: vi.fn(),
    },
  },
}));

// Mock permissions utils
vi.mock("~/utils/permissions", () => ({
  isAdmin: vi.fn(),
  isProjectAdmin: vi.fn(),
}));

import { baseDb } from "~/lib/db";
import { isAdmin, isProjectAdmin } from "~/utils/permissions";

const mockDb = baseDb as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn> };
  projects: { findUnique: ReturnType<typeof vi.fn> };
  userProjectPermission: { findUnique: ReturnType<typeof vi.fn> };
  groupProjectPermission: { findMany: ReturnType<typeof vi.fn> };
};

describe("Permissions", () => {
  const mockSession: Session = {
    user: { id: "user-123", email: "test@example.com" },
    expires: new Date(Date.now() + 3600000).toISOString(),
  };

  const mockUser = {
    id: "user-123",
    email: "test@example.com",
    role: {
      id: 1,
      name: "Developer",
      rolePermissions: [
        {
          area: ApplicationArea.TestCaseRepository,
          canAddEdit: true,
          canDelete: false,
          canClose: true,
        },
        {
          area: ApplicationArea.TestRuns,
          canAddEdit: true,
          canDelete: true,
          canClose: true,
        },
      ],
    },
    groups: [],
  };

  const mockProject = {
    id: 1,
    name: "Test Project",
    defaultAccessType: ProjectAccessType.GLOBAL_ROLE,
    defaultRole: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isAdmin).mockReturnValue(false);
    vi.mocked(isProjectAdmin).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getUserProjectPermissions", () => {
    it("should return default permissions when user not found", async () => {
      mockDb.user.findUnique.mockResolvedValue(null);
      mockDb.projects.findUnique.mockResolvedValue(mockProject);
      mockDb.userProjectPermission.findUnique.mockResolvedValue(null);

      const result = await getUserProjectPermissions(
        "non-existent",
        1,
        mockSession
      );

      expect(result.hasAccess).toBe(false);
      expect(result.effectiveRole).toBeNull();
    });

    it("should return default permissions when project not found", async () => {
      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.projects.findUnique.mockResolvedValue(null);
      mockDb.userProjectPermission.findUnique.mockResolvedValue(null);

      const result = await getUserProjectPermissions(
        "user-123",
        999,
        mockSession
      );

      expect(result.hasAccess).toBe(false);
      expect(result.effectiveRole).toBeNull();
    });

    it("should return full permissions for system admin", async () => {
      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.projects.findUnique.mockResolvedValue(mockProject);
      mockDb.userProjectPermission.findUnique.mockResolvedValue(null);
      vi.mocked(isAdmin).mockReturnValue(true);

      const result = await getUserProjectPermissions(
        "user-123",
        1,
        mockSession
      );

      expect(result.hasAccess).toBe(true);
      expect(result.effectiveRole).toBe("System Admin");
      expect(
        (result.permissions as Record<ApplicationArea, any>)[
          ApplicationArea.TestCaseRepository
        ]
      ).toEqual({
        canAddEdit: true,
        canDelete: true,
        canClose: true,
      });
    });

    it("should return full permissions for project admin", async () => {
      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.projects.findUnique.mockResolvedValue(mockProject);
      mockDb.userProjectPermission.findUnique.mockResolvedValue(null);
      vi.mocked(isProjectAdmin).mockReturnValue(true);

      const result = await getUserProjectPermissions(
        "user-123",
        1,
        mockSession
      );

      expect(result.hasAccess).toBe(true);
      expect(result.effectiveRole).toBe("System Project Admin");
    });

    it("should deny access for NO_ACCESS user permission", async () => {
      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.projects.findUnique.mockResolvedValue(mockProject);
      mockDb.userProjectPermission.findUnique.mockResolvedValue({
        accessType: ProjectAccessType.NO_ACCESS,
        role: null,
      });

      const result = await getUserProjectPermissions(
        "user-123",
        1,
        mockSession
      );

      expect(result.hasAccess).toBe(false);
    });

    it("should use global role when GLOBAL_ROLE access type", async () => {
      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.projects.findUnique.mockResolvedValue(mockProject);
      mockDb.userProjectPermission.findUnique.mockResolvedValue({
        accessType: ProjectAccessType.GLOBAL_ROLE,
        role: null,
      });

      const result = await getUserProjectPermissions(
        "user-123",
        1,
        mockSession
      );

      expect(result.hasAccess).toBe(true);
      expect(result.effectiveRole).toBe("Developer");
    });

    it("should use specific role when SPECIFIC_ROLE access type", async () => {
      const specificRole = {
        id: 2,
        name: "QA Engineer",
        rolePermissions: [
          {
            area: ApplicationArea.TestCaseRepository,
            canAddEdit: true,
            canDelete: true,
            canClose: true,
          },
        ],
      };

      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.projects.findUnique.mockResolvedValue(mockProject);
      mockDb.userProjectPermission.findUnique.mockResolvedValue({
        accessType: ProjectAccessType.SPECIFIC_ROLE,
        role: specificRole,
      });

      const result = await getUserProjectPermissions(
        "user-123",
        1,
        mockSession
      );

      expect(result.hasAccess).toBe(true);
      expect(result.effectiveRole).toBe("QA Engineer");
    });

    it("should check group permissions when user has no direct permission", async () => {
      const userWithGroups = {
        ...mockUser,
        groups: [{ groupId: 1 }, { groupId: 2 }],
      };

      const groupRole = {
        id: 3,
        name: "Group Role",
        rolePermissions: [
          {
            area: ApplicationArea.TestCaseRepository,
            canAddEdit: true,
            canDelete: false,
            canClose: false,
          },
        ],
      };

      mockDb.user.findUnique.mockResolvedValue(userWithGroups);
      mockDb.projects.findUnique.mockResolvedValue(mockProject);
      mockDb.userProjectPermission.findUnique.mockResolvedValue(null);
      mockDb.groupProjectPermission.findMany.mockResolvedValue([
        {
          accessType: ProjectAccessType.SPECIFIC_ROLE,
          role: groupRole,
        },
      ]);

      const result = await getUserProjectPermissions(
        "user-123",
        1,
        mockSession
      );

      expect(result.hasAccess).toBe(true);
      expect(result.effectiveRole).toBe("Group Role");
    });

    it("should use project default when no other permissions apply", async () => {
      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.projects.findUnique.mockResolvedValue(mockProject);
      mockDb.userProjectPermission.findUnique.mockResolvedValue(null);

      const result = await getUserProjectPermissions(
        "user-123",
        1,
        mockSession
      );

      expect(result.hasAccess).toBe(true);
      expect(result.effectiveRole).toBe("Developer"); // Uses global role from project default
    });

    it("should deny access when project default is NO_ACCESS", async () => {
      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.projects.findUnique.mockResolvedValue({
        ...mockProject,
        defaultAccessType: ProjectAccessType.NO_ACCESS,
      });
      mockDb.userProjectPermission.findUnique.mockResolvedValue(null);

      const result = await getUserProjectPermissions(
        "user-123",
        1,
        mockSession
      );

      expect(result.hasAccess).toBe(false);
    });

    it("should return permissions for specific area when provided", async () => {
      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.projects.findUnique.mockResolvedValue(mockProject);
      mockDb.userProjectPermission.findUnique.mockResolvedValue(null);

      const result = await getUserProjectPermissions(
        "user-123",
        1,
        mockSession,
        ApplicationArea.TestCaseRepository
      );

      expect(result.hasAccess).toBe(true);
      expect(result.permissions).toEqual({
        canAddEdit: true,
        canDelete: false,
        canClose: true,
      });
    });

    it("should return all area permissions when no specific area", async () => {
      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.projects.findUnique.mockResolvedValue(mockProject);
      mockDb.userProjectPermission.findUnique.mockResolvedValue(null);

      const result = await getUserProjectPermissions(
        "user-123",
        1,
        mockSession
      );

      expect(result.hasAccess).toBe(true);
      expect(result.permissions).toHaveProperty(
        ApplicationArea.TestCaseRepository
      );
      expect(result.permissions).toHaveProperty(ApplicationArea.TestRuns);
    });

    it("should return default permissions for areas without explicit permissions", async () => {
      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.projects.findUnique.mockResolvedValue(mockProject);
      mockDb.userProjectPermission.findUnique.mockResolvedValue(null);

      const result = await getUserProjectPermissions(
        "user-123",
        1,
        mockSession,
        ApplicationArea.Sessions // Not in mockUser's role permissions
      );

      expect(result.permissions).toEqual({
        canAddEdit: false,
        canDelete: false,
        canClose: false,
      });
    });

    it("should handle user with no role", async () => {
      const userWithoutRole = {
        ...mockUser,
        role: null,
      };

      mockDb.user.findUnique.mockResolvedValue(userWithoutRole);
      mockDb.projects.findUnique.mockResolvedValue(mockProject);
      mockDb.userProjectPermission.findUnique.mockResolvedValue(null);

      const result = await getUserProjectPermissions(
        "user-123",
        1,
        mockSession
      );

      // With GLOBAL_ROLE default and no role, permissions should be default (all false)
      expect(result.hasAccess).toBe(false);
    });

    it("should use project default role when SPECIFIC_ROLE default", async () => {
      const projectDefaultRole = {
        id: 4,
        name: "Default Role",
        rolePermissions: [
          {
            area: ApplicationArea.TestCaseRepository,
            canAddEdit: true,
            canDelete: true,
            canClose: true,
          },
        ],
      };

      mockDb.user.findUnique.mockResolvedValue({ ...mockUser, role: null });
      mockDb.projects.findUnique.mockResolvedValue({
        ...mockProject,
        defaultAccessType: ProjectAccessType.SPECIFIC_ROLE,
        defaultRole: projectDefaultRole,
      });
      mockDb.userProjectPermission.findUnique.mockResolvedValue(null);

      const result = await getUserProjectPermissions(
        "user-123",
        1,
        mockSession
      );

      expect(result.hasAccess).toBe(true);
      expect(result.effectiveRole).toBe("Default Role");
    });
  });

  describe("checkUserPermission", () => {
    it("should return true when user has specific permission", async () => {
      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.projects.findUnique.mockResolvedValue(mockProject);
      mockDb.userProjectPermission.findUnique.mockResolvedValue(null);

      const result = await checkUserPermission(
        "user-123",
        1,
        mockSession,
        ApplicationArea.TestCaseRepository,
        "canAddEdit"
      );

      expect(result).toBe(true);
    });

    it("should return false when user lacks specific permission", async () => {
      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.projects.findUnique.mockResolvedValue(mockProject);
      mockDb.userProjectPermission.findUnique.mockResolvedValue(null);

      const result = await checkUserPermission(
        "user-123",
        1,
        mockSession,
        ApplicationArea.TestCaseRepository,
        "canDelete"
      );

      expect(result).toBe(false);
    });

    it("should return false when user has no access", async () => {
      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.projects.findUnique.mockResolvedValue(mockProject);
      mockDb.userProjectPermission.findUnique.mockResolvedValue({
        accessType: ProjectAccessType.NO_ACCESS,
        role: null,
      });

      const result = await checkUserPermission(
        "user-123",
        1,
        mockSession,
        ApplicationArea.TestCaseRepository,
        "canAddEdit"
      );

      expect(result).toBe(false);
    });

    it("should return true for admin regardless of role permissions", async () => {
      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.projects.findUnique.mockResolvedValue(mockProject);
      mockDb.userProjectPermission.findUnique.mockResolvedValue(null);
      vi.mocked(isAdmin).mockReturnValue(true);

      const result = await checkUserPermission(
        "user-123",
        1,
        mockSession,
        ApplicationArea.Sessions, // Not in user's role permissions
        "canDelete"
      );

      expect(result).toBe(true);
    });

    it("should check canClose permission", async () => {
      mockDb.user.findUnique.mockResolvedValue(mockUser);
      mockDb.projects.findUnique.mockResolvedValue(mockProject);
      mockDb.userProjectPermission.findUnique.mockResolvedValue(null);

      const result = await checkUserPermission(
        "user-123",
        1,
        mockSession,
        ApplicationArea.TestRuns,
        "canClose"
      );

      expect(result).toBe(true);
    });
  });
});
