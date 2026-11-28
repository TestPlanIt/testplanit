// @vitest-environment node
/**
 * The three two-factor routes a password sign-in uses before it has a session
 * identify the user from a signed token alone. Each must take only the token
 * minted for its own step.
 */
import jwt from "jsonwebtoken";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = vi.hoisted(() => {
  const secret = "test-secret-key-at-least-32-chars-long";
  process.env.NEXTAUTH_SECRET = secret;
  return secret;
});

const { mockDb, mockVerifyTOTP } = vi.hoisted(() => ({
  mockDb: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  mockVerifyTOTP: vi.fn(),
}));

vi.mock("~/lib/db", () => ({ baseDb: mockDb }));

vi.mock("~/lib/two-factor", () => ({
  verifyTOTP: mockVerifyTOTP,
  decryptSecret: vi.fn().mockReturnValue("totp-secret"),
  encryptSecret: vi.fn().mockReturnValue("encrypted-secret"),
  verifyBackupCode: vi.fn().mockReturnValue(-1),
  generateTOTPSecret: vi.fn().mockReturnValue("NEWSECRET"),
  generateQRCodeDataURL: vi.fn().mockResolvedValue("data:image/png;base64,qr"),
  generateBackupCodes: vi
    .fn()
    .mockReturnValue({ plainCodes: ["CODE0001"], hashedCodes: ["hash"] }),
}));

vi.mock("~/lib/auth-security", () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock("~/lib/services/auditLog", () => ({
  auditAuthEvent: vi.fn().mockResolvedValue(undefined),
}));

import {
  signSignInToken,
  type SignInTokenPurpose,
} from "~/lib/auth/signInTokens";
import { POST as enableRequired } from "./enable-required/route";
import { POST as setupRequired } from "./setup-required/route";
import { POST as verify } from "./verify/route";

const claims = {
  userId: "user-1",
  email: "user@example.com",
  // What each route looks for once the signature checks out.
  twoFactorPending: true,
  twoFactorSetupRequired: true,
};

function tokenFor(purpose: SignInTokenPurpose): string {
  return signSignInToken(purpose, claims, { expiresIn: "5m" });
}

function unlabelledToken(): string {
  return jwt.sign(claims, SECRET, { expiresIn: "5m" });
}

function post(path: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost:3000/api/auth/two-factor/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyTOTP.mockResolvedValue(true);
});

describe("POST /api/auth/two-factor/verify", () => {
  beforeEach(() => {
    mockDb.user.findUnique.mockResolvedValue({
      id: "user-1",
      twoFactorEnabled: true,
      twoFactorSecret: "encrypted-secret",
      twoFactorBackupCodes: null,
    });
  });

  it.each([
    ["a two-factor setup token", () => tokenFor("two-factor-setup")],
    ["a SAML completion token", () => tokenFor("saml-complete")],
    ["a token that names no purpose", unlabelledToken],
  ])("refuses %s", async (_label, mint) => {
    const response = await verify(
      post("verify", { token: "123456", pendingAuthToken: mint() })
    );

    expect(response.status).toBe(401);
    expect(mockDb.user.findUnique).not.toHaveBeenCalled();
  });

  it("accepts the token a password sign-in hands out", async () => {
    const response = await verify(
      post("verify", {
        token: "123456",
        pendingAuthToken: tokenFor("two-factor-pending"),
      })
    );

    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
  });
});

describe.each([
  ["setup-required", setupRequired],
  ["enable-required", enableRequired],
] as const)("POST /api/auth/two-factor/%s", (path, handler) => {
  beforeEach(() => {
    mockDb.user.findUnique.mockResolvedValue({
      email: "user@example.com",
      twoFactorEnabled: false,
      twoFactorSecret: "encrypted-secret",
    });
    mockDb.user.update.mockResolvedValue({});
  });

  it.each([
    ["a pending two-factor token", () => tokenFor("two-factor-pending")],
    ["a SAML completion token", () => tokenFor("saml-complete")],
    ["a token that names no purpose", unlabelledToken],
  ])("refuses %s", async (_label, mint) => {
    const response = await handler(
      post(path, { token: "123456", setupToken: mint() })
    );

    expect(response.status).toBe(401);
    expect(mockDb.user.findUnique).not.toHaveBeenCalled();
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it("accepts the setup token a password sign-in hands out", async () => {
    const response = await handler(
      post(path, { token: "123456", setupToken: tokenFor("two-factor-setup") })
    );

    expect(response.status).toBe(200);
  });
});
