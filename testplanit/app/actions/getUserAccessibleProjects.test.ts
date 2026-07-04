import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Use vi.hoisted to ensure mocks are available before the vi.mock factory runs
const {
  mockUser,
  mockProjects,
  mockUserProjectPermission,
  mockProjectAssignment,
} = vi.hoisted(() => ({
  mockUser: { findMany: vi.fn() },
  mockProjects: { findMany: vi.fn() },
  mockUserProjectPermission: { findMany: vi.fn() },
  mockProjectAssignment: { findMany: vi.fn() },
}));

// Mock the baseDb singleton
vi.mock("~/lib/db", () => ({
  baseDb: {
    user: mockUser,
    projects: mockProjects,
    userProjectPermission: mockUserProjectPermission,
    projectAssignment: mockProjectAssignment,
  },
}));

// Import after mocking
import {
  getUserAccessibleProjects,
  getUsersAccessibleProjects,
} from "./getUserAccessibleProjects";

// A project row as returned by the batched `baseDb.projects.findMany` select.
type ProjectRow = {
  id: number;
  name?: string;
  iconUrl?: string | null;
  createdBy?: string | null;
  defaultAccessType?: string;
  defaultRoleId?: number | null;
};

type GroupPerm = { projectId: number; accessType: string };
type UserRow = {
  id: string;
  access: string;
  roleId: number | null;
  groups?: { group: { projectPermissions: GroupPerm[] } }[];
};
type PermRow = { userId: string; projectId: number; accessType: string };
type AssignmentRow = { userId: string; projectId: number };

/**
 * Configure the four `baseDb` mocks in one place. Projects default to
 * `NO_ACCESS` (no default access) unless the scenario says otherwise.
 */
function setup(opts: {
  projects?: ProjectRow[];
  users?: UserRow[];
  permissions?: PermRow[];
  assignments?: AssignmentRow[];
}) {
  const projects = (opts.projects ?? []).map((p) => ({
    id: p.id,
    name: p.name ?? `Project ${p.id}`,
    iconUrl: p.iconUrl ?? null,
    createdBy: p.createdBy ?? null,
    defaultAccessType: p.defaultAccessType ?? "NO_ACCESS",
    defaultRoleId: p.defaultRoleId ?? null,
  }));
  mockProjects.findMany.mockResolvedValue(projects);
  mockUser.findMany.mockResolvedValue(
    (opts.users ?? []).map((u) => ({ groups: [], ...u }))
  );
  mockUserProjectPermission.findMany.mockResolvedValue(opts.permissions ?? []);
  mockProjectAssignment.findMany.mockResolvedValue(opts.assignments ?? []);
}

const projectIds = (projects: { id: number }[]) =>
  projects.map((p) => p.id).sort((a, b) => a - b);
const wrapperIds = (projects: { projectId: number }[]) =>
  projects.map((p) => p.projectId).sort((a, b) => a - b);

const USER: UserRow = { id: "user-123", access: "USER", roleId: 5 };

describe("getUserAccessibleProjects (single-user wrapper)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("user not found", () => {
    it("returns empty array when the user does not exist", async () => {
      setup({ projects: [{ id: 1 }], users: [] });

      const result = await getUserAccessibleProjects("nonexistent-user");

      expect(result).toEqual([]);
    });
  });

  describe("NONE access users", () => {
    it("returns empty array when the user has NONE system access", async () => {
      setup({
        projects: [{ id: 1, defaultAccessType: "DEFAULT" }],
        users: [{ id: "user-123", access: "NONE", roleId: 5 }],
      });

      const result = await getUserAccessibleProjects("user-123");

      expect(result).toEqual([]);
    });
  });

  describe("ADMIN access users", () => {
    it("returns all projects when the user has ADMIN access", async () => {
      setup({
        projects: [{ id: 1 }, { id: 2 }, { id: 3 }],
        users: [{ id: "admin-user", access: "ADMIN", roleId: 1 }],
      });

      const result = await getUserAccessibleProjects("admin-user");

      expect(wrapperIds(result)).toEqual([1, 2, 3]);
    });

    it("returns empty array when no projects exist for an ADMIN", async () => {
      setup({
        projects: [],
        users: [{ id: "admin-user", access: "ADMIN", roleId: 1 }],
      });

      const result = await getUserAccessibleProjects("admin-user");

      expect(result).toEqual([]);
    });
  });

  describe("regular user access sources", () => {
    it("includes projects the user created", async () => {
      setup({
        projects: [
          { id: 1, createdBy: "user-123" },
          { id: 2, createdBy: "user-123" },
          { id: 3, createdBy: "someone-else" },
        ],
        users: [USER],
      });

      const result = await getUserAccessibleProjects("user-123");

      expect(wrapperIds(result)).toEqual([1, 2]);
    });

    it("includes projects with explicit user permissions (not NO_ACCESS)", async () => {
      setup({
        projects: [{ id: 10 }, { id: 11 }],
        users: [USER],
        permissions: [
          { userId: "user-123", projectId: 10, accessType: "SPECIFIC_ROLE" },
          { userId: "user-123", projectId: 11, accessType: "GLOBAL_ROLE" },
        ],
      });

      const result = await getUserAccessibleProjects("user-123");

      expect(result).toContainEqual({ projectId: 10 });
      expect(result).toContainEqual({ projectId: 11 });
    });

    it("includes projects the user is assigned to", async () => {
      setup({
        projects: [{ id: 20 }, { id: 21 }],
        users: [USER],
        assignments: [
          { userId: "user-123", projectId: 20 },
          { userId: "user-123", projectId: 21 },
        ],
      });

      const result = await getUserAccessibleProjects("user-123");

      expect(result).toContainEqual({ projectId: 20 });
      expect(result).toContainEqual({ projectId: 21 });
    });

    it("includes projects accessible through groups", async () => {
      setup({
        projects: [{ id: 30 }, { id: 31 }],
        users: [
          {
            ...USER,
            groups: [
              {
                group: {
                  projectPermissions: [
                    { projectId: 30, accessType: "SPECIFIC_ROLE" },
                    { projectId: 31, accessType: "GLOBAL_ROLE" },
                  ],
                },
              },
            ],
          },
        ],
      });

      const result = await getUserAccessibleProjects("user-123");

      expect(result).toContainEqual({ projectId: 30 });
      expect(result).toContainEqual({ projectId: 31 });
    });

    it("excludes group projects with a NO_ACCESS permission", async () => {
      setup({
        projects: [{ id: 30 }],
        users: [
          {
            ...USER,
            groups: [
              {
                group: {
                  projectPermissions: [
                    { projectId: 30, accessType: "NO_ACCESS" },
                  ],
                },
              },
            ],
          },
        ],
      });

      const result = await getUserAccessibleProjects("user-123");

      expect(result).not.toContainEqual({ projectId: 30 });
    });

    it("excludes deleted projects referenced by groups", async () => {
      // Project 30 is deleted, so it never appears in the projects fetch even
      // though a group still points at it.
      setup({
        projects: [],
        users: [
          {
            ...USER,
            groups: [
              {
                group: {
                  projectPermissions: [
                    { projectId: 30, accessType: "SPECIFIC_ROLE" },
                  ],
                },
              },
            ],
          },
        ],
      });

      const result = await getUserAccessibleProjects("user-123");

      expect(result).not.toContainEqual({ projectId: 30 });
    });
  });

  describe("explicit denial override", () => {
    it("excludes group projects when the user has an explicit NO_ACCESS", async () => {
      setup({
        projects: [{ id: 100 }],
        users: [
          {
            ...USER,
            groups: [
              {
                group: {
                  projectPermissions: [
                    { projectId: 100, accessType: "SPECIFIC_ROLE" },
                  ],
                },
              },
            ],
          },
        ],
        permissions: [
          { userId: "user-123", projectId: 100, accessType: "NO_ACCESS" },
        ],
      });

      const result = await getUserAccessibleProjects("user-123");

      expect(result).not.toContainEqual({ projectId: 100 });
    });

    it("excludes GLOBAL_ROLE default projects when the user has an explicit NO_ACCESS", async () => {
      setup({
        projects: [{ id: 200, defaultAccessType: "GLOBAL_ROLE" }],
        users: [USER],
        permissions: [
          { userId: "user-123", projectId: 200, accessType: "NO_ACCESS" },
        ],
      });

      const result = await getUserAccessibleProjects("user-123");

      expect(result).not.toContainEqual({ projectId: 200 });
    });

    it("excludes SPECIFIC_ROLE default projects when the user has an explicit NO_ACCESS", async () => {
      setup({
        projects: [
          { id: 300, defaultAccessType: "SPECIFIC_ROLE", defaultRoleId: 9 },
        ],
        users: [USER],
        permissions: [
          { userId: "user-123", projectId: 300, accessType: "NO_ACCESS" },
        ],
      });

      const result = await getUserAccessibleProjects("user-123");

      expect(result).not.toContainEqual({ projectId: 300 });
    });

    it("excludes DEFAULT access projects when the user has an explicit NO_ACCESS", async () => {
      setup({
        projects: [{ id: 400, defaultAccessType: "DEFAULT" }],
        users: [USER],
        permissions: [
          { userId: "user-123", projectId: 400, accessType: "NO_ACCESS" },
        ],
      });

      const result = await getUserAccessibleProjects("user-123");

      expect(result).not.toContainEqual({ projectId: 400 });
    });
  });

  describe("project default access types", () => {
    it("includes GLOBAL_ROLE default projects when the user has a role", async () => {
      setup({
        projects: [{ id: 50, defaultAccessType: "GLOBAL_ROLE" }],
        users: [USER],
      });

      const result = await getUserAccessibleProjects("user-123");

      expect(result).toContainEqual({ projectId: 50 });
    });

    it("does NOT include GLOBAL_ROLE default projects when the user has no role", async () => {
      setup({
        projects: [{ id: 50, defaultAccessType: "GLOBAL_ROLE" }],
        users: [{ id: "user-123", access: "USER", roleId: null }],
      });

      const result = await getUserAccessibleProjects("user-123");

      expect(result).toEqual([]);
    });

    it("includes SPECIFIC_ROLE default projects when a default role is set", async () => {
      setup({
        projects: [
          { id: 60, defaultAccessType: "SPECIFIC_ROLE", defaultRoleId: 9 },
        ],
        users: [USER],
      });

      const result = await getUserAccessibleProjects("user-123");

      expect(result).toContainEqual({ projectId: 60 });
    });

    it("does NOT include SPECIFIC_ROLE projects with no default role", async () => {
      setup({
        projects: [
          { id: 61, defaultAccessType: "SPECIFIC_ROLE", defaultRoleId: null },
        ],
        users: [USER],
      });

      const result = await getUserAccessibleProjects("user-123");

      expect(result).toEqual([]);
    });

    it("includes DEFAULT access type projects (legacy)", async () => {
      setup({
        projects: [{ id: 70, defaultAccessType: "DEFAULT" }],
        users: [USER],
      });

      const result = await getUserAccessibleProjects("user-123");

      expect(result).toContainEqual({ projectId: 70 });
    });
  });

  describe("deduplication", () => {
    it("does not return duplicate project ids", async () => {
      setup({
        projects: [
          { id: 1, createdBy: "user-123", defaultAccessType: "GLOBAL_ROLE" },
        ],
        users: [
          {
            ...USER,
            groups: [
              {
                group: {
                  projectPermissions: [
                    { projectId: 1, accessType: "SPECIFIC_ROLE" },
                  ],
                },
              },
            ],
          },
        ],
        permissions: [
          { userId: "user-123", projectId: 1, accessType: "SPECIFIC_ROLE" },
        ],
        assignments: [{ userId: "user-123", projectId: 1 }],
      });

      const result = await getUserAccessibleProjects("user-123");

      expect(result).toEqual([{ projectId: 1 }]);
    });
  });

  describe("error handling", () => {
    it("returns empty array and logs the error on exception", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      mockProjects.findMany.mockRejectedValue(new Error("Database error"));
      mockUser.findMany.mockResolvedValue([]);
      mockUserProjectPermission.findMany.mockResolvedValue([]);
      mockProjectAssignment.findMany.mockResolvedValue([]);

      const result = await getUserAccessibleProjects("user-123");

      expect(result).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Error getting users accessible projects:",
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });
});

describe("getUsersAccessibleProjects (batched)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an empty map without querying when given no user ids", async () => {
    const result = await getUsersAccessibleProjects([]);

    expect(result).toEqual({});
    expect(mockProjects.findMany).not.toHaveBeenCalled();
    expect(mockUser.findMany).not.toHaveBeenCalled();
  });

  it("resolves multiple users in a single batch with per-user results", async () => {
    setup({
      projects: [
        { id: 1, name: "Alpha", createdBy: "creator" },
        { id: 2, name: "Bravo", defaultAccessType: "DEFAULT" },
        { id: 3, name: "Charlie" },
      ],
      users: [
        { id: "creator", access: "USER", roleId: 5 },
        { id: "admin", access: "ADMIN", roleId: 1 },
        { id: "none-user", access: "NONE", roleId: null },
      ],
      assignments: [{ userId: "creator", projectId: 3 }],
    });

    const result = await getUsersAccessibleProjects([
      "creator",
      "admin",
      "none-user",
    ]);

    // creator: created (1) + DEFAULT (2) + assignment (3)
    expect(projectIds(result["creator"])).toEqual([1, 2, 3]);
    // admin: everything
    expect(projectIds(result["admin"])).toEqual([1, 2, 3]);
    // none-user: nothing
    expect(result["none-user"]).toEqual([]);

    // One round-trip per table, not per user.
    expect(mockProjects.findMany).toHaveBeenCalledTimes(1);
    expect(mockUser.findMany).toHaveBeenCalledTimes(1);
    expect(mockUserProjectPermission.findMany).toHaveBeenCalledTimes(1);
    expect(mockProjectAssignment.findMany).toHaveBeenCalledTimes(1);
  });

  it("returns project details sorted by name", async () => {
    setup({
      projects: [
        { id: 1, name: "Zebra", defaultAccessType: "DEFAULT" },
        { id: 2, name: "Apple", defaultAccessType: "DEFAULT" },
      ],
      users: [USER],
    });

    const result = await getUsersAccessibleProjects(["user-123"]);

    expect(result["user-123"].map((p) => p.name)).toEqual(["Apple", "Zebra"]);
  });

  it("keeps one user's denial from affecting another user", async () => {
    setup({
      projects: [{ id: 500, defaultAccessType: "DEFAULT" }],
      users: [
        { id: "denied", access: "USER", roleId: 5 },
        { id: "allowed", access: "USER", roleId: 5 },
      ],
      permissions: [
        { userId: "denied", projectId: 500, accessType: "NO_ACCESS" },
      ],
    });

    const result = await getUsersAccessibleProjects(["denied", "allowed"]);

    expect(result["denied"]).toEqual([]);
    expect(projectIds(result["allowed"])).toEqual([500]);
  });
});
