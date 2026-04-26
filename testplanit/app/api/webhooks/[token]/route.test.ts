import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VerifyResult } from "~/lib/webhooks/adapters/types";

/**
 * Hoisted mocks for the receiver route's collaborators.
 *
 * Mirrors the project-standard pattern (`vi.hoisted`) used in
 * `lib/services/auditLog.test.ts` and `lib/webhooks/services/applyJiraIssueUpdate.test.ts`.
 *
 * Each test mutates the per-call return values:
 *   - prisma.webhookConfig.findUnique → controls 404 vs valid-config
 *   - getAdapter().verify              → controls 401 vs success
 *   - applyJiraIssueUpdate              → controls 200 outcome / 500 error
 *   - decrypt                           → returns the plaintext secret
 */
const mocks = vi.hoisted(() => {
  const adapter = {
    adapterType: "JIRA" as const,
    verify: vi.fn(),
  };
  return {
    prisma: {
      webhookConfig: {
        findUnique: vi.fn(),
      },
    },
    getAdapter: vi.fn(() => adapter),
    adapter,
    applyJiraIssueUpdate: vi.fn(),
    decrypt: vi.fn(async (input: string) => input.replace(/^enc:/, "")),
  };
});

vi.mock("~/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("~/lib/webhooks/adapters", () => ({
  getAdapter: mocks.getAdapter,
}));

vi.mock("~/lib/webhooks/services/applyJiraIssueUpdate", () => ({
  applyJiraIssueUpdate: mocks.applyJiraIssueUpdate,
}));

vi.mock("~/utils/encryption", () => ({
  decrypt: mocks.decrypt,
}));

import { POST } from "./route";

const FULL_TOKEN =
  "whk_a8d3f1b2c4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";
const REDACTED_PREFIX = "whk_a8d3f1b2…[redacted]";

type ParamsP = Promise<{ token: string }>;

function makeRequest(
  body: string,
  token: string,
  headers: Record<string, string> = {}
): { req: any; params: ParamsP } {
  const req = new Request(`http://localhost/api/webhooks/${token}`, {
    method: "POST",
    body,
    headers,
  });
  return { req, params: Promise.resolve({ token }) };
}

const VALID_CONFIG = {
  id: "cfg-id-1",
  projectId: 42,
  adapterType: "JIRA" as const,
  secret: "enc:plaintext-secret",
  isActive: true,
};

const VALID_PAYLOAD = {
  eventType: "jira:issue_updated",
  issueKey: "DEMO-1",
  externalStatus: "In Progress",
  synthetic: false,
};

describe("POST /api/webhooks/[token]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decrypt.mockImplementation(async (input: string) =>
      input.replace(/^enc:/, "")
    );
    mocks.getAdapter.mockReturnValue(mocks.adapter);
  });

  it("Test 1 — returns 404 with no DB writes when the token is unknown (D-13)", async () => {
    mocks.prisma.webhookConfig.findUnique.mockResolvedValueOnce(null);
    const { req, params } = makeRequest("{}", FULL_TOKEN);

    const res = await POST(req, { params });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false });
    expect(mocks.adapter.verify).not.toHaveBeenCalled();
    expect(mocks.applyJiraIssueUpdate).not.toHaveBeenCalled();
  });

  it("Test 2 — returns 404 (same body) when the config exists but is inactive", async () => {
    mocks.prisma.webhookConfig.findUnique.mockResolvedValueOnce({
      ...VALID_CONFIG,
      isActive: false,
    });
    const { req, params } = makeRequest("{}", FULL_TOKEN);

    const res = await POST(req, { params });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false });
    expect(mocks.adapter.verify).not.toHaveBeenCalled();
    expect(mocks.applyJiraIssueUpdate).not.toHaveBeenCalled();
  });

  it("Test 3 — returns 401 with no DB writes on missing-signature (WBHK-02)", async () => {
    mocks.prisma.webhookConfig.findUnique.mockResolvedValueOnce(VALID_CONFIG);
    mocks.adapter.verify.mockReturnValueOnce({
      valid: false,
      reason: "missing-signature",
    } satisfies VerifyResult);
    const { req, params } = makeRequest("{}", FULL_TOKEN);

    const res = await POST(req, { params });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false });
    expect(mocks.applyJiraIssueUpdate).not.toHaveBeenCalled();
  });

  it("Test 4 — returns 401 on signature-mismatch", async () => {
    mocks.prisma.webhookConfig.findUnique.mockResolvedValueOnce(VALID_CONFIG);
    mocks.adapter.verify.mockReturnValueOnce({
      valid: false,
      reason: "signature-mismatch",
    } satisfies VerifyResult);
    const { req, params } = makeRequest("{}", FULL_TOKEN);

    const res = await POST(req, { params });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false });
    expect(mocks.applyJiraIssueUpdate).not.toHaveBeenCalled();
  });

  it("Test 5 — returns 401 on malformed-signature", async () => {
    mocks.prisma.webhookConfig.findUnique.mockResolvedValueOnce(VALID_CONFIG);
    mocks.adapter.verify.mockReturnValueOnce({
      valid: false,
      reason: "malformed-signature",
    } satisfies VerifyResult);
    const { req, params } = makeRequest("{}", FULL_TOKEN);

    const res = await POST(req, { params });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false });
    expect(mocks.applyJiraIssueUpdate).not.toHaveBeenCalled();
  });

  it("Test 6 — happy path: verifies, computes payloadDigest, returns 200 (WBHK-01/04/07)", async () => {
    mocks.prisma.webhookConfig.findUnique.mockResolvedValueOnce(VALID_CONFIG);
    mocks.adapter.verify.mockReturnValueOnce({
      valid: true,
      payload: VALID_PAYLOAD,
    } satisfies VerifyResult);
    mocks.applyJiraIssueUpdate.mockResolvedValueOnce({
      outcome: "updated",
      deliveryId: "del-1",
      issueId: 7,
    });
    const body = '{"webhookEvent":"jira:issue_updated"}';
    const { req, params } = makeRequest(body, FULL_TOKEN);

    const res = await POST(req, { params });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: "updated" });

    expect(mocks.applyJiraIssueUpdate).toHaveBeenCalledTimes(1);
    const call = mocks.applyJiraIssueUpdate.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      webhookConfigId: "cfg-id-1",
      projectId: 42,
      payload: VALID_PAYLOAD,
      statusCode: 200,
    });
    // sha256("...") of the same body must be deterministic
    const { createHash } = await import("node:crypto");
    expect(call.payloadDigest).toBe(
      createHash("sha256").update(Buffer.from(body)).digest("hex")
    );
    expect(call.receivedAt).toBeInstanceOf(Date);
  });

  it("Test 7 — no-link outcome still returns 200 (D-14)", async () => {
    mocks.prisma.webhookConfig.findUnique.mockResolvedValueOnce(VALID_CONFIG);
    mocks.adapter.verify.mockReturnValueOnce({
      valid: true,
      payload: VALID_PAYLOAD,
    } satisfies VerifyResult);
    mocks.applyJiraIssueUpdate.mockResolvedValueOnce({
      outcome: "no-link",
      deliveryId: "del-2",
      reason: "no-link",
    });
    const { req, params } = makeRequest("{}", FULL_TOKEN);

    const res = await POST(req, { params });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: "no-link" });
  });

  it("Test 8 — duplicate outcome still returns 200 (D-15)", async () => {
    mocks.prisma.webhookConfig.findUnique.mockResolvedValueOnce(VALID_CONFIG);
    mocks.adapter.verify.mockReturnValueOnce({
      valid: true,
      payload: VALID_PAYLOAD,
    } satisfies VerifyResult);
    mocks.applyJiraIssueUpdate.mockResolvedValueOnce({
      outcome: "duplicate",
      deliveryId: "del-3",
      reason: "duplicate",
    });
    const { req, params } = makeRequest("{}", FULL_TOKEN);

    const res = await POST(req, { params });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: "duplicate" });
  });

  it("Test 9 — synthetic outcome still returns 200 (D-20)", async () => {
    mocks.prisma.webhookConfig.findUnique.mockResolvedValueOnce(VALID_CONFIG);
    mocks.adapter.verify.mockReturnValueOnce({
      valid: true,
      payload: { ...VALID_PAYLOAD, synthetic: true },
    } satisfies VerifyResult);
    mocks.applyJiraIssueUpdate.mockResolvedValueOnce({
      outcome: "synthetic",
      deliveryId: "del-4",
      reason: "synthetic",
    });
    const { req, params } = makeRequest("{}", FULL_TOKEN);

    const res = await POST(req, { params });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: "synthetic" });
  });

  it("Test 10 — service error returns 500 with no leak in body", async () => {
    mocks.prisma.webhookConfig.findUnique.mockResolvedValueOnce(VALID_CONFIG);
    mocks.adapter.verify.mockReturnValueOnce({
      valid: true,
      payload: VALID_PAYLOAD,
    } satisfies VerifyResult);
    mocks.applyJiraIssueUpdate.mockResolvedValueOnce({
      outcome: "error",
      reason: "kaboom",
    });
    const { req, params } = makeRequest("{}", FULL_TOKEN);

    const res = await POST(req, { params });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false });
  });

  it("Test 11 — passes the EXACT raw body bytes to adapter.verify (no parse-and-re-stringify)", async () => {
    mocks.prisma.webhookConfig.findUnique.mockResolvedValueOnce(VALID_CONFIG);
    mocks.adapter.verify.mockReturnValueOnce({
      valid: true,
      payload: VALID_PAYLOAD,
    } satisfies VerifyResult);
    mocks.applyJiraIssueUpdate.mockResolvedValueOnce({
      outcome: "updated",
      deliveryId: "del-1",
      issueId: 7,
    });
    // Body with non-canonical whitespace — re-stringify would lose this.
    const body = '{   "webhookEvent":   "jira:issue_updated"   }';
    const { req, params } = makeRequest(body, FULL_TOKEN);

    await POST(req, { params });

    expect(mocks.adapter.verify).toHaveBeenCalledTimes(1);
    const [rawBuf, headers, secret] = mocks.adapter.verify.mock.calls[0]!;
    expect(Buffer.isBuffer(rawBuf)).toBe(true);
    expect((rawBuf as Buffer).equals(Buffer.from(body, "utf8"))).toBe(true);
    expect(headers).toBeInstanceOf(Headers);
    expect(secret).toBe("plaintext-secret");
  });

  it("Test 12 — every console emission for the token routes through redactToken", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Trigger the unknown-token path → console.warn is emitted.
      mocks.prisma.webhookConfig.findUnique.mockResolvedValueOnce(null);
      const { req, params } = makeRequest("{}", FULL_TOKEN);
      await POST(req, { params });

      const allCalls = [...errSpy.mock.calls, ...warnSpy.mock.calls].flat();
      const joined = allCalls
        .map((c) => (typeof c === "string" ? c : JSON.stringify(c)))
        .join(" | ");

      // The redacted form is present.
      expect(joined).toContain(REDACTED_PREFIX);
      // The full unredacted token NEVER appears.
      expect(joined).not.toContain(FULL_TOKEN);
    } finally {
      errSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("Test 13 — latencyMs passed to the service is non-negative and below 5000ms ceiling", async () => {
    mocks.prisma.webhookConfig.findUnique.mockResolvedValueOnce(VALID_CONFIG);
    mocks.adapter.verify.mockReturnValueOnce({
      valid: true,
      payload: VALID_PAYLOAD,
    } satisfies VerifyResult);
    mocks.applyJiraIssueUpdate.mockResolvedValueOnce({
      outcome: "updated",
      deliveryId: "del-1",
      issueId: 7,
    });
    const { req, params } = makeRequest("{}", FULL_TOKEN);

    await POST(req, { params });

    const call = mocks.applyJiraIssueUpdate.mock.calls[0]?.[0];
    expect(call.latencyMs).toBeGreaterThanOrEqual(0);
    expect(call.latencyMs).toBeLessThan(5000);
  });

  it("Test 14 — decrypts WebhookConfig.secret before passing plaintext to adapter.verify (D-02 + D-06)", async () => {
    // Encrypted form is the prefix-mocked "enc:..." string; plaintext follows the prefix.
    mocks.prisma.webhookConfig.findUnique.mockResolvedValueOnce({
      ...VALID_CONFIG,
      secret: "enc:test-secret-123",
    });
    mocks.adapter.verify.mockReturnValueOnce({
      valid: true,
      payload: VALID_PAYLOAD,
    } satisfies VerifyResult);
    mocks.applyJiraIssueUpdate.mockResolvedValueOnce({
      outcome: "updated",
      deliveryId: "del-1",
      issueId: 7,
    });
    const { req, params } = makeRequest("{}", FULL_TOKEN);

    await POST(req, { params });

    expect(mocks.decrypt).toHaveBeenCalledWith("enc:test-secret-123");
    const [, , secret] = mocks.adapter.verify.mock.calls[0]!;
    expect(secret).toBe("test-secret-123");
  });

  // T-04-01 mitigation: 401 and 404 bodies are byte-identical so callers can't enumerate.
  it("Body equality — 401 and 404 share the exact same JSON body shape", async () => {
    mocks.prisma.webhookConfig.findUnique.mockResolvedValueOnce(null);
    const a = makeRequest("{}", FULL_TOKEN);
    const r404 = await POST(a.req, { params: a.params });

    mocks.prisma.webhookConfig.findUnique.mockResolvedValueOnce(VALID_CONFIG);
    mocks.adapter.verify.mockReturnValueOnce({
      valid: false,
      reason: "signature-mismatch",
    } satisfies VerifyResult);
    const b = makeRequest("{}", FULL_TOKEN);
    const r401 = await POST(b.req, { params: b.params });

    expect(r404.status).toBe(404);
    expect(r401.status).toBe(401);
    expect(await r404.json()).toEqual(await r401.json());
  });
});
