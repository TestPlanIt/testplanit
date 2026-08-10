/**
 * Who gets told a run is ready to complete.
 *
 * The set has to equal what the completion gate would allow, so the risks are
 * symmetric: missing someone who can act makes the feature useless to them,
 * and including someone who cannot makes it noise they can do nothing about.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveEligibleRoleIds = vi.fn();
const resolveEffectiveProjectRolesForUsers = vi.fn();
const getProjectEffectiveMemberIds = vi.fn();

const userFindMany = vi.fn();
const projectFindUnique = vi.fn();
const userProjectPermissionFindMany = vi.fn();

vi.mock("~/lib/services/areaPermission", () => ({
  resolveEligibleRoleIds: (...a: unknown[]) => resolveEligibleRoleIds(...a),
}));
vi.mock("~/lib/services/effectiveRole", () => ({
  resolveEffectiveProjectRolesForUsers: (...a: unknown[]) =>
    resolveEffectiveProjectRolesForUsers(...a),
}));
vi.mock("~/lib/services/projectMembers", () => ({
  getProjectEffectiveMemberIds: (...a: unknown[]) =>
    getProjectEffectiveMemberIds(...a),
}));
vi.mock("~/lib/db", () => ({
  baseDb: {
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    projects: { findUnique: (...a: unknown[]) => projectFindUnique(...a) },
    userProjectPermission: {
      findMany: (...a: unknown[]) => userProjectPermissionFindMany(...a),
    },
  },
}));

const { MAX_READY_TO_COMPLETE_RECIPIENTS, resolveRunCompletionRecipients } =
  await import("./runCompletionRecipients");

const withAdmins = (admins: Array<{ id: string; access: string }>) => {
  userFindMany.mockReset();
  userFindMany.mockResolvedValue(admins);
};

beforeEach(() => {
  vi.clearAllMocks();
  resolveEligibleRoleIds.mockResolvedValue(new Set([1]));
  getProjectEffectiveMemberIds.mockResolvedValue([]);
  resolveEffectiveProjectRolesForUsers.mockResolvedValue(new Map());
  projectFindUnique.mockResolvedValue({ defaultAccessType: "GLOBAL_ROLE" });
  userProjectPermissionFindMany.mockResolvedValue([]);
  withAdmins([]);
});

describe("resolveRunCompletionRecipients", () => {
  it("includes members whose effective role carries canClose", async () => {
    getProjectEffectiveMemberIds.mockResolvedValue(["u1", "u2", "u3"]);
    resolveEffectiveProjectRolesForUsers.mockResolvedValue(
      new Map([
        ["u1", 1], // closer role
        ["u2", 2], // some other role
        ["u3", null], // no effective role
      ])
    );

    await expect(resolveRunCompletionRecipients(7)).resolves.toEqual(["u1"]);
  });

  // No role carrying the permission means the role branch can't produce
  // anyone, so the per-user ladder walk is pure waste.
  it("skips the membership walk when no role carries canClose", async () => {
    resolveEligibleRoleIds.mockResolvedValue(new Set());
    await resolveRunCompletionRecipients(7);
    expect(getProjectEffectiveMemberIds).not.toHaveBeenCalled();
    expect(resolveEffectiveProjectRolesForUsers).not.toHaveBeenCalled();
  });

  it("always includes system admins", async () => {
    withAdmins([{ id: "admin", access: "ADMIN" }]);
    await expect(resolveRunCompletionRecipients(7)).resolves.toEqual(["admin"]);
  });

  it("includes a project admin the project does not deny", async () => {
    withAdmins([{ id: "pa", access: "PROJECTADMIN" }]);
    await expect(resolveRunCompletionRecipients(7)).resolves.toEqual(["pa"]);
  });

  it("excludes a project admin denied on this project", async () => {
    withAdmins([{ id: "pa", access: "PROJECTADMIN" }]);
    userProjectPermissionFindMany.mockResolvedValue([{ userId: "pa" }]);
    await expect(resolveRunCompletionRecipients(7)).resolves.toEqual([]);
  });

  it("excludes project admins when the project denies by default", async () => {
    withAdmins([{ id: "pa", access: "PROJECTADMIN" }]);
    projectFindUnique.mockResolvedValue({ defaultAccessType: "NO_ACCESS" });
    await expect(resolveRunCompletionRecipients(7)).resolves.toEqual([]);
  });

  it("keeps a system admin even when the project denies by default", async () => {
    withAdmins([{ id: "admin", access: "ADMIN" }]);
    projectFindUnique.mockResolvedValue({ defaultAccessType: "NO_ACCESS" });
    await expect(resolveRunCompletionRecipients(7)).resolves.toEqual(["admin"]);
  });

  it("only considers active, non-deleted admin accounts", async () => {
    await resolveRunCompletionRecipients(7);
    expect(userFindMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        isDeleted: false,
        access: { in: ["ADMIN", "PROJECTADMIN"] },
      },
      select: { id: true, access: true },
    });
  });

  // isApi is just "may use the API" — auto-enabled for admins and set on most
  // ordinary accounts. It must never gate a notification.
  it("includes users regardless of their isApi flag", async () => {
    getProjectEffectiveMemberIds.mockResolvedValue(["u1", "api-user"]);
    resolveEffectiveProjectRolesForUsers.mockResolvedValue(
      new Map([
        ["u1", 1],
        ["api-user", 1],
      ])
    );

    await expect(resolveRunCompletionRecipients(7)).resolves.toEqual([
      "u1",
      "api-user",
    ]);
  });

  it("does not double-count a user who qualifies twice", async () => {
    getProjectEffectiveMemberIds.mockResolvedValue(["admin"]);
    resolveEffectiveProjectRolesForUsers.mockResolvedValue(
      new Map([["admin", 1]])
    );
    withAdmins([{ id: "admin", access: "ADMIN" }]);
    await expect(resolveRunCompletionRecipients(7)).resolves.toEqual(["admin"]);
  });

  // A project whose default role can close runs makes every active user a
  // recipient. At that size the notification is spam, not a signal.
  it("sends to nobody rather than blasting an oversized audience", async () => {
    const many = Array.from(
      { length: MAX_READY_TO_COMPLETE_RECIPIENTS + 1 },
      (_, i) => `u${i}`
    );
    getProjectEffectiveMemberIds.mockResolvedValue(many);
    resolveEffectiveProjectRolesForUsers.mockResolvedValue(
      new Map(many.map((id) => [id, 1]))
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(resolveRunCompletionRecipients(7)).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
