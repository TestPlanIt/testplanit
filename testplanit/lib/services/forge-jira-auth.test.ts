import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    integration: { findMany: vi.fn() },
    user: { findFirst: vi.fn() },
    projects: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ baseDb: mockDb }));

import {
  authenticateForgeIntegration,
  authenticateForgeWrite,
  forgeUserHasProjectAccess,
  resolveForgeUser,
} from "./forge-jira-auth";

const FORGE_KEY = "forge-secret-key-123";

function mockHeaders(map: Record<string, string | null>): Request {
  return {
    headers: {
      get: (name: string) => map[name] ?? null,
    },
  } as unknown as Request;
}

describe("forge-jira-auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("authenticateForgeIntegration", () => {
    it("returns null for a missing key without querying", async () => {
      const result = await authenticateForgeIntegration(null);
      expect(result).toBeNull();
      expect(mockDb.integration.findMany).not.toHaveBeenCalled();
    });

    it("matches the stored forgeApiKey constant-time", async () => {
      mockDb.integration.findMany.mockResolvedValue([
        { id: 7, settings: { forgeApiKey: FORGE_KEY } },
      ]);
      const result = await authenticateForgeIntegration(FORGE_KEY);
      expect(result).toEqual({ id: 7 });
    });

    it("returns null when no stored key matches", async () => {
      mockDb.integration.findMany.mockResolvedValue([
        { id: 7, settings: { forgeApiKey: FORGE_KEY } },
      ]);
      expect(
        await authenticateForgeIntegration("wrong-key-1234567")
      ).toBeNull();
    });

    it("rejects a key of different length (no length leak)", async () => {
      mockDb.integration.findMany.mockResolvedValue([
        { id: 7, settings: { forgeApiKey: FORGE_KEY } },
      ]);
      expect(await authenticateForgeIntegration("short")).toBeNull();
    });

    it("ignores integrations without a stored key", async () => {
      mockDb.integration.findMany.mockResolvedValue([
        { id: 1, settings: null },
        { id: 2, settings: {} },
      ]);
      expect(await authenticateForgeIntegration(FORGE_KEY)).toBeNull();
    });
  });

  describe("resolveForgeUser", () => {
    it("matches by lowercased email", async () => {
      mockDb.user.findFirst.mockResolvedValue({
        id: "u1",
        name: "Ada",
        email: "ada@example.com",
        access: "MEMBER",
      });
      const user = await resolveForgeUser({
        email: "Ada@Example.com",
        accountId: null,
      });
      expect(user?.id).toBe("u1");
      expect(mockDb.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            email: "ada@example.com",
            isActive: true,
            isDeleted: false,
          }),
        })
      );
    });

    it("falls back to accountId → externalId when email is absent", async () => {
      mockDb.user.findFirst.mockResolvedValue({
        id: "u2",
        name: "Grace",
        email: "grace@example.com",
        access: "ADMIN",
      });
      const user = await resolveForgeUser({
        email: null,
        accountId: "acct-123",
      });
      expect(user?.id).toBe("u2");
      expect(mockDb.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ externalId: "acct-123" }),
        })
      );
    });

    it("returns null when neither email nor accountId matches", async () => {
      mockDb.user.findFirst.mockResolvedValue(null);
      expect(
        await resolveForgeUser({ email: null, accountId: null })
      ).toBeNull();
      expect(mockDb.user.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("forgeUserHasProjectAccess", () => {
    const adminUser = {
      id: "a1",
      name: "Admin",
      email: "a@x.com",
      access: "ADMIN",
    };
    const memberUser = {
      id: "m1",
      name: "Member",
      email: "m@x.com",
      access: "MEMBER",
    };

    it("uses the simple where for admins", async () => {
      mockDb.projects.findFirst.mockResolvedValue({ id: 5 });
      expect(await forgeUserHasProjectAccess(adminUser, 5)).toBe(true);
      expect(mockDb.projects.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 5, isDeleted: false },
        })
      );
    });

    it("returns false when a non-admin has no access path", async () => {
      mockDb.projects.findFirst.mockResolvedValue(null);
      expect(await forgeUserHasProjectAccess(memberUser, 9)).toBe(false);
      const arg = mockDb.projects.findFirst.mock.calls[0][0];
      expect(arg.where.OR).toBeDefined();
    });
  });

  describe("authenticateForgeWrite", () => {
    it("401s on an invalid key", async () => {
      mockDb.integration.findMany.mockResolvedValue([]);
      const result = await authenticateForgeWrite(
        mockHeaders({ "X-Forge-Api-Key": "nope" })
      );
      expect(result).toMatchObject({ ok: false, status: 401 });
    });

    it("403s when the key is valid but the user isn't linked", async () => {
      mockDb.integration.findMany.mockResolvedValue([
        { id: 3, settings: { forgeApiKey: FORGE_KEY } },
      ]);
      mockDb.user.findFirst.mockResolvedValue(null);
      const result = await authenticateForgeWrite(
        mockHeaders({
          "X-Forge-Api-Key": FORGE_KEY,
          "X-Forge-User-Email": "ghost@example.com",
        })
      );
      expect(result).toMatchObject({ ok: false, status: 403 });
    });

    it("403s when the linked user lacks project access", async () => {
      mockDb.integration.findMany.mockResolvedValue([
        { id: 3, settings: { forgeApiKey: FORGE_KEY } },
      ]);
      mockDb.user.findFirst.mockResolvedValue({
        id: "u9",
        name: "NoAccess",
        email: "n@x.com",
        access: "MEMBER",
      });
      mockDb.projects.findFirst.mockResolvedValue(null);
      const result = await authenticateForgeWrite(
        mockHeaders({
          "X-Forge-Api-Key": FORGE_KEY,
          "X-Forge-User-Email": "n@x.com",
        }),
        { projectId: 42 }
      );
      expect(result).toMatchObject({ ok: false, status: 403 });
    });

    it("returns ok with integration + user when everything checks out", async () => {
      mockDb.integration.findMany.mockResolvedValue([
        { id: 3, settings: { forgeApiKey: FORGE_KEY } },
      ]);
      mockDb.user.findFirst.mockResolvedValue({
        id: "u9",
        name: "Ok User",
        email: "ok@x.com",
        access: "MEMBER",
      });
      mockDb.projects.findFirst.mockResolvedValue({ id: 42 });
      const result = await authenticateForgeWrite(
        mockHeaders({
          "X-Forge-Api-Key": FORGE_KEY,
          "X-Forge-User-Email": "ok@x.com",
        }),
        { projectId: 42 }
      );
      expect(result).toEqual({
        ok: true,
        integrationId: 3,
        user: {
          id: "u9",
          name: "Ok User",
          email: "ok@x.com",
          access: "MEMBER",
        },
      });
    });
  });
});
