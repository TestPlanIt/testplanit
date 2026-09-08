import { ApplicationArea } from "~/zenstack/models";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRolesFindMany = vi.fn();
const mockUserProjectPermissionFindMany = vi.fn();
const mockGroupProjectPermissionFindMany = vi.fn();

vi.mock("~/lib/db", () => ({
  baseDb: {
    roles: { findMany: (...args: unknown[]) => mockRolesFindMany(...args) },
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

import { getProjectEligibleRoles } from "./getProjectEligibleRoles";

describe("getProjectEligibleRoles canApprove option", () => {
  beforeEach(() => {
    mockRolesFindMany.mockReset();
    mockUserProjectPermissionFindMany.mockReset().mockResolvedValue([]);
    mockGroupProjectPermissionFindMany.mockReset().mockResolvedValue([]);
  });

  it("Test A: when option is omitted, findMany where clause does NOT include rolePermissions", async () => {
    mockRolesFindMany.mockResolvedValue([]);
    await getProjectEligibleRoles(42);

    expect(mockRolesFindMany).toHaveBeenCalledTimes(1);
    const callArg = mockRolesFindMany.mock.calls[0][0];
    expect(callArg.where).toEqual({ isDeleted: false });
    expect(callArg.where.rolePermissions).toBeUndefined();
  });

  it("Test B: when option is present, findMany where clause includes rolePermissions.some filter for the area + canApprove:true", async () => {
    mockRolesFindMany.mockResolvedValue([]);
    await getProjectEligibleRoles(42, {
      requireCanApproveOn: ApplicationArea.TestRuns,
    });

    expect(mockRolesFindMany).toHaveBeenCalledTimes(1);
    const callArg = mockRolesFindMany.mock.calls[0][0];
    expect(callArg.where.rolePermissions).toEqual({
      some: {
        area: ApplicationArea.TestRuns,
        canApprove: true,
      },
    });
  });

  it("Test C: when option is present and zero matching roles found, returns []", async () => {
    mockRolesFindMany.mockResolvedValue([]);
    const result = await getProjectEligibleRoles(42, {
      requireCanApproveOn: ApplicationArea.Sessions,
    });
    expect(result).toEqual([]);
    expect(mockUserProjectPermissionFindMany).not.toHaveBeenCalled();
    expect(mockGroupProjectPermissionFindMany).not.toHaveBeenCalled();
  });
});
