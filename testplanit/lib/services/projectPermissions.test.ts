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
import { userCanAddEditArea, userCanAddEditAreas } from "./projectPermissions";

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
      rolePermissions: [{ area: ApplicationArea.TestRuns, canAddEdit: true }],
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

describe("userCanAddEditAreas", () => {
  beforeEach(() => vi.clearAllMocks());

  const AREAS = [
    ApplicationArea.TestRunResults,
    ApplicationArea.AutomatedExecution,
  ] as const;

  it("system ADMIN is always allowed without resolving a role", async () => {
    expect(await userCanAddEditAreas("u1", 1, AREAS, "ADMIN")).toBe(true);
    expect(mockedResolve).not.toHaveBeenCalled();
  });

  it("denies when no role resolves, even for PROJECTADMIN", async () => {
    mockedResolve.mockResolvedValue(null);
    expect(await userCanAddEditAreas("u1", 1, AREAS, "PROJECTADMIN")).toBe(
      false
    );
    expect(mockedRoleFind).not.toHaveBeenCalled();
  });

  it("allows a system PROJECTADMIN who has a resolvable role", async () => {
    mockedResolve.mockResolvedValue(7);
    expect(await userCanAddEditAreas("u1", 1, AREAS, "PROJECTADMIN")).toBe(
      true
    );
    expect(mockedRoleFind).not.toHaveBeenCalled();
  });

  it("requires canAddEdit on EVERY area, resolved with one role lookup", async () => {
    mockedResolve.mockResolvedValue(7);
    mockedRoleFind.mockResolvedValue({
      rolePermissions: [
        { area: ApplicationArea.TestRunResults, canAddEdit: true },
        { area: ApplicationArea.AutomatedExecution, canAddEdit: true },
      ],
    });
    expect(await userCanAddEditAreas("u1", 1, AREAS, "USER")).toBe(true);
    expect(mockedRoleFind).toHaveBeenCalledTimes(1);
    expect(mockedRoleFind).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          rolePermissions: {
            where: { area: { in: [...AREAS] } },
            select: { area: true, canAddEdit: true },
          },
        },
      })
    );
  });

  it("denies when one of the areas is missing or not granted", async () => {
    mockedResolve.mockResolvedValue(7);
    mockedRoleFind.mockResolvedValue({
      rolePermissions: [
        { area: ApplicationArea.TestRunResults, canAddEdit: true },
        { area: ApplicationArea.AutomatedExecution, canAddEdit: false },
      ],
    });
    expect(await userCanAddEditAreas("u1", 1, AREAS, "USER")).toBe(false);

    mockedRoleFind.mockResolvedValue({
      rolePermissions: [
        { area: ApplicationArea.TestRunResults, canAddEdit: true },
      ],
    });
    expect(await userCanAddEditAreas("u1", 1, AREAS, "USER")).toBe(false);
  });

  it("ignores grants on areas that were not asked for", async () => {
    mockedResolve.mockResolvedValue(7);
    mockedRoleFind.mockResolvedValue({
      rolePermissions: [{ area: ApplicationArea.TestRuns, canAddEdit: true }],
    });
    expect(await userCanAddEditAreas("u1", 1, AREAS, "USER")).toBe(false);
  });
});
