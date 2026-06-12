import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/prisma", () => ({
  prisma: {
    groupAssignment: { findMany: vi.fn() },
    groups: { findUnique: vi.fn(), update: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    appConfig: { findUnique: vi.fn() },
  },
}));

vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(),
}));

vi.mock("~/lib/scim/access/resolve", () => ({
  ACCESS_RANK: { NONE: 0, USER: 1, PROJECTADMIN: 2, ADMIN: 3 },
  resolveEffectiveAccess: vi.fn(),
}));

vi.mock("~/lib/scim/access/fallbackDefault", () => ({
  readScimFallbackDefault: vi.fn().mockResolvedValue("NONE"),
}));

vi.mock("~/lib/queues", () => ({
  getScimAccessRecomputeQueue: vi.fn().mockReturnValue({ add: vi.fn() }),
}));

import { prisma } from "~/lib/prisma";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { getServerAuthSession } from "~/server/auth";
import { resolveEffectiveAccess } from "~/lib/scim/access/resolve";
import { readScimFallbackDefault } from "~/lib/scim/access/fallbackDefault";
import { getScimAccessRecomputeQueue } from "~/lib/queues";

import {
  previewGroupMappingChange,
  saveMappingChange,
  previewFallbackDefaultChange,
  enqueueFallbackDefaultRecompute,
} from "./scimMappingActions";

function mockAdminSession(id = "admin1") {
  vi.mocked(getServerAuthSession).mockResolvedValue({
    user: { id, access: "ADMIN", name: "Admin User" },
  } as any);
}

function mockNonAdminSession(id = "user1") {
  vi.mocked(getServerAuthSession).mockResolvedValue({
    user: { id, access: "USER" },
  } as any);
}

function mockNoSession() {
  vi.mocked(getServerAuthSession).mockResolvedValue(null as any);
}

describe("scimMappingActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("previewGroupMappingChange", () => {
    it("returns Unauthorized for unauthenticated caller", async () => {
      mockNoSession();

      const result = await previewGroupMappingChange(1, "USER");

      expect(result).toEqual({ success: false, error: "Unauthorized" });
      expect(prisma.groupAssignment.findMany).not.toHaveBeenCalled();
    });

    it("returns Unauthorized for non-admin caller", async () => {
      mockNonAdminSession();

      const result = await previewGroupMappingChange(1, "USER");

      expect(result).toEqual({ success: false, error: "Unauthorized" });
      expect(prisma.groupAssignment.findMany).not.toHaveBeenCalled();
    });

    it("returns empty downgraded list when no members would drop", async () => {
      mockAdminSession();
      vi.mocked(readScimFallbackDefault).mockResolvedValue("NONE");
      vi.mocked(prisma.groupAssignment.findMany)
        .mockResolvedValueOnce([{ userId: "u1" }] as any)
        .mockResolvedValueOnce([
          { group: { id: 1, mappedAccess: "USER" } },
        ] as any);
      vi.mocked(resolveEffectiveAccess)
        .mockReturnValueOnce("USER")
        .mockReturnValueOnce("ADMIN");

      const result = await previewGroupMappingChange(1, "ADMIN");

      expect(result).toEqual({ success: true, downgraded: [] });
    });

    it("correctly identifies a user whose effective access would drop", async () => {
      mockAdminSession();
      vi.mocked(readScimFallbackDefault).mockResolvedValue("NONE");
      vi.mocked(prisma.groupAssignment.findMany)
        .mockResolvedValueOnce([{ userId: "u1" }] as any)
        .mockResolvedValueOnce([
          { group: { id: 1, mappedAccess: "ADMIN" } },
        ] as any);
      vi.mocked(resolveEffectiveAccess)
        .mockReturnValueOnce("ADMIN")
        .mockReturnValueOnce("USER");
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        name: "Alice",
      } as any);

      const result = await previewGroupMappingChange(1, "USER");

      expect(result).toEqual({
        success: true,
        downgraded: [
          {
            userId: "u1",
            name: "Alice",
            currentAccess: "ADMIN",
            newAccess: "USER",
          },
        ],
      });
    });

    it("does NOT flag users in a higher-access group (highest-wins check)", async () => {
      mockAdminSession();
      vi.mocked(readScimFallbackDefault).mockResolvedValue("NONE");
      vi.mocked(prisma.groupAssignment.findMany)
        .mockResolvedValueOnce([{ userId: "u1" }] as any)
        .mockResolvedValueOnce([
          { group: { id: 1, mappedAccess: "USER" } },
          { group: { id: 2, mappedAccess: "ADMIN" } },
        ] as any);
      vi.mocked(resolveEffectiveAccess)
        .mockReturnValueOnce("ADMIN")
        .mockReturnValueOnce("ADMIN");

      const result = await previewGroupMappingChange(1, null);

      expect(result).toEqual({ success: true, downgraded: [] });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("saveMappingChange", () => {
    it("returns Unauthorized for non-admin caller without calling DB", async () => {
      mockNonAdminSession();

      const result = await saveMappingChange(1, "USER");

      expect(result).toEqual({ success: false, error: "Unauthorized" });
      expect(prisma.groups.update).not.toHaveBeenCalled();
      expect(captureAuditEvent).not.toHaveBeenCalled();
    });

    it("writes mappedAccess, captures audit, enqueues worker on success", async () => {
      mockAdminSession("admin1");
      vi.mocked(prisma.groups.findUnique).mockResolvedValue({
        mappedAccess: "ADMIN",
        name: "Engineering",
      } as any);
      vi.mocked(prisma.groups.update).mockResolvedValue({} as any);
      const mockAdd = vi.fn().mockResolvedValue(undefined);
      vi.mocked(getScimAccessRecomputeQueue).mockReturnValue({
        add: mockAdd,
      } as any);

      const result = await saveMappingChange(1, "USER");

      expect(result).toEqual({ success: true });
      expect(prisma.groups.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { mappedAccess: "USER" },
      });
      expect(captureAuditEvent).toHaveBeenCalledTimes(1);
      const auditArg = vi.mocked(captureAuditEvent).mock.calls[0][0];
      expect(auditArg.action).toBe("UPDATE");
      expect(auditArg.entityType).toBe("Groups");
      expect(auditArg.userId).toBe("admin1");
      expect(auditArg.changes).toEqual({
        mappedAccess: { old: "ADMIN", new: "USER" },
      });
    });

    it("includes groupId in job data and adminUserId from session", async () => {
      mockAdminSession("admin2");
      vi.mocked(prisma.groups.findUnique).mockResolvedValue({
        mappedAccess: null,
        name: "Team",
      } as any);
      vi.mocked(prisma.groups.update).mockResolvedValue({} as any);
      const mockAdd = vi.fn().mockResolvedValue(undefined);
      vi.mocked(getScimAccessRecomputeQueue).mockReturnValue({
        add: mockAdd,
      } as any);

      await saveMappingChange(5, "PROJECTADMIN");

      expect(mockAdd).toHaveBeenCalledWith(
        "scim-access-recompute",
        expect.objectContaining({
          adminUserId: "admin2",
          groupId: 5,
        })
      );
    });

    it("returns error on DB failure and does NOT enqueue", async () => {
      mockAdminSession();
      vi.mocked(prisma.groups.findUnique).mockRejectedValue(
        new Error("db error")
      );

      const result = await saveMappingChange(1, "USER");

      expect(result).toEqual({
        success: false,
        error: "Failed to save mapping",
      });
      expect(getScimAccessRecomputeQueue).not.toHaveBeenCalled();
    });
  });

  describe("previewFallbackDefaultChange", () => {
    it("returns Unauthorized for non-admin caller", async () => {
      mockNonAdminSession();

      const result = await previewFallbackDefaultChange("USER");

      expect(result).toEqual({ success: false, error: "Unauthorized" });
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it("only evaluates GROUP_MAPPING users (not MANUAL users)", async () => {
      mockAdminSession();
      vi.mocked(readScimFallbackDefault).mockResolvedValue("NONE");
      vi.mocked(prisma.user.findMany).mockResolvedValue([]);
      vi.mocked(prisma.groupAssignment.findMany).mockResolvedValue([]);

      await previewFallbackDefaultChange("USER");

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            accessSource: "GROUP_MAPPING",
            isDeleted: false,
          }),
        })
      );
    });

    it("returns downgraded list for users whose effective access drops", async () => {
      mockAdminSession();
      vi.mocked(readScimFallbackDefault).mockResolvedValue("USER");
      vi.mocked(prisma.user.findMany).mockResolvedValue([
        { id: "u1", name: "Bob", access: "USER" },
      ] as any);
      vi.mocked(prisma.groupAssignment.findMany).mockResolvedValue([] as any);
      vi.mocked(resolveEffectiveAccess)
        .mockReturnValueOnce("USER")
        .mockReturnValueOnce("NONE");

      const result = await previewFallbackDefaultChange("NONE");

      expect(result).toEqual({
        success: true,
        downgraded: [
          {
            userId: "u1",
            name: "Bob",
            currentAccess: "USER",
            newAccess: "NONE",
          },
        ],
      });
    });
  });

  describe("enqueueFallbackDefaultRecompute", () => {
    it("returns Unauthorized for non-admin caller", async () => {
      mockNonAdminSession();

      const result = await enqueueFallbackDefaultRecompute();

      expect(result).toEqual({ success: false, error: "Unauthorized" });
    });

    it("enqueues job with adminUserId from session and no groupId", async () => {
      mockAdminSession("admin3");
      const mockAdd = vi.fn().mockResolvedValue(undefined);
      vi.mocked(getScimAccessRecomputeQueue).mockReturnValue({
        add: mockAdd,
      } as any);

      const result = await enqueueFallbackDefaultRecompute();

      expect(result).toEqual({ success: true });
      expect(mockAdd).toHaveBeenCalledWith(
        "scim-access-recompute",
        expect.objectContaining({ adminUserId: "admin3" })
      );
      const jobArg = mockAdd.mock.calls[0][1];
      expect(jobArg).not.toHaveProperty("groupId");
    });

    it("returns success when queue is null (Valkey absent)", async () => {
      mockAdminSession();
      vi.mocked(getScimAccessRecomputeQueue).mockReturnValue(null as any);

      const result = await enqueueFallbackDefaultRecompute();

      expect(result).toEqual({ success: true });
    });
  });
});
