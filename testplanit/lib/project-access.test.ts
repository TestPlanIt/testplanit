import { describe, it, expect } from "vitest";
import { ProjectAccessType } from "@prisma/client";
import {
  buildProjectAccessWhere,
  buildProjectAccessCondition,
} from "./project-access";

// Type helper to access OR property when it exists
interface WithOR {
  OR?: Array<Record<string, unknown>>;
}

describe("Project Access Control", () => {
  const userId = "user-123";
  const projectId = 1;

  describe("buildProjectAccessWhere", () => {
    describe("Admin users", () => {
      it("returns simple where clause for ADMIN users with projectId", () => {
        const result = buildProjectAccessWhere(
          projectId,
          userId,
          true, // isAdmin
          false // isProjectAdmin
        );

        expect(result).toEqual({
          id: projectId,
          isDeleted: false,
        });
        expect(result).not.toHaveProperty("OR");
      });

      it("returns simple where clause for ADMIN users without projectId", () => {
        const result = buildProjectAccessWhere(
          undefined,
          userId,
          true, // isAdmin
          false // isProjectAdmin
        );

        expect(result).toEqual({
          isDeleted: false,
        });
        expect(result).not.toHaveProperty("OR");
        expect(result).not.toHaveProperty("id");
      });
    });

    describe("Non-admin users", () => {
      it("includes userPermissions check", () => {
        const result = buildProjectAccessWhere(
          projectId,
          userId,
          false, // isAdmin
          false // isProjectAdmin
        ) as WithOR;

        expect(result.OR).toBeDefined();
        expect(result.OR).toContainEqual({
          userPermissions: {
            some: {
              userId: userId,
              accessType: { not: ProjectAccessType.NO_ACCESS },
            },
          },
        });
      });

      it("includes groupPermissions check", () => {
        const result = buildProjectAccessWhere(
          projectId,
          userId,
          false, // isAdmin
          false // isProjectAdmin
        ) as WithOR;

        expect(result.OR).toBeDefined();
        expect(result.OR).toContainEqual({
          groupPermissions: {
            some: {
              group: {
                assignedUsers: {
                  some: {
                    userId: userId,
                  },
                },
              },
              accessType: { not: ProjectAccessType.NO_ACCESS },
            },
          },
        });
      });

      it("includes GLOBAL_ROLE default access type check", () => {
        const result = buildProjectAccessWhere(
          projectId,
          userId,
          false, // isAdmin
          false // isProjectAdmin
        ) as WithOR;

        expect(result.OR).toBeDefined();
        expect(result.OR).toContainEqual({
          defaultAccessType: ProjectAccessType.GLOBAL_ROLE,
        });
      });

      it("does NOT include assignedUsers check for regular users", () => {
        const result = buildProjectAccessWhere(
          projectId,
          userId,
          false, // isAdmin
          false // isProjectAdmin
        ) as WithOR;

        expect(result.OR).toBeDefined();
        const hasAssignedUsersCheck = result.OR!.some(
          (condition: Record<string, unknown>) => condition.assignedUsers !== undefined
        );
        expect(hasAssignedUsersCheck).toBe(false);
      });

      it("includes assignedUsers check for PROJECTADMIN users", () => {
        const result = buildProjectAccessWhere(
          projectId,
          userId,
          false, // isAdmin
          true // isProjectAdmin
        ) as WithOR;

        expect(result.OR).toBeDefined();
        expect(result.OR).toContainEqual({
          assignedUsers: {
            some: {
              userId: userId,
            },
          },
        });
      });

      it("has 4 OR conditions for PROJECTADMIN users", () => {
        const result = buildProjectAccessWhere(
          projectId,
          userId,
          false, // isAdmin
          true // isProjectAdmin
        ) as WithOR;

        expect(result.OR).toHaveLength(4);
      });

      it("has 3 OR conditions for regular users", () => {
        const result = buildProjectAccessWhere(
          projectId,
          userId,
          false, // isAdmin
          false // isProjectAdmin
        ) as WithOR;

        expect(result.OR).toHaveLength(3);
      });

      it("includes id and isDeleted with projectId", () => {
        const result = buildProjectAccessWhere(
          projectId,
          userId,
          false, // isAdmin
          false // isProjectAdmin
        ) as { id?: number; isDeleted: boolean };

        expect(result.id).toBe(projectId);
        expect(result.isDeleted).toBe(false);
      });

      it("only includes isDeleted without projectId", () => {
        const result = buildProjectAccessWhere(
          undefined,
          userId,
          false, // isAdmin
          false // isProjectAdmin
        ) as WithOR & { id?: number; isDeleted: boolean };

        expect(result).not.toHaveProperty("id");
        expect(result.isDeleted).toBe(false);
        expect(result.OR).toBeDefined();
      });
    });

    describe("Excludes NO_ACCESS", () => {
      it("filters out NO_ACCESS in userPermissions", () => {
        const result = buildProjectAccessWhere(
          projectId,
          userId,
          false,
          false
        ) as WithOR;

        const userPermCondition = result.OR!.find(
          (c: Record<string, unknown>) => c.userPermissions
        ) as { userPermissions: { some: { accessType: unknown } } };
        expect(userPermCondition.userPermissions.some.accessType).toEqual({
          not: ProjectAccessType.NO_ACCESS,
        });
      });

      it("filters out NO_ACCESS in groupPermissions", () => {
        const result = buildProjectAccessWhere(
          projectId,
          userId,
          false,
          false
        ) as WithOR;

        const groupPermCondition = result.OR!.find(
          (c: Record<string, unknown>) => c.groupPermissions
        ) as { groupPermissions: { some: { accessType: unknown } } };
        expect(groupPermCondition.groupPermissions.some.accessType).toEqual({
          not: ProjectAccessType.NO_ACCESS,
        });
      });
    });
  });

  describe("buildProjectAccessCondition", () => {
    describe("Admin users", () => {
      it("returns empty object for ADMIN users", () => {
        const result = buildProjectAccessCondition(
          userId,
          true, // isAdmin
          false // isProjectAdmin
        );

        expect(result).toEqual({});
      });
    });

    describe("Non-admin users", () => {
      it("includes all access checks without id/isDeleted", () => {
        const result = buildProjectAccessCondition(
          userId,
          false, // isAdmin
          false // isProjectAdmin
        ) as WithOR;

        expect(result).not.toHaveProperty("id");
        expect(result).not.toHaveProperty("isDeleted");
        expect(result.OR).toBeDefined();
        expect(result.OR).toHaveLength(3);
      });

      it("includes assignedUsers check for PROJECTADMIN", () => {
        const result = buildProjectAccessCondition(
          userId,
          false, // isAdmin
          true // isProjectAdmin
        ) as WithOR;

        expect(result.OR).toHaveLength(4);
        expect(result.OR).toContainEqual({
          assignedUsers: {
            some: {
              userId: userId,
            },
          },
        });
      });
    });
  });

  describe("Access control coverage", () => {
    it("covers all required access paths for non-admin users", () => {
      const result = buildProjectAccessWhere(projectId, userId, false, false) as WithOR;

      const accessPaths = result.OR!.map((condition: Record<string, unknown>) => {
        if (condition.userPermissions) return "userPermissions";
        if (condition.groupPermissions) return "groupPermissions";
        if (condition.defaultAccessType) return "defaultAccessType";
        if (condition.assignedUsers) return "assignedUsers";
        return "unknown";
      });

      // Regular users should have these 3 access paths
      expect(accessPaths).toContain("userPermissions");
      expect(accessPaths).toContain("groupPermissions");
      expect(accessPaths).toContain("defaultAccessType");
      expect(accessPaths).not.toContain("assignedUsers");
    });

    it("covers all required access paths for PROJECTADMIN users", () => {
      const result = buildProjectAccessWhere(projectId, userId, false, true) as WithOR;

      const accessPaths = result.OR!.map((condition: Record<string, unknown>) => {
        if (condition.userPermissions) return "userPermissions";
        if (condition.groupPermissions) return "groupPermissions";
        if (condition.defaultAccessType) return "defaultAccessType";
        if (condition.assignedUsers) return "assignedUsers";
        return "unknown";
      });

      // PROJECTADMIN users should have these 4 access paths
      expect(accessPaths).toContain("userPermissions");
      expect(accessPaths).toContain("groupPermissions");
      expect(accessPaths).toContain("defaultAccessType");
      expect(accessPaths).toContain("assignedUsers");
    });
  });

  describe("Regression tests for previous bugs", () => {
    it("does NOT only check userPermissions (the original bug)", () => {
      const result = buildProjectAccessWhere(projectId, userId, false, false) as WithOR;

      // The original bug was only checking userPermissions
      // Make sure we check more than just that
      expect(result.OR!.length).toBeGreaterThan(1);
    });

    it("includes group permissions (previously missing)", () => {
      const result = buildProjectAccessWhere(projectId, userId, false, false) as WithOR;

      const hasGroupPermissions = result.OR!.some(
        (c: Record<string, unknown>) => c.groupPermissions !== undefined
      );
      expect(hasGroupPermissions).toBe(true);
    });

    it("includes GLOBAL_ROLE check (previously missing)", () => {
      const result = buildProjectAccessWhere(projectId, userId, false, false) as WithOR;

      const hasGlobalRole = result.OR!.some(
        (c: Record<string, unknown>) => c.defaultAccessType === ProjectAccessType.GLOBAL_ROLE
      );
      expect(hasGlobalRole).toBe(true);
    });

    it("includes PROJECTADMIN assignedUsers check (previously missing)", () => {
      const result = buildProjectAccessWhere(projectId, userId, false, true) as WithOR;

      const hasAssignedUsers = result.OR!.some(
        (c: Record<string, unknown>) => c.assignedUsers !== undefined
      );
      expect(hasAssignedUsers).toBe(true);
    });
  });
});
