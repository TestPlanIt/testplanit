import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  baseDb: {
    groupAssignment: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    scimRoleMapping: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(),
}));

vi.mock("~/lib/auditContext", () => ({
  runWithAuditContext: vi.fn((_ctx: unknown, fn: () => unknown) => fn()),
}));

vi.mock("~/lib/scim/access/fallbackDefault", () => ({
  readScimFallbackDefault: vi.fn().mockResolvedValue("NONE"),
}));

vi.mock("~/lib/queues", () => ({
  getScimAccessRecomputeQueue: vi.fn(),
}));

import { baseDb } from "~/lib/db";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { getServerAuthSession } from "~/server/auth";
import { readScimFallbackDefault } from "~/lib/scim/access/fallbackDefault";
import { getScimAccessRecomputeQueue } from "~/lib/queues";

import {
  previewRoleMappingChange,
  saveRoleMappingChange,
} from "./scimRoleMappingActions";

function mockAdminSession(id = "admin1") {
  vi.mocked(getServerAuthSession).mockResolvedValue({
    user: { id, access: "ADMIN", name: "Admin User" },
  } as any);
}

function mockNonAdminSession() {
  vi.mocked(getServerAuthSession).mockResolvedValue({
    user: { id: "user1", access: "USER" },
  } as any);
}

const queueAdd = vi.fn();

describe("scimRoleMappingActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queueAdd.mockResolvedValue(undefined);
    vi.mocked(getScimAccessRecomputeQueue).mockReturnValue({
      add: queueAdd,
    } as any);
    vi.mocked(readScimFallbackDefault).mockResolvedValue("NONE");
    vi.mocked(baseDb.scimRoleMapping.findMany).mockResolvedValue([] as any);
    vi.mocked(baseDb.user.findMany).mockResolvedValue([] as any);
    vi.mocked(baseDb.groupAssignment.findMany).mockResolvedValue([] as any);
  });

  describe("authorization", () => {
    it("rejects an unauthenticated caller before touching the database", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue(null as any);

      expect(await previewRoleMappingChange("qa-lead", "USER")).toEqual({
        success: false,
        error: "Unauthorized",
      });
      expect(await saveRoleMappingChange("qa-lead", "USER")).toEqual({
        success: false,
        error: "Unauthorized",
      });
      expect(baseDb.user.findMany).not.toHaveBeenCalled();
      expect(baseDb.scimRoleMapping.create).not.toHaveBeenCalled();
    });

    it("rejects a non-admin caller", async () => {
      mockNonAdminSession();

      expect(await saveRoleMappingChange("qa-lead", "ADMIN")).toEqual({
        success: false,
        error: "Unauthorized",
      });
      expect(baseDb.scimRoleMapping.create).not.toHaveBeenCalled();
    });
  });

  describe("validation", () => {
    it("rejects a blank role value", async () => {
      mockAdminSession();

      expect(await saveRoleMappingChange("   ", "USER")).toEqual({
        success: false,
        error: "Invalid input",
      });
      expect(baseDb.scimRoleMapping.create).not.toHaveBeenCalled();
    });

    it("rejects a role value beyond the column length", async () => {
      mockAdminSession();

      const result = await saveRoleMappingChange("x".repeat(201), "USER");

      expect(result).toEqual({ success: false, error: "Invalid input" });
    });
  });

  describe("saveRoleMappingChange", () => {
    it("creates a mapping with a lowercased role value and enqueues a scoped recompute", async () => {
      mockAdminSession();
      vi.mocked(baseDb.scimRoleMapping.findUnique).mockResolvedValue(
        null as any
      );

      const result = await saveRoleMappingChange("QA-Lead", "PROJECTADMIN");

      expect(result).toEqual({ success: true });
      expect(baseDb.scimRoleMapping.create).toHaveBeenCalledWith({
        data: { roleValue: "qa-lead", mappedAccess: "PROJECTADMIN" },
      });
      expect(queueAdd).toHaveBeenCalledWith(
        "scim-access-recompute",
        expect.objectContaining({ roleValue: "qa-lead" })
      );
    });

    it("updates an existing mapping instead of creating a duplicate", async () => {
      mockAdminSession();
      vi.mocked(baseDb.scimRoleMapping.findUnique).mockResolvedValue({
        id: 7,
        mappedAccess: "USER",
      } as any);

      await saveRoleMappingChange("qa-lead", "ADMIN");

      expect(baseDb.scimRoleMapping.update).toHaveBeenCalledWith({
        where: { roleValue: "qa-lead" },
        data: { mappedAccess: "ADMIN" },
      });
      expect(baseDb.scimRoleMapping.create).not.toHaveBeenCalled();
    });

    it("deletes the mapping when the new tier is null", async () => {
      mockAdminSession();
      vi.mocked(baseDb.scimRoleMapping.findUnique).mockResolvedValue({
        id: 7,
        mappedAccess: "ADMIN",
      } as any);

      await saveRoleMappingChange("qa-lead", null);

      expect(baseDb.scimRoleMapping.delete).toHaveBeenCalledWith({
        where: { roleValue: "qa-lead" },
      });
      expect(captureAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "DELETE",
          entityType: "ScimRoleMapping",
          entityId: "qa-lead",
        })
      );
    });

    it("is a no-op when deleting a mapping that does not exist", async () => {
      mockAdminSession();
      vi.mocked(baseDb.scimRoleMapping.findUnique).mockResolvedValue(
        null as any
      );

      const result = await saveRoleMappingChange("ghost", null);

      expect(result).toEqual({ success: true });
      expect(baseDb.scimRoleMapping.delete).not.toHaveBeenCalled();
      expect(captureAuditEvent).not.toHaveBeenCalled();
      expect(queueAdd).not.toHaveBeenCalled();
    });

    it("writes an audit row carrying the old and new tier", async () => {
      mockAdminSession();
      vi.mocked(baseDb.scimRoleMapping.findUnique).mockResolvedValue({
        id: 7,
        mappedAccess: "USER",
      } as any);

      await saveRoleMappingChange("qa-lead", "ADMIN");

      expect(captureAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "ScimRoleMapping",
          changes: { mappedAccess: { old: "USER", new: "ADMIN" } },
        })
      );
    });
  });

  describe("previewRoleMappingChange", () => {
    it("reports a holder who would be demoted by the new tier", async () => {
      mockAdminSession();
      vi.mocked(baseDb.user.findMany).mockResolvedValue([
        { id: "u1", name: "Ann", access: "ADMIN", scimRoles: ["qa-lead"] },
      ] as any);
      vi.mocked(baseDb.scimRoleMapping.findMany).mockResolvedValue([
        { roleValue: "qa-lead", mappedAccess: "ADMIN" },
      ] as any);

      const result = await previewRoleMappingChange("qa-lead", "USER");

      expect(result).toEqual({
        success: true,
        downgraded: [
          {
            userId: "u1",
            name: "Ann",
            currentAccess: "ADMIN",
            newAccess: "USER",
          },
        ],
      });
    });

    it("reports nobody when the new tier is a promotion", async () => {
      mockAdminSession();
      vi.mocked(baseDb.user.findMany).mockResolvedValue([
        { id: "u1", name: "Ann", access: "USER", scimRoles: ["qa-lead"] },
      ] as any);
      vi.mocked(baseDb.scimRoleMapping.findMany).mockResolvedValue([
        { roleValue: "qa-lead", mappedAccess: "USER" },
      ] as any);

      const result = await previewRoleMappingChange("qa-lead", "ADMIN");

      expect(result).toEqual({ success: true, downgraded: [] });
    });

    it("treats a delete as a fall-back to the group tier, not to NONE", async () => {
      mockAdminSession();
      vi.mocked(baseDb.user.findMany).mockResolvedValue([
        { id: "u1", name: "Ann", access: "ADMIN", scimRoles: ["qa-lead"] },
      ] as any);
      vi.mocked(baseDb.scimRoleMapping.findMany).mockResolvedValue([
        { roleValue: "qa-lead", mappedAccess: "ADMIN" },
      ] as any);
      vi.mocked(baseDb.groupAssignment.findMany).mockResolvedValue([
        { group: { mappedAccess: "PROJECTADMIN" } },
      ] as any);

      const result = await previewRoleMappingChange("qa-lead", null);

      expect(result).toEqual({
        success: true,
        downgraded: [
          {
            userId: "u1",
            name: "Ann",
            currentAccess: "ADMIN",
            newAccess: "PROJECTADMIN",
          },
        ],
      });
    });

    it("keeps a second mapped role in play when only one mapping changes", async () => {
      mockAdminSession();
      vi.mocked(baseDb.user.findMany).mockResolvedValue([
        {
          id: "u1",
          name: "Ann",
          access: "ADMIN",
          scimRoles: ["qa-lead", "release-manager"],
        },
      ] as any);
      vi.mocked(baseDb.scimRoleMapping.findMany).mockResolvedValue([
        { roleValue: "qa-lead", mappedAccess: "ADMIN" },
        { roleValue: "release-manager", mappedAccess: "PROJECTADMIN" },
      ] as any);

      const result = await previewRoleMappingChange("qa-lead", "USER");

      // Highest-wins within roles: PROJECTADMIN survives from the other role.
      expect(result).toEqual({
        success: true,
        downgraded: [
          {
            userId: "u1",
            name: "Ann",
            currentAccess: "ADMIN",
            newAccess: "PROJECTADMIN",
          },
        ],
      });
    });
  });
});
