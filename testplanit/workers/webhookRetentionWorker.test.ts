import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * v0.23.0 Phase 4 Plan 04-04 — webhook retention worker unit tests.
 *
 * TDD RED scaffold. Mocks:
 *   - prisma.$executeRaw — driven per-table via mockImplementationOnce chains
 *     so we can simulate the LIMIT 1000 batch loop (n, n, ..., 0).
 *   - captureAuditEvent — assert exactly ONE call per purgeOnce() with the
 *     totals + durationMs metadata.
 *
 * Clock is locked via vi.useFakeTimers() + vi.setSystemTime() so the cutoff
 * derivation is deterministic across cases (case 8 asserts the exact
 * 30 * 24 * 60 * 60 * 1000 math).
 */

const mockExecuteRaw = vi.fn();
const mockCaptureAuditEvent = vi.fn();

vi.mock("../lib/prisma", () => ({
  prisma: {
    $executeRaw: (...args: unknown[]) => mockExecuteRaw(...args),
  },
}));

vi.mock("../lib/services/auditLog", () => ({
  captureAuditEvent: (...args: unknown[]) => mockCaptureAuditEvent(...args),
}));

import { purgeOnce } from "./webhookRetentionWorker";

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

  it("4. batches deletes with LIMIT 1000 and loops until rowsAffected === 0 (D-27 + warning-5 lock)", async () => {
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
});
