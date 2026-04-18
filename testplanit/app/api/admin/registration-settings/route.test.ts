import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  db: {
    registrationSettings: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: vi.fn().mockResolvedValue(undefined),
  calculateDiff: vi.fn(),
}));

import { getServerAuthSession } from "~/server/auth";
import { db } from "~/server/db";
import { captureAuditEvent, calculateDiff } from "~/lib/services/auditLog";
import { PATCH } from "./route";

const mockGetServerAuthSession = vi.mocked(getServerAuthSession);
const mockDb = vi.mocked(db, true);
const mockCaptureAuditEvent = vi.mocked(captureAuditEvent);
const mockCalculateDiff = vi.mocked(calculateDiff);

function makeAdminSession() {
  return {
    user: { id: "admin-1", access: "ADMIN", email: "admin@test.com" },
  } as any;
}

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/registration-settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeCurrentSettings(overrides: Record<string, unknown> = {}) {
  return {
    id: "settings-1",
    minPasswordLength: 12,
    requireUppercase: false,
    requireLowercase: false,
    requireNumbers: false,
    requiredSpecialChars: null,
    passwordHistoryDepth: 0,
    passwordExpirationDays: 0,
    lockoutThreshold: 5,
    lockoutDurationMinutes: 15,
    ...overrides,
  };
}

describe("PATCH /api/admin/registration-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCaptureAuditEvent.mockResolvedValue(undefined);
  });

  it("returns 401 when no session", async () => {
    mockGetServerAuthSession.mockResolvedValue(null);

    const res = await PATCH(makeRequest({ minPasswordLength: 16 }));

    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin users", async () => {
    mockGetServerAuthSession.mockResolvedValue({
      user: { id: "user-1", access: "USER" },
    } as any);

    const res = await PATCH(makeRequest({ minPasswordLength: 16 }));

    expect(res.status).toBe(403);
  });

  it("returns 400 when no valid policy fields are provided", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeAdminSession());

    const res = await PATCH(makeRequest({ unknownField: "value" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("No valid policy fields");
  });

  it("returns 400 when minPasswordLength is below 8", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeAdminSession());

    const res = await PATCH(makeRequest({ minPasswordLength: 4 }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("minPasswordLength");
  });

  it("returns 400 when minPasswordLength is above 128", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeAdminSession());

    const res = await PATCH(makeRequest({ minPasswordLength: 200 }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("minPasswordLength");
  });

  it("calls calculateDiff and fires PASSWORD_POLICY_CHANGED when values change", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeAdminSession());
    const currentSettings = makeCurrentSettings({ minPasswordLength: 12 });
    mockDb.registrationSettings.findFirst.mockResolvedValue(
      currentSettings as any
    );
    mockDb.registrationSettings.update.mockResolvedValue({
      ...currentSettings,
      minPasswordLength: 16,
    } as any);
    mockCalculateDiff.mockReturnValue({
      minPasswordLength: { old: 12, new: 16 },
    });

    const res = await PATCH(makeRequest({ minPasswordLength: 16 }));

    expect(res.status).toBe(200);
    expect(mockCalculateDiff).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(mockCaptureAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "PASSWORD_POLICY_CHANGED",
          metadata: expect.objectContaining({ diff: expect.any(Object) }),
        })
      );
    });
  });

  it("does NOT fire audit event when calculateDiff returns undefined (no changes)", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeAdminSession());
    const currentSettings = makeCurrentSettings({ minPasswordLength: 16 });
    mockDb.registrationSettings.findFirst.mockResolvedValue(
      currentSettings as any
    );
    mockDb.registrationSettings.update.mockResolvedValue(
      currentSettings as any
    );
    mockCalculateDiff.mockReturnValue(undefined);

    const res = await PATCH(makeRequest({ minPasswordLength: 16 }));

    expect(res.status).toBe(200);
    // Wait a tick to ensure any async fire-and-forget would have run
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockCaptureAuditEvent).not.toHaveBeenCalled();
  });

  it("returns 404 when settings not found", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeAdminSession());
    mockDb.registrationSettings.findFirst.mockResolvedValue(null);

    const res = await PATCH(makeRequest({ minPasswordLength: 16 }));

    expect(res.status).toBe(404);
  });
});
