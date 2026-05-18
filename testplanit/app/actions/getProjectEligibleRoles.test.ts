import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetProjectEffectiveMembers = vi.fn();
vi.mock("./getProjectEffectiveMembers", () => ({
  getProjectEffectiveMembers: (...args: unknown[]) =>
    mockGetProjectEffectiveMembers(...args),
}));

const mockRolesFindMany = vi.fn();
vi.mock("~/lib/prisma", () => ({
  prisma: {
    roles: {
      findMany: (...args: unknown[]) => mockRolesFindMany(...args),
    },
  },
}));

// Import after mocks are set up so the action wires up the spies.
import { getProjectEligibleRoles } from "./getProjectEligibleRoles";

describe("getProjectEligibleRoles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an empty array (and skips the roles query) when the project has zero effective members", async () => {
    mockGetProjectEffectiveMembers.mockResolvedValue([]);

    const result = await getProjectEligibleRoles(7);

    expect(result).toEqual([]);
    // No reason to hit the roles table if there's no membership to filter by.
    expect(mockRolesFindMany).not.toHaveBeenCalled();
  });

  it("returns only roles with at least one project-effective holder, with project-scoped userCount", async () => {
    mockGetProjectEffectiveMembers.mockResolvedValue([
      "user-a",
      "user-b",
      "user-c",
    ]);
    mockRolesFindMany.mockResolvedValue([
      { id: 10, name: "QA Lead", _count: { users: 2 } },
      { id: 11, name: "Dev", _count: { users: 1 } },
    ]);

    const result = await getProjectEligibleRoles(42);

    // Roles returned in the order Prisma gives them (the action passes
    // `orderBy: { name: "asc" }`); transform exposes a flat shape.
    expect(result).toEqual([
      { id: 10, name: "QA Lead", userCount: 2 },
      { id: 11, name: "Dev", userCount: 1 },
    ]);
  });

  it("scopes both `where.users.some` and `_count.users.where` to the effective members so empty-roles drop out and counts match", async () => {
    mockGetProjectEffectiveMembers.mockResolvedValue(["alice", "bob"]);
    mockRolesFindMany.mockResolvedValue([]);

    await getProjectEligibleRoles(99);

    expect(mockRolesFindMany).toHaveBeenCalledTimes(1);
    const [callArg] = mockRolesFindMany.mock.calls[0];
    // The role list filters to roles having at least one user in the
    // effective-member set, AND the `_count.users` count is restricted to
    // that same set so the subtitle reflects "users on this project who
    // hold this role" rather than the global count.
    expect(callArg.where).toEqual({
      isDeleted: false,
      users: {
        some: {
          id: { in: ["alice", "bob"] },
          isActive: true,
          isDeleted: false,
        },
      },
    });
    expect(callArg.select._count.select.users.where).toEqual({
      id: { in: ["alice", "bob"] },
      isActive: true,
      isDeleted: false,
    });
    expect(callArg.orderBy).toEqual({ name: "asc" });
  });

  it("defaults `userCount` to 0 when Prisma returns a row without `_count` (defensive)", async () => {
    mockGetProjectEffectiveMembers.mockResolvedValue(["user-a"]);
    mockRolesFindMany.mockResolvedValue([
      { id: 10, name: "Edge case", _count: undefined },
    ]);

    const result = await getProjectEligibleRoles(1);

    expect(result).toEqual([{ id: 10, name: "Edge case", userCount: 0 }]);
  });

  it("returns an empty array on error rather than throwing (callers fall back to the users-only picker)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetProjectEffectiveMembers.mockRejectedValue(new Error("db down"));

    const result = await getProjectEligibleRoles(1);

    expect(result).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(
      "Error fetching project eligible roles:",
      expect.any(Error)
    );
  });
});
