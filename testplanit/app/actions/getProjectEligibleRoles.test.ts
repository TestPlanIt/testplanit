import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks for every baseDb delegate the action touches. Tests build per-case
// resolved values so each one isolates a single eligibility path.
const mockRolesFindMany = vi.fn();
const mockUserProjectPermissionFindMany = vi.fn();
const mockGroupProjectPermissionFindMany = vi.fn();

vi.mock("~/lib/db", () => ({
  baseDb: {
    roles: {
      findMany: (...args: unknown[]) => mockRolesFindMany(...args),
    },
    userProjectPermission: {
      findMany: (...args: unknown[]) =>
        mockUserProjectPermissionFindMany(...args),
    },
    groupProjectPermission: {
      findMany: (...args: unknown[]) =>
        mockGroupProjectPermissionFindMany(...args),
    },
  },
}));

// Import after mocks are set up so the action wires up the spies.
import { getProjectEligibleRoles } from "./getProjectEligibleRoles";

const ROLES = [
  { id: 10, name: "QA Lead" },
  { id: 11, name: "Dev" },
];

function setupNoPermissions() {
  mockRolesFindMany.mockResolvedValue(ROLES);
  mockUserProjectPermissionFindMany.mockResolvedValue([]);
  mockGroupProjectPermissionFindMany.mockResolvedValue([]);
}

describe("getProjectEligibleRoles — union of four eligibility paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an empty array when no roles exist", async () => {
    mockRolesFindMany.mockResolvedValue([]);

    const result = await getProjectEligibleRoles(7);

    expect(result).toEqual([]);
    // No reason to fan out to the permission tables if there are no roles.
    expect(mockUserProjectPermissionFindMany).not.toHaveBeenCalled();
    expect(mockGroupProjectPermissionFindMany).not.toHaveBeenCalled();
  });

  it("filters out roles with zero project-eligible holders (dead-end roles are hidden)", async () => {
    setupNoPermissions();

    const result = await getProjectEligibleRoles(42);

    expect(result).toEqual([]);
  });

  it("path 1 — UserProjectPermission SPECIFIC_ROLE contributes to the count", async () => {
    mockRolesFindMany.mockResolvedValue(ROLES);
    mockUserProjectPermissionFindMany.mockImplementation((args: any) => {
      if (args.where.accessType === "SPECIFIC_ROLE") {
        return Promise.resolve([
          { roleId: 10, userId: "alice" },
          { roleId: 10, userId: "bob" },
          { roleId: 11, userId: "carol" },
        ]);
      }
      return Promise.resolve([]);
    });
    mockGroupProjectPermissionFindMany.mockResolvedValue([]);

    const result = await getProjectEligibleRoles(1);

    expect(result).toEqual([
      { id: 10, name: "QA Lead", userCount: 2 },
      { id: 11, name: "Dev", userCount: 1 },
    ]);
  });

  it("path 2 — UserProjectPermission GLOBAL_ROLE uses user.roleId for matching", async () => {
    mockRolesFindMany.mockResolvedValue(ROLES);
    mockUserProjectPermissionFindMany.mockImplementation((args: any) => {
      if (args.where.accessType === "GLOBAL_ROLE") {
        return Promise.resolve([
          { userId: "alice", user: { roleId: 10 } },
          { userId: "bob", user: { roleId: 11 } },
        ]);
      }
      return Promise.resolve([]);
    });
    mockGroupProjectPermissionFindMany.mockResolvedValue([]);

    const result = await getProjectEligibleRoles(1);

    expect(result).toEqual([
      { id: 10, name: "QA Lead", userCount: 1 },
      { id: 11, name: "Dev", userCount: 1 },
    ]);
  });

  it("path 3 — Group SPECIFIC_ROLE counts every active group member", async () => {
    mockRolesFindMany.mockResolvedValue(ROLES);
    mockUserProjectPermissionFindMany.mockResolvedValue([]);
    mockGroupProjectPermissionFindMany.mockImplementation((args: any) => {
      if (args.where.accessType === "SPECIFIC_ROLE") {
        return Promise.resolve([
          {
            roleId: 10,
            group: {
              assignedUsers: [{ userId: "alice" }, { userId: "bob" }],
            },
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const result = await getProjectEligibleRoles(1);

    expect(result).toEqual([{ id: 10, name: "QA Lead", userCount: 2 }]);
  });

  it("path 4 — Group GLOBAL_ROLE keys on each member's global User.roleId", async () => {
    mockRolesFindMany.mockResolvedValue(ROLES);
    mockUserProjectPermissionFindMany.mockResolvedValue([]);
    mockGroupProjectPermissionFindMany.mockImplementation((args: any) => {
      if (args.where.accessType === "GLOBAL_ROLE") {
        return Promise.resolve([
          {
            group: {
              assignedUsers: [
                { userId: "alice", user: { roleId: 10 } },
                { userId: "bob", user: { roleId: 11 } },
                { userId: "carol", user: { roleId: 10 } },
              ],
            },
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const result = await getProjectEligibleRoles(1);

    expect(result).toEqual([
      { id: 10, name: "QA Lead", userCount: 2 },
      { id: 11, name: "Dev", userCount: 1 },
    ]);
  });

  it("dedupes a single user counted across multiple eligibility paths", async () => {
    mockRolesFindMany.mockResolvedValue(ROLES);
    // Alice holds role 10 via path 1 (SPECIFIC_ROLE) AND path 3 (Group
    // SPECIFIC_ROLE). The role should count her once, not twice.
    mockUserProjectPermissionFindMany.mockImplementation((args: any) => {
      if (args.where.accessType === "SPECIFIC_ROLE") {
        return Promise.resolve([{ roleId: 10, userId: "alice" }]);
      }
      return Promise.resolve([]);
    });
    mockGroupProjectPermissionFindMany.mockImplementation((args: any) => {
      if (args.where.accessType === "SPECIFIC_ROLE") {
        return Promise.resolve([
          {
            roleId: 10,
            group: { assignedUsers: [{ userId: "alice" }] },
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const result = await getProjectEligibleRoles(1);

    expect(result).toEqual([{ id: 10, name: "QA Lead", userCount: 1 }]);
  });

  it("returns an empty array on error rather than throwing (callers fall back to the users-only picker)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRolesFindMany.mockRejectedValue(new Error("db down"));

    const result = await getProjectEligibleRoles(1);

    expect(result).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(
      "Error fetching project eligible roles:",
      expect.any(Error)
    );
  });
});
