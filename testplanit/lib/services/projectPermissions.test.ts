import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationArea } from "~/zenstack/models";

vi.mock("~/lib/db", () => ({
  baseDb: { roles: { findUnique: vi.fn() } },
}));
vi.mock("~/lib/services/effectiveRole", () => ({
  resolveEffectiveProjectRoleId: vi.fn(),
}));

import { baseDb } from "~/lib/db";
import { resolveEffectiveProjectRoleId } from "~/lib/services/effectiveRole";
import { userCanAddEditArea } from "./projectPermissions";

const mockedResolve = resolveEffectiveProjectRoleId as unknown as ReturnType<
  typeof vi.fn
>;
const mockedRoleFind = baseDb.roles.findUnique as unknown as ReturnType<
  typeof vi.fn
>;

describe("userCanAddEditArea", () => {
  beforeEach(() => vi.clearAllMocks());

  it("system ADMIN is always allowed without resolving a role", async () => {
    const ok = await userCanAddEditArea(
      "u1",
      1,
      ApplicationArea.TestRuns,
      "ADMIN"
    );
    expect(ok).toBe(true);
    expect(mockedResolve).not.toHaveBeenCalled();
  });

  it("denies when no role resolves (NO_ACCESS), even for PROJECTADMIN", async () => {
    mockedResolve.mockResolvedValue(null);
    const ok = await userCanAddEditArea(
      "u1",
      1,
      ApplicationArea.TestRuns,
      "PROJECTADMIN"
    );
    expect(ok).toBe(false);
    expect(mockedRoleFind).not.toHaveBeenCalled();
  });

  it("allows a system PROJECTADMIN who has a resolvable role", async () => {
    mockedResolve.mockResolvedValue(42);
    const ok = await userCanAddEditArea(
      "u1",
      1,
      ApplicationArea.TestRuns,
      "PROJECTADMIN"
    );
    expect(ok).toBe(true);
    expect(mockedRoleFind).not.toHaveBeenCalled();
  });

  it("honors the role's TestRuns canAddEdit permission for a regular user", async () => {
    mockedResolve.mockResolvedValue(7);
    mockedRoleFind.mockResolvedValue({
      rolePermissions: [{ canAddEdit: true }],
    });
    const ok = await userCanAddEditArea(
      "u1",
      1,
      ApplicationArea.TestRuns,
      "USER"
    );
    expect(ok).toBe(true);
  });

  it("denies when the role lacks TestRuns canAddEdit", async () => {
    mockedResolve.mockResolvedValue(7);
    mockedRoleFind.mockResolvedValue({ rolePermissions: [] });
    const ok = await userCanAddEditArea(
      "u1",
      1,
      ApplicationArea.TestRuns,
      "USER"
    );
    expect(ok).toBe(false);
  });
});
