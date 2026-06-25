import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * UserIntegrationAuth audit emission (no token leakage).
 *
 * UserIntegrationAuth is a credential table (CDC-excluded per SAF-04), and its
 * real mutations run through the raw rawDb client in AuthenticationService
 * — so they bypass the $extends entity-audit hooks entirely. These tests pin the
 * explicit semantic audit added here: connect → CREATE, re-auth → UPDATE,
 * revoke → DELETE, lastUsedAt bump → no audit, and NEVER the encrypted tokens.
 */

const mockFindUnique = vi.fn();
const mockUpsert = vi.fn();
const mockFindFirst = vi.fn();
const mockUpdateMany = vi.fn();
const mockCaptureAuditEvent = vi.fn();

vi.mock("@/lib/rawDb", () => ({
  rawDb: {
    userIntegrationAuth: {
      findUnique: (...a: unknown[]) => mockFindUnique(...a),
      upsert: (...a: unknown[]) => mockUpsert(...a),
      findFirst: (...a: unknown[]) => mockFindFirst(...a),
      updateMany: (...a: unknown[]) => mockUpdateMany(...a),
    },
  },
}));

vi.mock("@/lib/services/auditLog", () => ({
  captureAuditEvent: (...a: unknown[]) => mockCaptureAuditEvent(...a),
}));

vi.mock("@/utils/encryption", () => ({
  EncryptionService: {
    encrypt: (value: string) => `enc(${value})`,
    decrypt: vi.fn(),
    decryptObject: vi.fn(),
  },
  getMasterKey: () => "test-master-key",
}));

import { AuthenticationService } from "./AuthenticationService";

describe("AuthenticationService — UserIntegrationAuth audit", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockUpsert.mockReset();
    mockFindFirst.mockReset();
    mockUpdateMany.mockReset();
    mockCaptureAuditEvent.mockReset();
    mockCaptureAuditEvent.mockResolvedValue(undefined);
  });

  it("storeUserAuth emits a CREATE audit on first auth, with NO tokens in the payload", async () => {
    mockFindUnique.mockResolvedValue(null); // no existing record → CREATE
    mockUpsert.mockResolvedValue({
      id: "uia-1",
      integration: { name: "Jira Prod" },
    });

    await AuthenticationService.storeUserAuth("user-1", 42, {
      accessToken: "SECRET_ACCESS_TOKEN",
      refreshToken: "SECRET_REFRESH_TOKEN",
    });

    expect(mockCaptureAuditEvent).toHaveBeenCalledTimes(1);
    const evt = mockCaptureAuditEvent.mock.calls[0][0];
    expect(evt.action).toBe("CREATE");
    expect(evt.entityType).toBe("UserIntegrationAuth");
    expect(evt.entityId).toBe("uia-1");
    expect(evt.userId).toBe("user-1");
    expect(evt.entityName).toBe("Jira Prod");
    expect(evt.metadata).toEqual({ integrationId: 42 });

    // The encrypted tokens (and even their field names) must never reach the audit.
    const serialized = JSON.stringify(evt);
    expect(serialized).not.toContain("SECRET_ACCESS_TOKEN");
    expect(serialized).not.toContain("SECRET_REFRESH_TOKEN");
    expect(serialized).not.toContain("accessToken");
    expect(serialized).not.toContain("refreshToken");
  });

  it("storeUserAuth emits an UPDATE audit when re-authorizing an existing record", async () => {
    mockFindUnique.mockResolvedValue({ id: "uia-1" }); // exists → UPDATE
    mockUpsert.mockResolvedValue({
      id: "uia-1",
      integration: { name: "Jira Prod" },
    });

    await AuthenticationService.storeUserAuth("user-1", 42, {
      accessToken: "tok",
    });

    expect(mockCaptureAuditEvent.mock.calls[0][0].action).toBe("UPDATE");
  });

  it("storeUserAuth falls back to an integration label when the name is unavailable", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockUpsert.mockResolvedValue({ id: "uia-1", integration: null });

    await AuthenticationService.storeUserAuth("user-1", 7, {
      accessToken: "t",
    });

    expect(mockCaptureAuditEvent.mock.calls[0][0].entityName).toBe(
      "Integration #7"
    );
  });

  it("revokeUserAuth emits a DELETE audit for the active record", async () => {
    mockFindFirst.mockResolvedValue({
      id: "uia-1",
      integration: { name: "Jira Prod" },
    });
    mockUpdateMany.mockResolvedValue({ count: 1 });

    await AuthenticationService.revokeUserAuth("user-1", 42);

    expect(mockCaptureAuditEvent).toHaveBeenCalledTimes(1);
    const evt = mockCaptureAuditEvent.mock.calls[0][0];
    expect(evt.action).toBe("DELETE");
    expect(evt.entityType).toBe("UserIntegrationAuth");
    expect(evt.entityId).toBe("uia-1");
    expect(evt.userId).toBe("user-1");
  });

  it("revokeUserAuth does NOT audit when there is no active record", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockUpdateMany.mockResolvedValue({ count: 0 });

    await AuthenticationService.revokeUserAuth("user-1", 42);

    expect(mockCaptureAuditEvent).not.toHaveBeenCalled();
  });

  it("updateLastUsed does NOT emit an audit (housekeeping noise)", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });

    await AuthenticationService.updateLastUsed("user-1", 42);

    expect(mockCaptureAuditEvent).not.toHaveBeenCalled();
  });

  it("an audit failure does not break the authentication flow", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockUpsert.mockResolvedValue({
      id: "uia-1",
      integration: { name: "Jira" },
    });
    mockCaptureAuditEvent.mockRejectedValue(new Error("audit queue down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      AuthenticationService.storeUserAuth("user-1", 42, { accessToken: "tok" })
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
