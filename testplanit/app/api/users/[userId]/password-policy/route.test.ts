import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
    },
    registrationSettings: {
      findFirst: vi.fn(),
    },
  },
}));

import { getServerAuthSession } from "~/server/auth";
import { db } from "~/server/db";
import { GET } from "./route";

const mockGetServerAuthSession = vi.mocked(getServerAuthSession);
const mockDb = vi.mocked(db, true);

function makeRequest(userId: string) {
  return new NextRequest(
    `http://localhost/api/users/${userId}/password-policy`,
    { method: "GET" }
  );
}

function makeUserSession(userId = "user-1") {
  return {
    user: { id: userId, access: "USER", email: "user@test.com" },
  } as any;
}

const defaultSettings = {
  minPasswordLength: 8,
  requireUppercase: false,
  requireLowercase: false,
  requireNumbers: false,
  requiredSpecialChars: 0,
};

describe("GET /api/users/[userId]/password-policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.registrationSettings.findFirst.mockResolvedValue(
      defaultSettings as any
    );
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetServerAuthSession.mockResolvedValue(null);

    const res = await GET(makeRequest("user-1"), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    expect(res.status).toBe(401);
  });

  it("returns 403 when userId does not match session user", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeUserSession("other-user"));

    const res = await GET(makeRequest("user-1"), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    expect(res.status).toBe(403);
  });

  it("returns hasPassword: true when user has bcrypt-hashed password ($2b$)", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeUserSession());
    mockDb.user.findUnique.mockResolvedValue({
      password: "$2b$10$abcdefghijklmnopqrstuuVGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
    } as any);

    const res = await GET(makeRequest("user-1"), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasPassword).toBe(true);
  });

  it("returns hasPassword: true when user has bcrypt-hashed password ($2a$)", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeUserSession());
    mockDb.user.findUnique.mockResolvedValue({
      password: "$2a$10$abcdefghijklmnopqrstuuVGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
    } as any);

    const res = await GET(makeRequest("user-1"), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    const body = await res.json();
    expect(body.hasPassword).toBe(true);
  });

  it("returns hasPassword: false when user has null password (SSO-provisioned)", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeUserSession());
    mockDb.user.findUnique.mockResolvedValue({ password: null } as any);

    const res = await GET(makeRequest("user-1"), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    const body = await res.json();
    expect(body.hasPassword).toBe(false);
  });

  it("returns hasPassword: false when user has plain-text UUID password (SSO-provisioned)", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeUserSession());
    mockDb.user.findUnique.mockResolvedValue({
      password: "3f2a1b4c-5d6e-7f8a-9b0c-1d2e3f4a5b6c",
    } as any);

    const res = await GET(makeRequest("user-1"), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    const body = await res.json();
    expect(body.hasPassword).toBe(false);
  });

  it("returns hasPassword: false when user is not found", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeUserSession());
    mockDb.user.findUnique.mockResolvedValue(null);

    const res = await GET(makeRequest("user-1"), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    const body = await res.json();
    expect(body.hasPassword).toBe(false);
  });

  it("returns policy data alongside hasPassword", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeUserSession());
    mockDb.user.findUnique.mockResolvedValue({
      password: "$2b$10$abcdefghijklmnopqrstuuVGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
    } as any);
    mockDb.registrationSettings.findFirst.mockResolvedValue({
      minPasswordLength: 12,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requiredSpecialChars: 2,
    } as any);

    const res = await GET(makeRequest("user-1"), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    const body = await res.json();
    expect(body.hasPassword).toBe(true);
    expect(body.policy).toMatchObject({
      minPasswordLength: 12,
      requireUppercase: true,
      requireNumbers: true,
      requiredSpecialChars: 2,
    });
  });

  it("returns policy: null with hasPassword when no settings found", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeUserSession());
    mockDb.user.findUnique.mockResolvedValue({ password: null } as any);
    mockDb.registrationSettings.findFirst.mockResolvedValue(null);

    const res = await GET(makeRequest("user-1"), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    const body = await res.json();
    expect(body.policy).toBeNull();
    expect(body.hasPassword).toBe(false);
  });
});
