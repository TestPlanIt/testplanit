import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/scim/tokens", () => ({
  mintScimToken: vi.fn(),
  revokeScimToken: vi.fn(),
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

import { Prisma } from "@prisma/client";

import { mintScimToken, revokeScimToken } from "~/lib/scim/tokens";
import { probeScimToken } from "~/lib/scim/probe";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { getServerAuthSession } from "~/server/auth";
import {
  mintScimTokenAction,
  revokeScimTokenAction,
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

    it("surfaces a friendly 'name already exists' error on P2002 without audit", async () => {
      mockAdminSession();
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        "Unique constraint failed",
        { code: "P2002", clientVersion: "test", meta: { target: ["name"] } }
      );
      vi.mocked(mintScimToken).mockRejectedValue(p2002);

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
