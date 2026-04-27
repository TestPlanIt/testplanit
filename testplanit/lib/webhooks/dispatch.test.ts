import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchWebhook, type DispatchJobData } from "./dispatch";

vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/utils/encryption", () => ({
  decrypt: vi.fn().mockImplementation(async (cipher: string) => `decrypted:${cipher}`),
}));

import { captureAuditEvent } from "~/lib/services/auditLog";
import { decrypt } from "~/utils/encryption";

const mockedCaptureAudit = captureAuditEvent as unknown as ReturnType<typeof vi.fn>;
const mockedDecrypt = decrypt as unknown as ReturnType<typeof vi.fn>;

/**
 * Build a Prisma-shaped mock for the dispatch service.
 * Returns a plain object that the dispatch service can call as if it were a PrismaClient.
 */
function buildPrismaMock(opts: {
  outboxEvent: any;
  config: any;
  delivery?: any;
}) {
  const created: { delivery?: any } = {};
  return {
    webhookOutboxEvent: {
      findUnique: vi.fn().mockResolvedValue(opts.outboxEvent),
    },
    webhookConfig: {
      findUnique: vi.fn().mockResolvedValue(opts.config),
    },
    webhookDelivery: {
      create: vi.fn().mockImplementation(async (args: any) => {
        const row = {
          id: opts.delivery?.id ?? "delivery-id-1",
          ...args.data,
          receivedAt: new Date(),
        };
        created.delivery = row;
        return row;
      }),
    },
    _created: created,
  } as any;
}

const baseOutboxEvent = {
  id: "outbox-1",
  projectId: 7,
  eventName: "test_run.completed",
  eventId: "evt_00000000-0000-4000-8000-000000000000",
  eventTimestamp: new Date("2026-04-27T12:00:00.000Z"),
  actorUserId: "user-1",
  payload: { runId: 1, runTitle: "Smoke" },
  dispatchedAt: null,
  createdAt: new Date("2026-04-27T11:59:00.000Z"),
};

const baseConfig = (overrides: Record<string, any> = {}) => ({
  id: "cfg-1",
  projectId: 7,
  adapterType: "SLACK",
  direction: "OUTBOUND",
  isActive: true,
  url: "https://hooks.slack.com/services/T0/B0/abc",
  subscribedEvents: [],
  endpointHealth: "HEALTHY",
  secrets: [],
  project: { id: 7, name: "Acme" },
  ...overrides,
});

const baseJobData: DispatchJobData = {
  outboxEventId: "outbox-1",
  webhookConfigId: "cfg-1",
  attempt: 1,
  tenantId: "tenant-A",
};

describe("dispatchWebhook", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockedCaptureAudit.mockClear();
    mockedDecrypt.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("1. returns skipped_inactive when webhookConfig is not found (no fetch, no delivery)", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    const prismaMock = buildPrismaMock({
      outboxEvent: baseOutboxEvent,
      config: null,
    });

    const outcome = await dispatchWebhook(baseJobData, prismaMock);

    expect(outcome).toEqual({ outcome: "skipped_inactive" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prismaMock.webhookDelivery.create).not.toHaveBeenCalled();
  });

  it("2. returns skipped_inactive when config.isActive === false", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    const prismaMock = buildPrismaMock({
      outboxEvent: baseOutboxEvent,
      config: baseConfig({ isActive: false }),
    });

    const outcome = await dispatchWebhook(baseJobData, prismaMock);

    expect(outcome).toEqual({ outcome: "skipped_inactive" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prismaMock.webhookDelivery.create).not.toHaveBeenCalled();
  });

  it("3. returns skipped_unsubscribed when subscribedEvents excludes eventName (OUT-19, no delivery row)", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    const prismaMock = buildPrismaMock({
      outboxEvent: baseOutboxEvent,
      config: baseConfig({ subscribedEvents: ["issue.created"] }),
    });

    const outcome = await dispatchWebhook(baseJobData, prismaMock);

    expect(outcome).toEqual({ outcome: "skipped_unsubscribed" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prismaMock.webhookDelivery.create).not.toHaveBeenCalled();
  });

  it("4. webhook.test bypass: empty subscribedEvents → dispatch proceeds (delivery row written)", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 200 }));
    globalThis.fetch = fetchSpy as any;
    const prismaMock = buildPrismaMock({
      outboxEvent: { ...baseOutboxEvent, eventName: "webhook.test" },
      config: baseConfig({ subscribedEvents: [] }),
    });

    const outcome = await dispatchWebhook(baseJobData, prismaMock);

    expect(outcome.outcome).toBe("success");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(prismaMock.webhookDelivery.create).toHaveBeenCalledTimes(1);
  });

  it("5. webhook.test bypass: non-empty subscribedEvents that excludes 'webhook.test' → dispatch STILL proceeds (Blocker 6)", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 200 }));
    globalThis.fetch = fetchSpy as any;
    const prismaMock = buildPrismaMock({
      outboxEvent: { ...baseOutboxEvent, eventName: "webhook.test" },
      config: baseConfig({ subscribedEvents: ["test_run.completed"] }),
    });

    const outcome = await dispatchWebhook(baseJobData, prismaMock);

    expect(outcome.outcome).toBe("success");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(prismaMock.webhookDelivery.create).toHaveBeenCalledTimes(1);
  });

  it("6. success path: 200 → delivery row direction=OUTBOUND, error=null, statusCode=200, attempt=jobData.attempt; audit success", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 200 }));
    globalThis.fetch = fetchSpy as any;
    const prismaMock = buildPrismaMock({
      outboxEvent: baseOutboxEvent,
      config: baseConfig(),
    });

    const outcome = await dispatchWebhook(baseJobData, prismaMock);

    expect(outcome).toMatchObject({
      outcome: "success",
      statusCode: 200,
    });
    const createCall = prismaMock.webhookDelivery.create.mock.calls[0][0];
    expect(createCall.data.direction).toBe("OUTBOUND");
    expect(createCall.data.error).toBeNull();
    expect(createCall.data.statusCode).toBe(200);
    expect(createCall.data.attempt).toBe(baseJobData.attempt);
    expect(mockedCaptureAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "WEBHOOK_DISPATCHED",
        metadata: expect.objectContaining({ outcome: "success" }),
      })
    );
  });

  it("7. Slack adapter: no signature header sent; body is the Slack Block Kit JSON", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 200 }));
    globalThis.fetch = fetchSpy as any;
    const prismaMock = buildPrismaMock({
      outboxEvent: baseOutboxEvent,
      config: baseConfig({ adapterType: "SLACK" }),
    });

    await dispatchWebhook(baseJobData, prismaMock);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-TestPlanIt-Signature"]).toBeUndefined();
    // Slack body is JSON containing blocks/text — must parse cleanly.
    const parsed = JSON.parse(init.body as string);
    expect(parsed).toBeDefined();
  });

  it("8. Generic-HMAC adapter with one active secret only: sign called with retiring=null; X-TestPlanIt-Signature header present", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 200 }));
    globalThis.fetch = fetchSpy as any;
    const prismaMock = buildPrismaMock({
      outboxEvent: baseOutboxEvent,
      config: baseConfig({
        adapterType: "GENERIC_HMAC",
        secrets: [
          {
            id: "s-1",
            secret: "ciphered-active",
            activatedAt: new Date(),
            retiredAt: null,
            autoRetireAt: null,
          },
        ],
      }),
    });

    await dispatchWebhook(baseJobData, prismaMock);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-TestPlanIt-Signature"]).toMatch(/^t=\d{10},v1=[0-9a-f]{64}$/);
    // Decrypt called once for the active secret.
    expect(mockedDecrypt).toHaveBeenCalledTimes(1);
    expect(mockedDecrypt).toHaveBeenCalledWith("ciphered-active");
  });

  it("9. Generic-HMAC adapter with active + retiring: both v1 entries appear in the header", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 200 }));
    globalThis.fetch = fetchSpy as any;
    const prismaMock = buildPrismaMock({
      outboxEvent: baseOutboxEvent,
      config: baseConfig({
        adapterType: "GENERIC_HMAC",
        secrets: [
          {
            id: "s-1",
            secret: "ciphered-active",
            activatedAt: new Date(),
            retiredAt: null,
            autoRetireAt: null,
          },
          {
            id: "s-2",
            secret: "ciphered-retiring",
            activatedAt: new Date(Date.now() - 1000),
            retiredAt: null,
            autoRetireAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
          },
        ],
      }),
    });

    await dispatchWebhook(baseJobData, prismaMock);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-TestPlanIt-Signature"]).toMatch(
      /^t=\d{10},v1=[0-9a-f]{64},v1=[0-9a-f]{64}$/
    );
    // Decrypt called twice — once per secret.
    expect(mockedDecrypt).toHaveBeenCalledTimes(2);
  });

  it("10. NO_ACTIVE_SECRET: GENERIC_HMAC config with zero unretired secrets → delivery row error='NO_ACTIVE_SECRET', returns failure outcome", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    const prismaMock = buildPrismaMock({
      outboxEvent: baseOutboxEvent,
      config: baseConfig({
        adapterType: "GENERIC_HMAC",
        secrets: [],
      }),
    });

    const outcome = await dispatchWebhook(baseJobData, prismaMock);

    expect(outcome.outcome).toBe("failure");
    expect((outcome as any).error).toBe("NO_ACTIVE_SECRET");
    const createCall = prismaMock.webhookDelivery.create.mock.calls[0][0];
    expect(createCall.data.error).toBe("NO_ACTIVE_SECRET");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("11. Non-2xx response: delivery row error contains status code + truncated body; THROWS", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response("server fire", { status: 500 }));
    globalThis.fetch = fetchSpy as any;
    const prismaMock = buildPrismaMock({
      outboxEvent: baseOutboxEvent,
      config: baseConfig(),
    });

    await expect(dispatchWebhook(baseJobData, prismaMock)).rejects.toThrow();
    const createCall = prismaMock.webhookDelivery.create.mock.calls[0][0];
    expect(createCall.data.error).toMatch(/^500_/);
    expect(createCall.data.statusCode).toBe(500);
  });

  it("12. Timeout (DOMException name='TimeoutError'): delivery row error='TIMEOUT', statusCode=null; THROWS", async () => {
    const timeoutErr = new DOMException("aborted", "TimeoutError");
    const fetchSpy = vi.fn().mockRejectedValue(timeoutErr);
    globalThis.fetch = fetchSpy as any;
    const prismaMock = buildPrismaMock({
      outboxEvent: baseOutboxEvent,
      config: baseConfig(),
    });

    await expect(dispatchWebhook(baseJobData, prismaMock)).rejects.toThrow();
    const createCall = prismaMock.webhookDelivery.create.mock.calls[0][0];
    expect(createCall.data.error).toBe("TIMEOUT");
    expect(createCall.data.statusCode).toBeNull();
  });

  it("13. Connection refused (TypeError with cause.code='ECONNREFUSED'): delivery row error='CONNECTION_REFUSED'; THROWS", async () => {
    const refused = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ECONNREFUSED" },
    });
    const fetchSpy = vi.fn().mockRejectedValue(refused);
    globalThis.fetch = fetchSpy as any;
    const prismaMock = buildPrismaMock({
      outboxEvent: baseOutboxEvent,
      config: baseConfig(),
    });

    await expect(dispatchWebhook(baseJobData, prismaMock)).rejects.toThrow();
    const createCall = prismaMock.webhookDelivery.create.mock.calls[0][0];
    expect(createCall.data.error).toBe("CONNECTION_REFUSED");
  });

  it("14. Audit emitted on every attempt: success → outcome='success'; failure → outcome='failure'", async () => {
    // Success path
    const fetchSuccess = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 204 }));
    globalThis.fetch = fetchSuccess as any;
    const prismaSuccess = buildPrismaMock({
      outboxEvent: baseOutboxEvent,
      config: baseConfig(),
    });
    await dispatchWebhook(baseJobData, prismaSuccess);
    expect(mockedCaptureAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ outcome: "success" }),
      })
    );
    mockedCaptureAudit.mockClear();

    // Failure path
    const fetchFail = vi
      .fn()
      .mockResolvedValue(new Response("oops", { status: 503 }));
    globalThis.fetch = fetchFail as any;
    const prismaFail = buildPrismaMock({
      outboxEvent: baseOutboxEvent,
      config: baseConfig(),
    });
    await expect(dispatchWebhook(baseJobData, prismaFail)).rejects.toThrow();
    expect(mockedCaptureAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ outcome: "failure" }),
      })
    );
  });

  it("15. Attempt threading: jobData.attempt=2 produces delivery.attempt=2; jobData.attempt=3 produces delivery.attempt=3 (Blocker 2)", async () => {
    for (const attempt of [2, 3]) {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(new Response("", { status: 200 }));
      globalThis.fetch = fetchSpy as any;
      const prismaMock = buildPrismaMock({
        outboxEvent: baseOutboxEvent,
        config: baseConfig(),
      });

      await dispatchWebhook({ ...baseJobData, attempt: attempt }, prismaMock);

      const createCall = prismaMock.webhookDelivery.create.mock.calls[0][0];
      expect(createCall.data.attempt).toBe(attempt);
    }
  });

  it("16. payloadDigest is sha256 hex of body bytes (regression lock)", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 200 }));
    globalThis.fetch = fetchSpy as any;
    const prismaMock = buildPrismaMock({
      outboxEvent: baseOutboxEvent,
      config: baseConfig({ adapterType: "GENERIC_HMAC", secrets: [
        {
          id: "s-1",
          secret: "ciphered-active",
          activatedAt: new Date(),
          retiredAt: null,
          autoRetireAt: null,
        },
      ] }),
    });

    await dispatchWebhook(baseJobData, prismaMock);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const sentBody = init.body as string;
    const expectedDigest = createHash("sha256").update(sentBody).digest("hex");

    const createCall = prismaMock.webhookDelivery.create.mock.calls[0][0];
    expect(createCall.data.payloadDigest).toBe(expectedDigest);
  });
});

