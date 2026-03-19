import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/prisma", () => ({
  prisma: {
    shareLink: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("bcrypt", () => ({
  default: {
    compare: vi.fn(),
  },
}));

vi.mock("~/lib/rate-limit", () => ({
  checkPasswordAttemptLimit: vi.fn(),
  clearPasswordAttempts: vi.fn(),
  recordPasswordAttempt: vi.fn(),
}));

import bcrypt from "bcrypt";
import { prisma } from "~/lib/prisma";
import {
  checkPasswordAttemptLimit,
  clearPasswordAttempts,
  recordPasswordAttempt,
} from "~/lib/rate-limit";
import { POST } from "./route";

const createRequest = (
  shareKey: string,
  body: Record<string, any> = {}
): [NextRequest, { params: Promise<{ shareKey: string }> }] => {
  const req = new NextRequest(
    `http://localhost/api/share/${shareKey}/password-verify`,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  );
  const params = { params: Promise.resolve({ shareKey }) };
  return [req, params];
};

const mockShareLink = {
  id: 1,
  passwordHash: "$2b$10$hashedpassword",
  mode: "PASSWORD_PROTECTED",
  isRevoked: false,
  expiresAt: null,
};

const mockAllowed = {
  allowed: true,
  remainingAttempts: 4,
  resetAt: null,
};

describe("POST /api/share/[shareKey]/password-verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (checkPasswordAttemptLimit as any).mockReturnValue(mockAllowed);
    (clearPasswordAttempts as any).mockReturnValue(undefined);
    (recordPasswordAttempt as any).mockReturnValue(undefined);
  });

  describe("Input validation", () => {
    it("returns 400 when password is missing", async () => {
      const [req, ctx] = createRequest("abc123", {});
      const response = await POST(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Password is required");
    });
  });

  describe("Rate limiting", () => {
    it("returns 429 when rate limited", async () => {
      (checkPasswordAttemptLimit as any).mockReturnValue({
        allowed: false,
        remainingAttempts: 0,
        resetAt: new Date("2030-01-01"),
      });

      const [req, ctx] = createRequest("abc123", { password: "test" });
      const response = await POST(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(429);
      expect(data.rateLimited).toBe(true);
      expect(data.resetAt).toBeDefined();
    });
  });

  describe("Share link validation", () => {
    it("returns 404 for non-existent share link", async () => {
      (prisma.shareLink.findUnique as any).mockResolvedValue(null);

      const [req, ctx] = createRequest("nonexistent", { password: "pass" });
      const response = await POST(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toContain("not found");
    });

    it("returns 403 for revoked share link", async () => {
      (prisma.shareLink.findUnique as any).mockResolvedValue({
        ...mockShareLink,
        isRevoked: true,
      });

      const [req, ctx] = createRequest("abc123", { password: "pass" });
      const response = await POST(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toContain("revoked");
    });

    it("returns 403 for expired share link", async () => {
      (prisma.shareLink.findUnique as any).mockResolvedValue({
        ...mockShareLink,
        expiresAt: new Date("2020-01-01"),
      });

      const [req, ctx] = createRequest("abc123", { password: "pass" });
      const response = await POST(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toContain("expired");
    });

    it("returns 400 when share link is not PASSWORD_PROTECTED", async () => {
      (prisma.shareLink.findUnique as any).mockResolvedValue({
        ...mockShareLink,
        mode: "PUBLIC",
      });

      const [req, ctx] = createRequest("abc123", { password: "pass" });
      const response = await POST(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("does not require a password");
    });

    it("returns 500 when passwordHash is missing on a PASSWORD_PROTECTED link", async () => {
      (prisma.shareLink.findUnique as any).mockResolvedValue({
        ...mockShareLink,
        passwordHash: null,
      });

      const [req, ctx] = createRequest("abc123", { password: "pass" });
      const response = await POST(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain("not configured");
    });
  });

  describe("Password verification", () => {
    it("returns 401 for wrong password and records failed attempt", async () => {
      (prisma.shareLink.findUnique as any).mockResolvedValue(mockShareLink);
      (bcrypt.compare as any).mockResolvedValue(false);
      (checkPasswordAttemptLimit as any)
        .mockReturnValueOnce(mockAllowed) // initial check
        .mockReturnValueOnce({ allowed: true, remainingAttempts: 3, resetAt: null }); // after recording

      const [req, ctx] = createRequest("abc123", { password: "wrongpassword" });
      const response = await POST(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Invalid password");
      expect(data.remainingAttempts).toBeDefined();
      expect(recordPasswordAttempt).toHaveBeenCalledOnce();
    });

    it("returns success token for correct password", async () => {
      (prisma.shareLink.findUnique as any).mockResolvedValue(mockShareLink);
      (bcrypt.compare as any).mockResolvedValue(true);

      const [req, ctx] = createRequest("abc123", { password: "correctpassword" });
      const response = await POST(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.token).toBe("abc123"); // shareKey is returned as token
      expect(data.expiresIn).toBe(3600);
    });

    it("clears rate limit after successful verification", async () => {
      (prisma.shareLink.findUnique as any).mockResolvedValue(mockShareLink);
      (bcrypt.compare as any).mockResolvedValue(true);

      const [req, ctx] = createRequest("abc123", { password: "correctpassword" });
      await POST(req, ctx);

      expect(clearPasswordAttempts).toHaveBeenCalledOnce();
      expect(recordPasswordAttempt).not.toHaveBeenCalled();
    });

    it("calls bcrypt.compare with provided password and stored hash", async () => {
      (prisma.shareLink.findUnique as any).mockResolvedValue(mockShareLink);
      (bcrypt.compare as any).mockResolvedValue(true);

      const [req, ctx] = createRequest("abc123", { password: "mypassword" });
      await POST(req, ctx);

      expect(bcrypt.compare).toHaveBeenCalledWith(
        "mypassword",
        "$2b$10$hashedpassword"
      );
    });
  });

  describe("Error handling", () => {
    it("returns 500 when database throws", async () => {
      (prisma.shareLink.findUnique as any).mockRejectedValue(new Error("DB error"));

      const [req, ctx] = createRequest("abc123", { password: "pass" });
      const response = await POST(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain("Failed to verify password");
    });
  });
});
