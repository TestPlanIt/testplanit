import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  emitDatasetRowAcquired,
  emitDatasetRowReleased,
} from "./datasetLeaseEvents";

/**
 * 999.12 lease-emitter contract.
 *
 * - Emits `dataset.row.acquired` / `dataset.row.released` through
 *   `webhookEvents.emit` (mocked so we can introspect call args).
 * - Forwards the caller's `tx` and `projectId` — atomicity contract.
 * - Throws when called without a tx (defense in depth on top of the runtime
 *   guard in lib/webhooks/events.ts).
 * - SECURITY: the payload NEVER carries `valuesJson` (rows may hold secrets).
 */

vi.mock("~/lib/webhooks/events", () => ({
  webhookEvents: {
    emit: vi.fn(async () => ({
      eventId: "evt_xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx",
      outboxRowId: "who_42",
    })),
  },
}));

import { webhookEvents } from "~/lib/webhooks/events";

const emitMock = webhookEvents.emit as unknown as ReturnType<typeof vi.fn>;

const basePayload = {
  dataSetId: 3,
  rowId: 17,
  rowIndex: 2,
  label: "row-two",
  projectId: 42,
  leasedById: "user-1",
  leaseExpiresAt: "2026-07-15T12:05:00.000Z",
};

describe("datasetLeaseEvents emitters", () => {
  beforeEach(() => emitMock.mockClear());

  it("emits dataset.row.acquired with identifiers only and forwards tx + projectId", async () => {
    const tx = {} as any;
    await emitDatasetRowAcquired(basePayload, tx, { actorUserId: "user-1" });

    expect(emitMock).toHaveBeenCalledTimes(1);
    const [eventName, payload, opts] = emitMock.mock.calls[0];
    expect(eventName).toBe("dataset.row.acquired");
    expect(payload).toEqual(basePayload);
    expect(opts.tx).toBe(tx);
    expect(opts.projectId).toBe(42);
    expect(opts.actorUserId).toBe("user-1");
  });

  it("emits dataset.row.released with the reason discriminator", async () => {
    const tx = {} as any;
    await emitDatasetRowReleased(basePayload, "expired", tx);

    const [eventName, payload] = emitMock.mock.calls[0];
    expect(eventName).toBe("dataset.row.released");
    expect(payload.reason).toBe("expired");
  });

  it("SECURITY: neither event payload ever contains valuesJson", async () => {
    const tx = {} as any;
    // Even if a caller sneaks extra fields, the emitter only spreads the
    // typed payload — assert the wire shape has no values leakage.
    await emitDatasetRowAcquired(basePayload, tx);
    await emitDatasetRowReleased(basePayload, "released", tx);
    for (const call of emitMock.mock.calls) {
      const payload = call[1] as Record<string, unknown>;
      expect(payload).not.toHaveProperty("valuesJson");
      expect(payload).not.toHaveProperty("values");
    }
  });

  it("requires a transaction client (throws when tx is missing)", async () => {
    await expect(
      // @ts-expect-error — exercising the runtime guard
      emitDatasetRowAcquired(basePayload, undefined)
    ).rejects.toThrow(/TxClient/);
    await expect(
      // @ts-expect-error — exercising the runtime guard
      emitDatasetRowReleased(basePayload, "released", undefined)
    ).rejects.toThrow(/TxClient/);
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("uses opts.projectId override when supplied", async () => {
    const tx = {} as any;
    await emitDatasetRowAcquired(basePayload, tx, { projectId: 999 });
    const [, , opts] = emitMock.mock.calls[0];
    expect(opts.projectId).toBe(999);
  });
});
