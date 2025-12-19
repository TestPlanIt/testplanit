import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Session } from "next-auth";

// Mock prisma
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock ZenStack enhance
vi.mock("@zenstackhq/runtime", () => ({
  enhance: vi.fn((prisma, context) => ({
    ...prisma,
    _context: context,
  })),
}));

import { prisma } from "@/lib/prisma";
import { enhance } from "@zenstackhq/runtime";
import { getUserWithRole, getEnhancedDb } from "./utils";

const mockPrisma = prisma as unknown as {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
  };
};

describe("Auth Utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getUserWithRole", () => {
    it("should return user with role and rolePermissions", async () => {
      const mockUser = {
        id: "user-123",
        email: "test@example.com",
        name: "Test User",
        role: {
          id: 1,
          name: "Admin",
          rolePermissions: [
            { id: 1, permission: "READ" },
            { id: 2, permission: "WRITE" },
          ],
        },
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await getUserWithRole("user-123");

      expect(result).toEqual(mockUser);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user-123" },
        include: {
          role: {
            include: {
              rolePermissions: true,
            },
          },
        },
      });
    });

    it("should return null when user not found", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await getUserWithRole("non-existent-user");

      expect(result).toBeNull();
    });

    it("should return user without role if no role assigned", async () => {
      const mockUser = {
        id: "user-123",
        email: "test@example.com",
        name: "Test User",
        role: null,
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await getUserWithRole("user-123");

      expect(result).toEqual(mockUser);
      expect(result?.role).toBeNull();
    });

    it("should include empty rolePermissions when role has none", async () => {
      const mockUser = {
        id: "user-123",
        email: "test@example.com",
        name: "Test User",
        role: {
          id: 1,
          name: "Guest",
          rolePermissions: [],
        },
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await getUserWithRole("user-123");

      expect(result?.role?.rolePermissions).toEqual([]);
    });
  });

  describe("getEnhancedDb", () => {
    it("should return enhanced database for valid session", async () => {
      const mockUser = {
        id: "user-123",
        email: "test@example.com",
        name: "Test User",
        role: {
          id: 1,
          name: "Admin",
          rolePermissions: [{ id: 1, permission: "READ" }],
        },
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const session: Session = {
        user: {
          id: "user-123",
          email: "test@example.com",
        },
        expires: new Date(Date.now() + 3600000).toISOString(),
      };

      const result = await getEnhancedDb(session);

      expect(enhance).toHaveBeenCalledWith(prisma, { user: mockUser });
      expect(result).toBeDefined();
    });

    it("should throw error when session is null", async () => {
      await expect(getEnhancedDb(null)).rejects.toThrow("Unauthorized");
    });

    it("should throw error when session user is undefined", async () => {
      const session = {
        expires: new Date(Date.now() + 3600000).toISOString(),
      } as Session;

      await expect(getEnhancedDb(session)).rejects.toThrow("Unauthorized");
    });

    it("should throw error when session user id is missing", async () => {
      const session = {
        user: {
          email: "test@example.com",
        },
        expires: new Date(Date.now() + 3600000).toISOString(),
      } as Session;

      await expect(getEnhancedDb(session)).rejects.toThrow("Unauthorized");
    });

    it("should throw error when user not found in database", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const session: Session = {
        user: {
          id: "non-existent-user",
          email: "test@example.com",
        },
        expires: new Date(Date.now() + 3600000).toISOString(),
      };

      await expect(getEnhancedDb(session)).rejects.toThrow("User not found");
    });

    it("should pass user context to ZenStack enhance", async () => {
      const mockUser = {
        id: "user-456",
        email: "admin@example.com",
        name: "Admin User",
        role: {
          id: 2,
          name: "SuperAdmin",
          rolePermissions: [
            { id: 1, permission: "READ" },
            { id: 2, permission: "WRITE" },
            { id: 3, permission: "DELETE" },
          ],
        },
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const session: Session = {
        user: {
          id: "user-456",
          email: "admin@example.com",
        },
        expires: new Date(Date.now() + 3600000).toISOString(),
      };

      await getEnhancedDb(session);

      expect(enhance).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          user: expect.objectContaining({
            id: "user-456",
            role: expect.objectContaining({
              name: "SuperAdmin",
            }),
          }),
        })
      );
    });

    it("should handle database errors gracefully", async () => {
      mockPrisma.user.findUnique.mockRejectedValue(
        new Error("Database connection failed")
      );

      const session: Session = {
        user: {
          id: "user-123",
          email: "test@example.com",
        },
        expires: new Date(Date.now() + 3600000).toISOString(),
      };

      await expect(getEnhancedDb(session)).rejects.toThrow(
        "Database connection failed"
      );
    });
  });
});
