import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApplicationArea, ProjectAccessType } from "@prisma/client";
import type { Session } from "next-auth";
import {
  getUserProjectPermissions,
  checkUserPermission,
  type UserProjectPermissionsResult,
} from "./permissions";

// Mock prisma
vi.mock("~/lib/prisma", () => ({
  prisma: {
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

import { prisma } from "~/lib/prisma";
import { isAdmin, isProjectAdmin } from "~/utils/permissions";

const mockPrisma = prisma as unknown as {
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
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.projects.findUnique.mockResolvedValue(mockProject);
      mockPrisma.userProjectPermission.findUnique.mockResolvedValue(null);

      const result = await getUserProjectPermissions(
        "non-existent",
        1,
        mockSession
      );

      expect(result.hasAccess).toBe(false);
      expect(result.effectiveRole).toBeNull();
    });

    it("should return default permissions when project not found", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.projects.findUnique.mockResolvedValue(null);
      mockPrisma.userProjectPermission.findUnique.mockResolvedValue(null);

      const result = await getUserProjectPermissions("user-123", 999, mockSession);

      expect(result.hasAccess).toBe(false);
      expect(result.effectiveRole).toBeNull();
    });

    it("should return full permissions for system admin", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.projects.findUnique.mockResolvedValue(mockProject);
      mockPrisma.userProjectPermission.findUnique.mockResolvedValue(null);
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
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.projects.findUnique.mockResolvedValue(mockProject);
      mockPrisma.userProjectPermission.findUnique.mockResolvedValue(null);
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
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.projects.findUnique.mockResolvedValue(mockProject);
      mockPrisma.userProjectPermission.findUnique.mockResolvedValue({
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
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.projects.findUnique.mockResolvedValue(mockProject);
      mockPrisma.userProjectPermission.findUnique.mockResolvedValue({
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

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.projects.findUnique.mockResolvedValue(mockProject);
      mockPrisma.userProjectPermission.findUnique.mockResolvedValue({
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

      mockPrisma.user.findUnique.mockResolvedValue(userWithGroups);
      mockPrisma.projects.findUnique.mockResolvedValue(mockProject);
      mockPrisma.userProjectPermission.findUnique.mockResolvedValue(null);
      mockPrisma.groupProjectPermission.findMany.mockResolvedValue([
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
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.projects.findUnique.mockResolvedValue(mockProject);
      mockPrisma.userProjectPermission.findUnique.mockResolvedValue(null);

      const result = await getUserProjectPermissions(
        "user-123",
        1,
        mockSession
      );

      expect(result.hasAccess).toBe(true);
      expect(result.effectiveRole).toBe("Developer"); // Uses global role from project default
    });

    it("should deny access when project default is NO_ACCESS", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.projects.findUnique.mockResolvedValue({
        ...mockProject,
        defaultAccessType: ProjectAccessType.NO_ACCESS,
      });
      mockPrisma.userProjectPermission.findUnique.mockResolvedValue(null);

      const result = await getUserProjectPermissions(
        "user-123",
        1,
        mockSession
      );

      expect(result.hasAccess).toBe(false);
    });

    it("should return permissions for specific area when provided", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.projects.findUnique.mockResolvedValue(mockProject);
      mockPrisma.userProjectPermission.findUnique.mockResolvedValue(null);

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
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.projects.findUnique.mockResolvedValue(mockProject);
      mockPrisma.userProjectPermission.findUnique.mockResolvedValue(null);

      const result = await getUserProjectPermissions(
        "user-123",
        1,
        mockSession
      );

      expect(result.hasAccess).toBe(true);
      expect(result.permissions).toHaveProperty(ApplicationArea.TestCaseRepository);
      expect(result.permissions).toHaveProperty(ApplicationArea.TestRuns);
    });

    it("should return default permissions for areas without explicit permissions", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.projects.findUnique.mockResolvedValue(mockProject);
      mockPrisma.userProjectPermission.findUnique.mockResolvedValue(null);

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

      mockPrisma.user.findUnique.mockResolvedValue(userWithoutRole);
      mockPrisma.projects.findUnique.mockResolvedValue(mockProject);
      mockPrisma.userProjectPermission.findUnique.mockResolvedValue(null);

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

      mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, role: null });
      mockPrisma.projects.findUnique.mockResolvedValue({
        ...mockProject,
        defaultAccessType: ProjectAccessType.SPECIFIC_ROLE,
        defaultRole: projectDefaultRole,
      });
      mockPrisma.userProjectPermission.findUnique.mockResolvedValue(null);

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
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.projects.findUnique.mockResolvedValue(mockProject);
      mockPrisma.userProjectPermission.findUnique.mockResolvedValue(null);

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
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.projects.findUnique.mockResolvedValue(mockProject);
      mockPrisma.userProjectPermission.findUnique.mockResolvedValue(null);

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
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.projects.findUnique.mockResolvedValue(mockProject);
      mockPrisma.userProjectPermission.findUnique.mockResolvedValue({
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
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.projects.findUnique.mockResolvedValue(mockProject);
      mockPrisma.userProjectPermission.findUnique.mockResolvedValue(null);
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
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.projects.findUnique.mockResolvedValue(mockProject);
      mockPrisma.userProjectPermission.findUnique.mockResolvedValue(null);

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
