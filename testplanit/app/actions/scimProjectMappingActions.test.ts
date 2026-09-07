import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db", () => {
  const tx = {
    groupProjectAccessMapping: {
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  };
  return {
    baseDb: {
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
      __tx: tx,
      groupProjectAccessMapping: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
      },
    },
  };
});

vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: vi.fn(),
}));

vi.mock("~/lib/auditContext", () => ({
  runWithAuditContext: vi.fn((_ctx: unknown, fn: () => unknown) => fn()),
}));

vi.mock("~/lib/scim/access/projectMappings", async () => {
  const actual = await vi.importActual<
    typeof import("~/lib/scim/access/projectMappings")
  >("~/lib/scim/access/projectMappings");
  return {
    ...actual,
    materializeGroupProjectMappings: vi.fn(async () => {}),
  };
});

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(),
}));

import { baseDb } from "~/lib/db";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { materializeGroupProjectMappings } from "~/lib/scim/access/projectMappings";
import { getServerAuthSession } from "~/server/auth";

import {
  listGroupProjectMappings,
  saveGroupProjectMapping,
} from "./scimProjectMappingActions";

interface TxLike {
  groupProjectAccessMapping: {
    upsert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
}

const tx = (baseDb as unknown as { __tx: TxLike }).__tx;

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

describe("scimProjectMappingActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(baseDb.groupProjectAccessMapping.findUnique).mockResolvedValue(
      null as any
    );
    vi.mocked(baseDb.groupProjectAccessMapping.findMany).mockResolvedValue(
      [] as any
    );
  });

  describe("authorization", () => {
    it("rejects an unauthenticated caller before touching the database", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue(null as any);

      expect(await listGroupProjectMappings(1)).toEqual({
        success: false,
        error: "Unauthorized",
      });
      expect(await saveGroupProjectMapping(1, 5, "USER")).toEqual({
        success: false,
        error: "Unauthorized",
      });
      expect(tx.groupProjectAccessMapping.upsert).not.toHaveBeenCalled();
    });

    it("rejects a non-admin caller", async () => {
      mockNonAdminSession();

      expect(await saveGroupProjectMapping(1, 5, "ADMIN")).toEqual({
        success: false,
        error: "Unauthorized",
      });
      expect(tx.groupProjectAccessMapping.upsert).not.toHaveBeenCalled();
    });
  });

  describe("validation", () => {
    it("rejects NONE — a group row cannot deny project access", async () => {
      mockAdminSession();

      const result = await saveGroupProjectMapping(1, 5, "NONE");

      expect(result).toEqual({ success: false, error: "Invalid input" });
      expect(tx.groupProjectAccessMapping.upsert).not.toHaveBeenCalled();
    });

    it("rejects a non-positive project id", async () => {
      mockAdminSession();

      expect(await saveGroupProjectMapping(1, 0, "USER")).toEqual({
        success: false,
        error: "Invalid input",
      });
      expect(await saveGroupProjectMapping(0, 5, "USER")).toEqual({
        success: false,
        error: "Invalid input",
      });
    });
  });

  describe("saveGroupProjectMapping", () => {
    it("upserts the mapping and re-materializes the permission rows", async () => {
      mockAdminSession();

      const result = await saveGroupProjectMapping(1, 5, "PROJECTADMIN");

      expect(result).toEqual({ success: true });
      expect(tx.groupProjectAccessMapping.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { groupId: 1, projectId: 5, mappedAccess: "PROJECTADMIN" },
          update: { mappedAccess: "PROJECTADMIN" },
        })
      );
      expect(materializeGroupProjectMappings).toHaveBeenCalledWith(
        expect.anything(),
        1
      );
    });

    it("writes the mapping and materializes inside ONE transaction", async () => {
      mockAdminSession();

      await saveGroupProjectMapping(1, 5, "USER");

      // A half-applied change would leave permission rows disagreeing with
      // the mapping table — exactly the drift materializing avoids.
      expect(baseDb.$transaction).toHaveBeenCalledTimes(1);
    });

    it("deletes the mapping when the tier is null", async () => {
      mockAdminSession();
      vi.mocked(baseDb.groupProjectAccessMapping.findUnique).mockResolvedValue({
        mappedAccess: "ADMIN",
      } as any);

      await saveGroupProjectMapping(1, 5, null);

      expect(tx.groupProjectAccessMapping.delete).toHaveBeenCalledWith({
        where: { groupId_projectId: { groupId: 1, projectId: 5 } },
      });
      expect(materializeGroupProjectMappings).toHaveBeenCalled();
    });

    it("is a no-op when removing a mapping that does not exist", async () => {
      mockAdminSession();

      const result = await saveGroupProjectMapping(1, 5, null);

      expect(result).toEqual({ success: true });
      expect(baseDb.$transaction).not.toHaveBeenCalled();
      expect(captureAuditEvent).not.toHaveBeenCalled();
    });

    it("audits the change with the old and new tier", async () => {
      mockAdminSession();
      vi.mocked(baseDb.groupProjectAccessMapping.findUnique).mockResolvedValue({
        mappedAccess: "USER",
      } as any);

      await saveGroupProjectMapping(1, 5, "ADMIN");

      expect(captureAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "GroupProjectAccessMapping",
          entityId: "1:5",
          changes: { mappedAccess: { old: "USER", new: "ADMIN" } },
        })
      );
    });

    it("never leaks a raw error message when the write throws", async () => {
      mockAdminSession();
      vi.mocked(baseDb.$transaction).mockRejectedValueOnce(
        new Error("postgres://user:pw@host/db is unreachable")
      );

      const result = await saveGroupProjectMapping(1, 5, "USER");

      expect(result).toEqual({
        success: false,
        error: "Failed to save project mapping",
      });
    });
  });

  describe("listGroupProjectMappings", () => {
    it("returns each mapping with its project name", async () => {
      mockAdminSession();
      vi.mocked(baseDb.groupProjectAccessMapping.findMany).mockResolvedValue([
        { projectId: 5, mappedAccess: "ADMIN", project: { name: "Banking" } },
      ] as any);

      const result = await listGroupProjectMappings(1);

      expect(result).toEqual({
        success: true,
        mappings: [
          { projectId: 5, projectName: "Banking", mappedAccess: "ADMIN" },
        ],
      });
    });
  });
});
