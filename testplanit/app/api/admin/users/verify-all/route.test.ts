import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    user: {
      updateMany: vi.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "~/lib/prisma";

import { POST } from "./route";

describe("Admin Users Verify-All Route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    it("returns 401 when unauthenticated (no session)", async () => {
      (getServerSession as any).mockResolvedValue(null);

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when session has no user id", async () => {
      (getServerSession as any).mockResolvedValue({ user: {} });

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 403 when authenticated as non-admin", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "user-1", access: "USER" },
      });

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Forbidden - Admin access required");
    });

    it("returns 403 when access is PROJECTADMIN", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "user-1", access: "PROJECTADMIN" },
      });

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Forbidden - Admin access required");
    });
  });

  describe("POST - verify all users", () => {
    it("marks all unverified internal users as verified", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (prisma.user.updateMany as any).mockResolvedValue({ count: 5 });

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.verifiedCount).toBe(5);
      expect(data.message).toContain("5");
    });

    it("calls updateMany with correct where clause (unverified, internal/both auth)", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (prisma.user.updateMany as any).mockResolvedValue({ count: 3 });

      await POST();

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: {
          emailVerified: null,
          authMethod: { in: ["INTERNAL", "BOTH"] },
        },
        data: expect.objectContaining({
          emailVerified: expect.any(Date),
          emailVerifToken: null,
        }),
      });
    });

    it("returns verifiedCount of 0 when all users already verified", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (prisma.user.updateMany as any).mockResolvedValue({ count: 0 });

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.verifiedCount).toBe(0);
    });

    it("returns 500 when database update fails", async () => {
      (getServerSession as any).mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      (prisma.user.updateMany as any).mockRejectedValue(new Error("DB error"));

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to verify users");
    });
  });
});
