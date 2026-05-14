import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchWebhook, type DispatchJobData } from "./dispatch";

vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/utils/encryption", () => ({
  decrypt: vi
    .fn()
    .mockImplementation(async (cipher: string) => `decrypted:${cipher}`),
}));

import { captureAuditEvent } from "~/lib/services/auditLog";
import { decrypt } from "~/utils/encryption";

const mockedCaptureAudit = captureAuditEvent as unknown as ReturnType<
  typeof vi.fn
>;
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
      // dispatch.ts updates lastDispatchedAt + lastSuccessAt | lastFailureAt
      // per attempt. Tests assert on .mock.calls[*][0].data shape.
      update: vi.fn().mockImplementation(async (args: any) => ({
        id: opts.config?.id ?? "cfg-1",
        ...opts.config,
        ...args.data,
      })),
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
  project: { id: 7, name: "Acme", isDeleted: false },
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

  it("2a. returns skipped_inactive when project.isDeleted === true (L-05 tenancy gate, no fetch, no delivery)", async () => {
    // Soft-deleted projects must not fan webhooks out to external systems
    // an outbox row that committed BEFORE the project was deleted would
    // otherwise leak events for a tenant the admin has already removed.
    // The dispatcher treats the soft-deleted project as functionally
    // inactive: same outcome shape as the isActive===false path.
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    const prismaMock = buildPrismaMock({
      outboxEvent: baseOutboxEvent,
      config: baseConfig({
        project: { id: 7, name: "Acme", isDeleted: true },
      }),
    });

    const outcome = await dispatchWebhook(baseJobData, prismaMock);

    expect(outcome).toEqual({ outcome: "skipped_inactive" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prismaMock.webhookDelivery.create).not.toHaveBeenCalled();
  });

  it("3. returns skipped_unsubscribed when subscribedEvents excludes eventName (, no delivery row)", async () => {
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

  it("5. webhook.test bypass: non-empty subscribedEvents that excludes 'webhook.test' → dispatch STILL proceeds ()", async () => {
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
    expect(headers["X-TestPlanIt-Signature"]).toMatch(
      /^t=\d{10},v1=[0-9a-f]{64}$/
    );
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
      .mockResolvedValue(new Response("", { status: 200 }));
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

  it("15. Attempt threading: jobData.attempt=2 produces delivery.attempt=2; jobData.attempt=3 produces delivery.attempt=3 ()", async () => {
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
    const sentBody = init.body as string;
    const expectedDigest = createHash("sha256").update(sentBody).digest("hex");

    const createCall = prismaMock.webhookDelivery.create.mock.calls[0][0];
    expect(createCall.data.payloadDigest).toBe(expectedDigest);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// DISABLED gate + per-attempt timestamps +
// replay/eventId threading (+). The dispatcher now:
// 1. Short-circuits on endpointHealth === "DISABLED" with a stub delivery
// row (error="endpoint_disabled") and no HTTP call.
// 2. Updates lastDispatchedAt + lastSuccessAt | lastFailureAt on every
// attempt's WebhookConfig.update call. Does NOT touch
// consecutiveFailureCount — that's the worker hook's responsibility.
// 3. Stamps WebhookOutboxEvent.eventId onto every WebhookDelivery row
// (success row, failure row, AND the DISABLED stub).
// 4. Threads jobData.replayedFromDeliveryId from BullMQ job data into
// the WebhookDelivery row when present.
// ──────────────────────────────────────────────────────────────────────────

describe("dispatchWebhook — endpoint_disabled gate ( / )", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockedCaptureAudit.mockClear();
    mockedDecrypt.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("D1. DISABLED config skips HTTP and writes a stub delivery row with error='endpoint_disabled'", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    const prismaMock = buildPrismaMock({
      outboxEvent: { ...baseOutboxEvent, eventId: "evt_abc" },
      config: baseConfig({ endpointHealth: "DISABLED" }),
    });

    const outcome = await dispatchWebhook(
      { ...baseJobData, attempt: 2 },
      prismaMock
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prismaMock.webhookDelivery.create).toHaveBeenCalledTimes(1);
    const createCall = prismaMock.webhookDelivery.create.mock.calls[0][0];
    expect(createCall.data.error).toBe("endpoint_disabled");
    expect(createCall.data.direction).toBe("OUTBOUND");
    expect(createCall.data.statusCode).toBeNull();
    expect(createCall.data.attempt).toBe(2);
    expect(createCall.data.eventId).toBe("evt_abc");
    expect(createCall.data.eventType).toBe("test_run.completed");

    expect(mockedCaptureAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "WEBHOOK_DISPATCHED",
        metadata: expect.objectContaining({
          outcome: "failure",
          error: "endpoint_disabled",
          eventId: "evt_abc",
        }),
      })
    );

    expect(outcome).toMatchObject({
      outcome: "failure",
      statusCode: null,
      error: "endpoint_disabled",
    });
  });

  it("D2. HEALTHY config still fires the HTTP request (DISABLED gate does not block HEALTHY)", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 200 }));
    globalThis.fetch = fetchSpy as any;
    const prismaMock = buildPrismaMock({
      outboxEvent: baseOutboxEvent,
      config: baseConfig({ endpointHealth: "HEALTHY" }),
    });

    const outcome = await dispatchWebhook(baseJobData, prismaMock);

    expect(outcome.outcome).toBe("success");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("D3. DEGRADED config still fires the HTTP request (early warning, not a block)", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 200 }));
    globalThis.fetch = fetchSpy as any;
    const prismaMock = buildPrismaMock({
      outboxEvent: baseOutboxEvent,
      config: baseConfig({ endpointHealth: "DEGRADED" }),
    });

    const outcome = await dispatchWebhook(baseJobData, prismaMock);

    expect(outcome.outcome).toBe("success");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("D4. DISABLED gate runs AFTER isActive check — isActive=false short-circuits first with no delivery row", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    const prismaMock = buildPrismaMock({
      outboxEvent: baseOutboxEvent,
      config: baseConfig({ isActive: false, endpointHealth: "DISABLED" }),
    });

    const outcome = await dispatchWebhook(baseJobData, prismaMock);

    // isActive=false short-circuits BEFORE the DISABLED gate, so NO delivery
    // row written and NO endpoint_disabled audit emitted.
    expect(outcome).toEqual({ outcome: "skipped_inactive" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prismaMock.webhookDelivery.create).not.toHaveBeenCalled();
  });
});

describe("dispatchWebhook — per-attempt timestamps ( / )", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockedCaptureAudit.mockClear();
    mockedDecrypt.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("T1. success path updates lastDispatchedAt AND lastSuccessAt; lastFailureAt NOT touched", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 200 }));
    globalThis.fetch = fetchSpy as any;
    const prismaMock = buildPrismaMock({
      outboxEvent: baseOutboxEvent,
      config: baseConfig(),
    });

    await dispatchWebhook(baseJobData, prismaMock);

    expect(prismaMock.webhookConfig.update).toHaveBeenCalled();
    // Aggregate the data fields across all update calls.
    const allData: Record<string, unknown> = {};
    for (const call of prismaMock.webhookConfig.update.mock.calls) {
      Object.assign(allData, call[0].data);
    }
    expect(allData.lastDispatchedAt).toBeInstanceOf(Date);
    expect(allData.lastSuccessAt).toBeInstanceOf(Date);
    expect(allData).not.toHaveProperty("lastFailureAt");
  });

  it("T2. failure path (non-2xx) updates lastDispatchedAt AND lastFailureAt; lastSuccessAt NOT touched", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response("oops", { status: 500 }));
    globalThis.fetch = fetchSpy as any;
    const prismaMock = buildPrismaMock({
      outboxEvent: baseOutboxEvent,
      config: baseConfig(),
    });

    await expect(dispatchWebhook(baseJobData, prismaMock)).rejects.toThrow();

    expect(prismaMock.webhookConfig.update).toHaveBeenCalled();
    const allData: Record<string, unknown> = {};
    for (const call of prismaMock.webhookConfig.update.mock.calls) {
      Object.assign(allData, call[0].data);
    }
    expect(allData.lastDispatchedAt).toBeInstanceOf(Date);
    expect(allData.lastFailureAt).toBeInstanceOf(Date);
    expect(allData).not.toHaveProperty("lastSuccessAt");
  });

  it("T3. dispatch.ts does NOT update consecutiveFailureCount (counter is the worker hook's responsibility — locked seam)", async () => {
    // Run BOTH success and failure paths and assert no counter touch on either.
    const fetchSuccess = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 200 }));
    globalThis.fetch = fetchSuccess as any;
    const prismaSuccess = buildPrismaMock({
      outboxEvent: baseOutboxEvent,
      config: baseConfig(),
    });
    await dispatchWebhook(baseJobData, prismaSuccess);
    for (const call of prismaSuccess.webhookConfig.update.mock.calls) {
      expect(call[0].data).not.toHaveProperty("consecutiveFailureCount");
    }

    const fetchFail = vi
      .fn()
      .mockResolvedValue(new Response("oops", { status: 503 }));
    globalThis.fetch = fetchFail as any;
    const prismaFail = buildPrismaMock({
      outboxEvent: baseOutboxEvent,
      config: baseConfig(),
    });
    await expect(dispatchWebhook(baseJobData, prismaFail)).rejects.toThrow();
    for (const call of prismaFail.webhookConfig.update.mock.calls) {
      expect(call[0].data).not.toHaveProperty("consecutiveFailureCount");
    }
  });
});

describe("dispatchWebhook — replay + eventId threading ( / + )", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockedCaptureAudit.mockClear();
    mockedDecrypt.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("R1. jobData.replayedFromDeliveryId is persisted alongside eventId on the success delivery row", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 200 }));
    globalThis.fetch = fetchSpy as any;
    const prismaMock = buildPrismaMock({
      outboxEvent: { ...baseOutboxEvent, eventId: "evt_xyz" },
      config: baseConfig(),
    });

    await dispatchWebhook(
      { ...baseJobData, replayedFromDeliveryId: "orig_id_123" } as any,
      prismaMock
    );

    const createCall = prismaMock.webhookDelivery.create.mock.calls[0][0];
    expect(createCall.data.replayedFromDeliveryId).toBe("orig_id_123");
    expect(createCall.data.eventId).toBe("evt_xyz");
  });

  it("R2. no replayedFromDeliveryId in jobData → field absent or null on row, eventId still threaded", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 200 }));
    globalThis.fetch = fetchSpy as any;
    const prismaMock = buildPrismaMock({
      outboxEvent: { ...baseOutboxEvent, eventId: "evt_normal" },
      config: baseConfig(),
    });

    await dispatchWebhook(baseJobData, prismaMock);

    const createCall = prismaMock.webhookDelivery.create.mock.calls[0][0];
    // Either undefined (field absent) or null are acceptable for the
    // not-a-replay path — both translate to NULL in Postgres.
    expect(
      createCall.data.replayedFromDeliveryId === undefined ||
        createCall.data.replayedFromDeliveryId === null
    ).toBe(true);
    expect(createCall.data.eventId).toBe("evt_normal");
  });

  it("R3. replay against a DISABLED config writes the stub row with replayedFromDeliveryId AND eventId", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    const prismaMock = buildPrismaMock({
      outboxEvent: { ...baseOutboxEvent, eventId: "evt_disabled" },
      config: baseConfig({ endpointHealth: "DISABLED" }),
    });

    await dispatchWebhook(
      { ...baseJobData, replayedFromDeliveryId: "orig_id" } as any,
      prismaMock
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    const createCall = prismaMock.webhookDelivery.create.mock.calls[0][0];
    expect(createCall.data.error).toBe("endpoint_disabled");
    expect(createCall.data.replayedFromDeliveryId).toBe("orig_id");
    expect(createCall.data.eventId).toBe("evt_disabled");
  });

  it("R4. eventId is stamped on the success delivery row ( outbound correlation)", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 200 }));
    globalThis.fetch = fetchSpy as any;
    const prismaMock = buildPrismaMock({
      outboxEvent: { ...baseOutboxEvent, eventId: "evt_success" },
      config: baseConfig(),
    });

    await dispatchWebhook(baseJobData, prismaMock);

    const createCall = prismaMock.webhookDelivery.create.mock.calls[0][0];
    expect(createCall.data.eventId).toBe("evt_success");
  });

  it("R5. eventId is stamped on the non-2xx failure delivery row", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response("server fire", { status: 500 }));
    globalThis.fetch = fetchSpy as any;
    const prismaMock = buildPrismaMock({
      outboxEvent: { ...baseOutboxEvent, eventId: "evt_500" },
      config: baseConfig(),
    });

    await expect(dispatchWebhook(baseJobData, prismaMock)).rejects.toThrow();

    const createCall = prismaMock.webhookDelivery.create.mock.calls[0][0];
    expect(createCall.data.error).toMatch(/^500_/);
    expect(createCall.data.eventId).toBe("evt_500");
  });

  it("R6. non-2xx with a huge streaming response body: error sentinel stays bounded and the underlying stream is cancelled before draining", async () => {
    // Misbehaving consumer that keeps emitting 64 KB chunks indefinitely.
    // Without the capped reader the worker would buffer the whole thing
    // into memory; cancel() must fire as soon as the cap is reached.
    let pulls = 0;
    let cancelled = false;
    const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
    const stream = new ReadableStream({
      pull(controller) {
        pulls++;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const hugeResponse = new Response(stream, { status: 502 });
    const fetchSpy = vi.fn().mockResolvedValue(hugeResponse);
    globalThis.fetch = fetchSpy as any;
    const prismaMock = buildPrismaMock({
      outboxEvent: { ...baseOutboxEvent, eventId: "evt_huge" },
      config: baseConfig(),
    });

    await expect(dispatchWebhook(baseJobData, prismaMock)).rejects.toThrow();

    const createCall = prismaMock.webhookDelivery.create.mock.calls[0][0];
    // Sentinel still capped by MAX_ERROR_LEN (1024).
    expect(createCall.data.error.length).toBeLessThanOrEqual(1024);
    expect(createCall.data.error).toMatch(/^502_/);
    // We pulled at most a couple of chunks before hitting the cap and
    // cancelling — NOT enough to consume an unbounded stream.
    expect(pulls).toBeLessThan(5);
    expect(cancelled).toBe(true);
  });
});
