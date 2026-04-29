import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

const mockQueueAdd = vi.fn();
const mockGetQueue = vi.fn(() => ({ add: mockQueueAdd }));

vi.mock("~/lib/queues", () => ({
  getWebhookDispatchQueue: () => mockGetQueue(),
}));

import { captureAuditEvent } from "~/lib/services/auditLog";

import {
  BULK_REPLAY_HARD_CAP,
  bulkReplayDeliveries,
  replayDelivery,
} from "./replay";

const mockedCaptureAudit = captureAuditEvent as unknown as ReturnType<
  typeof vi.fn
>;

/**
 * Build a Prisma-shaped mock for the replay service.
 *
 * The helper reads the original delivery row + (for OUTBOUND) the linked
 * WebhookOutboxEvent row by `eventId`. Mocks expose findUnique on both models
 * so individual tests configure return values per-call (e.g., bulk tests pass
 * an array of deliveries, each loaded once).
 */
function buildPrismaMock(opts: {
  deliveriesById?: Record<string, unknown>;
  outboxByEventId?: Record<string, unknown>;
}) {
  const deliveryFindUnique = vi.fn(async (args: { where: { id: string } }) => {
    return opts.deliveriesById?.[args.where.id] ?? null;
  });
  const outboxFindUnique = vi.fn(
    async (args: { where: { eventId: string } }) => {
      return opts.outboxByEventId?.[args.where.eventId] ?? null;
    }
  );
  return {
    webhookDelivery: {
      findUnique: deliveryFindUnique,
      create: vi.fn(),
    },
    webhookOutboxEvent: {
      findUnique: outboxFindUnique,
    },
  } as any;
}

const baseOutboundDelivery = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  id: "orig_id",
  direction: "OUTBOUND",
  eventId: "evt_orig",
  webhookConfigId: "cfg_a",
  webhookConfig: { projectId: 7, adapterType: "SLACK" },
  ...overrides,
});

const baseInboundDelivery = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  id: "orig_inbound",
  direction: "INBOUND",
  eventId: null,
  webhookConfigId: "cfg_in",
  webhookConfig: { projectId: 7, adapterType: "JIRA" },
  ...overrides,
});

const baseOutboxRow = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  id: "outbox_id_1",
  payload: { foo: "bar" },
  eventName: "test_run.completed",
  ...overrides,
});

describe("lib/webhooks/replay", () => {
  beforeEach(() => {
    mockedCaptureAudit.mockClear();
    mockQueueAdd.mockReset();
    mockQueueAdd.mockResolvedValue(undefined);
  });

  it("1. outbound-replay-loads-outbox-and-enqueues-job: queue.add called once + WEBHOOK_REPLAYED audit emitted", async () => {
    const prisma = buildPrismaMock({
      deliveriesById: { orig_id: baseOutboundDelivery() },
      outboxByEventId: { evt_orig: baseOutboxRow() },
    });

    const result = await replayDelivery(
      "orig_id",
      { actorUserId: "u1", source: "single" },
      prisma
    );

    expect(result).toMatchObject({ outcome: "queued" });
    expect((result as { queueJobId: string }).queueJobId).toEqual(
      expect.stringMatching(/^replay--orig_id--/)
    );

    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    const [name, jobData, jobOpts] = mockQueueAdd.mock.calls[0];
    expect(name).toBe("dispatch");
    expect(jobData).toMatchObject({
      webhookConfigId: "cfg_a",
      outboxEventId: "outbox_id_1",
      eventId: "evt_orig",
      attempt: 1,
      replayedFromDeliveryId: "orig_id",
    });
    expect((jobOpts as { jobId: string }).jobId).toEqual(
      expect.stringMatching(/^replay--orig_id--/)
    );

    expect(mockedCaptureAudit).toHaveBeenCalledTimes(1);
    const auditCall = mockedCaptureAudit.mock.calls[0][0];
    expect(auditCall.action).toBe("WEBHOOK_REPLAYED");
    expect(auditCall.entityType).toBe("WebhookDelivery");
    expect(auditCall.entityId).toBe("orig_id");
    expect(auditCall.projectId).toBe(7);
    expect(auditCall.userId).toBe("u1");
    expect(auditCall.metadata).toMatchObject({
      webhookConfigId: "cfg_a",
      originalDeliveryId: "orig_id",
      replayDeliveryId: null,
      actorUserId: "u1",
      source: "single",
    });
    expect(auditCall.metadata.batchId).toBeUndefined();
  });

  it("2. inbound-replay-returns-rejected: NO queue, NO audit, NO row write (D-17a)", async () => {
    const prisma = buildPrismaMock({
      deliveriesById: { orig_inbound: baseInboundDelivery() },
    });

    const result = await replayDelivery(
      "orig_inbound",
      { actorUserId: "u1", source: "single" },
      prisma
    );

    expect(result).toEqual({
      outcome: "rejected",
      reason: "inbound_replay_not_supported",
    });
    expect(mockQueueAdd).not.toHaveBeenCalled();
    expect(mockedCaptureAudit).not.toHaveBeenCalled();
    expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
  });

  it("3. bulk-source-attaches-batchId-to-audit-on-outbound: source=bulk + batchId in metadata", async () => {
    const prisma = buildPrismaMock({
      deliveriesById: { orig_id: baseOutboundDelivery() },
      outboxByEventId: { evt_orig: baseOutboxRow() },
    });

    const result = await replayDelivery(
      "orig_id",
      { actorUserId: "u1", source: "bulk", batchId: "bat_xyz" },
      prisma
    );

    expect(result.outcome).toBe("queued");
    expect(mockedCaptureAudit).toHaveBeenCalledTimes(1);
    const meta = mockedCaptureAudit.mock.calls[0][0].metadata;
    expect(meta.source).toBe("bulk");
    expect(meta.batchId).toBe("bat_xyz");
  });

  it("4. outbound-replay-of-replay-allowed (D-17): replays of replays succeed; jobData.replayedFromDeliveryId points to THIS row", async () => {
    const prisma = buildPrismaMock({
      deliveriesById: {
        replay_of_orig: baseOutboundDelivery({
          id: "replay_of_orig",
          eventId: "evt_orig",
          replayedFromDeliveryId: "orig_id",
        }),
      },
      outboxByEventId: { evt_orig: baseOutboxRow() },
    });

    const result = await replayDelivery(
      "replay_of_orig",
      { actorUserId: "u1", source: "single" },
      prisma
    );

    expect(result.outcome).toBe("queued");
    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    const [, jobData] = mockQueueAdd.mock.calls[0];
    expect(jobData.replayedFromDeliveryId).toBe("replay_of_orig");
  });

  it("5. delivery-not-found-returns-error: NO audit, NO queue.add", async () => {
    const prisma = buildPrismaMock({ deliveriesById: {} });

    const result = await replayDelivery(
      "nonexistent_id",
      { actorUserId: "u1", source: "single" },
      prisma
    );

    expect(result).toEqual({
      outcome: "rejected",
      reason: "delivery_not_found",
    });
    expect(mockQueueAdd).not.toHaveBeenCalled();
    expect(mockedCaptureAudit).not.toHaveBeenCalled();
  });

  it("6. outbound-with-missing-outbox-row-returns-error (outbox_purged): NO audit, NO queue.add", async () => {
    const prisma = buildPrismaMock({
      deliveriesById: { orig_id: baseOutboundDelivery() },
      outboxByEventId: {}, // outbox row purged
    });

    const result = await replayDelivery(
      "orig_id",
      { actorUserId: "u1", source: "single" },
      prisma
    );

    expect(result).toEqual({
      outcome: "rejected",
      reason: "outbox_purged",
    });
    expect(mockQueueAdd).not.toHaveBeenCalled();
    expect(mockedCaptureAudit).not.toHaveBeenCalled();
  });

  it("7. outbound-with-null-eventId-returns-error: rejects with outbox_purged when eventId is null", async () => {
    const prisma = buildPrismaMock({
      deliveriesById: {
        orig_legacy: baseOutboundDelivery({
          id: "orig_legacy",
          eventId: null,
        }),
      },
    });

    const result = await replayDelivery(
      "orig_legacy",
      { actorUserId: "u1", source: "single" },
      prisma
    );

    expect(result).toEqual({
      outcome: "rejected",
      reason: "outbox_purged",
    });
    expect(mockQueueAdd).not.toHaveBeenCalled();
    expect(mockedCaptureAudit).not.toHaveBeenCalled();
  });

  it("8. bulkReplayDeliveries-hard-caps-at-100: returns exceeds_cap BEFORE any queue/audit", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `d${i}`);

    const result = await bulkReplayDeliveries(ids, { actorUserId: "u1" });

    expect(result).toEqual({
      outcome: "rejected",
      reason: "exceeds_cap",
    });
    expect(mockQueueAdd).not.toHaveBeenCalled();
    expect(mockedCaptureAudit).not.toHaveBeenCalled();
  });

  it("9. bulkReplayDeliveries-mixed-input-skips-inbound (D-17a integration): 3 outbound + 2 inbound → 3 enqueues + 3 audits + skippedInboundCount=2", async () => {
    const deliveriesById: Record<string, unknown> = {
      o1: baseOutboundDelivery({ id: "o1", eventId: "evt_o1" }),
      o2: baseOutboundDelivery({ id: "o2", eventId: "evt_o2" }),
      o3: baseOutboundDelivery({ id: "o3", eventId: "evt_o3" }),
      i1: baseInboundDelivery({ id: "i1" }),
      i2: baseInboundDelivery({ id: "i2" }),
    };
    const outboxByEventId: Record<string, unknown> = {
      evt_o1: baseOutboxRow({ id: "outbox_o1" }),
      evt_o2: baseOutboxRow({ id: "outbox_o2" }),
      evt_o3: baseOutboxRow({ id: "outbox_o3" }),
    };
    const prisma = buildPrismaMock({ deliveriesById, outboxByEventId });

    const result = await bulkReplayDeliveries(
      ["o1", "i1", "o2", "i2", "o3"],
      { actorUserId: "u1" },
      prisma
    );

    expect(result.outcome).toBe("queued");
    expect((result as { batchId: string }).batchId).toEqual(
      expect.stringMatching(/^bat_/)
    );
    expect((result as { enqueuedCount: number }).enqueuedCount).toBe(3);
    expect((result as { skippedInboundCount: number }).skippedInboundCount).toBe(
      2
    );

    expect(mockQueueAdd).toHaveBeenCalledTimes(3);
    expect(mockedCaptureAudit).toHaveBeenCalledTimes(3);

    // Every audit emitted carries source=bulk and the same batchId.
    const batchIds = mockedCaptureAudit.mock.calls.map(
      (c: unknown[]) => (c[0] as { metadata: Record<string, unknown> }).metadata.batchId
    );
    expect(new Set(batchIds).size).toBe(1);
    for (const call of mockedCaptureAudit.mock.calls) {
      expect((call[0] as { metadata: Record<string, unknown> }).metadata.source).toBe("bulk");
    }

    // Defense-in-depth: also verify each inbound id is treated as
    // inbound_replay_not_supported when fed through the helper directly,
    // locking the per-row contract that bulkReplay relies on.
    mockQueueAdd.mockClear();
    mockedCaptureAudit.mockClear();
    const inboundResult = await replayDelivery(
      "i1",
      { actorUserId: "u1", source: "bulk", batchId: "bat_check" },
      prisma
    );
    expect(inboundResult).toEqual({
      outcome: "rejected",
      reason: "inbound_replay_not_supported",
    });
    expect(mockQueueAdd).not.toHaveBeenCalled();
    expect(mockedCaptureAudit).not.toHaveBeenCalled();
  });

  it("10. bulkReplayDeliveries-100-or-fewer-all-outbound-enqueues-each: 47 outbound → 47 enqueues + 47 audits + same batchId", async () => {
    const N = 47;
    const deliveriesById: Record<string, unknown> = {};
    const outboxByEventId: Record<string, unknown> = {};
    const ids: string[] = [];
    for (let i = 0; i < N; i++) {
      const id = `d${i}`;
      const evtId = `evt_${i}`;
      ids.push(id);
      deliveriesById[id] = baseOutboundDelivery({ id, eventId: evtId });
      outboxByEventId[evtId] = baseOutboxRow({ id: `outbox_${i}` });
    }
    const prisma = buildPrismaMock({ deliveriesById, outboxByEventId });

    const result = await bulkReplayDeliveries(ids, { actorUserId: "u1" }, prisma);

    expect(result.outcome).toBe("queued");
    expect((result as { batchId: string }).batchId).toEqual(
      expect.stringMatching(/^bat_/)
    );
    expect((result as { enqueuedCount: number }).enqueuedCount).toBe(N);
    expect((result as { skippedInboundCount: number }).skippedInboundCount).toBe(
      0
    );

    expect(mockQueueAdd).toHaveBeenCalledTimes(N);
    expect(mockedCaptureAudit).toHaveBeenCalledTimes(N);

    const batchIds = mockedCaptureAudit.mock.calls.map(
      (c: unknown[]) => (c[0] as { metadata: Record<string, unknown> }).metadata.batchId
    );
    expect(new Set(batchIds).size).toBe(1);

    expect(BULK_REPLAY_HARD_CAP).toBe(100);
  });

  it("11. export-BULK_REPLAY_HARD_CAP: literal 100 importable directly", async () => {
    const mod = await import("./replay");
    expect(mod.BULK_REPLAY_HARD_CAP).toBe(100);
    expect(BULK_REPLAY_HARD_CAP).toBe(100);
  });
});
