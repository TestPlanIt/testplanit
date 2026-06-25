import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * webhook retention worker unit tests.
 *
 * TDD RED scaffold. Mocks:
 * - baseDb.$executeRaw — driven per-table via mockImplementationOnce chains
 * so we can simulate the LIMIT 1000 batch loop (n, n,..., 0).
 * - captureAuditEvent — assert exactly ONE call per purgeOnce() with the
 * totals + durationMs metadata.
 *
 * Clock is locked via vi.useFakeTimers() + vi.setSystemTime() so the cutoff
 * derivation is deterministic across cases (case 8 asserts the exact
 * 30 * 24 * 60 * 60 * 1000 math).
 */

const mockExecuteRaw = vi.fn();
const mockCaptureAuditEvent = vi.fn();
const mockIsMultiTenantMode = vi.fn();
const mockGetAllTenantIds = vi.fn();
const mockGetTenantDbClient = vi.fn();
const mockDisconnectAllTenantClients = vi.fn();

vi.mock("../lib/db", () => ({
  baseDb: {
    $executeRaw: (...args: unknown[]) => mockExecuteRaw(...args),
  },
}));

vi.mock("../lib/services/auditLog", () => ({
  captureAuditEvent: (...args: unknown[]) => mockCaptureAuditEvent(...args),
}));

vi.mock("../lib/multiTenantDb", () => ({
  isMultiTenantMode: () => mockIsMultiTenantMode(),
  getAllTenantIds: () => mockGetAllTenantIds(),
  getTenantDbClient: (tenantId: string) =>
    mockGetTenantDbClient(tenantId),
  disconnectAllTenantClients: () => mockDisconnectAllTenantClients(),
}));

import { purgeAllTenantsOnce, purgeOnce } from "./webhookRetentionWorker";

/**
 * Helper — flatten the tagged-template SQL strings array into a single string
 * for grep-style assertions. `$executeRaw` is invoked as a tagged template so
 * `args[0]` is a TemplateStringsArray of the literal SQL chunks; subsequent
 * args are the interpolated values.
 */
function sqlOf(call: unknown[]): string {
  const tpl = call[0] as TemplateStringsArray | string[];
  if (Array.isArray(tpl)) {
    return tpl.join("?");
  }
  return String(tpl);
}

/**
 * Drive the table-by-table $executeRaw mock by inspecting the SQL of each
 * incoming call and returning the next response from the matching queue.
 */
function setupTableQueues(opts: {
  WebhookDelivery?: number[];
  WebhookEventDedup?: number[];
  WebhookOutboxEvent?: number[];
}): void {
  const queues: Record<string, number[]> = {
    WebhookDelivery: [...(opts.WebhookDelivery ?? [0])],
    WebhookEventDedup: [...(opts.WebhookEventDedup ?? [0])],
    WebhookOutboxEvent: [...(opts.WebhookOutboxEvent ?? [0])],
  };
  mockExecuteRaw.mockImplementation((...args: unknown[]) => {
    const sql = sqlOf(args);
    let key: string | null = null;
    if (sql.includes('"WebhookDelivery"')) key = "WebhookDelivery";
    else if (sql.includes('"WebhookEventDedup"')) key = "WebhookEventDedup";
    else if (sql.includes('"WebhookOutboxEvent"')) key = "WebhookOutboxEvent";
    if (!key) {
      throw new Error("Unexpected $executeRaw target SQL: " + sql);
    }
    const q = queues[key];
    if (q.length === 0) {
      throw new Error(`Queue exhausted for ${key}`);
    }
    return Promise.resolve(q.shift());
  });
}

describe("workers/webhookRetentionWorker.purgeOnce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T03:00:00.000Z"));
    mockExecuteRaw.mockReset();
    mockCaptureAuditEvent.mockReset();
    mockIsMultiTenantMode.mockReset();
    mockGetAllTenantIds.mockReset();
    mockGetTenantDbClient.mockReset();
    mockDisconnectAllTenantClients.mockReset();
    mockDisconnectAllTenantClients.mockResolvedValue(undefined);
    mockIsMultiTenantMode.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("1. deletes WebhookDelivery rows older than 30 days using $executeRaw with LIMIT 1000", async () => {
    setupTableQueues({
      WebhookDelivery: [47, 0],
      WebhookEventDedup: [0],
      WebhookOutboxEvent: [0],
    });

    const result = await purgeOnce();

    const deliveryCalls = mockExecuteRaw.mock.calls.filter((c) =>
      sqlOf(c).includes('"WebhookDelivery"')
    );
    expect(deliveryCalls.length).toBe(2); // loop until rowsAffected === 0
    expect(sqlOf(deliveryCalls[0])).toMatch(
      /DELETE.*"WebhookDelivery".*"receivedAt".*LIMIT\s+1000/is
    );
    expect(result.webhookDeliveryRows).toBe(47);
  });

  it("2. deletes WebhookEventDedup rows older than 30 days FILTERED BY processedAt", async () => {
    // Pass-1 fix lock — column must be processedAt per schema.zmodel:3591.
    // We assert the column is processedAt by name; the absence of any other
    // timestamp column is implicit (only processedAt exists on the model).
    setupTableQueues({
      WebhookDelivery: [0],
      WebhookEventDedup: [13, 0],
      WebhookOutboxEvent: [0],
    });

    const result = await purgeOnce();

    const dedupCalls = mockExecuteRaw.mock.calls.filter((c) =>
      sqlOf(c).includes('"WebhookEventDedup"')
    );
    expect(dedupCalls.length).toBe(2);
    const sql = sqlOf(dedupCalls[0]);
    expect(sql).toContain('"WebhookEventDedup"');
    expect(sql).toContain('"processedAt"');
    // Pass-1 fix lock: filter column must be the processedAt timestamp,
    // matching schema.zmodel WebhookEventDedup model.
    expect(sql).toMatch(/"processedAt"\s*</);
    expect(result.webhookEventDedupRows).toBe(13);
  });

  it("3. deletes dispatched WebhookOutboxEvent rows older than 30 days; un-dispatched rows survive", async () => {
    setupTableQueues({
      WebhookDelivery: [0],
      WebhookEventDedup: [0],
      WebhookOutboxEvent: [89, 0],
    });

    const result = await purgeOnce();

    const outboxCalls = mockExecuteRaw.mock.calls.filter((c) =>
      sqlOf(c).includes('"WebhookOutboxEvent"')
    );
    expect(outboxCalls.length).toBe(2);
    const sql = sqlOf(outboxCalls[0]);
    expect(sql).toContain('"WebhookOutboxEvent"');
    expect(sql).toMatch(/"dispatchedAt"\s+IS\s+NOT\s+NULL/i);
    expect(sql).toMatch(/"dispatchedAt"\s*</);
    expect(result.webhookOutboxEventRows).toBe(89);
  });

  it("4. batches deletes with LIMIT 1000 and loops until rowsAffected === 0 (+ warning-5 lock)", async () => {
    setupTableQueues({
      WebhookDelivery: [1000, 1000, 1000, 247, 0],
      WebhookEventDedup: [0],
      WebhookOutboxEvent: [0],
    });

    const result = await purgeOnce();

    const deliveryCalls = mockExecuteRaw.mock.calls.filter((c) =>
      sqlOf(c).includes('"WebhookDelivery"')
    );
    expect(deliveryCalls.length).toBe(5); // 4 batches that returned >0 + 1 final 0
    for (const call of deliveryCalls) {
      expect(sqlOf(call)).toContain("LIMIT 1000");
    }
    expect(result.webhookDeliveryRows).toBe(3247);
  });

  it("5. emits exactly ONE WEBHOOK_RETENTION_PURGED audit row per run with totals", async () => {
    setupTableQueues({
      WebhookDelivery: [47, 0],
      WebhookEventDedup: [13, 0],
      WebhookOutboxEvent: [89, 0],
    });

    await purgeOnce();

    expect(mockCaptureAuditEvent).toHaveBeenCalledTimes(1);
    const event = mockCaptureAuditEvent.mock.calls[0][0];
    expect(event.action).toBe("WEBHOOK_RETENTION_PURGED");
    expect(event.userId).toBe("__system__");
    expect(event.metadata).toMatchObject({
      webhookDeliveryRows: 47,
      webhookEventDedupRows: 13,
      webhookOutboxEventRows: 89,
    });
    expect(typeof event.metadata.durationMs).toBe("number");
    expect(typeof event.metadata.cutoff).toBe("string");
  });

  it("6. returns totals and durationMs", async () => {
    setupTableQueues({
      WebhookDelivery: [47, 0],
      WebhookEventDedup: [13, 0],
      WebhookOutboxEvent: [89, 0],
    });

    const result = await purgeOnce();

    expect(result).toMatchObject({
      webhookDeliveryRows: 47,
      webhookEventDedupRows: 13,
      webhookOutboxEventRows: 89,
    });
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("7. with zero rows still emits the audit row (operator signal that worker ran)", async () => {
    setupTableQueues({
      WebhookDelivery: [0],
      WebhookEventDedup: [0],
      WebhookOutboxEvent: [0],
    });

    await purgeOnce();

    expect(mockCaptureAuditEvent).toHaveBeenCalledTimes(1);
    const event = mockCaptureAuditEvent.mock.calls[0][0];
    expect(event.action).toBe("WEBHOOK_RETENTION_PURGED");
    expect(event.metadata).toMatchObject({
      webhookDeliveryRows: 0,
      webhookEventDedupRows: 0,
      webhookOutboxEventRows: 0,
    });
  });

  it("8. 30-day cutoff is exact: now - (30 * 24 * 60 * 60 * 1000)", async () => {
    setupTableQueues({
      WebhookDelivery: [0],
      WebhookEventDedup: [0],
      WebhookOutboxEvent: [0],
    });

    await purgeOnce();

    // Capture cutoff Date binding from any of the $executeRaw template values.
    // Tagged-template invocation: args[0] = strings, args[1..] = interpolations.
    const firstCall = mockExecuteRaw.mock.calls[0];
    const cutoffArg = firstCall.find((a: unknown) => a instanceof Date) as Date;
    expect(cutoffArg).toBeInstanceOf(Date);

    const expectedNow = new Date("2026-04-29T03:00:00.000Z").getTime();
    const expectedCutoff = expectedNow - 30 * 24 * 60 * 60 * 1000;
    expect(cutoffArg.getTime()).toBe(expectedCutoff);

    // And spelled out: 2026-03-30T03:00:00.000Z
    expect(cutoffArg.toISOString()).toBe("2026-03-30T03:00:00.000Z");
  });

  it("9. accepts an explicit Prisma client and tenantId, and stamps tenantId on the audit event", async () => {
    const tenantExecute = vi.fn().mockResolvedValue(0);
    const tenantClient = { $executeRaw: tenantExecute } as never;

    await purgeOnce(tenantClient, "tenant-a");

    // Default mockExecuteRaw was NOT used — the per-tenant client was.
    expect(mockExecuteRaw).not.toHaveBeenCalled();
    expect(tenantExecute).toHaveBeenCalled();
    const event = mockCaptureAuditEvent.mock.calls[0][0];
    expect(event.tenantId).toBe("tenant-a");
  });

  it("10. truncated=false on a successful sweep that finishes inside the time budget", async () => {
    setupTableQueues({
      WebhookDelivery: [47, 0],
      WebhookEventDedup: [13, 0],
      WebhookOutboxEvent: [89, 0],
    });

    const result = await purgeOnce();

    expect(result.truncated).toBe(false);
    expect(mockCaptureAuditEvent.mock.calls[0][0].metadata.truncated).toBe(
      false
    );
  });

  it("11. truncated=true when the per-tenant time budget elapses; remaining rows are left for next pass", async () => {
    // budget=0 forces every batched-delete loop to exit on its first
    // Date.now()<deadline check. The DELETE for WebhookDelivery still runs
    // once via the existing while-true semantics? No — the new gate is
    // `while (Date.now() < deadlineMs)`, which evaluates BEFORE the first
    // call when budgetMs=0 and timers are fake. So the helpers no-op and
    // the truncated flag fires.
    setupTableQueues({
      WebhookDelivery: [0],
      WebhookEventDedup: [0],
      WebhookOutboxEvent: [0],
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await purgeOnce(undefined, undefined, 0);

    expect(result.truncated).toBe(true);
    expect(mockCaptureAuditEvent.mock.calls[0][0].metadata.truncated).toBe(
      true
    );
    expect(
      warnSpy.mock.calls.some((args) =>
        args.some(
          (a) => typeof a === "string" && a.includes("tenant time budget")
        )
      )
    ).toBe(true);
    warnSpy.mockRestore();
  });
});

describe("workers/webhookRetentionWorker.purgeAllTenantsOnce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T03:00:00.000Z"));
    mockExecuteRaw.mockReset();
    mockCaptureAuditEvent.mockReset();
    mockIsMultiTenantMode.mockReset();
    mockGetAllTenantIds.mockReset();
    mockGetTenantDbClient.mockReset();
    mockDisconnectAllTenantClients.mockReset();
    mockDisconnectAllTenantClients.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("single-tenant mode: runs purgeOnce against the singleton client and returns one result", async () => {
    mockIsMultiTenantMode.mockReturnValue(false);
    mockExecuteRaw.mockResolvedValue(0);

    const results = await purgeAllTenantsOnce();

    expect(results).toHaveLength(1);
    expect(mockExecuteRaw).toHaveBeenCalled();
    expect(mockGetTenantDbClient).not.toHaveBeenCalled();
    expect(mockCaptureAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockCaptureAuditEvent.mock.calls[0][0].tenantId).toBeUndefined();
  });

  it("multi-tenant mode: runs purgeOnce per tenant with that tenant's client and emits one audit row per tenant", async () => {
    mockIsMultiTenantMode.mockReturnValue(true);
    mockGetAllTenantIds.mockReturnValue(["tenant-a", "tenant-b"]);
    const tenantAExecute = vi.fn().mockResolvedValue(0);
    const tenantBExecute = vi.fn().mockResolvedValue(0);
    mockGetTenantDbClient.mockImplementation((id: string) =>
      id === "tenant-a"
        ? { $executeRaw: tenantAExecute }
        : { $executeRaw: tenantBExecute }
    );

    const results = await purgeAllTenantsOnce();

    expect(results).toHaveLength(2);
    expect(tenantAExecute).toHaveBeenCalled();
    expect(tenantBExecute).toHaveBeenCalled();
    expect(mockCaptureAuditEvent).toHaveBeenCalledTimes(2);
    expect(mockCaptureAuditEvent.mock.calls[0][0].tenantId).toBe("tenant-a");
    expect(mockCaptureAuditEvent.mock.calls[1][0].tenantId).toBe("tenant-b");
  });

  it("multi-tenant mode: a tenant-level error does NOT abort other tenants", async () => {
    mockIsMultiTenantMode.mockReturnValue(true);
    mockGetAllTenantIds.mockReturnValue(["tenant-a", "tenant-b"]);
    const tenantBExecute = vi.fn().mockResolvedValue(0);
    mockGetTenantDbClient.mockImplementation((id: string) => {
      if (id === "tenant-a") {
        throw new Error("tenant-a config missing");
      }
      return { $executeRaw: tenantBExecute };
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const results = await purgeAllTenantsOnce();

    // Only tenant-b succeeded
    expect(results).toHaveLength(1);
    expect(tenantBExecute).toHaveBeenCalled();
    expect(mockCaptureAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockCaptureAuditEvent.mock.calls[0][0].tenantId).toBe("tenant-b");
    expect(errorSpy).toHaveBeenCalled();
  });

  it("multi-tenant mode with zero tenants returns an empty array", async () => {
    mockIsMultiTenantMode.mockReturnValue(true);
    mockGetAllTenantIds.mockReturnValue([]);

    const results = await purgeAllTenantsOnce();

    expect(results).toEqual([]);
    expect(mockExecuteRaw).not.toHaveBeenCalled();
    expect(mockCaptureAuditEvent).not.toHaveBeenCalled();
  });

  it("multi-tenant mode: disconnects all tenant Prisma clients after the pass to free Rust query engine buffers", async () => {
    mockIsMultiTenantMode.mockReturnValue(true);
    mockGetAllTenantIds.mockReturnValue(["tenant-a", "tenant-b"]);
    mockGetTenantDbClient.mockImplementation(() => ({
      $executeRaw: vi.fn().mockResolvedValue(0),
    }));

    await purgeAllTenantsOnce();

    expect(mockDisconnectAllTenantClients).toHaveBeenCalledTimes(1);
  });

  it("multi-tenant mode: disconnect still runs even when a tenant errors mid-pass", async () => {
    mockIsMultiTenantMode.mockReturnValue(true);
    mockGetAllTenantIds.mockReturnValue(["tenant-a", "tenant-b"]);
    mockGetTenantDbClient.mockImplementation((id: string) => {
      if (id === "tenant-a") throw new Error("boom");
      return { $executeRaw: vi.fn().mockResolvedValue(0) };
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await purgeAllTenantsOnce();

    expect(mockDisconnectAllTenantClients).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("single-tenant mode: does NOT disconnect tenant clients (the singleton client is owned elsewhere)", async () => {
    mockIsMultiTenantMode.mockReturnValue(false);
    mockExecuteRaw.mockResolvedValue(0);

    await purgeAllTenantsOnce();

    expect(mockDisconnectAllTenantClients).not.toHaveBeenCalled();
  });
});
