import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

// ─── Mocks ────────────────────────────────────────────────────────────────

const mockGetServerAuthSession = vi.fn();
vi.mock("~/server/auth", () => ({
  getServerAuthSession: () => mockGetServerAuthSession(),
}));

const mockWebhookConfigFindFirst = vi.fn();
const mockWebhookConfigFindUnique = vi.fn();
const mockWebhookConfigCreate = vi.fn();
const mockWebhookConfigUpdate = vi.fn();
const mockWebhookConfigDelete = vi.fn();
const mockGetEnhancedDb = vi.fn();
vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: (...args: unknown[]) => mockGetEnhancedDb(...args),
}));

const mockEncrypt = vi.fn();
const mockDecrypt = vi.fn();
vi.mock("~/utils/encryption", () => ({
  encrypt: (...args: unknown[]) => mockEncrypt(...args),
  decrypt: (...args: unknown[]) => mockDecrypt(...args),
}));

// Capture original fetch, install a vitest spy default.
const originalFetch = globalThis.fetch;
let fetchSpy: ReturnType<typeof vi.fn>;

import {
  createOrRotateJiraWebhook,
  deleteJiraWebhook,
  sendTestWebhook,
} from "./webhook-config";

// The byte-identical synthetic payload literal — copy of the constant in the
// source file. Test #8 asserts byte-equality between two calls' fetch bodies
// AND that the body equals this literal. If the source ever drifts (e.g.,
// someone adds Date.now()), the unit tests fail BEFORE the SC#5 demo runs.
const EXPECTED_SYNTHETIC_PAYLOAD = JSON.stringify({
  webhookEvent: "jira:issue_updated",
  issue: {
    key: "FAKE-9999",
    fields: { status: { name: "Synthetic Test" } },
  },
  metadata: { synthetic: true },
});

describe("webhook-config server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    mockGetServerAuthSession.mockResolvedValue({
      user: { id: "user-123" },
    });

    mockGetEnhancedDb.mockResolvedValue({
      webhookConfig: {
        findFirst: mockWebhookConfigFindFirst,
        findUnique: mockWebhookConfigFindUnique,
        create: mockWebhookConfigCreate,
        update: mockWebhookConfigUpdate,
        delete: mockWebhookConfigDelete,
      },
    });

    mockEncrypt.mockImplementation(async (s: string) => `enc:${s}`);
    mockDecrypt.mockImplementation(async (s: string) =>
      s.startsWith("enc:") ? s.slice(4) : s
    );

    process.env.NEXTAUTH_URL = "https://app.example.test";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  // ─── Test 1: createOrRotateJiraWebhook — unauthorized ────────────────────
  describe("createOrRotateJiraWebhook", () => {
    it("Test 1: returns Unauthorized when session is missing", async () => {
      mockGetServerAuthSession.mockResolvedValue(null);

      const result = await createOrRotateJiraWebhook(42);

      expect(result).toEqual({ success: false, error: "Unauthorized" });
      expect(mockWebhookConfigCreate).not.toHaveBeenCalled();
      expect(mockWebhookConfigUpdate).not.toHaveBeenCalled();
    });

    // ─── Test 2: createOrRotate — fresh create ────────────────────────────
    it("Test 2: creates a new row when no existing config (URL contains whk_<64-hex>; secret is plaintext)", async () => {
      mockWebhookConfigFindFirst.mockResolvedValue(null);
      mockWebhookConfigCreate.mockResolvedValue({ id: "cfg-new-1" });

      const result = await createOrRotateJiraWebhook(42);

      expect(result.success).toBe(true);
      expect(result.configId).toBe("cfg-new-1");
      // URL contains whk_ + 64 hex chars (D-05 token shape).
      expect(result.url).toMatch(
        /^https:\/\/app\.example\.test\/api\/webhooks\/whk_[0-9a-f]{64}$/
      );
      // Secret is plaintext (NOT the encrypted blob with `enc:` prefix).
      expect(result.secret).toBeTruthy();
      expect(result.secret!.startsWith("enc:")).toBe(false);

      // Encrypt was called with the plaintext, and the create stored the encrypted form.
      expect(mockEncrypt).toHaveBeenCalledWith(result.secret);
      expect(mockWebhookConfigCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: 42,
          adapterType: "JIRA",
          direction: "INBOUND",
          isActive: true,
          token: expect.stringMatching(/^whk_[0-9a-f]{64}$/),
          secret: `enc:${result.secret}`,
        }),
        select: { id: true },
      });
    });

    // ─── Test 3: createOrRotate — rotate existing ─────────────────────────
    it("Test 3: rotates existing row (D-07 hard cutover — old token NOT preserved)", async () => {
      mockWebhookConfigFindFirst.mockResolvedValue({ id: "cfg-existing" });
      mockWebhookConfigUpdate.mockResolvedValue({ id: "cfg-existing" });

      const result = await createOrRotateJiraWebhook(42);

      expect(result.success).toBe(true);
      expect(result.configId).toBe("cfg-existing");
      expect(mockWebhookConfigCreate).not.toHaveBeenCalled();
      expect(mockWebhookConfigUpdate).toHaveBeenCalledWith({
        where: { id: "cfg-existing" },
        data: expect.objectContaining({
          token: expect.stringMatching(/^whk_[0-9a-f]{64}$/),
          secret: expect.stringMatching(/^enc:/),
          isActive: true,
        }),
        select: { id: true },
      });
    });
  });

  describe("deleteJiraWebhook", () => {
    // ─── Test 4: deleteJiraWebhook ────────────────────────────────────────
    it("Test 4 (happy path): returns success", async () => {
      mockWebhookConfigDelete.mockResolvedValue({ id: "cfg-1" });

      const result = await deleteJiraWebhook("cfg-1");

      expect(result).toEqual({ success: true });
      expect(mockWebhookConfigDelete).toHaveBeenCalledWith({
        where: { id: "cfg-1" },
      });
    });

    it("Test 4 (denial path): returns friendly error string when ZenStack policy denies (raw error logged server-side per LO-04)", async () => {
      mockWebhookConfigDelete.mockRejectedValue(
        new Error("denied by policy: cannot delete")
      );

      const result = await deleteJiraWebhook("cfg-1");

      expect(result.success).toBe(false);
      // Raw error message is NOT bubbled to client — it would leak policy
      // implementation detail. The raw error is captured server-side via
      // console.error inside the catch (verified by tests in earlier rounds).
      expect(result.error).toBe("Failed to delete webhook configuration");
    });

    it("Test 4 (unauth): returns Unauthorized when session missing", async () => {
      mockGetServerAuthSession.mockResolvedValue(null);

      const result = await deleteJiraWebhook("cfg-1");

      expect(result).toEqual({ success: false, error: "Unauthorized" });
      expect(mockWebhookConfigDelete).not.toHaveBeenCalled();
    });
  });

  describe("sendTestWebhook", () => {
    const FIXTURE_TOKEN = "whk_" + "a".repeat(64);
    const FIXTURE_SECRET_PLAIN = "secret-plain";
    const FIXTURE_SECRET_ENC = `enc:${FIXTURE_SECRET_PLAIN}`;

    function expectedSignature(): string {
      return (
        "sha256=" +
        createHmac("sha256", FIXTURE_SECRET_PLAIN)
          .update(EXPECTED_SYNTHETIC_PAYLOAD)
          .digest("hex")
      );
    }

    // ─── Test 5: auth ─────────────────────────────────────────────────────
    it("Test 5: returns 401 when session is missing", async () => {
      mockGetServerAuthSession.mockResolvedValue(null);

      const result = await sendTestWebhook("cfg-1");

      expect(result).toEqual({
        ok: false,
        statusCode: 401,
        error: "Unauthorized",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    // ─── Test 6: not found ────────────────────────────────────────────────
    it("Test 6: returns 404 when config not found", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue(null);

      const result = await sendTestWebhook("cfg-missing");

      expect(result).toEqual({
        ok: false,
        statusCode: 404,
        error: "Not found",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    // ─── Test 7: happy path FIRST CALL (synthetic) ────────────────────────
    it("Test 7: first call signs SYNTHETIC_PAYLOAD bytes and forwards 'synthetic'", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        token: FIXTURE_TOKEN,
        secret: FIXTURE_SECRET_ENC,
        projectId: 42,
      });
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ outcome: "synthetic" }),
      });

      const result = await sendTestWebhook("cfg-1");

      expect(result).toEqual({
        ok: true,
        statusCode: 200,
        outcome: "synthetic",
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe(
        `https://app.example.test/api/webhooks/${FIXTURE_TOKEN}`
      );
      expect(init).toMatchObject({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": expectedSignature(),
        },
      });
      // Body bytes EQUAL the literal synthetic payload (BLOCKER #5).
      expect(init.body).toBe(EXPECTED_SYNTHETIC_PAYLOAD);
    });

    // ─── Test 8: SC#5 demo lock — second call body byte-identical ─────────
    it("Test 8 (SC#5 demo lock): two consecutive calls produce BYTE-IDENTICAL fetch bodies; second forwards 'duplicate'", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        token: FIXTURE_TOKEN,
        secret: FIXTURE_SECRET_ENC,
        projectId: 42,
      });

      fetchSpy
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ outcome: "synthetic" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ outcome: "duplicate" }),
        });

      const r1 = await sendTestWebhook("cfg-1");
      const r2 = await sendTestWebhook("cfg-1");

      expect(r1.outcome).toBe("synthetic");
      expect(r2.outcome).toBe("duplicate");

      const callOneBody = fetchSpy.mock.calls[0][1].body as string;
      const callTwoBody = fetchSpy.mock.calls[1][1].body as string;

      // BLOCKER #5: byte-identical across clicks. If a Date.now/nonce/random ever
      // sneaks into SYNTHETIC_PAYLOAD, this assertion catches it before demo day.
      expect(callOneBody).toBe(callTwoBody);
      expect(callOneBody).toBe(EXPECTED_SYNTHETIC_PAYLOAD);

      // And the signature must also be identical (signed over the same bytes).
      const sig1 = (
        fetchSpy.mock.calls[0][1].headers as Record<string, string>
      )["x-hub-signature-256"];
      const sig2 = (
        fetchSpy.mock.calls[1][1].headers as Record<string, string>
      )["x-hub-signature-256"];
      expect(sig1).toBe(sig2);
      expect(sig1).toBe(expectedSignature());
    });

    // ─── Test 9: D-20 sentinel propagated ────────────────────────────────
    it("Test 9: synthetic payload contains metadata.synthetic === true (D-20 sentinel)", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        token: FIXTURE_TOKEN,
        secret: FIXTURE_SECRET_ENC,
        projectId: 42,
      });
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ outcome: "synthetic" }),
      });

      await sendTestWebhook("cfg-1");

      const body = fetchSpy.mock.calls[0][1].body as string;
      const parsed = JSON.parse(body);
      expect(parsed.metadata).toEqual({ synthetic: true });
    });

    // ─── Test 10: fetch throws → returned as { ok: false, statusCode: 0 } ─
    it("Test 10: fetch throws (network error) → ok=false, statusCode=0, error preserved", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        token: FIXTURE_TOKEN,
        secret: FIXTURE_SECRET_ENC,
        projectId: 42,
      });
      fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));

      const result = await sendTestWebhook("cfg-1");

      expect(result.ok).toBe(false);
      expect(result.statusCode).toBe(0);
      expect(result.error).toContain("ECONNREFUSED");
    });
  });
});
