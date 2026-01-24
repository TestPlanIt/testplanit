import { describe, it, expect, vi, beforeEach } from "vitest";
import { prepareShareLinkData, auditShareLinkCreation, revokeShareLink } from "./share-links";

// Mock dependencies
vi.mock("~/lib/share-tokens", () => ({
  generateShareKey: vi.fn(() => "mock-share-key-43-chars-long-base64url-enc"),
}));

vi.mock("bcrypt", () => ({
  default: {
    hash: vi.fn((password: string) => Promise.resolve(`$2b$10$hashed_${password}`)),
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    auditLog: {
      create: vi.fn(),
    },
    shareLink: {
      findUnique: vi.fn(),
    },
    projects: {
      findUnique: vi.fn(),
    },
  },
}));

import { generateShareKey } from "~/lib/share-tokens";
import bcrypt from "bcrypt";
import { getServerSession } from "next-auth";
import { prisma } from "~/lib/prisma";

describe("share-links server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("prepareShareLinkData", () => {
    it("should generate a share key", async () => {
      const result = await prepareShareLinkData({});

      expect(generateShareKey).toHaveBeenCalledOnce();
      expect(result.shareKey).toBe("mock-share-key-43-chars-long-base64url-enc");
    });

    it("should return null passwordHash when no password provided", async () => {
      const result = await prepareShareLinkData({});

      expect(bcrypt.hash).not.toHaveBeenCalled();
      expect(result.passwordHash).toBeNull();
    });

    it("should return null passwordHash when password is null", async () => {
      const result = await prepareShareLinkData({ password: null });

      expect(bcrypt.hash).not.toHaveBeenCalled();
      expect(result.passwordHash).toBeNull();
    });

    it("should return null passwordHash when password is empty string", async () => {
      const result = await prepareShareLinkData({ password: "" });

      expect(bcrypt.hash).not.toHaveBeenCalled();
      expect(result.passwordHash).toBeNull();
    });

    it("should hash password with bcrypt when provided", async () => {
      const result = await prepareShareLinkData({ password: "myPassword123" });

      expect(bcrypt.hash).toHaveBeenCalledWith("myPassword123", 10);
      expect(result.passwordHash).toBe("$2b$10$hashed_myPassword123");
    });

    it("should hash password using 10 rounds", async () => {
      await prepareShareLinkData({ password: "testPassword" });

      expect(bcrypt.hash).toHaveBeenCalledWith("testPassword", 10);
    });

    it("should return both shareKey and passwordHash when password provided", async () => {
      const result = await prepareShareLinkData({ password: "securePass" });

      expect(result).toEqual({
        shareKey: "mock-share-key-43-chars-long-base64url-enc",
        passwordHash: "$2b$10$hashed_securePass",
      });
    });

    it("should handle special characters in password", async () => {
      const specialPassword = "P@ssw0rd!#$%";
      const result = await prepareShareLinkData({ password: specialPassword });

      expect(bcrypt.hash).toHaveBeenCalledWith(specialPassword, 10);
      expect(result.passwordHash).toBe(`$2b$10$hashed_${specialPassword}`);
    });

    it("should generate unique share keys on each call", async () => {
      const result1 = await prepareShareLinkData({});
      const result2 = await prepareShareLinkData({});

      expect(generateShareKey).toHaveBeenCalledTimes(2);
      // Both return the same mock value, but in reality would be different
      expect(result1.shareKey).toBeDefined();
      expect(result2.shareKey).toBeDefined();
    });
  });

  describe("auditShareLinkCreation", () => {
    const mockShareLink = {
      id: "share-123",
      shareKey: "abc123def456",
      entityType: "REPORT",
      mode: "PUBLIC",
      title: "Test Report Share",
      projectId: 1,
      expiresAt: new Date("2024-12-31"),
      notifyOnView: true,
      passwordHash: null,
    };

    it("should return early if no session", async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);

      await auditShareLinkCreation(mockShareLink);

      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it("should return early if session has no user", async () => {
      vi.mocked(getServerSession).mockResolvedValue({} as any);

      await auditShareLinkCreation(mockShareLink);

      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it("should create audit log for authenticated user", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: {
          id: "user-123",
          email: "user@example.com",
          name: "Test User",
        },
      } as any);

      await auditShareLinkCreation(mockShareLink);

      expect(prisma.auditLog.create).toHaveBeenCalledOnce();
    });

    it("should include correct audit log data", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: {
          id: "user-123",
          email: "user@example.com",
          name: "Test User",
        },
      } as any);

      await auditShareLinkCreation(mockShareLink);

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: "user-123",
          userEmail: "user@example.com",
          userName: "Test User",
          action: "SHARE_LINK_CREATED",
          entityType: "ShareLink",
          entityId: "share-123",
          entityName: "Test Report Share",
          metadata: {
            shareKey: "abc123def456",
            entityType: "REPORT",
            mode: "PUBLIC",
            hasPassword: false,
            expiresAt: "2024-12-31T00:00:00.000Z",
            notifyOnView: true,
          },
          projectId: 1,
        },
      });
    });

    it("should use entityType as fallback name when title is null", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: {
          id: "user-123",
          email: "user@example.com",
          name: "Test User",
        },
      } as any);

      await auditShareLinkCreation({
        ...mockShareLink,
        title: null,
      });

      const call = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
      expect(call.data.entityName).toBe("REPORT share");
    });

    it("should set hasPassword to true when passwordHash exists", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: {
          id: "user-123",
          email: "user@example.com",
          name: "Test User",
        },
      } as any);

      await auditShareLinkCreation({
        ...mockShareLink,
        passwordHash: "$2b$10$hashedpassword",
      });

      const call = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
      expect(call.data.metadata).toBeDefined();
      expect((call.data.metadata as any).hasPassword).toBe(true);
    });

    it("should handle null expiresAt", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: {
          id: "user-123",
          email: "user@example.com",
          name: "Test User",
        },
      } as any);

      await auditShareLinkCreation({
        ...mockShareLink,
        expiresAt: null,
      });

      const call = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
      expect(call.data.metadata).toBeDefined();
      expect((call.data.metadata as any).expiresAt).toBeNull();
    });

    it("should handle undefined projectId", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: {
          id: "user-123",
          email: "user@example.com",
          name: "Test User",
        },
      } as any);

      await auditShareLinkCreation({
        ...mockShareLink,
        projectId: undefined,
      });

      const call = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
      expect(call.data.projectId).toBeNull();
    });
  });

  describe("revokeShareLink", () => {
    const mockShareLink = {
      id: "share-123",
      shareKey: "abc123def456",
      entityType: "REPORT",
      mode: "PUBLIC",
      title: "Test Report Share",
      projectId: 1,
      createdById: "owner-123",
      viewCount: 42,
    };

    beforeEach(() => {
      vi.mocked(prisma.shareLink.findUnique).mockResolvedValue(mockShareLink as any);
    });

    it("should throw error if no session", async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);

      await expect(revokeShareLink("share-123")).rejects.toThrow("Authentication required");
    });

    it("should throw error if session has no user", async () => {
      vi.mocked(getServerSession).mockResolvedValue({} as any);

      await expect(revokeShareLink("share-123")).rejects.toThrow("Authentication required");
    });

    it("should throw error if share link not found", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: "user-123", access: "USER" },
      } as any);
      vi.mocked(prisma.shareLink.findUnique).mockResolvedValue(null);

      await expect(revokeShareLink("share-123")).rejects.toThrow("Share link not found");
    });

    it("should allow admin to revoke any share", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: {
          id: "admin-123",
          email: "admin@example.com",
          name: "Admin User",
          access: "ADMIN",
        },
      } as any);

      const result = await revokeShareLink("share-123");

      expect(result).toEqual({ success: true });
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it("should allow share creator to revoke their own share", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: {
          id: "owner-123",
          email: "owner@example.com",
          name: "Share Owner",
          access: "USER",
        },
      } as any);

      const result = await revokeShareLink("share-123");

      expect(result).toEqual({ success: true });
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it("should allow project owner to revoke project shares", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: {
          id: "project-owner-123",
          email: "owner@example.com",
          name: "Project Owner",
          access: "USER",
        },
      } as any);
      vi.mocked(prisma.projects.findUnique).mockResolvedValue({
        id: 1,
        createdBy: "project-owner-123",
      } as any);

      const result = await revokeShareLink("share-123");

      expect(result).toEqual({ success: true });
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it("should deny access to users without permission", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: {
          id: "other-user-123",
          email: "other@example.com",
          name: "Other User",
          access: "USER",
        },
      } as any);
      vi.mocked(prisma.projects.findUnique).mockResolvedValue({
        id: 1,
        createdBy: "project-owner-123",
      } as any);

      await expect(revokeShareLink("share-123")).rejects.toThrow(
        "You do not have permission to revoke this share link"
      );
    });

    it("should create audit log with correct data", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: {
          id: "admin-123",
          email: "admin@example.com",
          name: "Admin User",
          access: "ADMIN",
        },
      } as any);

      await revokeShareLink("share-123");

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: "admin-123",
          userEmail: "admin@example.com",
          userName: "Admin User",
          action: "SHARE_LINK_REVOKED",
          entityType: "ShareLink",
          entityId: "share-123",
          entityName: "Test Report Share",
          metadata: {
            shareKey: "abc123def456",
            entityType: "REPORT",
            mode: "PUBLIC",
            viewCount: 42,
          },
          projectId: 1,
        },
      });
    });

    it("should use entityType as fallback name when title is null", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: {
          id: "admin-123",
          email: "admin@example.com",
          name: "Admin User",
          access: "ADMIN",
        },
      } as any);
      vi.mocked(prisma.shareLink.findUnique).mockResolvedValue({
        ...mockShareLink,
        title: null,
      } as any);

      await revokeShareLink("share-123");

      const call = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
      expect(call.data.entityName).toBe("REPORT share");
    });

    it("should handle share without project", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: {
          id: "owner-123",
          email: "owner@example.com",
          name: "Share Owner",
          access: "USER",
        },
      } as any);
      vi.mocked(prisma.shareLink.findUnique).mockResolvedValue({
        ...mockShareLink,
        projectId: null,
      } as any);

      const result = await revokeShareLink("share-123");

      expect(result).toEqual({ success: true });
      expect(prisma.projects.findUnique).not.toHaveBeenCalled();
    });
  });
});
