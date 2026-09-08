import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks for every baseDb delegate the action touches. Tests build per-case
// resolved values so each one isolates a single eligibility path.
const mockRolesFindMany = vi.fn();
const mockUserProjectPermissionFindMany = vi.fn();
const mockGroupProjectPermissionFindMany = vi.fn();
const mockUserPreferencesFindMany = vi.fn();
const mockAppConfigFindUnique = vi.fn();
const mockGetServerAuthSession = vi.fn();

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
    userPreferences: {
      findMany: (...args: unknown[]) => mockUserPreferencesFindMany(...args),
    },
    appConfig: {
      findUnique: (...args: unknown[]) => mockAppConfigFindUnique(...args),
    },
  },
}));

vi.mock("~/server/auth", () => ({
  getServerAuthSession: () => mockGetServerAuthSession(),
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
    // Default recipient context: a requester who holds none of the roles,
    // no per-user notification preferences, global default IN_APP. Cases
    // that exercise the recipient projection override these.
    mockGetServerAuthSession.mockResolvedValue({ user: { id: "requester" } });
    mockUserPreferencesFindMany.mockResolvedValue([]);
    mockAppConfigFindUnique.mockResolvedValue(null);
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
      { id: 10, name: "QA Lead", userCount: 2, notifyCount: 2 },
      { id: 11, name: "Dev", userCount: 1, notifyCount: 1 },
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
      { id: 10, name: "QA Lead", userCount: 1, notifyCount: 1 },
      { id: 11, name: "Dev", userCount: 1, notifyCount: 1 },
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

    expect(result).toEqual([
      { id: 10, name: "QA Lead", userCount: 2, notifyCount: 2 },
    ]);
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
      { id: 10, name: "QA Lead", userCount: 2, notifyCount: 2 },
      { id: 11, name: "Dev", userCount: 1, notifyCount: 1 },
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

    expect(result).toEqual([
      { id: 10, name: "QA Lead", userCount: 1, notifyCount: 1 },
    ]);
  });

  it("notifyCount excludes the requester while userCount still counts them", async () => {
    mockGetServerAuthSession.mockResolvedValue({ user: { id: "alice" } });
    mockRolesFindMany.mockResolvedValue(ROLES);
    mockUserProjectPermissionFindMany.mockImplementation((args: any) => {
      if (args.where.accessType === "SPECIFIC_ROLE") {
        return Promise.resolve([
          { roleId: 10, userId: "alice" },
          { roleId: 10, userId: "bob" },
          { roleId: 11, userId: "alice" },
        ]);
      }
      return Promise.resolve([]);
    });
    mockGroupProjectPermissionFindMany.mockResolvedValue([]);

    const result = await getProjectEligibleRoles(1);

    expect(result).toEqual([
      { id: 10, name: "QA Lead", userCount: 2, notifyCount: 1 },
      // Alice is the sole holder of Dev: still selectable, notifies no one.
      { id: 11, name: "Dev", userCount: 1, notifyCount: 0 },
    ]);
  });

  it("notifyCount excludes holders whose notifications are turned off", async () => {
    mockRolesFindMany.mockResolvedValue(ROLES);
    mockUserProjectPermissionFindMany.mockImplementation((args: any) => {
      if (args.where.accessType === "SPECIFIC_ROLE") {
        return Promise.resolve([
          { roleId: 10, userId: "alice" },
          { roleId: 10, userId: "bob" },
        ]);
      }
      return Promise.resolve([]);
    });
    mockGroupProjectPermissionFindMany.mockResolvedValue([]);
    mockUserPreferencesFindMany.mockResolvedValue([
      { userId: "alice", notificationMode: "NONE" },
      { userId: "bob", notificationMode: "IN_APP" },
    ]);

    const result = await getProjectEligibleRoles(1);

    expect(result).toEqual([
      { id: 10, name: "QA Lead", userCount: 2, notifyCount: 1 },
    ]);
  });

  it("USE_GLOBAL holders inherit a global default of NONE", async () => {
    mockRolesFindMany.mockResolvedValue(ROLES);
    mockUserProjectPermissionFindMany.mockImplementation((args: any) => {
      if (args.where.accessType === "SPECIFIC_ROLE") {
        return Promise.resolve([
          { roleId: 10, userId: "alice" },
          { roleId: 10, userId: "bob" },
        ]);
      }
      return Promise.resolve([]);
    });
    mockGroupProjectPermissionFindMany.mockResolvedValue([]);
    // Alice has no preferences row at all, Bob defers explicitly.
    mockUserPreferencesFindMany.mockResolvedValue([
      { userId: "bob", notificationMode: "USE_GLOBAL" },
    ]);
    mockAppConfigFindUnique.mockResolvedValue({
      value: { defaultMode: "NONE" },
    });

    const result = await getProjectEligibleRoles(1);

    expect(result).toEqual([
      { id: 10, name: "QA Lead", userCount: 2, notifyCount: 0 },
    ]);
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
