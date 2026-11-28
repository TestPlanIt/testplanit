// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSession,
  mockGetToken,
  mockFindUser,
  mockAvailability,
  mockComplete,
  mockCaptureAuditEvent,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetToken: vi.fn(),
  mockFindUser: vi.fn(),
  mockAvailability: vi.fn(),
  mockComplete: vi.fn(),
  mockCaptureAuditEvent: vi.fn(),
}));

vi.mock("~/server/auth", () => ({ getServerAuthSession: mockGetSession }));
vi.mock("next-auth/jwt", () => ({ getToken: mockGetToken }));
vi.mock("~/server/db", () => ({
  db: { user: { findUnique: mockFindUser } },
}));
vi.mock("~/lib/passkey", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/passkey")>()),
  getPasskeyAvailability: mockAvailability,
  completePasskeyRegistration: mockComplete,
}));
vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: mockCaptureAuditEvent,
}));

import { POST } from "./route";

const dbUser = {
  id: "user-1",
  email: "user@example.com",
  name: "User One",
  isActive: true,
  isDeleted: false,
  authMethod: "BOTH",
  password: "$2b$10$hash",
  twoFactorEnabled: false,
  twoFactorSecret: null,
};

const storedPasskey = {
  id: "passkey-1",
  name: "MacBook",
  createdAt: "2026-11-27T00:00:00.000Z",
  lastUsedAt: null,
};

const validBody = {
  response: { id: "credential" },
  challengeToken: "token-1",
  name: "  MacBook  ",
};

function makePost(body: unknown = validBody) {
  return new NextRequest("http://localhost/api/auth/passkey/register/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
  mockGetToken.mockResolvedValue({ sub: "user-1" });
  mockFindUser.mockResolvedValue(dbUser);
  mockAvailability.mockResolvedValue({ available: true });
  mockComplete.mockResolvedValue({ ok: true, passkey: storedPasskey });
  mockCaptureAuditEvent.mockResolvedValue(undefined);
});

describe("POST /api/auth/passkey/register/verify", () => {
  it("stores the passkey and audits it", async () => {
    const response = await POST(makePost());

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(storedPasskey);
    expect(mockComplete).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      response: { id: "credential" },
      challengeToken: "token-1",
      name: "MacBook",
    });
    expect(mockCaptureAuditEvent).toHaveBeenCalledWith({
      action: "PASSKEY_REGISTERED",
      entityType: "Passkey",
      entityId: "passkey-1",
      entityName: "MacBook",
      userId: "user-1",
      userEmail: "user@example.com",
      userName: "User One",
    });
  });

  it("requires a signed-in user", async () => {
    mockGetSession.mockResolvedValue(null);
    expect((await POST(makePost())).status).toBe(401);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("refuses a session that still owes a second factor", async () => {
    mockGetToken.mockResolvedValue({
      sub: "user-1",
      twoFactorRequired: true,
      twoFactorVerified: false,
    });
    expect((await POST(makePost())).status).toBe(403);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing name", { ...validBody, name: "   " }],
    ["a name that is too long", { ...validBody, name: "x".repeat(101) }],
    ["a missing challenge token", { ...validBody, challengeToken: "" }],
  ])("rejects %s", async (_label, body) => {
    const response = await POST(makePost(body));

    expect(response.status).toBe(400);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed", 400, "users.profile.passkeys.errors.registrationFailed"],
    [
      "challenge_invalid",
      400,
      "users.profile.passkeys.errors.registrationFailed",
    ],
    [
      "verification_failed",
      400,
      "users.profile.passkeys.errors.registrationFailed",
    ],
    ["duplicate", 409, "users.profile.passkeys.errors.alreadyRegistered"],
    ["limit_reached", 409, "users.profile.passkeys.errors.limitReached"],
  ])("maps %s to %i", async (reason, status, errorCode) => {
    mockComplete.mockResolvedValue({ ok: false, reason });
    const response = await POST(makePost());

    expect(response.status).toBe(status);
    expect((await response.json()).errorCode).toBe(errorCode);
    expect(mockCaptureAuditEvent).not.toHaveBeenCalled();
  });
});
