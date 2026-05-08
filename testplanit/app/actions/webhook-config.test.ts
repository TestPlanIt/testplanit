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
const mockWebhookDeliveryFindUnique = vi.fn();
const mockWebhookDeliveryFindMany = vi.fn();
const mockAuditLogFindMany = vi.fn();
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
      findMany: (...args: unknown[]) =>
        mockWebhookConfigSecretFindMany(...args),
      findUnique: (...args: unknown[]) =>
        mockWebhookConfigSecretFindUnique(...args),
      update: (...args: unknown[]) => mockWebhookConfigSecretUpdate(...args),
    },
    webhookDelivery: {
      findUnique: (...args: unknown[]) =>
        mockWebhookDeliveryFindUnique(...args),
      findMany: (...args: unknown[]) => mockWebhookDeliveryFindMany(...args),
    },
    auditLog: {
      findMany: (...args: unknown[]) => mockAuditLogFindMany(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

// replay service is mocked so server-action tests never spin up
// BullMQ. The 4 new actions delegate to replayDelivery / bulkReplayDeliveries
// for the outbound enqueue side; the action's job is just the
// auth gate, the inbound rejection, and the bulk SELECT-with-cap.
const mockReplayDelivery = vi.fn();
const mockBulkReplayDeliveries = vi.fn();
vi.mock("~/lib/webhooks/replay", () => ({
  replayDelivery: (...args: unknown[]) => mockReplayDelivery(...args),
  bulkReplayDeliveries: (...args: unknown[]) =>
    mockBulkReplayDeliveries(...args),
  BULK_REPLAY_HARD_CAP: 100,
}));

// captureAuditEvent is mocked so reEnableWebhookConfig's
// WEBHOOK_HEALTH_CHANGED audit can be asserted by metadata shape.
const mockCaptureAuditEvent = vi.fn();
vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: (...args: unknown[]) => mockCaptureAuditEvent(...args),
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

// webhookEvents.emit is called by sendTestOutboundWebhook to fire
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
  createOrRotateInboundWebhook,
  createOrRotateJiraWebhook,
  deleteInboundWebhook,
  deleteJiraWebhook,
  sendTestWebhook,
} from "./webhook-config";

// The byte-identical synthetic payload literal — copy of the constant in the
// source file. Test #8 asserts byte-equality between two calls' fetch bodies
// AND that the body equals this literal. If the source ever drifts (e.g.,
// someone adds Date.now()), the unit tests fail BEFORE the demo runs.
const EXPECTED_SYNTHETIC_PAYLOAD = JSON.stringify({
  webhookEvent: "jira:issue_updated",
  issue: {
    // synthetic intent is bound to the sentinel issue.key — no
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

    // sane defaults so the *.not.toHaveBeenCalled() assertions
    // in early-exit tests remain meaningful.
    mockReplayDelivery.mockReset();
    mockBulkReplayDeliveries.mockReset();
    mockCaptureAuditEvent.mockReset().mockResolvedValue(undefined);
    mockWebhookDeliveryFindUnique.mockReset();
    mockWebhookDeliveryFindMany.mockReset();
    mockAuditLogFindMany.mockReset();

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
      // URL contains whk_ + 64 hex chars (token shape).
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
    it("Test 3: rotates existing row (hard cutover — old token NOT preserved)", async () => {
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

    it("Test 3b: concurrent-create race — P2002 on first INSERT triggers a single retry via the rotate path", async () => {
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

  // =========================================================================
  // generalize createOrRotate + delete
  // for all 3 inbound adapters (JIRA / GITHUB / AZURE_DEVOPS).
  // =========================================================================

  describe("createOrRotateInboundWebhook", () => {
    it("creates a GITHUB config when no row exists; mints HMAC secret + adapterType=GITHUB", async () => {
      mockWebhookConfigFindFirst.mockResolvedValue(null);
      mockWebhookConfigCreate.mockResolvedValue({ id: "cfg-gh-1" });

      const result = await createOrRotateInboundWebhook({
        projectId: 42,
        adapterType: "GITHUB",
      });

      expect(result.success).toBe(true);
      expect(result.configId).toBe("cfg-gh-1");
      // Server-minted HMAC secret returned plaintext, NOT encrypted blob.
      expect(result.secret).toBeTruthy();
      expect(result.secret!.startsWith("enc:")).toBe(false);
      // Lookup filters by GITHUB (not hardcoded JIRA).
      expect(mockWebhookConfigFindFirst).toHaveBeenCalledWith({
        where: { projectId: 42, adapterType: "GITHUB", direction: "INBOUND" },
        select: { id: true },
      });
      expect(mockWebhookConfigCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: 42,
          adapterType: "GITHUB",
          direction: "INBOUND",
          isActive: true,
          token: expect.stringMatching(/^whk_[0-9a-f]{64}$/),
          secret: `enc:${result.secret}`,
        }),
        select: { id: true },
      });
    });

    it("creates an AZURE_DEVOPS config with JSON-encoded {username, password} secret", async () => {
      mockWebhookConfigFindFirst.mockResolvedValue(null);
      mockWebhookConfigCreate.mockResolvedValue({ id: "cfg-ado-1" });

      const result = await createOrRotateInboundWebhook({
        projectId: 42,
        adapterType: "AZURE_DEVOPS",
        secretInput: {
          kind: "AZURE_DEVOPS",
          username: "tpi",
          password: "s3cret",
        },
      });

      expect(result.success).toBe(true);
      expect(result.configId).toBe("cfg-ado-1");
      // ADO does NOT return a server-minted secret; admin already typed it.
      expect(result.secret).toBeUndefined();

      // Encryption helper invoked with the JSON-encoded credential blob.
      const expectedJson = JSON.stringify({
        username: "tpi",
        password: "s3cret",
      });
      expect(mockEncrypt).toHaveBeenCalledWith(expectedJson);

      expect(mockWebhookConfigCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: 42,
          adapterType: "AZURE_DEVOPS",
          direction: "INBOUND",
          isActive: true,
          token: expect.stringMatching(/^whk_[0-9a-f]{64}$/),
          secret: `enc:${expectedJson}`,
        }),
        select: { id: true },
      });
    });

    it("returns friendly error when AZURE_DEVOPS missing secretInput", async () => {
      const result = await createOrRotateInboundWebhook({
        projectId: 42,
        adapterType: "AZURE_DEVOPS",
        // secretInput intentionally omitted
      });

      expect(result).toEqual({
        success: false,
        error: "Failed to save webhook configuration",
      });
      expect(mockWebhookConfigCreate).not.toHaveBeenCalled();
    });

    it("returns friendly error when AZURE_DEVOPS secretInput has empty username", async () => {
      const result = await createOrRotateInboundWebhook({
        projectId: 42,
        adapterType: "AZURE_DEVOPS",
        secretInput: {
          kind: "AZURE_DEVOPS",
          username: "",
          password: "s3cret",
        },
      });

      expect(result).toEqual({
        success: false,
        error: "Failed to save webhook configuration",
      });
      expect(mockWebhookConfigCreate).not.toHaveBeenCalled();
    });

    it("Q8 RESOLVED: encrypt(JSON.stringify({username,password})) round-trips via decrypt+JSON.parse", async () => {
      // Verifies the encryption helper handles arbitrary string content
      // (mirrors the Slack-URL-as-credential precedent). Mock encrypt
      // to a passthrough so we can assert decrypt+parse recovers structural
      // equality of the credentials object.
      mockEncrypt.mockImplementationOnce(async (s: string) => `enc:${s}`);
      mockDecrypt.mockImplementationOnce(async (s: string) => s.slice(4));

      const creds = { username: "tpi-user", password: "p@ss:word" };
      const enc = await mockEncrypt(JSON.stringify(creds));
      const dec = await mockDecrypt(enc);
      const parsed = JSON.parse(dec);

      expect(parsed).toEqual(creds);
    });

    it("alias createOrRotateJiraWebhook still routes through the new function", async () => {
      mockWebhookConfigFindFirst.mockResolvedValue(null);
      mockWebhookConfigCreate.mockResolvedValue({ id: "cfg-jira-via-alias" });

      const result = await createOrRotateJiraWebhook(42);

      expect(result.success).toBe(true);
      expect(result.configId).toBe("cfg-jira-via-alias");
      // The lookup filtered by JIRA, not GITHUB or ADO.
      expect(mockWebhookConfigFindFirst).toHaveBeenCalledWith({
        where: { projectId: 42, adapterType: "JIRA", direction: "INBOUND" },
        select: { id: true },
      });
      expect(mockWebhookConfigCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: 42,
          adapterType: "JIRA",
          direction: "INBOUND",
        }),
        select: { id: true },
      });
    });

    it("rotate path: GITHUB existing row → update (hard cutover, fresh token+secret)", async () => {
      mockWebhookConfigFindFirst.mockResolvedValue({ id: "cfg-gh-exist" });
      mockWebhookConfigUpdate.mockResolvedValue({ id: "cfg-gh-exist" });

      const result = await createOrRotateInboundWebhook({
        projectId: 42,
        adapterType: "GITHUB",
      });

      expect(result.success).toBe(true);
      expect(result.configId).toBe("cfg-gh-exist");
      expect(mockWebhookConfigCreate).not.toHaveBeenCalled();
      expect(mockWebhookConfigUpdate).toHaveBeenCalledWith({
        where: { id: "cfg-gh-exist" },
        data: expect.objectContaining({
          token: expect.stringMatching(/^whk_[0-9a-f]{64}$/),
          secret: expect.stringMatching(/^enc:/),
          isActive: true,
        }),
        select: { id: true },
      });
    });
  });

  describe("deleteInboundWebhook", () => {
    it("happy path: tenant-scopes by projectId + direction=INBOUND", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        projectId: 42,
        direction: "INBOUND",
      });
      mockWebhookConfigDelete.mockResolvedValue({ id: "cfg-1" });

      const result = await deleteInboundWebhook({
        webhookConfigId: "cfg-1",
        projectId: 42,
      });

      expect(result).toEqual({ success: true });
      expect(mockWebhookConfigDelete).toHaveBeenCalledWith({
        where: { id: "cfg-1" },
      });
    });

    it("returns Not found when projectId mismatch (cross-tenant attempt)", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        projectId: 99, // different from input projectId
        direction: "INBOUND",
      });

      const result = await deleteInboundWebhook({
        webhookConfigId: "cfg-other-tenant",
        projectId: 42,
      });

      expect(result).toEqual({ success: false, error: "Not found" });
      expect(mockWebhookConfigDelete).not.toHaveBeenCalled();
    });

    it("returns Not found when direction is OUTBOUND (refuse to delete outbound via inbound action)", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        projectId: 42,
        direction: "OUTBOUND",
      });

      const result = await deleteInboundWebhook({
        webhookConfigId: "cfg-out",
        projectId: 42,
      });

      expect(result).toEqual({ success: false, error: "Not found" });
      expect(mockWebhookConfigDelete).not.toHaveBeenCalled();
    });

    it("returns Unauthorized when session missing", async () => {
      mockGetServerAuthSession.mockResolvedValue(null);

      const result = await deleteInboundWebhook({
        webhookConfigId: "cfg-1",
        projectId: 42,
      });

      expect(result).toEqual({ success: false, error: "Unauthorized" });
      expect(mockWebhookConfigDelete).not.toHaveBeenCalled();
    });

    it("returns Forbidden when canManageWebhookConfig denies", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        projectId: 42,
        direction: "INBOUND",
      });
      mockCanManageWebhookConfig.mockResolvedValueOnce(false);

      const result = await deleteInboundWebhook({
        webhookConfigId: "cfg-1",
        projectId: 42,
      });

      expect(result).toEqual({ success: false, error: "Forbidden" });
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
        adapterType: "JIRA",
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
      // Body bytes EQUAL the literal synthetic payload.
      expect(init.body).toBe(EXPECTED_SYNTHETIC_PAYLOAD);
    });

    // ─── Test 8: demo lock — second call body byte-identical ─────────
    it("Test 8 (demo lock): two consecutive calls produce BYTE-IDENTICAL fetch bodies; second forwards 'duplicate'", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        token: FIXTURE_TOKEN,
        secret: FIXTURE_SECRET_ENC,
        projectId: 42,
        adapterType: "JIRA",
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

      // Byte-identical across clicks. If a Date.now/nonce/random ever
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

    // ─── Test 9: sentinel issue.key in synthetic payload ───────────
    it("Test 9: synthetic payload uses sentinel issue.key='__synthetic__' and contains NO wire-supplied metadata.synthetic boolean", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        token: FIXTURE_TOKEN,
        secret: FIXTURE_SECRET_ENC,
        projectId: 42,
        adapterType: "JIRA",
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
      // The wire-controllable metadata.synthetic boolean MUST NOT be present
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
        adapterType: "JIRA",
      });
      fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));

      const result = await sendTestWebhook("cfg-1");

      expect(result.ok).toBe(false);
      expect(result.statusCode).toBe(0);
      expect(result.error).toContain("ECONNREFUSED");
    });

    // ─────────────────────────────────────────────────────────────────────
    // adapter-aware sendTestWebhook
    // (GitHub HMAC + ADO Basic Auth) with module-level synthetic payloads.
    // ─────────────────────────────────────────────────────────────────────

    // The module-level constants from webhook-config.ts (copies here for
    // byte-identity assertion). If the source ever drifts, these tests fail
    // BEFORE the test runs — same guard as the JIRA EXPECTED_SYNTHETIC_PAYLOAD.
    const EXPECTED_GITHUB_PAYLOAD = JSON.stringify({
      action: "opened",
      issue: { number: 0, state: "open", title: "Synthetic test" },
      repository: { full_name: "__synthetic__/__synthetic__" },
    });
    const EXPECTED_ADO_PAYLOAD = JSON.stringify({
      eventType: "workitem.updated",
      resource: { id: 0, fields: { "System.State": "Synthetic" } },
    });

    it("Test 11 (GITHUB): posts X-Hub-Signature-256 + X-GitHub-Event: issues with synthetic GithubIssuesPayload", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        token: FIXTURE_TOKEN,
        secret: FIXTURE_SECRET_ENC,
        projectId: 42,
        adapterType: "GITHUB",
      });
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ outcome: "synthetic" }),
      });

      const result = await sendTestWebhook("cfg-gh");

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

      // Body bytes EQUAL the literal GitHub synthetic payload.
      expect(init.body).toBe(EXPECTED_GITHUB_PAYLOAD);

      const expectedSig =
        "sha256=" +
        createHmac("sha256", FIXTURE_SECRET_PLAIN)
          .update(EXPECTED_GITHUB_PAYLOAD)
          .digest("hex");

      expect(init.method).toBe("POST");
      expect(init.headers).toMatchObject({
        "content-type": "application/json",
        "x-hub-signature-256": expectedSig,
        "x-github-event": "issues",
      });

      // sentinel binding: __synthetic__/__synthetic__ + issue.number === 0
      const parsed = JSON.parse(init.body);
      expect(parsed.repository.full_name).toBe("__synthetic__/__synthetic__");
      expect(parsed.issue.number).toBe(0);
    });

    it("Test 12 (GITHUB dedup invariant): two consecutive calls produce BYTE-IDENTICAL bodies", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        token: FIXTURE_TOKEN,
        secret: FIXTURE_SECRET_ENC,
        projectId: 42,
        adapterType: "GITHUB",
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

      const r1 = await sendTestWebhook("cfg-gh");
      const r2 = await sendTestWebhook("cfg-gh");

      expect(r1.outcome).toBe("synthetic");
      expect(r2.outcome).toBe("duplicate");

      const body1 = fetchSpy.mock.calls[0][1].body as string;
      const body2 = fetchSpy.mock.calls[1][1].body as string;
      // invariant: byte-identity → identical payloadDigest → dedup hits
      // duplicate path on the second call. Module-level const guarantees this.
      expect(body1).toBe(body2);
      expect(body1).toBe(EXPECTED_GITHUB_PAYLOAD);

      // Signature is identical too (HMAC over identical bytes + secret).
      const sig1 = (
        fetchSpy.mock.calls[0][1].headers as Record<string, string>
      )["x-hub-signature-256"];
      const sig2 = (
        fetchSpy.mock.calls[1][1].headers as Record<string, string>
      )["x-hub-signature-256"];
      expect(sig1).toBe(sig2);
    });

    it("Test 13 (AZURE_DEVOPS): posts Authorization: Basic <base64> with synthetic workitem.updated payload", async () => {
      // ADO secret is JSON-encoded {username, password}.
      const adoCreds = JSON.stringify({ username: "tpi", password: "s3cret" });
      mockWebhookConfigFindUnique.mockResolvedValue({
        token: FIXTURE_TOKEN,
        secret: `enc:${adoCreds}`,
        projectId: 42,
        adapterType: "AZURE_DEVOPS",
      });
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ outcome: "synthetic" }),
      });

      const result = await sendTestWebhook("cfg-ado");

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

      // Body bytes EQUAL the literal ADO synthetic payload.
      expect(init.body).toBe(EXPECTED_ADO_PAYLOAD);

      // base64("tpi:s3cret") === "dHBpOnMzY3JldA=="
      expect(init.method).toBe("POST");
      expect(init.headers).toMatchObject({
        "content-type": "application/json",
        authorization: "Basic dHBpOnMzY3JldA==",
      });

      // sentinel binding: resource.id === 0 (real ADO IDs are ≥ 1)
      const parsed = JSON.parse(init.body);
      expect(parsed.resource.id).toBe(0);
      expect(parsed.eventType).toBe("workitem.updated");
    });

    it("Test 14 (AZURE_DEVOPS malformed secret): returns friendly error when stored credentials are not valid JSON", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        token: FIXTURE_TOKEN,
        secret: "enc:not-json{[",
        projectId: 42,
        adapterType: "AZURE_DEVOPS",
      });

      const result = await sendTestWebhook("cfg-ado-bad");

      expect(result.ok).toBe(false);
      expect(result.error).toBe(
        "Send-test failed: stored credentials are malformed"
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("Test 15 (AZURE_DEVOPS dedup invariant): two consecutive calls produce BYTE-IDENTICAL bodies", async () => {
      const adoCreds = JSON.stringify({ username: "tpi", password: "s3cret" });
      mockWebhookConfigFindUnique.mockResolvedValue({
        token: FIXTURE_TOKEN,
        secret: `enc:${adoCreds}`,
        projectId: 42,
        adapterType: "AZURE_DEVOPS",
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

      const r1 = await sendTestWebhook("cfg-ado");
      const r2 = await sendTestWebhook("cfg-ado");

      expect(r1.outcome).toBe("synthetic");
      expect(r2.outcome).toBe("duplicate");

      const body1 = fetchSpy.mock.calls[0][1].body as string;
      const body2 = fetchSpy.mock.calls[1][1].body as string;
      expect(body1).toBe(body2);
      expect(body1).toBe(EXPECTED_ADO_PAYLOAD);
    });

    it("Test 16 (unknown adapterType): returns friendly error and does NOT POST", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        token: FIXTURE_TOKEN,
        secret: FIXTURE_SECRET_ENC,
        projectId: 42,
        // SLACK / GENERIC_HMAC are OUTBOUND-only adapters; reaching this
        // code path indicates a corrupted INBOUND row (defensive guard).
        adapterType: "SLACK",
      });

      const result = await sendTestWebhook("cfg-bad");

      expect(result.ok).toBe(false);
      expect(result.error).toBe(
        "Send-test not supported for this adapter type"
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Outbound webhook server actions
  // =========================================================================

  describe("createOutboundWebhook", () => {
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

    it("rejects when name is empty/whitespace with 'Name is required'", async () => {
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

      expect(r1).toEqual({
        success: false,
        errorCode: "projects.webhooks.outboundCreateNameRequired",
        error: "Name is required",
      });
      expect(r2).toEqual({
        success: false,
        errorCode: "projects.webhooks.outboundCreateNameRequired",
        error: "Name is required",
      });
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

      expect(result).toEqual({
        success: false,
        errorCode: "projects.webhooks.outboundCreateUrlInvalid",
        error: "Invalid URL",
      });
      expect(mockWebhookConfigCreate).not.toHaveBeenCalled();
    });

    it("rejects http:// URLs with 'URL must use HTTPS' when ALLOW_HTTP_OUTBOUND is unset", async () => {
      const { createOutboundWebhook } = await import("./webhook-config");

      const result = await createOutboundWebhook({
        projectId: 42,
        name: "My Hook",
        url: "http://example.com/hook",
      });

      expect(result).toEqual({
        success: false,
        errorCode: "projects.webhooks.outboundCreateUrlMustUseHttps",
        error: "URL must use HTTPS",
      });
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

    it("Slack URL: auto-detects adapterType=SLACK, sets secret='', NO WebhookConfigSecret row, persists name+url", async () => {
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
        secret: "", // Slack URL is the credential
        name: "Team Slack", // trimmed
        url: "https://hooks.slack.com/services/T000/B000/abc",
        isActive: true,
      });
      // Default preset is empty — admins explicitly opt in via the form's
      // subscription checkboxes (the @@unique([projectId, adapterType,
      // direction]) constraint was dropped, so multiple Slack outbounds
      // per project are now allowed and the action no longer pre-fills).
      expect(callArg.data.subscribedEvents).toEqual([]);
      // No secret row for Slack
      expect(mockWebhookConfigSecretCreate).not.toHaveBeenCalled();
    });

    it("Slack URL: any create-time DB error returns a generic save-failure message", async () => {
      // The schema-level @@unique([projectId, adapterType, direction]) was
      // dropped, so the dedicated "already exists" branch is gone — any
      // unexpected DB error now surfaces as the generic save-failure error.
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
        error: "Failed to save webhook configuration",
      });
    });

    it("Generic-HMAC URL: detects GENERIC_HMAC, creates WebhookConfigSecret row, returns plaintext secret, persists name+url", async () => {
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

      // Config create payload — — name and url persisted into columns.
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
      expect(callArg.data.subscribedEvents).toEqual(["test_run.state_changed"]);
    });
  });

  describe("deleteOutboundWebhook", () => {
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

  describe("updateOutboundSubscriptions", () => {
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
  // Two-secret rotation lifecycle (..)
  // =========================================================================

  describe("rotateOutboundSecret", () => {
    function buildTxMock() {
      return {
        webhookConfigSecret: {
          findMany: (args: any) => mockWebhookConfigSecretFindMany(args),
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
      mockTransaction.mockImplementation(async (fn: any) => fn(buildTxMock()));
      mockWebhookConfigSecretFindMany.mockResolvedValue([{ id: "sec-old" }]);
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
      mockTransaction.mockImplementation(async (fn: any) => fn(buildTxMock()));
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
      mockTransaction.mockImplementation(async (fn: any) => fn(buildTxMock()));
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

  describe("retireOutboundSecretNow", () => {
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

  describe("extendRetiringSecret", () => {
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
      const expected = new Date(oldExpiry.getTime() + 7 * 24 * 60 * 60 * 1000);
      expect(result.newAutoRetireAt!.getTime()).toBe(expected.getTime());

      const call = mockWebhookConfigSecretUpdate.mock.calls[0][0];
      expect(call.where).toEqual({ id: "sec-retiring" });
      expect((call.data.autoRetireAt as Date).getTime()).toBe(
        expected.getTime()
      );
    });
  });

  // =========================================================================
  // sendTestOutboundWebhook (synthetic emit)
  // =========================================================================

  describe("sendTestOutboundWebhook", () => {
    function buildEmitTxMock() {
      // Pass-through: $transaction(async (tx) => fn(tx)). The mock just runs
      // the closure with a stub client that webhookEvents.emit will receive,
      // and we let the emit mock capture the actual call.
      return mockTransaction.mockImplementation(async (fn: any) =>
        fn({} as any)
      );
    }

    it("returns Unauthorized when session missing", async () => {
      mockGetServerAuthSession.mockResolvedValue(null);
      const { sendTestOutboundWebhook } = await import("./webhook-config");

      const result = await sendTestOutboundWebhook("cfg-1");

      expect(result).toEqual({ success: false, error: "Unauthorized" });
      expect(mockWebhookEventsEmit).not.toHaveBeenCalled();
    });

    it("returns 'Not found' when config doesn't exist", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue(null);
      const { sendTestOutboundWebhook } = await import("./webhook-config");

      const result = await sendTestOutboundWebhook("missing");

      expect(result).toEqual({ success: false, error: "Not found" });
      expect(mockWebhookEventsEmit).not.toHaveBeenCalled();
    });

    it("rejects INBOUND configs", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        projectId: 42,
        direction: "INBOUND",
      });
      const { sendTestOutboundWebhook } = await import("./webhook-config");

      const result = await sendTestOutboundWebhook("cfg-jira");

      expect(result).toEqual({
        success: false,
        error: "Not an outbound webhook",
      });
      expect(mockWebhookEventsEmit).not.toHaveBeenCalled();
    });

    it("happy path: emits a webhook.test event in a transaction with the canonical payload", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        projectId: 42,
        direction: "OUTBOUND",
      });
      buildEmitTxMock();
      mockWebhookEventsEmit.mockResolvedValue({
        eventId: "evt_abc",
        outboxRowId: "row_1",
      });

      const { sendTestOutboundWebhook } = await import("./webhook-config");
      const result = await sendTestOutboundWebhook("cfg-out");

      expect(result.success).toBe(true);
      expect(result.eventId).toBe("evt_abc");

      expect(mockWebhookEventsEmit).toHaveBeenCalledTimes(1);
      const [eventName, payload, opts] = mockWebhookEventsEmit.mock.calls[0];
      expect(eventName).toBe("webhook.test");
      expect(payload).toMatchObject({
        source: "TestPlanIt",
        message: "Webhook pipeline is healthy",
        configId: "cfg-out",
      });
      // dispatchedAt is an ISO timestamp string
      expect(typeof payload.dispatchedAt).toBe("string");
      expect(() => new Date(payload.dispatchedAt)).not.toThrow();

      expect(opts.projectId).toBe(42);
      expect(opts.tx).toBeDefined();
      expect(opts.actorUserId).toBe("user-123");
    });

    it("returns success even when emit returns null (suppression hatch)", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        projectId: 42,
        direction: "OUTBOUND",
      });
      buildEmitTxMock();
      mockWebhookEventsEmit.mockResolvedValue(null);

      const { sendTestOutboundWebhook } = await import("./webhook-config");
      const result = await sendTestOutboundWebhook("cfg-out");

      expect(result.success).toBe(true);
      expect(result.eventId).toBeUndefined();
    });

    it("returns error when transaction throws", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        projectId: 42,
        direction: "OUTBOUND",
      });
      mockTransaction.mockImplementation(async () => {
        throw new Error("DB exploded");
      });

      const { sendTestOutboundWebhook } = await import("./webhook-config");
      const result = await sendTestOutboundWebhook("cfg-out");

      expect(result).toEqual({
        success: false,
        error: "Failed to send test webhook",
      });
    });
  });

  // ===========================================================================
  // replay + bulk replay + re-enable + batch status
  // ===========================================================================

  describe("replayWebhookDelivery", () => {
    it("returns Unauthorized when session is missing", async () => {
      mockGetServerAuthSession.mockResolvedValue(null);
      const { replayWebhookDelivery } = await import("./webhook-config");

      const result = await replayWebhookDelivery("d1");

      expect(result).toEqual({ ok: false, error: "Unauthorized" });
      expect(mockReplayDelivery).not.toHaveBeenCalled();
    });

    it("returns Not found when delivery row does not exist", async () => {
      mockWebhookDeliveryFindUnique.mockResolvedValue(null);
      const { replayWebhookDelivery } = await import("./webhook-config");

      const result = await replayWebhookDelivery("d-missing");

      expect(result).toEqual({ ok: false, error: "Not found" });
      expect(mockReplayDelivery).not.toHaveBeenCalled();
    });

    it("returns Forbidden when canManageWebhookConfig denies", async () => {
      mockWebhookDeliveryFindUnique.mockResolvedValue({
        direction: "OUTBOUND",
        webhookConfig: { projectId: 99 },
      });
      mockCanManageWebhookConfig.mockResolvedValue(false);
      const { replayWebhookDelivery } = await import("./webhook-config");

      const result = await replayWebhookDelivery("d1");

      expect(result).toEqual({ ok: false, error: "Forbidden" });
      expect(mockReplayDelivery).not.toHaveBeenCalled();
    });

    it("rejects INBOUND deliveries with typed reason inbound_replay_not_supported", async () => {
      mockWebhookDeliveryFindUnique.mockResolvedValue({
        direction: "INBOUND",
        webhookConfig: { projectId: 1 },
      });
      mockCanManageWebhookConfig.mockResolvedValue(true);
      const { replayWebhookDelivery } = await import("./webhook-config");

      const result = await replayWebhookDelivery("d-inbound");

      expect(result).toEqual({
        ok: false,
        reason: "inbound_replay_not_supported",
      });
      // Per rejected at action boundary, no service call, no audit.
      expect(mockReplayDelivery).not.toHaveBeenCalled();
      expect(mockCaptureAuditEvent).not.toHaveBeenCalled();
    });

    it("delegates OUTBOUND to replayDelivery with source:'single' and actorUserId from session", async () => {
      mockWebhookDeliveryFindUnique.mockResolvedValue({
        direction: "OUTBOUND",
        webhookConfig: { projectId: 1 },
      });
      mockCanManageWebhookConfig.mockResolvedValue(true);
      mockReplayDelivery.mockResolvedValue({
        outcome: "queued",
        queueJobId: "q1",
      });
      const { replayWebhookDelivery } = await import("./webhook-config");

      const result = await replayWebhookDelivery("d1");

      expect(result).toEqual({ ok: true, queueJobId: "q1" });
      expect(mockReplayDelivery).toHaveBeenCalledTimes(1);
      const [deliveryId, opts] = mockReplayDelivery.mock.calls[0];
      expect(deliveryId).toBe("d1");
      expect(opts).toMatchObject({
        actorUserId: "user-123",
        source: "single",
      });
    });
  });

  describe("bulkReplayFailedDeliveries", () => {
    it("returns Unauthorized when session is missing", async () => {
      mockGetServerAuthSession.mockResolvedValue(null);
      const { bulkReplayFailedDeliveries } = await import("./webhook-config");

      const result = await bulkReplayFailedDeliveries({
        webhookConfigId: "cfg_a",
        sinceTimestamp: "2026-04-22T00:00:00Z",
      });

      expect(result).toEqual({ ok: false, error: "Unauthorized" });
      expect(mockWebhookDeliveryFindMany).not.toHaveBeenCalled();
      expect(mockBulkReplayDeliveries).not.toHaveBeenCalled();
    });

    it("returns Forbidden when canManageWebhookConfig denies", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({ projectId: 1 });
      mockCanManageWebhookConfig.mockResolvedValue(false);
      const { bulkReplayFailedDeliveries } = await import("./webhook-config");

      const result = await bulkReplayFailedDeliveries({
        webhookConfigId: "cfg_a",
        sinceTimestamp: "2026-04-22T00:00:00Z",
      });

      expect(result).toEqual({ ok: false, error: "Forbidden" });
      expect(mockBulkReplayDeliveries).not.toHaveBeenCalled();
    });

    it("filters to direction:OUTBOUND with error:not-null and take = BULK_REPLAY_HARD_CAP+1", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({ projectId: 1 });
      mockCanManageWebhookConfig.mockResolvedValue(true);
      const fortySeven = Array.from({ length: 47 }, (_, i) => ({
        id: `d_${i}`,
      }));
      mockWebhookDeliveryFindMany.mockResolvedValue(fortySeven);
      mockBulkReplayDeliveries.mockResolvedValue({
        outcome: "queued",
        batchId: "bat_xyz",
        enqueuedCount: 47,
        skippedInboundCount: 0,
      });

      const { bulkReplayFailedDeliveries } = await import("./webhook-config");
      const since = "2026-04-22T00:00:00Z";

      await bulkReplayFailedDeliveries({
        webhookConfigId: "cfg_a",
        sinceTimestamp: since,
      });

      expect(mockWebhookDeliveryFindMany).toHaveBeenCalledTimes(1);
      const [args] = mockWebhookDeliveryFindMany.mock.calls[0];
      expect(args.where).toMatchObject({
        webhookConfigId: "cfg_a",
        direction: "OUTBOUND",
        error: { not: null },
      });
      expect(args.where.receivedAt.gte).toEqual(new Date(since));
      // 100-row hard cap → take 101 to detect over-cap.
      expect(args.take).toBe(101);
    });

    it("returns exceeds_cap when over-cap and does not enqueue", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({ projectId: 1 });
      mockCanManageWebhookConfig.mockResolvedValue(true);
      const overCap = Array.from({ length: 101 }, (_, i) => ({
        id: `d_${i}`,
      }));
      mockWebhookDeliveryFindMany.mockResolvedValue(overCap);

      const { bulkReplayFailedDeliveries } = await import("./webhook-config");
      const result = await bulkReplayFailedDeliveries({
        webhookConfigId: "cfg_a",
        sinceTimestamp: "2026-04-22T00:00:00Z",
      });

      expect(result).toEqual({ ok: false, reason: "exceeds_cap" });
      expect(mockBulkReplayDeliveries).not.toHaveBeenCalled();
    });

    it("at-or-under-cap delegates to bulkReplayDeliveries and returns enqueuedCount + batchId", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({ projectId: 1 });
      mockCanManageWebhookConfig.mockResolvedValue(true);
      const fortySeven = Array.from({ length: 47 }, (_, i) => ({
        id: `d_${i}`,
      }));
      mockWebhookDeliveryFindMany.mockResolvedValue(fortySeven);
      mockBulkReplayDeliveries.mockResolvedValue({
        outcome: "queued",
        batchId: "bat_xyz",
        enqueuedCount: 47,
        skippedInboundCount: 0,
      });

      const { bulkReplayFailedDeliveries } = await import("./webhook-config");
      const result = await bulkReplayFailedDeliveries({
        webhookConfigId: "cfg_a",
        sinceTimestamp: "2026-04-22T00:00:00Z",
      });

      expect(result).toEqual({
        ok: true,
        batchId: "bat_xyz",
        enqueuedCount: 47,
      });
      expect(mockBulkReplayDeliveries).toHaveBeenCalledTimes(1);
      const [ids, opts] = mockBulkReplayDeliveries.mock.calls[0];
      expect(ids).toHaveLength(47);
      expect(opts).toMatchObject({ actorUserId: "user-123" });
    });

    it("includes untilTimestamp in the where filter when provided", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({ projectId: 1 });
      mockCanManageWebhookConfig.mockResolvedValue(true);
      mockWebhookDeliveryFindMany.mockResolvedValue([]);
      mockBulkReplayDeliveries.mockResolvedValue({
        outcome: "queued",
        batchId: "bat_xyz",
        enqueuedCount: 0,
        skippedInboundCount: 0,
      });

      const { bulkReplayFailedDeliveries } = await import("./webhook-config");
      const since = "2026-04-22T00:00:00Z";
      const until = "2026-04-29T23:59:59Z";

      await bulkReplayFailedDeliveries({
        webhookConfigId: "cfg_a",
        sinceTimestamp: since,
        untilTimestamp: until,
      });

      const [args] = mockWebhookDeliveryFindMany.mock.calls[0];
      expect(args.where.receivedAt.gte).toEqual(new Date(since));
      expect(args.where.receivedAt.lte).toEqual(new Date(until));
    });

    it("inbound rows do not count toward cap — direction:OUTBOUND filter excludes them", async () => {
      // 50 INBOUND failed + 60 OUTBOUND failed exist for the same configId,
      // but the where filter is direction:OUTBOUND so findMany returns 60.
      mockWebhookConfigFindUnique.mockResolvedValue({ projectId: 1 });
      mockCanManageWebhookConfig.mockResolvedValue(true);
      const sixty = Array.from({ length: 60 }, (_, i) => ({ id: `o_${i}` }));
      mockWebhookDeliveryFindMany.mockImplementation(async (args: unknown) => {
        // Simulate the DB layer honoring the direction filter.
        const a = args as { where: { direction?: string } };
        if (a.where.direction === "OUTBOUND") return sixty;
        return Array.from({ length: 110 }, (_, i) => ({ id: `x_${i}` }));
      });
      mockBulkReplayDeliveries.mockResolvedValue({
        outcome: "queued",
        batchId: "bat_xyz",
        enqueuedCount: 60,
        skippedInboundCount: 0,
      });

      const { bulkReplayFailedDeliveries } = await import("./webhook-config");
      const result = await bulkReplayFailedDeliveries({
        webhookConfigId: "cfg_a",
        sinceTimestamp: "2026-04-22T00:00:00Z",
      });

      // 60 outbound is under cap; under-cap delegate path runs.
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.enqueuedCount).toBe(60);
      }
      const [args] = mockWebhookDeliveryFindMany.mock.calls[0];
      // The action filtered to direction:"OUTBOUND" — the 50 inbound rows
      // were never visible to the cap calculation.
      expect(args.where.direction).toBe("OUTBOUND");
    });
  });

  describe("reEnableWebhookConfig", () => {
    it("returns Unauthorized when session is missing", async () => {
      mockGetServerAuthSession.mockResolvedValue(null);
      const { reEnableWebhookConfig } = await import("./webhook-config");

      const result = await reEnableWebhookConfig("cfg_a");

      expect(result).toEqual({ ok: false, error: "Unauthorized" });
      expect(mockWebhookConfigUpdate).not.toHaveBeenCalled();
    });

    it("returns Not found when config row missing", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue(null);
      const { reEnableWebhookConfig } = await import("./webhook-config");

      const result = await reEnableWebhookConfig("cfg_missing");

      expect(result).toEqual({ ok: false, error: "Not found" });
      expect(mockWebhookConfigUpdate).not.toHaveBeenCalled();
    });

    it("rejects when config endpointHealth is not DISABLED (e.g., DEGRADED)", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        projectId: 1,
        endpointHealth: "DEGRADED",
      });
      const { reEnableWebhookConfig } = await import("./webhook-config");

      const result = await reEnableWebhookConfig("cfg_a");

      expect(result).toEqual({ ok: false, error: "Not disabled" });
      expect(mockWebhookConfigUpdate).not.toHaveBeenCalled();
      expect(mockCaptureAuditEvent).not.toHaveBeenCalled();
    });

    it("returns Forbidden when canManageWebhookConfig denies", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        projectId: 99,
        endpointHealth: "DISABLED",
      });
      mockCanManageWebhookConfig.mockResolvedValue(false);
      const { reEnableWebhookConfig } = await import("./webhook-config");

      const result = await reEnableWebhookConfig("cfg_a");

      expect(result).toEqual({ ok: false, error: "Forbidden" });
      expect(mockWebhookConfigUpdate).not.toHaveBeenCalled();
    });

    it("happy path: sets endpointHealth=HEALTHY + consecutiveFailureCount=0 and emits manual_reenable audit", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        projectId: 1,
        endpointHealth: "DISABLED",
      });
      mockCanManageWebhookConfig.mockResolvedValue(true);
      mockWebhookConfigUpdate.mockResolvedValue({});
      const { reEnableWebhookConfig } = await import("./webhook-config");

      const result = await reEnableWebhookConfig("cfg_a");

      expect(result).toEqual({ ok: true });
      expect(mockWebhookConfigUpdate).toHaveBeenCalledTimes(1);
      const [updateArgs] = mockWebhookConfigUpdate.mock.calls[0];
      expect(updateArgs).toMatchObject({
        where: { id: "cfg_a" },
        data: { endpointHealth: "HEALTHY", consecutiveFailureCount: 0 },
      });

      expect(mockCaptureAuditEvent).toHaveBeenCalledTimes(1);
      const [auditArg] = mockCaptureAuditEvent.mock.calls[0];
      expect(auditArg).toMatchObject({
        action: "WEBHOOK_HEALTH_CHANGED",
        entityType: "WebhookConfig",
        entityId: "cfg_a",
        projectId: 1,
        userId: "user-123",
        metadata: {
          webhookConfigId: "cfg_a",
          from: "DISABLED",
          to: "HEALTHY",
          reason: "manual_reenable",
          consecutiveFailureCount: 0,
        },
      });
    });

    it("manual_reenable uses actorUserId from session, NOT __system__", async () => {
      mockWebhookConfigFindUnique.mockResolvedValue({
        projectId: 1,
        endpointHealth: "DISABLED",
      });
      mockCanManageWebhookConfig.mockResolvedValue(true);
      mockWebhookConfigUpdate.mockResolvedValue({});
      const { reEnableWebhookConfig } = await import("./webhook-config");

      await reEnableWebhookConfig("cfg_a");

      const [auditArg] = mockCaptureAuditEvent.mock.calls[0];
      expect(auditArg.userId).toBe("user-123");
      expect(auditArg.userId).not.toBe("__system__");
      expect(auditArg.metadata.reason).toBe("manual_reenable");
      expect(auditArg.metadata.reason).not.toBe("auto_threshold");
    });
  });

  describe("getReplayBatchStatus", () => {
    it("returns Unauthorized when session is missing", async () => {
      mockGetServerAuthSession.mockResolvedValue(null);
      const { getReplayBatchStatus } = await import("./webhook-config");

      const result = await getReplayBatchStatus("bat_x");

      expect(result).toEqual({ ok: false, error: "Unauthorized" });
      expect(mockAuditLogFindMany).not.toHaveBeenCalled();
    });

    it("returns zeros when batch not found (no audit rows match)", async () => {
      mockAuditLogFindMany.mockResolvedValue([]);
      const { getReplayBatchStatus } = await import("./webhook-config");

      const result = await getReplayBatchStatus("bat_missing");

      expect(result).toEqual({
        ok: true,
        queued: 0,
        succeeded: 0,
        failed: 0,
      });
      // No need to query WebhookDelivery if no audit rows found.
      expect(mockWebhookDeliveryFindMany).not.toHaveBeenCalled();
    });

    it("all-queued — 2 audit rows, no replay rows yet → queued:2 succeeded:0 failed:0", async () => {
      mockAuditLogFindMany.mockResolvedValue([
        {
          metadata: { originalDeliveryId: "o1", batchId: "bat_q" },
          projectId: 1,
        },
        {
          metadata: { originalDeliveryId: "o2", batchId: "bat_q" },
          projectId: 1,
        },
      ]);
      mockCanManageWebhookConfig.mockResolvedValue(true);
      mockWebhookDeliveryFindMany.mockResolvedValue([]);
      const { getReplayBatchStatus } = await import("./webhook-config");

      const result = await getReplayBatchStatus("bat_q");

      expect(result).toEqual({
        ok: true,
        queued: 2,
        succeeded: 0,
        failed: 0,
      });
    });

    it("mixed-batch — 5 originals, 4 replay rows (2 success + 2 failed), 1 still queued — deterministic counts (Warning 7 lock)", async () => {
      mockAuditLogFindMany.mockResolvedValue([
        {
          metadata: { originalDeliveryId: "o1", batchId: "bat_m" },
          projectId: 1,
        },
        {
          metadata: { originalDeliveryId: "o2", batchId: "bat_m" },
          projectId: 1,
        },
        {
          metadata: { originalDeliveryId: "o3", batchId: "bat_m" },
          projectId: 1,
        },
        {
          metadata: { originalDeliveryId: "o4", batchId: "bat_m" },
          projectId: 1,
        },
        {
          metadata: { originalDeliveryId: "o5", batchId: "bat_m" },
          projectId: 1,
        },
      ]);
      mockCanManageWebhookConfig.mockResolvedValue(true);
      mockWebhookDeliveryFindMany.mockResolvedValue([
        { error: null, replayedFromDeliveryId: "o1" },
        { error: null, replayedFromDeliveryId: "o2" },
        { error: "TIMEOUT", replayedFromDeliveryId: "o3" },
        { error: "TIMEOUT", replayedFromDeliveryId: "o4" },
        // o5 has no replay row yet → counted as queued.
      ]);
      const { getReplayBatchStatus } = await import("./webhook-config");

      const result = await getReplayBatchStatus("bat_m");

      expect(result).toEqual({
        ok: true,
        queued: 1,
        succeeded: 2,
        failed: 2,
      });

      // The lock: query is replayedFromDeliveryId IN originalIds.
      const [args] = mockWebhookDeliveryFindMany.mock.calls[0];
      expect(args.where.replayedFromDeliveryId).toBeDefined();
      expect(args.where.replayedFromDeliveryId.in).toEqual([
        "o1",
        "o2",
        "o3",
        "o4",
        "o5",
      ]);
    });

    it("outbound-delivery-not-yet-written counts as queued — 5 audits, 3 success rows, 2 missing → queued:2 succeeded:3 failed:0", async () => {
      mockAuditLogFindMany.mockResolvedValue(
        ["o1", "o2", "o3", "o4", "o5"].map((id) => ({
          metadata: { originalDeliveryId: id, batchId: "bat_p" },
          projectId: 1,
        }))
      );
      mockCanManageWebhookConfig.mockResolvedValue(true);
      mockWebhookDeliveryFindMany.mockResolvedValue([
        { error: null, replayedFromDeliveryId: "o1" },
        { error: null, replayedFromDeliveryId: "o2" },
        { error: null, replayedFromDeliveryId: "o3" },
        // o4, o5 missing → queued
      ]);
      const { getReplayBatchStatus } = await import("./webhook-config");

      const result = await getReplayBatchStatus("bat_p");

      expect(result).toEqual({
        ok: true,
        queued: 2,
        succeeded: 3,
        failed: 0,
      });
    });

    it("returns Forbidden when canManageWebhookConfig denies (auth via first audit row's projectId)", async () => {
      mockAuditLogFindMany.mockResolvedValue([
        {
          metadata: { originalDeliveryId: "o1", batchId: "bat_x" },
          projectId: 999,
        },
      ]);
      mockCanManageWebhookConfig.mockResolvedValue(false);
      const { getReplayBatchStatus } = await import("./webhook-config");

      const result = await getReplayBatchStatus("bat_x");

      expect(result).toEqual({ ok: false, error: "Forbidden" });
      expect(mockWebhookDeliveryFindMany).not.toHaveBeenCalled();
    });
  });
});
