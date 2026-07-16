import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Dataset lease sweep worker unit tests.
 *
 * Mocks:
 * - a client whose $transaction runs the callback with a tx whose $queryRaw
 *   is driven per-call to simulate the batch loop (full batch, then a short
 *   batch to stop).
 * - emitDatasetRowReleased — assert one call per reaped row with reason
 *   "expired" and NO valuesJson leakage.
 * - multiTenantDb — single-tenant by default.
 */

const mockEmitReleased = vi.fn(async (..._args: unknown[]) => undefined);
const mockIsMultiTenantMode = vi.fn(() => false);
const mockGetAllTenantIds = vi.fn(() => [] as string[]);
const mockGetTenantDbClient = vi.fn();
const mockDisconnectAllTenantClients = vi.fn(async () => undefined);

vi.mock("../lib/db", () => ({ baseDb: {} }));

vi.mock("../lib/webhooks/event-emitters/datasetLeaseEvents", () => ({
  emitDatasetRowReleased: (...args: unknown[]) => mockEmitReleased(...args),
}));

vi.mock("../lib/multiTenantDb", () => ({
  isMultiTenantMode: () => mockIsMultiTenantMode(),
  getAllTenantIds: () => mockGetAllTenantIds(),
  getTenantDbClient: (t: string) => mockGetTenantDbClient(t),
  disconnectAllTenantClients: () => mockDisconnectAllTenantClients(),
}));

import { sweepOnce } from "./datasetLeaseSweepWorker";

/** A client whose $transaction passes a tx with a scripted $queryRaw. */
function clientWithBatches(batches: unknown[][]) {
  let call = 0;
  const tx = {
    $queryRaw: vi.fn(async () => batches[call++] ?? []),
  };
  return {
    tx,
    client: {
      $transaction: async (cb: any) => cb(tx),
    } as any,
  };
}

const expiredRow = (id: number) => ({
  id,
  dataSetId: 3,
  rowIndex: id,
  label: `row-${id}`,
  leasedById: "user-1",
  leaseExpiresAt: new Date("2026-07-15T12:00:00.000Z"),
  projectId: 42,
});

describe("sweepOnce", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reaps a single short batch and emits released(expired) per row", async () => {
    const { client } = clientWithBatches([[expiredRow(1), expiredRow(2)]]);
    const result = await sweepOnce(client);

    expect(result.reaped).toBe(2);
    expect(result.batches).toBe(1);
    expect(result.truncated).toBe(false);
    expect(mockEmitReleased).toHaveBeenCalledTimes(2);

    // reason discriminator + no valuesJson on the payload.
    for (const call of mockEmitReleased.mock.calls) {
      const [payload, reason] = call as [Record<string, unknown>, string];
      expect(reason).toBe("expired");
      expect(payload).not.toHaveProperty("valuesJson");
      expect(payload.projectId).toBe(42);
    }
  });

  it("stops after an empty batch (nothing expired)", async () => {
    const { client } = clientWithBatches([[]]);
    const result = await sweepOnce(client);
    expect(result.reaped).toBe(0);
    expect(result.batches).toBe(1);
    expect(mockEmitReleased).not.toHaveBeenCalled();
  });

  it("loops while batches are full, then stops on a short batch", async () => {
    // First a FULL batch (>= SWEEP_BATCH_SIZE=500) forces another iteration;
    // the second (short) batch ends the loop.
    const full = Array.from({ length: 500 }, (_, i) => expiredRow(i + 1));
    const short = [expiredRow(999)];
    const { client } = clientWithBatches([full, short]);

    const result = await sweepOnce(client);
    expect(result.batches).toBe(2);
    expect(result.reaped).toBe(501);
  });
});
