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
const mockWebhookConfigSecretCreate = vi.fn();
const mockWebhookConfigSecretFindMany = vi.fn();
const mockWebhookConfigSecretFindUnique = vi.fn();
const mockWebhookConfigSecretUpdate = vi.fn();
const mockTransaction = vi.fn();
vi.mock("~/lib/prisma", () => ({
  prisma: {
    webhookConfig: {
      findFirst: (...args: unknown[]) => mockWebhookConfigFindFirst(...args),
      findUnique: (...args: unknown[]) => mockWebhookConfigFindUnique(...args),
      create: (...args: unknown[]) => mockWebhookConfigCreate(...args),
      update: (...args: unknown[]) => mockWebhookConfigUpdate(...args),
      delete: (...args: unknown[]) => mockWebhookConfigDelete(...args),
    },
    webhookConfigSecret: {
      create: (...args: unknown[]) => mockWebhookConfigSecretCreate(...args),
      findMany: (...args: unknown[]) => mockWebhookConfigSecretFindMany(...args),
      findUnique: (...args: unknown[]) =>
        mockWebhookConfigSecretFindUnique(...args),
      update: (...args: unknown[]) => mockWebhookConfigSecretUpdate(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

// CR-02: server actions authorize via canManageWebhookConfig before raw writes.
// Default to "authorized" so existing tests continue to exercise the happy path;
// authorization-denial tests override to false.
const mockCanManageWebhookConfig = vi.fn();
vi.mock("~/lib/webhooks/auth", () => ({
  canManageWebhookConfig: (...args: unknown[]) =>
    mockCanManageWebhookConfig(...args),
}));

const mockEncrypt = vi.fn();
const mockDecrypt = vi.fn();
vi.mock("~/utils/encryption", () => ({
  encrypt: (...args: unknown[]) => mockEncrypt(...args),
  decrypt: (...args: unknown[]) => mockDecrypt(...args),
}));

// Phase 2 — webhookEvents.emit is called by sendTestOutboundWebhook to fire
// the synthetic webhook.test event into the outbox.
const mockWebhookEventsEmit = vi.fn();
vi.mock("~/lib/webhooks/events", () => ({
  webhookEvents: {
    emit: (...args: unknown[]) => mockWebhookEventsEmit(...args),
  },
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
    // HI-02: synthetic intent is bound to the sentinel issue.key — no
    // wire-controllable `metadata.synthetic` boolean. A real Jira can't
    // legitimately produce this key, so the synthetic path is reachable
    // only via the server-side self-loop.
    key: "__synthetic__",
    fields: { status: { name: "Synthetic Test" } },
  },
});

describe("webhook-config server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    mockGetServerAuthSession.mockResolvedValue({
      user: { id: "user-123" },
    });

    // Default: authorization passes (System Admin / Project Admin happy path).
    mockCanManageWebhookConfig.mockResolvedValue(true);

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

    it("Test 3b (HI-05/ME-03): concurrent-create race — P2002 on first INSERT triggers a single retry via the rotate path", async () => {
      // Two admins click 'Configure Jira webhook' simultaneously: both
      // findFirst() return null, both attempt create(), one wins and the
      // loser hits P2002. The loser should fall through to the
      // isUniqueConstraintError branch and rotate the now-existing row.
      const Prisma = await import("@prisma/client");
      const p2002 = new Prisma.Prisma.PrismaClientKnownRequestError(
        "Unique constraint failed",
        { code: "P2002", clientVersion: "test" }
      );
      // First findFirst (pre-create check): no row yet.
      // Second findFirst (retry-after-P2002): the winner's row.
      mockWebhookConfigFindFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "cfg-winner" });
      mockWebhookConfigCreate.mockRejectedValueOnce(p2002);
      mockWebhookConfigUpdate.mockResolvedValue({ id: "cfg-winner" });

      const result = await createOrRotateJiraWebhook(42);

      expect(result.success).toBe(true);
      expect(result.configId).toBe("cfg-winner");
      expect(mockWebhookConfigCreate).toHaveBeenCalledTimes(1);
      expect(mockWebhookConfigUpdate).toHaveBeenCalledWith({
        where: { id: "cfg-winner" },
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
      mockWebhookConfigFindUnique.mockResolvedValue({ projectId: 42 });
      mockWebhookConfigDelete.mockResolvedValue({ id: "cfg-1" });

      const result = await deleteJiraWebhook("cfg-1");

      expect(result).toEqual({ success: true });
      expect(mockWebhookConfigDelete).toHaveBeenCalledWith({
        where: { id: "cfg-1" },
      });
    });

    it("Test 4 (denial path): returns friendly error string when delete throws (raw error logged server-side per LO-04)", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({ projectId: 42 });
      mockWebhookConfigDelete.mockRejectedValue(
        new Error("delete failed at DB layer")
      );

      const result = await deleteJiraWebhook("cfg-1");

      expect(result.success).toBe(false);
      // Raw error message is NOT bubbled to client — it would leak DB
      // implementation detail. The raw error is captured server-side via
      // console.error inside the catch.
      expect(result.error).toBe("Failed to delete webhook configuration");
    });

    it("Test 4 (forbidden path): non-admin user gets a Forbidden error and delete is never invoked (CR-02)", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({ projectId: 42 });
      mockCanManageWebhookConfig.mockResolvedValueOnce(false);

      const result = await deleteJiraWebhook("cfg-1");

      expect(result).toEqual({ success: false, error: "Forbidden" });
      expect(mockWebhookConfigDelete).not.toHaveBeenCalled();
    });

    it("Test 4 (unauth): returns Unauthorized when session missing", async () => {
      mockGetServerAuthSession.mockResolvedValue(null);

      const result = await deleteJiraWebhook("cfg-1");

      expect(result).toEqual({ success: false, error: "Unauthorized" });
      expect(mockWebhookConfigDelete).not.toHaveBeenCalled();
    });
  });

  describe("setWebhookActive (CR-02 — replaces ZenStack RPC update)", () => {
    it("happy path: project admin toggles isActive=false, raw prisma.update is invoked with the correct shape", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({ projectId: 42 });
      mockWebhookConfigUpdate.mockResolvedValue({ id: "cfg-1" });
      const { setWebhookActive } = await import("./webhook-config");

      const result = await setWebhookActive("cfg-1", false);

      expect(result).toEqual({ success: true });
      expect(mockWebhookConfigUpdate).toHaveBeenCalledWith({
        where: { id: "cfg-1" },
        data: { isActive: false },
      });
    });

    it("forbidden path: non-admin user gets Forbidden error and update is never invoked", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({ projectId: 42 });
      mockCanManageWebhookConfig.mockResolvedValueOnce(false);
      const { setWebhookActive } = await import("./webhook-config");

      const result = await setWebhookActive("cfg-1", true);

      expect(result).toEqual({ success: false, error: "Forbidden" });
      expect(mockWebhookConfigUpdate).not.toHaveBeenCalled();
    });

    it("unauth: returns Unauthorized when session missing", async () => {
      mockGetServerAuthSession.mockResolvedValue(null);
      const { setWebhookActive } = await import("./webhook-config");

      const result = await setWebhookActive("cfg-1", true);

      expect(result).toEqual({ success: false, error: "Unauthorized" });
      expect(mockWebhookConfigUpdate).not.toHaveBeenCalled();
    });

    it("not-found: missing config returns 'Not found' and update is never invoked", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue(null);
      const { setWebhookActive } = await import("./webhook-config");

      const result = await setWebhookActive("cfg-missing", true);

      expect(result).toEqual({ success: false, error: "Not found" });
      expect(mockWebhookConfigUpdate).not.toHaveBeenCalled();
    });

    it("update failure → friendly error string (raw error logged via console.error per LO-04)", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({ projectId: 42 });
      mockWebhookConfigUpdate.mockRejectedValue(
        new Error("constraint violation")
      );
      const { setWebhookActive } = await import("./webhook-config");

      const result = await setWebhookActive("cfg-1", false);

      expect(result).toEqual({
        success: false,
        error: "Failed to update webhook configuration",
      });
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

    // ─── Test 9: HI-02 sentinel issue.key in synthetic payload ───────────
    it("Test 9 (HI-02): synthetic payload uses sentinel issue.key='__synthetic__' and contains NO wire-supplied metadata.synthetic boolean", async () => {
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
      // Synthetic intent is bound to the issue.key sentinel.
      expect(parsed.issue.key).toBe("__synthetic__");
      // The wire-controllable metadata.synthetic boolean MUST NOT be present —
      // the receiver-side adapter ignores it for non-sentinel keys, and we
      // don't want a misleading marker on the wire that could confuse log
      // analysis or external observers.
      expect(parsed.metadata).toBeUndefined();
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

  // =========================================================================
  // v0.23.0 Phase 2 — Outbound webhook server actions (Plan 02-06)
  // =========================================================================

  describe("createOutboundWebhook (Phase 2)", () => {
    beforeEach(() => {
      delete process.env.WEBHOOK_OUTBOUND_ALLOW_HTTP;
    });

    it("returns Unauthorized when session is missing", async () => {
      mockGetServerAuthSession.mockResolvedValue(null);
      const { createOutboundWebhook } = await import("./webhook-config");

      const result = await createOutboundWebhook({
        projectId: 42,
        name: "My Hook",
        url: "https://example.com/hook",
      });

      expect(result).toEqual({ success: false, error: "Unauthorized" });
      expect(mockWebhookConfigCreate).not.toHaveBeenCalled();
    });

    it("Blocker 4: rejects when name is empty/whitespace with 'Name is required'", async () => {
      const { createOutboundWebhook } = await import("./webhook-config");

      const r1 = await createOutboundWebhook({
        projectId: 42,
        name: "",
        url: "https://example.com/hook",
      });
      const r2 = await createOutboundWebhook({
        projectId: 42,
        name: "   ",
        url: "https://example.com/hook",
      });

      expect(r1).toEqual({ success: false, error: "Name is required" });
      expect(r2).toEqual({ success: false, error: "Name is required" });
      expect(mockWebhookConfigCreate).not.toHaveBeenCalled();
    });

    it("rejects with 'Forbidden' when canManageWebhookConfig returns false", async () => {
      mockCanManageWebhookConfig.mockResolvedValueOnce(false);
      const { createOutboundWebhook } = await import("./webhook-config");

      const result = await createOutboundWebhook({
        projectId: 42,
        name: "My Hook",
        url: "https://example.com/hook",
      });

      expect(result).toEqual({ success: false, error: "Forbidden" });
      expect(mockWebhookConfigCreate).not.toHaveBeenCalled();
    });

    it("rejects invalid URLs with 'Invalid URL'", async () => {
      const { createOutboundWebhook } = await import("./webhook-config");

      const result = await createOutboundWebhook({
        projectId: 42,
        name: "My Hook",
        url: "not-a-url",
      });

      expect(result).toEqual({ success: false, error: "Invalid URL" });
      expect(mockWebhookConfigCreate).not.toHaveBeenCalled();
    });

    it("rejects http:// URLs with 'URL must use HTTPS' when ALLOW_HTTP_OUTBOUND is unset", async () => {
      const { createOutboundWebhook } = await import("./webhook-config");

      const result = await createOutboundWebhook({
        projectId: 42,
        name: "My Hook",
        url: "http://example.com/hook",
      });

      expect(result).toEqual({ success: false, error: "URL must use HTTPS" });
      expect(mockWebhookConfigCreate).not.toHaveBeenCalled();
    });

    it("E2E override: accepts http:// URLs when WEBHOOK_OUTBOUND_ALLOW_HTTP=true", async () => {
      process.env.WEBHOOK_OUTBOUND_ALLOW_HTTP = "true";
      // Re-import after env mutation so the module-level constant picks up.
      vi.resetModules();
      mockTransaction.mockImplementation(async (fn: any) =>
        fn({
          webhookConfig: {
            create: (args: any) => mockWebhookConfigCreate(args),
          },
          webhookConfigSecret: {
            create: (args: any) => mockWebhookConfigSecretCreate(args),
          },
        })
      );
      mockWebhookConfigCreate.mockResolvedValue({ id: "cfg-http" });
      mockWebhookConfigSecretCreate.mockResolvedValue({ id: "sec-http" });

      const { createOutboundWebhook } = await import("./webhook-config");
      const result = await createOutboundWebhook({
        projectId: 42,
        name: "Local Stub",
        url: "http://localhost:9999/hook",
      });

      expect(result.success).toBe(true);
      expect(result.configId).toBe("cfg-http");
      delete process.env.WEBHOOK_OUTBOUND_ALLOW_HTTP;
    });

    it("Slack URL: auto-detects adapterType=SLACK, sets secret='', NO WebhookConfigSecret row, persists name+url (Blocker 4)", async () => {
      mockWebhookConfigCreate.mockResolvedValue({ id: "cfg-slack" });
      const { createOutboundWebhook } = await import("./webhook-config");

      const result = await createOutboundWebhook({
        projectId: 42,
        name: "  Team Slack  ", // whitespace should be trimmed
        url: "https://hooks.slack.com/services/T000/B000/abc",
      });

      expect(result.success).toBe(true);
      expect(result.configId).toBe("cfg-slack");
      expect(result.secret).toBeUndefined();

      expect(mockWebhookConfigCreate).toHaveBeenCalledTimes(1);
      const callArg = mockWebhookConfigCreate.mock.calls[0][0];
      expect(callArg.data).toMatchObject({
        projectId: 42,
        adapterType: "SLACK",
        direction: "OUTBOUND",
        secret: "", // Slack URL is the credential (D-18)
        name: "Team Slack", // trimmed
        url: "https://hooks.slack.com/services/T000/B000/abc",
        isActive: true,
      });
      expect(callArg.data.subscribedEvents).toEqual([
        "test_run.completed",
        "issue.created",
      ]);
      // No secret row for Slack
      expect(mockWebhookConfigSecretCreate).not.toHaveBeenCalled();
    });

    it("Slack URL: maps unique-constraint error to friendly message", async () => {
      const Prisma = await import("@prisma/client");
      const p2002 = new Prisma.Prisma.PrismaClientKnownRequestError(
        "Unique constraint failed",
        { code: "P2002", clientVersion: "test" }
      );
      mockWebhookConfigCreate.mockRejectedValueOnce(p2002);
      const { createOutboundWebhook } = await import("./webhook-config");

      const result = await createOutboundWebhook({
        projectId: 42,
        name: "Team Slack",
        url: "https://hooks.slack.com/services/T000/B000/abc",
      });

      expect(result).toEqual({
        success: false,
        error: "An outbound Slack webhook for this project already exists",
      });
    });

    it("Generic-HMAC URL: detects GENERIC_HMAC, creates WebhookConfigSecret row, returns plaintext secret, persists name+url (Blocker 4)", async () => {
      // Arrange: $transaction calls back with a tx client mock.
      mockTransaction.mockImplementation(async (fn: any) =>
        fn({
          webhookConfig: {
            create: (args: any) => mockWebhookConfigCreate(args),
          },
          webhookConfigSecret: {
            create: (args: any) => mockWebhookConfigSecretCreate(args),
          },
        })
      );
      mockWebhookConfigCreate.mockResolvedValue({ id: "cfg-hmac" });
      mockWebhookConfigSecretCreate.mockResolvedValue({ id: "sec-1" });

      const { createOutboundWebhook } = await import("./webhook-config");
      const result = await createOutboundWebhook({
        projectId: 42,
        name: "Custom HMAC",
        url: "https://example.com/webhooks/in",
      });

      expect(result.success).toBe(true);
      expect(result.configId).toBe("cfg-hmac");
      expect(result.secret).toBeTruthy();
      // Plaintext, not encrypted blob
      expect(result.secret!.startsWith("enc:")).toBe(false);

      // Config create payload — Blocker 4 — name and url persisted into columns.
      const cfgCallArg = mockWebhookConfigCreate.mock.calls[0][0];
      expect(cfgCallArg.data).toMatchObject({
        projectId: 42,
        adapterType: "GENERIC_HMAC",
        direction: "OUTBOUND",
        name: "Custom HMAC",
        url: "https://example.com/webhooks/in",
        isActive: true,
      });
      expect(cfgCallArg.data.secret).toBe(`enc:${result.secret}`);

      // Secret row created with same encrypted secret
      expect(mockWebhookConfigSecretCreate).toHaveBeenCalledTimes(1);
      const secCallArg = mockWebhookConfigSecretCreate.mock.calls[0][0];
      expect(secCallArg.data).toMatchObject({
        webhookConfigId: "cfg-hmac",
        secret: `enc:${result.secret}`,
      });
      expect(secCallArg.data.activatedAt).toBeInstanceOf(Date);
    });

    it("respects custom subscribedEvents when provided", async () => {
      mockWebhookConfigCreate.mockResolvedValue({ id: "cfg-slack-2" });
      const { createOutboundWebhook } = await import("./webhook-config");

      await createOutboundWebhook({
        projectId: 42,
        name: "Team Slack",
        url: "https://hooks.slack.com/services/T1/B1/zzz",
        subscribedEvents: ["test_run.state_changed"],
      });

      const callArg = mockWebhookConfigCreate.mock.calls[0][0];
      expect(callArg.data.subscribedEvents).toEqual([
        "test_run.state_changed",
      ]);
    });
  });

  describe("deleteOutboundWebhook (Phase 2)", () => {
    it("returns Unauthorized when session missing", async () => {
      mockGetServerAuthSession.mockResolvedValue(null);
      const { deleteOutboundWebhook } = await import("./webhook-config");

      const result = await deleteOutboundWebhook("cfg-1");

      expect(result).toEqual({ success: false, error: "Unauthorized" });
      expect(mockWebhookConfigDelete).not.toHaveBeenCalled();
    });

    it("returns 'Not found' when config doesn't exist", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue(null);
      const { deleteOutboundWebhook } = await import("./webhook-config");

      const result = await deleteOutboundWebhook("cfg-missing");

      expect(result).toEqual({ success: false, error: "Not found" });
      expect(mockWebhookConfigDelete).not.toHaveBeenCalled();
    });

    it("rejects INBOUND configs with 'Not an outbound webhook'", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        projectId: 42,
        direction: "INBOUND",
      });
      const { deleteOutboundWebhook } = await import("./webhook-config");

      const result = await deleteOutboundWebhook("cfg-inbound");

      expect(result).toEqual({
        success: false,
        error: "Not an outbound webhook",
      });
      expect(mockWebhookConfigDelete).not.toHaveBeenCalled();
    });

    it("happy path: deletes the config", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        projectId: 42,
        direction: "OUTBOUND",
      });
      mockWebhookConfigDelete.mockResolvedValue({ id: "cfg-1" });
      const { deleteOutboundWebhook } = await import("./webhook-config");

      const result = await deleteOutboundWebhook("cfg-1");

      expect(result).toEqual({ success: true });
      expect(mockWebhookConfigDelete).toHaveBeenCalledWith({
        where: { id: "cfg-1" },
      });
    });
  });

  describe("updateOutboundSubscriptions (Phase 2)", () => {
    it("returns Unauthorized when session missing", async () => {
      mockGetServerAuthSession.mockResolvedValue(null);
      const { updateOutboundSubscriptions } = await import("./webhook-config");

      const result = await updateOutboundSubscriptions("cfg-1", ["a"]);

      expect(result).toEqual({ success: false, error: "Unauthorized" });
    });

    it("rejects non-array argument with type-guard error", async () => {
      const { updateOutboundSubscriptions } = await import("./webhook-config");

      // @ts-expect-error testing runtime guard
      const result = await updateOutboundSubscriptions("cfg-1", "not-array");

      expect(result).toEqual({
        success: false,
        error: "subscribedEvents must be an array",
      });
    });

    it("happy path: updates subscribedEvents column", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        projectId: 42,
        direction: "OUTBOUND",
      });
      mockWebhookConfigUpdate.mockResolvedValue({ id: "cfg-1" });
      const { updateOutboundSubscriptions } = await import("./webhook-config");

      const events = ["issue.created", "test_run.state_changed"];
      const result = await updateOutboundSubscriptions("cfg-1", events);

      expect(result).toEqual({ success: true });
      expect(mockWebhookConfigUpdate).toHaveBeenCalledWith({
        where: { id: "cfg-1" },
        data: { subscribedEvents: events },
      });
    });
  });

  // =========================================================================
  // v0.23.0 Phase 2 / Task 6.2 — Two-secret rotation lifecycle (D-04..D-06)
  // =========================================================================

  describe("rotateOutboundSecret (Phase 2)", () => {
    function buildTxMock() {
      return {
        webhookConfigSecret: {
          findMany: (args: any) =>
            mockWebhookConfigSecretFindMany(args),
          create: (args: any) => mockWebhookConfigSecretCreate(args),
          update: (args: any) => mockWebhookConfigSecretUpdate(args),
        },
        webhookConfig: {
          update: (args: any) => mockWebhookConfigUpdate(args),
        },
      };
    }

    it("returns Unauthorized when session missing", async () => {
      mockGetServerAuthSession.mockResolvedValue(null);
      const { rotateOutboundSecret } = await import("./webhook-config");

      const result = await rotateOutboundSecret("cfg-1");

      expect(result).toEqual({ success: false, error: "Unauthorized" });
    });

    it("rejects INBOUND configs", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        projectId: 42,
        direction: "INBOUND",
        adapterType: "JIRA",
      });
      const { rotateOutboundSecret } = await import("./webhook-config");

      const result = await rotateOutboundSecret("cfg-jira");

      expect(result).toEqual({
        success: false,
        error: "Not an outbound webhook",
      });
    });

    it("rejects SLACK configs (no rotatable secret)", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        projectId: 42,
        direction: "OUTBOUND",
        adapterType: "SLACK",
      });
      const { rotateOutboundSecret } = await import("./webhook-config");

      const result = await rotateOutboundSecret("cfg-slack");

      expect(result).toEqual({
        success: false,
        error: "Slack webhooks do not have a rotatable secret",
      });
    });

    it("steady-state: demotes prior active with autoRetireAt ≈ now+7d, creates new active, updates WebhookConfig.secret", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        projectId: 42,
        direction: "OUTBOUND",
        adapterType: "GENERIC_HMAC",
      });
      mockTransaction.mockImplementation(async (fn: any) =>
        fn(buildTxMock())
      );
      mockWebhookConfigSecretFindMany.mockResolvedValue([
        { id: "sec-old" },
      ]);
      mockWebhookConfigSecretUpdate.mockResolvedValue({ id: "sec-old" });
      mockWebhookConfigSecretCreate.mockResolvedValue({ id: "sec-new" });
      mockWebhookConfigUpdate.mockResolvedValue({ id: "cfg-1" });

      const before = Date.now();
      const { rotateOutboundSecret } = await import("./webhook-config");
      const result = await rotateOutboundSecret("cfg-1");
      const after = Date.now();

      expect(result.success).toBe(true);
      expect(result.secret).toBeTruthy();
      expect(result.secret!.startsWith("enc:")).toBe(false);

      // Demote old: autoRetireAt set
      expect(mockWebhookConfigSecretUpdate).toHaveBeenCalledTimes(1);
      const demoteCall = mockWebhookConfigSecretUpdate.mock.calls[0][0];
      expect(demoteCall.where).toEqual({ id: "sec-old" });
      const ts = (demoteCall.data.autoRetireAt as Date).getTime();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      expect(ts).toBeGreaterThanOrEqual(before + sevenDays - 1);
      expect(ts).toBeLessThanOrEqual(after + sevenDays + 1);

      // Create new active
      expect(mockWebhookConfigSecretCreate).toHaveBeenCalledTimes(1);
      const createCall = mockWebhookConfigSecretCreate.mock.calls[0][0];
      expect(createCall.data).toMatchObject({
        webhookConfigId: "cfg-1",
        secret: `enc:${result.secret}`,
      });
      expect(createCall.data.activatedAt).toBeInstanceOf(Date);

      // WebhookConfig.secret kept in sync
      expect(mockWebhookConfigUpdate).toHaveBeenCalledWith({
        where: { id: "cfg-1" },
        data: { secret: `enc:${result.secret}` },
      });
    });

    it("zero-active recovery: no demotion when no active exists; just creates new", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        projectId: 42,
        direction: "OUTBOUND",
        adapterType: "GENERIC_HMAC",
      });
      mockTransaction.mockImplementation(async (fn: any) =>
        fn(buildTxMock())
      );
      mockWebhookConfigSecretFindMany.mockResolvedValue([]); // zero active
      mockWebhookConfigSecretCreate.mockResolvedValue({ id: "sec-new" });
      mockWebhookConfigUpdate.mockResolvedValue({ id: "cfg-1" });

      const { rotateOutboundSecret } = await import("./webhook-config");
      const result = await rotateOutboundSecret("cfg-1");

      expect(result.success).toBe(true);
      expect(mockWebhookConfigSecretUpdate).not.toHaveBeenCalled();
      expect(mockWebhookConfigSecretCreate).toHaveBeenCalledTimes(1);
    });

    it("multiple-active corruption: returns 'Multiple active secrets — contact support'", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        projectId: 42,
        direction: "OUTBOUND",
        adapterType: "GENERIC_HMAC",
      });
      mockTransaction.mockImplementation(async (fn: any) =>
        fn(buildTxMock())
      );
      mockWebhookConfigSecretFindMany.mockResolvedValue([
        { id: "sec-a" },
        { id: "sec-b" },
      ]);

      const { rotateOutboundSecret } = await import("./webhook-config");
      const result = await rotateOutboundSecret("cfg-corrupt");

      expect(result).toEqual({
        success: false,
        error: "Multiple active secrets — contact support",
      });
    });
  });

  describe("retireOutboundSecretNow (Phase 2)", () => {
    it("returns Unauthorized when session missing", async () => {
      mockGetServerAuthSession.mockResolvedValue(null);
      const { retireOutboundSecretNow } = await import("./webhook-config");

      const result = await retireOutboundSecretNow("sec-1");

      expect(result).toEqual({ success: false, error: "Unauthorized" });
    });

    it("rejects retiring the active secret with 'rotate first'", async () => {
      mockWebhookConfigSecretFindUnique.mockResolvedValue({
        id: "sec-active",
        retiredAt: null,
        autoRetireAt: null, // active = both null
        webhookConfig: { projectId: 42 },
      });
      const { retireOutboundSecretNow } = await import("./webhook-config");

      const result = await retireOutboundSecretNow("sec-active");

      expect(result).toEqual({
        success: false,
        error: "Cannot retire the active secret — rotate first",
      });
      expect(mockWebhookConfigSecretUpdate).not.toHaveBeenCalled();
    });

    it("rejects an already-retired secret with 'Already retired'", async () => {
      mockWebhookConfigSecretFindUnique.mockResolvedValue({
        id: "sec-old",
        retiredAt: new Date(),
        autoRetireAt: new Date(),
        webhookConfig: { projectId: 42 },
      });
      const { retireOutboundSecretNow } = await import("./webhook-config");

      const result = await retireOutboundSecretNow("sec-old");

      expect(result).toEqual({ success: false, error: "Already retired" });
      expect(mockWebhookConfigSecretUpdate).not.toHaveBeenCalled();
    });

    it("happy path: retires a retiring secret (sets retiredAt = now)", async () => {
      mockWebhookConfigSecretFindUnique.mockResolvedValue({
        id: "sec-retiring",
        retiredAt: null,
        autoRetireAt: new Date(Date.now() + 86400000),
        webhookConfig: { projectId: 42 },
      });
      mockWebhookConfigSecretUpdate.mockResolvedValue({ id: "sec-retiring" });
      const { retireOutboundSecretNow } = await import("./webhook-config");

      const result = await retireOutboundSecretNow("sec-retiring");

      expect(result).toEqual({ success: true });
      expect(mockWebhookConfigSecretUpdate).toHaveBeenCalledTimes(1);
      const call = mockWebhookConfigSecretUpdate.mock.calls[0][0];
      expect(call.where).toEqual({ id: "sec-retiring" });
      expect(call.data.retiredAt).toBeInstanceOf(Date);
    });
  });

  describe("extendRetiringSecret (Phase 2)", () => {
    it("returns Unauthorized when session missing", async () => {
      mockGetServerAuthSession.mockResolvedValue(null);
      const { extendRetiringSecret } = await import("./webhook-config");

      const result = await extendRetiringSecret("sec-1");

      expect(result).toEqual({ success: false, error: "Unauthorized" });
    });

    it("rejects extending an active secret", async () => {
      mockWebhookConfigSecretFindUnique.mockResolvedValue({
        id: "sec-active",
        retiredAt: null,
        autoRetireAt: null,
        webhookConfig: { projectId: 42 },
      });
      const { extendRetiringSecret } = await import("./webhook-config");

      const result = await extendRetiringSecret("sec-active");

      expect(result).toEqual({
        success: false,
        error: "Cannot extend the active secret",
      });
    });

    it("happy path: adds 7 days to autoRetireAt", async () => {
      const oldExpiry = new Date(Date.UTC(2026, 4, 1));
      mockWebhookConfigSecretFindUnique.mockResolvedValue({
        id: "sec-retiring",
        retiredAt: null,
        autoRetireAt: oldExpiry,
        webhookConfig: { projectId: 42 },
      });
      mockWebhookConfigSecretUpdate.mockResolvedValue({ id: "sec-retiring" });
      const { extendRetiringSecret } = await import("./webhook-config");

      const result = await extendRetiringSecret("sec-retiring");

      expect(result.success).toBe(true);
      expect(result.newAutoRetireAt).toBeInstanceOf(Date);
      const expected = new Date(
        oldExpiry.getTime() + 7 * 24 * 60 * 60 * 1000
      );
      expect(result.newAutoRetireAt!.getTime()).toBe(expected.getTime());

      const call = mockWebhookConfigSecretUpdate.mock.calls[0][0];
      expect(call.where).toEqual({ id: "sec-retiring" });
      expect((call.data.autoRetireAt as Date).getTime()).toBe(
        expected.getTime()
      );
    });
  });
});
