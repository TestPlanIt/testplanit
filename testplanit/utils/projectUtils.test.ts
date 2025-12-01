import { describe, it, expect } from "vitest";
import { processProjectsWithEffectiveMembers } from "./projectUtils";

// Helper to create mock project data
const createMockProject = (overrides: any = {}) => ({
  id: 1,
  name: "Test Project",
  isDeleted: false,
  createdAt: new Date(),
  createdBy: "user-1",
  defaultAccessType: "NO_ACCESS",
  defaultRoleId: null,
  creator: { id: "user-1", name: "Creator" },
  icon: null,
  milestones: [],
  milestoneTypes: [],
  projectIntegrations: [],
  assignedUsers: [],
  groupPermissions: [],
  _count: {
    milestones: 0,
    testRuns: 0,
    sessions: 0,
    repositoryCases: 0,
    issues: 0,
  },
  ...overrides,
});

describe("projectUtils", () => {
  describe("processProjectsWithEffectiveMembers", () => {
    describe("empty/undefined input", () => {
      it("should return empty array when projectsRaw is undefined", () => {
        const result = processProjectsWithEffectiveMembers(undefined);

        expect(result).toEqual([]);
      });

      it("should return empty array when projectsRaw is empty", () => {
        const result = processProjectsWithEffectiveMembers([]);

        expect(result).toEqual([]);
      });
    });

    describe("NO_ACCESS default type", () => {
      it("should include only directly assigned users", () => {
        const project = createMockProject({
          defaultAccessType: "NO_ACCESS",
          assignedUsers: [
            { userId: "user-1", projectId: 1 },
            { userId: "user-2", projectId: 1 },
          ],
        });

        const allUsers = [
          { id: "user-1", access: "USER" },
          { id: "user-2", access: "USER" },
          { id: "user-3", access: "USER" },
        ];

        const result = processProjectsWithEffectiveMembers([project], allUsers);

        expect(result[0].effectiveUserIds).toHaveLength(2);
        expect(result[0].effectiveUserIds).toContain("user-1");
        expect(result[0].effectiveUserIds).toContain("user-2");
        expect(result[0].effectiveUserIds).not.toContain("user-3");
      });

      it("should include users from groups with access", () => {
        const project = createMockProject({
          defaultAccessType: "NO_ACCESS",
          assignedUsers: [],
          groupPermissions: [
            {
              accessType: "SPECIFIC_ROLE",
              group: {
                assignedUsers: [{ userId: "user-3" }, { userId: "user-4" }],
              },
            },
          ],
        });

        const result = processProjectsWithEffectiveMembers([project]);

        expect(result[0].effectiveUserIds).toContain("user-3");
        expect(result[0].effectiveUserIds).toContain("user-4");
      });

      it("should NOT include users from groups with NO_ACCESS", () => {
        const project = createMockProject({
          defaultAccessType: "NO_ACCESS",
          assignedUsers: [],
          groupPermissions: [
            {
              accessType: "NO_ACCESS",
              group: {
                assignedUsers: [{ userId: "user-5" }],
              },
            },
          ],
        });

        const result = processProjectsWithEffectiveMembers([project]);

        expect(result[0].effectiveUserIds).not.toContain("user-5");
        expect(result[0].effectiveUserIds).toHaveLength(0);
      });

      it("should combine direct and group users", () => {
        const project = createMockProject({
          defaultAccessType: "NO_ACCESS",
          assignedUsers: [{ userId: "user-1", projectId: 1 }],
          groupPermissions: [
            {
              accessType: "GLOBAL_ROLE",
              group: {
                assignedUsers: [{ userId: "user-2" }],
              },
            },
          ],
        });

        const result = processProjectsWithEffectiveMembers([project]);

        expect(result[0].effectiveUserIds).toHaveLength(2);
        expect(result[0].effectiveUserIds).toContain("user-1");
        expect(result[0].effectiveUserIds).toContain("user-2");
      });
    });

    describe("GLOBAL_ROLE default type", () => {
      it("should include all active users except those with NONE access", () => {
        const project = createMockProject({
          defaultAccessType: "GLOBAL_ROLE",
          assignedUsers: [],
        });

        const allUsers = [
          { id: "user-1", access: "USER" },
          { id: "user-2", access: "ADMIN" },
          { id: "user-3", access: "NONE" },
          { id: "user-4", access: null },
        ];

        const result = processProjectsWithEffectiveMembers([project], allUsers);

        expect(result[0].effectiveUserIds).toContain("user-1");
        expect(result[0].effectiveUserIds).toContain("user-2");
        expect(result[0].effectiveUserIds).not.toContain("user-3");
        expect(result[0].effectiveUserIds).toContain("user-4"); // null access is included
      });

      it("should return empty if no allUsers provided", () => {
        const project = createMockProject({
          defaultAccessType: "GLOBAL_ROLE",
          assignedUsers: [],
        });

        const result = processProjectsWithEffectiveMembers([project]);

        expect(result[0].effectiveUserIds).toHaveLength(0);
      });
    });

    describe("SPECIFIC_ROLE default type", () => {
      it("should include all active users except those with NONE access", () => {
        const project = createMockProject({
          defaultAccessType: "SPECIFIC_ROLE",
          assignedUsers: [],
        });

        const allUsers = [
          { id: "user-1", access: "USER" },
          { id: "user-2", access: "NONE" },
        ];

        const result = processProjectsWithEffectiveMembers([project], allUsers);

        expect(result[0].effectiveUserIds).toContain("user-1");
        expect(result[0].effectiveUserIds).not.toContain("user-2");
      });

      it("should combine with directly assigned users", () => {
        const project = createMockProject({
          defaultAccessType: "SPECIFIC_ROLE",
          assignedUsers: [{ userId: "user-1", projectId: 1 }],
        });

        const allUsers = [
          { id: "user-1", access: "USER" },
          { id: "user-2", access: "USER" },
        ];

        const result = processProjectsWithEffectiveMembers([project], allUsers);

        // Both users should be in effective list, user-1 from both sources
        expect(result[0].effectiveUserIds).toContain("user-1");
        expect(result[0].effectiveUserIds).toContain("user-2");
      });
    });

    describe("deduplication", () => {
      it("should not duplicate users who appear in multiple sources", () => {
        const project = createMockProject({
          defaultAccessType: "GLOBAL_ROLE",
          assignedUsers: [{ userId: "user-1", projectId: 1 }],
          groupPermissions: [
            {
              accessType: "SPECIFIC_ROLE",
              group: {
                assignedUsers: [{ userId: "user-1" }],
              },
            },
          ],
        });

        const allUsers = [{ id: "user-1", access: "USER" }];

        const result = processProjectsWithEffectiveMembers([project], allUsers);

        // user-1 appears in: assignedUsers, groupPermissions, and allUsers
        // Should only appear once in effectiveUserIds
        const user1Count = result[0].effectiveUserIds.filter(
          (id) => id === "user-1"
        ).length;
        expect(user1Count).toBe(1);
      });
    });

    describe("multiple projects", () => {
      it("should process multiple projects independently", () => {
        const project1 = createMockProject({
          id: 1,
          defaultAccessType: "NO_ACCESS",
          assignedUsers: [{ userId: "user-1", projectId: 1 }],
        });

        const project2 = createMockProject({
          id: 2,
          defaultAccessType: "GLOBAL_ROLE",
          assignedUsers: [],
        });

        const allUsers = [
          { id: "user-1", access: "USER" },
          { id: "user-2", access: "USER" },
        ];

        const result = processProjectsWithEffectiveMembers(
          [project1, project2],
          allUsers
        );

        expect(result).toHaveLength(2);

        // Project 1 (NO_ACCESS): only user-1
        expect(result[0].effectiveUserIds).toEqual(["user-1"]);

        // Project 2 (GLOBAL_ROLE): both users
        expect(result[1].effectiveUserIds).toContain("user-1");
        expect(result[1].effectiveUserIds).toContain("user-2");
      });
    });

    describe("edge cases", () => {
      it("should handle empty assignedUsers", () => {
        const project = createMockProject({
          defaultAccessType: "NO_ACCESS",
          assignedUsers: [],
        });

        const result = processProjectsWithEffectiveMembers([project]);

        expect(result[0].effectiveUserIds).toEqual([]);
      });

      it("should handle empty groupPermissions", () => {
        const project = createMockProject({
          defaultAccessType: "NO_ACCESS",
          assignedUsers: [{ userId: "user-1", projectId: 1 }],
          groupPermissions: [],
        });

        const result = processProjectsWithEffectiveMembers([project]);

        expect(result[0].effectiveUserIds).toEqual(["user-1"]);
      });

      it("should handle undefined groupPermissions", () => {
        const project = createMockProject({
          defaultAccessType: "NO_ACCESS",
          assignedUsers: [{ userId: "user-1", projectId: 1 }],
          groupPermissions: undefined,
        });

        const result = processProjectsWithEffectiveMembers([project]);

        expect(result[0].effectiveUserIds).toEqual(["user-1"]);
      });

      it("should handle group with undefined assignedUsers", () => {
        const project = createMockProject({
          defaultAccessType: "NO_ACCESS",
          assignedUsers: [],
          groupPermissions: [
            {
              accessType: "SPECIFIC_ROLE",
              group: {
                assignedUsers: undefined,
              },
            },
          ],
        });

        const result = processProjectsWithEffectiveMembers([project]);

        expect(result[0].effectiveUserIds).toEqual([]);
      });

      it("should handle group with null group property", () => {
        const project = createMockProject({
          defaultAccessType: "NO_ACCESS",
          assignedUsers: [],
          groupPermissions: [
            {
              accessType: "SPECIFIC_ROLE",
              group: null,
            },
          ],
        });

        const result = processProjectsWithEffectiveMembers([project]);

        expect(result[0].effectiveUserIds).toEqual([]);
      });
    });

    describe("output structure", () => {
      it("should preserve all original project properties", () => {
        const project = createMockProject({
          id: 42,
          name: "My Project",
          defaultAccessType: "NO_ACCESS",
        });

        const result = processProjectsWithEffectiveMembers([project]);

        expect(result[0].id).toBe(42);
        expect(result[0].name).toBe("My Project");
        expect(result[0].creator).toBeDefined();
        expect(result[0]._count).toBeDefined();
      });

      it("should add effectiveUserIds property", () => {
        const project = createMockProject();

        const result = processProjectsWithEffectiveMembers([project]);

        expect(result[0]).toHaveProperty("effectiveUserIds");
        expect(Array.isArray(result[0].effectiveUserIds)).toBe(true);
      });
    });
  });
});
