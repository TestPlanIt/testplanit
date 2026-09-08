import { ApplicationArea } from "~/zenstack/models";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRolePermissionFindMany = vi.fn();
const mockUserFindMany = vi.fn();
const mockUserCount = vi.fn();

vi.mock("~/lib/db", () => ({
  baseDb: {
    rolePermission: {
      findMany: (...args: unknown[]) => mockRolePermissionFindMany(...args),
    },
    user: {
      findMany: (...args: unknown[]) => mockUserFindMany(...args),
      count: (...args: unknown[]) => mockUserCount(...args),
    },
  },
}));

const mockGetProjectEffectiveMembers = vi.fn();
vi.mock("./getProjectEffectiveMembers", () => ({
  getProjectEffectiveMembers: (...args: unknown[]) =>
    mockGetProjectEffectiveMembers(...args),
}));

const mockResolveEffectiveProjectRolesForUsers = vi.fn();
vi.mock("~/lib/services/effectiveRole", () => ({
  resolveEffectiveProjectRolesForUsers: (...args: unknown[]) =>
    mockResolveEffectiveProjectRolesForUsers(...args),
}));

import { searchProjectMembers } from "./searchProjectMembers";

describe("searchProjectMembers canApprove option", () => {
  beforeEach(() => {
    mockRolePermissionFindMany.mockReset();
    mockUserFindMany.mockReset().mockResolvedValue([]);
    mockUserCount.mockReset().mockResolvedValue(0);
    mockGetProjectEffectiveMembers.mockReset();
    mockResolveEffectiveProjectRolesForUsers.mockReset();
  });

  it("Test A: when option is omitted, the eligibleRoleIds query is NOT run and per-user filter is skipped", async () => {
    mockGetProjectEffectiveMembers.mockResolvedValue(["u-1", "u-2"]);
    mockUserFindMany.mockResolvedValue([
      { id: "u-1", name: "Alice", email: "a@x", image: null },
      { id: "u-2", name: "Bob", email: "b@x", image: null },
    ]);
    mockUserCount.mockResolvedValue(2);

    const result = await searchProjectMembers(42, "", 0, 10);
    expect(mockRolePermissionFindMany).not.toHaveBeenCalled();
    expect(mockResolveEffectiveProjectRolesForUsers).not.toHaveBeenCalled();
    expect(result.total).toBe(2);
    expect(result.results).toHaveLength(2);
  });

  it("Test B: when option is present, only users whose effective role is in eligibleRoleIds are queried", async () => {
    mockGetProjectEffectiveMembers.mockResolvedValue(["u-1", "u-2", "u-3"]);
    mockRolePermissionFindMany.mockResolvedValue([
      { roleId: 11 },
      { roleId: 22 },
    ]);
    mockResolveEffectiveProjectRolesForUsers.mockResolvedValue(
      new Map<string, number | null>([
        ["u-1", 11],
        ["u-2", 99], // not in eligible
        ["u-3", 22],
      ])
    );
    mockUserFindMany.mockResolvedValue([
      { id: "u-1", name: "Alice", email: "a@x", image: null },
      { id: "u-3", name: "Cara", email: "c@x", image: null },
    ]);
    mockUserCount.mockResolvedValue(2);

    const result = await searchProjectMembers(42, "", 0, 10, {
      requireCanApproveOn: ApplicationArea.TestCaseRepository,
    });

    expect(mockRolePermissionFindMany).toHaveBeenCalledWith({
      where: {
        area: ApplicationArea.TestCaseRepository,
        canApprove: true,
      },
      select: { roleId: true },
    });

    // findMany was called with only u-1 + u-3 (u-2 filtered out)
    const findManyArg = mockUserFindMany.mock.calls[0][0];
    expect(findManyArg.where.id.in).toEqual(["u-1", "u-3"]);
    const countArg = mockUserCount.mock.calls[0][0];
    expect(countArg.where.id.in).toEqual(["u-1", "u-3"]);
    expect(result.total).toBe(2);
  });

  it("Test C: when option is present and zero eligible roles exist, returns empty result without further queries", async () => {
    mockGetProjectEffectiveMembers.mockResolvedValue(["u-1"]);
    mockRolePermissionFindMany.mockResolvedValue([]);

    const result = await searchProjectMembers(42, "", 0, 10, {
      requireCanApproveOn: ApplicationArea.TestRuns,
    });

    expect(result).toEqual({ results: [], total: 0 });
    expect(mockResolveEffectiveProjectRolesForUsers).not.toHaveBeenCalled();
    expect(mockUserFindMany).not.toHaveBeenCalled();
    expect(mockUserCount).not.toHaveBeenCalled();
  });

  it("Test D: a user whose effective role IS in eligibleRoleIds is included", async () => {
    mockGetProjectEffectiveMembers.mockResolvedValue(["u-9"]);
    mockRolePermissionFindMany.mockResolvedValue([{ roleId: 5 }]);
    mockResolveEffectiveProjectRolesForUsers.mockResolvedValue(
      new Map<string, number | null>([["u-9", 5]])
    );
    mockUserFindMany.mockResolvedValue([
      { id: "u-9", name: "Nine", email: "n@x", image: null },
    ]);
    mockUserCount.mockResolvedValue(1);

    const result = await searchProjectMembers(42, "", 0, 10, {
      requireCanApproveOn: ApplicationArea.Sessions,
    });
    expect(result.results.map((u) => u.id)).toEqual(["u-9"]);
    expect(result.total).toBe(1);
  });
});
