import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Mock dependencies using vi.hoisted
const {
  mockGetServerSession,
  mockPrisma,
  mockVerifyTOTP,
  mockDecryptSecret,
  mockVerifyBackupCode,
  mockCheckRateLimit,
  mockGenerateTOTPSecret,
  mockGenerateQRCodeDataURL,
  mockEncryptSecret,
  mockGenerateBackupCodes,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockPrisma: {
    registrationSettings: {
      findFirst: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  mockVerifyTOTP: vi.fn(),
  mockDecryptSecret: vi.fn(),
  mockVerifyBackupCode: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockGenerateTOTPSecret: vi.fn(),
  mockGenerateQRCodeDataURL: vi.fn(),
  mockEncryptSecret: vi.fn(),
  mockGenerateBackupCodes: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("~/lib/two-factor", () => ({
  verifyTOTP: mockVerifyTOTP,
  decryptSecret: mockDecryptSecret,
  verifyBackupCode: mockVerifyBackupCode,
  generateTOTPSecret: mockGenerateTOTPSecret,
  generateQRCodeDataURL: mockGenerateQRCodeDataURL,
  encryptSecret: mockEncryptSecret,
  generateBackupCodes: mockGenerateBackupCodes,
}));

vi.mock("~/lib/auth-security", () => ({
  checkRateLimit: mockCheckRateLimit,
}));

// Import routes after mocking
import { GET as getSettings } from "./settings/route";
import { POST as disableTwoFactor } from "./disable/route";
import { POST as verifySso } from "./verify-sso/route";
import { GET as setup } from "./setup/route";
import { POST as enable } from "./enable/route";

describe("Two-Factor Authentication API Routes", () => {
  const mockSession = {
    user: {
      id: "user-123",
      name: "Test User",
      email: "test@example.com",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /api/auth/two-factor/settings", () => {
    it("should return 401 when user is not authenticated", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const response = await getSettings();
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 401 when session has no user id", async () => {
      mockGetServerSession.mockResolvedValue({ user: {} });

      const response = await getSettings();
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("should return default settings when no registration settings exist", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockPrisma.registrationSettings.findFirst.mockResolvedValue(null);

      const response = await getSettings();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        force2FAAllLogins: false,
        force2FANonSSO: false,
      });
    });

    it("should return actual settings when registration settings exist", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockPrisma.registrationSettings.findFirst.mockResolvedValue({
        force2FAAllLogins: true,
        force2FANonSSO: false,
      });

      const response = await getSettings();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        force2FAAllLogins: true,
        force2FANonSSO: false,
      });
    });

    it("should return 500 on database error", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockPrisma.registrationSettings.findFirst.mockRejectedValue(
        new Error("Database error")
      );

      const response = await getSettings();
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to get 2FA settings");
    });
  });

  describe("POST /api/auth/two-factor/disable", () => {
    const createRequest = (body: object) => {
      return new NextRequest("http://localhost/api/auth/two-factor/disable", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      });
    };

    it("should return 401 when user is not authenticated", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const response = await disableTwoFactor(createRequest({ token: "123456" }));
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 403 when force2FAAllLogins is enabled", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockPrisma.registrationSettings.findFirst.mockResolvedValue({
        force2FAAllLogins: true,
        force2FANonSSO: false,
      });

      const response = await disableTwoFactor(createRequest({ token: "123456" }));
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe(
        "Two-factor authentication is required by your organization and cannot be disabled"
      );
    });

    it("should return 403 when force2FANonSSO is enabled", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockPrisma.registrationSettings.findFirst.mockResolvedValue({
        force2FAAllLogins: false,
        force2FANonSSO: true,
      });

      const response = await disableTwoFactor(createRequest({ token: "123456" }));
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe(
        "Two-factor authentication is required by your organization and cannot be disabled"
      );
    });

    it("should return 400 when no token or backup code provided", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockPrisma.registrationSettings.findFirst.mockResolvedValue(null);

      const response = await disableTwoFactor(createRequest({}));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Token or backup code is required");
    });

    it("should return 404 when user not found", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockPrisma.registrationSettings.findFirst.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const response = await disableTwoFactor(createRequest({ token: "123456" }));
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("User not found");
    });

    it("should return 400 when 2FA is not enabled", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockPrisma.registrationSettings.findFirst.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue({
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: null,
      });

      const response = await disableTwoFactor(createRequest({ token: "123456" }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Two-factor authentication is not enabled");
    });

    it("should return 400 when verification fails", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockPrisma.registrationSettings.findFirst.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue({
        twoFactorEnabled: true,
        twoFactorSecret: "encrypted-secret",
        twoFactorBackupCodes: null,
      });
      mockDecryptSecret.mockReturnValue("decrypted-secret");
      mockVerifyTOTP.mockReturnValue(false);

      const response = await disableTwoFactor(createRequest({ token: "123456" }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid verification code or backup code");
    });

    it("should disable 2FA successfully with valid TOTP token", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockPrisma.registrationSettings.findFirst.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue({
        twoFactorEnabled: true,
        twoFactorSecret: "encrypted-secret",
        twoFactorBackupCodes: null,
      });
      mockDecryptSecret.mockReturnValue("decrypted-secret");
      mockVerifyTOTP.mockReturnValue(true);
      mockPrisma.user.update.mockResolvedValue({});

      const response = await disableTwoFactor(createRequest({ token: "123456" }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-123" },
        data: {
          twoFactorEnabled: false,
          twoFactorSecret: null,
          twoFactorBackupCodes: null,
        },
      });
    });

    it("should disable 2FA successfully with valid backup code", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockPrisma.registrationSettings.findFirst.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue({
        twoFactorEnabled: true,
        twoFactorSecret: "encrypted-secret",
        twoFactorBackupCodes: JSON.stringify(["hashed-code-1", "hashed-code-2"]),
      });
      mockDecryptSecret.mockReturnValue("decrypted-secret");
      mockVerifyTOTP.mockReturnValue(false);
      mockVerifyBackupCode.mockReturnValue(0); // Found at index 0

      const response = await disableTwoFactor(
        createRequest({ backupCode: "ABCD1234" })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe("POST /api/auth/two-factor/verify-sso", () => {
    const createRequest = (body: object) => {
      return new NextRequest("http://localhost/api/auth/two-factor/verify-sso", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      });
    };

    it("should return 401 when user is not authenticated", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const response = await verifySso(createRequest({ token: "123456" }));
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 400 when no token provided", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);

      const response = await verifySso(createRequest({}));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Verification code is required");
    });

    it("should return 429 when rate limited", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockCheckRateLimit.mockReturnValue(false);

      const response = await verifySso(createRequest({ token: "123456" }));
      const data = await response.json();

      expect(response.status).toBe(429);
      expect(data.error).toBe("Too many attempts. Please try again later.");
    });

    it("should return 404 when user not found", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const response = await verifySso(createRequest({ token: "123456" }));
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("User not found");
    });

    it("should return 400 when 2FA is not enabled", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-123",
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: null,
      });

      const response = await verifySso(createRequest({ token: "123456" }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Two-factor authentication is not enabled");
    });

    it("should return 400 when verification fails", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-123",
        twoFactorEnabled: true,
        twoFactorSecret: "encrypted-secret",
        twoFactorBackupCodes: null,
      });
      mockDecryptSecret.mockReturnValue("decrypted-secret");
      mockVerifyTOTP.mockReturnValue(false);

      const response = await verifySso(createRequest({ token: "123456" }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid verification code");
    });

    it("should verify successfully with valid TOTP token", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-123",
        twoFactorEnabled: true,
        twoFactorSecret: "encrypted-secret",
        twoFactorBackupCodes: null,
      });
      mockDecryptSecret.mockReturnValue("decrypted-secret");
      mockVerifyTOTP.mockReturnValue(true);

      const response = await verifySso(createRequest({ token: "123456" }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.usedBackupCode).toBe(false);
    });

    it("should verify with backup code and remove the used code", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-123",
        twoFactorEnabled: true,
        twoFactorSecret: "encrypted-secret",
        twoFactorBackupCodes: JSON.stringify(["hashed-code-1", "hashed-code-2"]),
      });
      mockDecryptSecret.mockReturnValue("decrypted-secret");
      mockVerifyTOTP.mockReturnValue(false);
      mockVerifyBackupCode.mockReturnValue(0); // Found at index 0
      mockPrisma.user.update.mockResolvedValue({});

      const response = await verifySso(createRequest({ token: "ABCD1234" }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.usedBackupCode).toBe(true);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-123" },
        data: { twoFactorBackupCodes: JSON.stringify(["hashed-code-2"]) },
      });
    });

    it("should return 500 on unexpected error", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockPrisma.user.findUnique.mockRejectedValue(new Error("Database error"));

      const response = await verifySso(createRequest({ token: "123456" }));
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to verify 2FA");
    });
  });

  describe("GET /api/auth/two-factor/setup", () => {
    it("should return 401 when user is not authenticated", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const response = await setup(new NextRequest("http://localhost/api/auth/two-factor/setup"));
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 404 when user not found", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const response = await setup(new NextRequest("http://localhost/api/auth/two-factor/setup"));
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("User not found");
    });

    it("should return 400 when 2FA is already enabled", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockPrisma.user.findUnique.mockResolvedValue({
        email: "test@example.com",
        twoFactorEnabled: true,
      });

      const response = await setup(new NextRequest("http://localhost/api/auth/two-factor/setup"));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Two-factor authentication is already enabled");
    });

    it("should generate and return QR code and secret", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockPrisma.user.findUnique.mockResolvedValue({
        email: "test@example.com",
        twoFactorEnabled: false,
      });
      mockGenerateTOTPSecret.mockReturnValue("ABCDEFGHIJ123456");
      mockGenerateQRCodeDataURL.mockResolvedValue("data:image/png;base64,qrcode");
      mockEncryptSecret.mockReturnValue("encrypted-secret");
      mockPrisma.user.update.mockResolvedValue({});

      const response = await setup(new NextRequest("http://localhost/api/auth/two-factor/setup"));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.secret).toBe("ABCDEFGHIJ123456");
      expect(data.qrCode).toBe("data:image/png;base64,qrcode");
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-123" },
        data: { twoFactorSecret: "encrypted-secret" },
      });
    });

    it("should return 500 on unexpected error", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockPrisma.user.findUnique.mockRejectedValue(new Error("Database error"));

      const response = await setup(new NextRequest("http://localhost/api/auth/two-factor/setup"));
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to generate 2FA setup");
    });
  });

  describe("POST /api/auth/two-factor/enable", () => {
    const createRequest = (body: object) => {
      return new NextRequest("http://localhost/api/auth/two-factor/enable", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      });
    };

    it("should return 401 when user is not authenticated", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const response = await enable(createRequest({ token: "123456" }));
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 400 when no token provided", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);

      const response = await enable(createRequest({}));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Token is required");
    });

    it("should return 404 when user not found", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const response = await enable(createRequest({ token: "123456" }));
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("User not found");
    });

    it("should return 400 when 2FA is already enabled", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockPrisma.user.findUnique.mockResolvedValue({
        twoFactorEnabled: true,
        twoFactorSecret: "encrypted-secret",
      });

      const response = await enable(createRequest({ token: "123456" }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Two-factor authentication is already enabled");
    });

    it("should return 400 when setup has not been started", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockPrisma.user.findUnique.mockResolvedValue({
        twoFactorEnabled: false,
        twoFactorSecret: null,
      });

      const response = await enable(createRequest({ token: "123456" }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Please start the 2FA setup process first");
    });

    it("should return 400 when verification code is invalid", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockPrisma.user.findUnique.mockResolvedValue({
        twoFactorEnabled: false,
        twoFactorSecret: "encrypted-secret",
      });
      mockDecryptSecret.mockReturnValue("decrypted-secret");
      mockVerifyTOTP.mockReturnValue(false);

      const response = await enable(createRequest({ token: "123456" }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid verification code");
    });

    it("should enable 2FA and return backup codes on success", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockPrisma.user.findUnique.mockResolvedValue({
        twoFactorEnabled: false,
        twoFactorSecret: "encrypted-secret",
      });
      mockDecryptSecret.mockReturnValue("decrypted-secret");
      mockVerifyTOTP.mockReturnValue(true);
      mockGenerateBackupCodes.mockReturnValue({
        plainCodes: ["CODE1", "CODE2", "CODE3"],
        hashedCodes: ["hashed1", "hashed2", "hashed3"],
      });
      mockPrisma.user.update.mockResolvedValue({});

      const response = await enable(createRequest({ token: "123456" }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.backupCodes).toEqual(["CODE1", "CODE2", "CODE3"]);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-123" },
        data: {
          twoFactorEnabled: true,
          twoFactorBackupCodes: JSON.stringify(["hashed1", "hashed2", "hashed3"]),
        },
      });
    });

    it("should return 500 on unexpected error", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockPrisma.user.findUnique.mockRejectedValue(new Error("Database error"));

      const response = await enable(createRequest({ token: "123456" }));
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to enable 2FA");
    });
  });
});
