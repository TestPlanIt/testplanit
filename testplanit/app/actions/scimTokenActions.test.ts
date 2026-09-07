import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/scim/tokens", () => ({
  mintScimToken: vi.fn(),
  revokeScimToken: vi.fn(),
  rotateScimToken: vi.fn(),
  getScimTokenById: vi.fn(),
}));

vi.mock("~/lib/scim/probe", () => ({
  probeScimToken: vi.fn(),
}));

vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(),
}));

import { ORMError, ORMErrorReason } from "@zenstackhq/orm";

import {
  mintScimToken,
  revokeScimToken,
  rotateScimToken,
} from "~/lib/scim/tokens";
import { probeScimToken } from "~/lib/scim/probe";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { getServerAuthSession } from "~/server/auth";
import {
  mintScimTokenAction,
  revokeScimTokenAction,
  rotateScimTokenAction,
  testScimProbeAction,
} from "./scimTokenActions";

function mockAdminSession(id = "admin1") {
  vi.mocked(getServerAuthSession).mockResolvedValue({
    user: { id, access: "ADMIN", name: "Admin User" },
  } as any);
}

function mockNonAdminSession(id = "user1") {
  vi.mocked(getServerAuthSession).mockResolvedValue({
    user: { id, access: "USER" },
  } as any);
}

function mockNoSession() {
  vi.mocked(getServerAuthSession).mockResolvedValue(null as any);
}

describe("scimTokenActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("mintScimTokenAction", () => {
    it("rejects an unauthenticated caller without invoking the service layer", async () => {
      mockNoSession();

      const result = await mintScimTokenAction({
        name: "Okta prod",
        idpName: "OKTA",
        expiresAt: null,
      });

      expect(result).toEqual({ success: false, error: "Unauthorized" });
      expect(mintScimToken).not.toHaveBeenCalled();
      expect(captureAuditEvent).not.toHaveBeenCalled();
    });

    it("rejects a non-admin caller without invoking the service layer", async () => {
      mockNonAdminSession();

      const result = await mintScimTokenAction({
        name: "Okta prod",
        idpName: "OKTA",
        expiresAt: null,
      });

      expect(result).toEqual({ success: false, error: "Unauthorized" });
      expect(mintScimToken).not.toHaveBeenCalled();
      expect(captureAuditEvent).not.toHaveBeenCalled();
    });

    it("rejects invalid input via zod with Invalid input string", async () => {
      mockAdminSession();

      const result = await mintScimTokenAction({
        name: "",
        idpName: "OKTA",
        expiresAt: null,
      } as any);

      expect(result).toEqual({ success: false, error: "Invalid input" });
      expect(mintScimToken).not.toHaveBeenCalled();
    });

    it("mints + audits and returns plaintext exactly once on success", async () => {
      mockAdminSession("admin1");
      const fakeRow = {
        id: "tk_1",
        name: "Okta prod",
        idpName: "OKTA",
        tokenPrefix: "tps_abcdefgh",
      } as any;
      vi.mocked(mintScimToken).mockResolvedValue({
        token: fakeRow,
        plaintext: "tps_freshly_minted_plaintext",
      });

      const result = await mintScimTokenAction({
        name: "Okta prod",
        idpName: "OKTA",
        expiresAt: null,
      });

      expect(result).toEqual({
        success: true,
        tokenId: "tk_1",
        plaintext: "tps_freshly_minted_plaintext",
        tokenPrefix: "tps_abcdefgh",
      });
      expect(mintScimToken).toHaveBeenCalledWith({
        name: "Okta prod",
        idpName: "OKTA",
        expiresAt: null,
        createdById: "admin1",
      });
      expect(captureAuditEvent).toHaveBeenCalledTimes(1);
      const auditArg = vi.mocked(captureAuditEvent).mock.calls[0][0];
      expect(auditArg.action).toBe("API_KEY_CREATED");
      expect(auditArg.entityType).toBe("ScimToken");
      expect(auditArg.entityId).toBe("tk_1");
      expect(auditArg.userId).toBe("admin1");
      expect(auditArg.entityName).toBe("Okta prod");
      expect(auditArg.metadata).toMatchObject({
        scimTokenId: "tk_1",
        idpName: "OKTA",
      });
    });

    it("surfaces a friendly 'name already exists' error on a unique-constraint violation without audit", async () => {
      mockAdminSession();
      const uniqueErr = Object.assign(
        new ORMError(
          ORMErrorReason.DB_QUERY_ERROR,
          'duplicate key value violates unique constraint "scim_token_name_key"'
        ),
        { dbErrorCode: "23505" }
      );
      vi.mocked(mintScimToken).mockRejectedValue(uniqueErr);

      const result = await mintScimTokenAction({
        name: "Existing name",
        idpName: "OKTA",
        expiresAt: null,
      });

      expect(result).toEqual({
        success: false,
        error: "A token with that name already exists",
      });
      expect(captureAuditEvent).not.toHaveBeenCalled();
    });

    it("returns a generic mint error for any other failure", async () => {
      mockAdminSession();
      vi.mocked(mintScimToken).mockRejectedValue(new Error("boom"));

      const result = await mintScimTokenAction({
        name: "Okta prod",
        idpName: "OKTA",
        expiresAt: null,
      });

      expect(result).toEqual({
        success: false,
        error: "Failed to mint SCIM token",
      });
    });
  });

  describe("revokeScimTokenAction", () => {
    it("rejects a non-admin caller without invoking the service layer", async () => {
      mockNonAdminSession();

      const result = await revokeScimTokenAction("tk_1");

      expect(result).toEqual({ success: false, error: "Unauthorized" });
      expect(revokeScimToken).not.toHaveBeenCalled();
      expect(captureAuditEvent).not.toHaveBeenCalled();
    });

    it("revokes + audits with metadata.scimTokenId on success", async () => {
      mockAdminSession("admin2");
      vi.mocked(revokeScimToken).mockResolvedValue({
        id: "tk_1",
        name: "Okta prod",
      } as any);

      const result = await revokeScimTokenAction("tk_1");

      expect(result).toEqual({ success: true });
      expect(revokeScimToken).toHaveBeenCalledWith("tk_1", "admin2");
      expect(captureAuditEvent).toHaveBeenCalledTimes(1);
      const auditArg = vi.mocked(captureAuditEvent).mock.calls[0][0];
      expect(auditArg.action).toBe("API_KEY_REVOKED");
      expect(auditArg.entityType).toBe("ScimToken");
      expect(auditArg.entityId).toBe("tk_1");
      expect(auditArg.userId).toBe("admin2");
      expect(auditArg.entityName).toBe("Okta prod");
      expect(auditArg.metadata).toMatchObject({ scimTokenId: "tk_1" });
    });

    it("surfaces a generic revoke error and skips audit on service failure", async () => {
      mockAdminSession();
      vi.mocked(revokeScimToken).mockRejectedValue(new Error("boom"));

      const result = await revokeScimTokenAction("tk_1");

      expect(result).toEqual({
        success: false,
        error: "Failed to revoke SCIM token",
      });
      expect(captureAuditEvent).not.toHaveBeenCalled();
    });
  });

  describe("testScimProbeAction", () => {
    it("rejects a non-admin caller without invoking the probe", async () => {
      mockNonAdminSession();

      const result = await testScimProbeAction("tk_1");

      expect(result).toEqual({ ok: false, status: 0, error: "Unauthorized" });
      expect(probeScimToken).not.toHaveBeenCalled();
      expect(captureAuditEvent).not.toHaveBeenCalled();
    });

    it("probes + audits with metadata.source 'scim' and resultStatus on success", async () => {
      mockAdminSession("admin3");
      vi.mocked(probeScimToken).mockResolvedValue({ ok: true, status: 200 });

      const result = await testScimProbeAction("tk_1");

      expect(result).toEqual({ ok: true, status: 200 });
      expect(probeScimToken).toHaveBeenCalledWith("tk_1");
      expect(captureAuditEvent).toHaveBeenCalledTimes(1);
      const auditArg = vi.mocked(captureAuditEvent).mock.calls[0][0];
      expect(auditArg.action).toBe("UPDATE");
      expect(auditArg.entityType).toBe("ScimToken");
      expect(auditArg.entityId).toBe("tk_1");
      expect(auditArg.userId).toBe("admin3");
      expect(auditArg.metadata).toMatchObject({
        scimTokenId: "tk_1",
        resultStatus: 200,
        source: "scim",
      });
    });

    it("audits failed probes too with the failing status code", async () => {
      mockAdminSession("admin3");
      vi.mocked(probeScimToken).mockResolvedValue({
        ok: false,
        status: 401,
        reason: "HTTP 401",
      });

      const result = await testScimProbeAction("tk_1");

      expect(result).toEqual({ ok: false, status: 401, reason: "HTTP 401" });
      expect(captureAuditEvent).toHaveBeenCalledTimes(1);
      const auditArg = vi.mocked(captureAuditEvent).mock.calls[0][0];
      expect(auditArg.metadata).toMatchObject({
        scimTokenId: "tk_1",
        resultStatus: 401,
        source: "scim",
      });
    });
  });
});

describe("rotateScimTokenAction", () => {
  const rotatedRow = {
    id: "tk_1",
    name: "Okta production",
    tokenPrefix: "tps_newpref",
    previousTokenExpiresAt: new Date("2026-09-07T12:00:00.000Z"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated caller before touching the service", async () => {
    mockNoSession();

    const result = await rotateScimTokenAction({
      tokenId: "tk_1",
      overlapMs: 3_600_000,
    });

    expect(result).toEqual({ success: false, error: "Unauthorized" });
    expect(rotateScimToken).not.toHaveBeenCalled();
  });

  it("rejects a non-admin caller", async () => {
    mockNonAdminSession();

    const result = await rotateScimTokenAction({
      tokenId: "tk_1",
      overlapMs: 3_600_000,
    });

    expect(result).toEqual({ success: false, error: "Unauthorized" });
    expect(rotateScimToken).not.toHaveBeenCalled();
  });

  it("rejects an overlap window beyond the cap", async () => {
    mockAdminSession();

    const result = await rotateScimTokenAction({
      tokenId: "tk_1",
      overlapMs: 99_999_999_999,
    });

    expect(result).toEqual({ success: false, error: "Invalid input" });
    expect(rotateScimToken).not.toHaveBeenCalled();
  });

  it("rejects a negative overlap window", async () => {
    mockAdminSession();

    const result = await rotateScimTokenAction({
      tokenId: "tk_1",
      overlapMs: -1,
    });

    expect(result).toEqual({ success: false, error: "Invalid input" });
  });

  it("returns the replacement bearer and the overlap expiry", async () => {
    mockAdminSession();
    vi.mocked(rotateScimToken).mockResolvedValue({
      token: rotatedRow,
      plaintext: "tps_brand_new_value",
    } as any);

    const result = await rotateScimTokenAction({
      tokenId: "tk_1",
      overlapMs: 3_600_000,
    });

    expect(result.success).toBe(true);
    expect(result.plaintext).toBe("tps_brand_new_value");
    expect(result.previousTokenExpiresAt).toBe("2026-09-07T12:00:00.000Z");
    expect(rotateScimToken).toHaveBeenCalledWith("tk_1", 3_600_000, "admin1");
  });

  it("audits the rotation with the token id and the window applied", async () => {
    mockAdminSession();
    vi.mocked(rotateScimToken).mockResolvedValue({
      token: rotatedRow,
      plaintext: "tps_brand_new_value",
    } as any);

    await rotateScimTokenAction({ tokenId: "tk_1", overlapMs: 3_600_000 });

    expect(captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "ScimToken",
        entityId: "tk_1",
        metadata: expect.objectContaining({
          scimTokenRotated: true,
          overlapMs: 3_600_000,
        }),
      })
    );
  });

  it("never leaks a raw error message when the service throws", async () => {
    mockAdminSession();
    vi.mocked(rotateScimToken).mockRejectedValue(
      new Error("connection string postgres://user:pw@host/db")
    );

    const result = await rotateScimTokenAction({
      tokenId: "tk_1",
      overlapMs: 0,
    });

    expect(result).toEqual({
      success: false,
      error: "Failed to rotate SCIM token",
    });
  });
});
