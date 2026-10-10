import { describe, expect, it, vi } from "vitest";
import {
  isReviewAssignee,
  resolveReviewAssigneeScope,
  reviewAssigneeWhere,
} from "./reviewInboxScope";

// Roles: 1 = Lead (approves CASE + RUN), 2 = Tester (approves nothing),
// 3 = Session lead (approves SESSION). User "me" holds global role 1.
// Project 10: explicit SPECIFIC_ROLE 2. Project 11: NO_ACCESS.
// Project 12: group grant SPECIFIC_ROLE 3. Project 13: SPECIFIC_ROLE default role 3.
// Every other project: GLOBAL_ROLE default.
const db = (overrides: Partial<Record<string, any>> = {}) =>
  ({
    user: {
      findUnique: vi.fn(async () => ({
        id: "me",
        roleId: 1,
        access: "USER",
        groups: [{ groupId: 100 }],
        ...overrides.user,
      })),
    },
    userProjectPermission: {
      findMany: vi.fn(async () => [
        { projectId: 10, accessType: "SPECIFIC_ROLE", roleId: 2 },
        { projectId: 11, accessType: "NO_ACCESS", roleId: null },
      ]),
    },
    groupProjectPermission: {
      findMany: vi.fn(async () => [
        { projectId: 12, accessType: "SPECIFIC_ROLE", roleId: 3 },
        // Already decided by the user's own grant; must not override it.
        { projectId: 10, accessType: "GLOBAL_ROLE", roleId: null },
      ]),
    },
    projects: {
      findMany: vi.fn(async () => [{ id: 13, defaultRoleId: 3 }]),
    },
    rolePermission: {
      findMany: vi.fn(async ({ where }: any) =>
        [
          { roleId: 1, area: "TestCaseRepository" },
          { roleId: 1, area: "TestRuns" },
          { roleId: 3, area: "Sessions" },
        ].filter((p) => where.roleId.in.includes(p.roleId))
      ),
    },
  }) as any;

describe("resolveReviewAssigneeScope", () => {
  it("resolves one role per project through the user, group and default ladder", async () => {
    const scope = await resolveReviewAssigneeScope("me", db());
    expect(scope.roleScopes).toEqual([
      { projectId: 12, roleId: 3, entityTypes: ["SESSION"] },
      { projectId: 13, roleId: 3, entityTypes: ["SESSION"] },
    ]);
    // Project 10's role approves nothing and project 11 is NO_ACCESS: no
    // branch for either, but both are excluded from the global default.
    expect(scope.defaultGlobalRole).toEqual({
      roleId: 1,
      entityTypes: ["CASE", "RUN"],
      excludedProjectIds: [10, 11, 12, 13],
    });
  });

  it("lets an admin approve every entity type", async () => {
    const scope = await resolveReviewAssigneeScope(
      "me",
      db({ user: { access: "ADMIN" } })
    );
    expect(scope.isAdmin).toBe(true);
    expect(scope.roleScopes.find((s) => s.projectId === 10)).toEqual({
      projectId: 10,
      roleId: 2,
      entityTypes: ["CASE", "RUN", "SESSION"],
    });
  });

  it("builds a where branch per project role and one for the global default", async () => {
    const where = reviewAssigneeWhere(
      await resolveReviewAssigneeScope("me", db())
    );
    expect(where).toEqual([
      { assigneeUserId: "me" },
      { projectId: 12, assigneeRoleId: 3, entityType: { in: ["SESSION"] } },
      { projectId: 13, assigneeRoleId: 3, entityType: { in: ["SESSION"] } },
      {
        assigneeRoleId: 1,
        entityType: { in: ["CASE", "RUN"] },
        project: {
          defaultAccessType: "GLOBAL_ROLE",
          id: { notIn: [10, 11, 12, 13] },
        },
      },
    ]);
  });

  it("answers the same question for a row in hand", async () => {
    const scope = await resolveReviewAssigneeScope("me", db());
    const row = (over: Record<string, unknown>) => ({
      projectId: 12,
      assigneeUserId: null,
      assigneeRoleId: 3,
      entityType: "SESSION" as const,
      ...over,
    });
    expect(isReviewAssignee(scope, row({}))).toBe(true);
    expect(isReviewAssignee(scope, row({ entityType: "CASE" }))).toBe(false);
    // Role 1 in project 10 is not the viewer's role there (it is role 2).
    expect(
      isReviewAssignee(
        scope,
        row({ projectId: 10, assigneeRoleId: 1, entityType: "CASE" })
      )
    ).toBe(false);
    // Global role by project default elsewhere.
    expect(
      isReviewAssignee(
        scope,
        row({ projectId: 50, assigneeRoleId: 1, entityType: "RUN" })
      )
    ).toBe(true);
    expect(
      isReviewAssignee(
        scope,
        row({ projectId: 50, assigneeRoleId: 1, entityType: "SESSION" })
      )
    ).toBe(false);
    expect(
      isReviewAssignee(
        scope,
        row({ projectId: 50, assigneeUserId: "me", assigneeRoleId: null })
      )
    ).toBe(true);
  });
});
