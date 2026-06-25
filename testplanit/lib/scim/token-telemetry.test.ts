import { beforeEach, describe, expect, test, vi } from "vitest";

import { SCIM_LAST_SYNC_THROTTLE_MS } from "./constants";

// Hoist-safe mock of the baseDb client. The helper uses
// `baseDb.scimToken.updateMany`; we hand back a vi.fn() the tests inspect.
const mockUpdateMany = vi.fn();
vi.mock("~/lib/db", () => ({
  baseDb: {
    scimToken: {
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    },
  },
}));

import { touchLastSync } from "./token-telemetry";

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateMany.mockReset();
  mockUpdateMany.mockResolvedValue({ count: 1 });
});

describe("touchLastSync", () => {
  test("calls scimToken.updateMany with the race-safe WHERE clause", () => {
    touchLastSync("tok-test-1");

    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    const call = mockUpdateMany.mock.calls[0]![0] as {
      where: {
        id: string;
        OR: Array<{ lastSyncAt: null | { lt: Date } }>;
      };
      data: { lastSyncAt: Date };
    };

    // Targets the given token id.
    expect(call.where.id).toBe("tok-test-1");

    // Race-safe guard: OR(lastSyncAt IS NULL, lastSyncAt < cutoff)
    expect(call.where.OR).toHaveLength(2);
    expect(call.where.OR[0]).toEqual({ lastSyncAt: null });
    const cutoffEntry = call.where.OR[1]!.lastSyncAt as { lt: Date };
    expect(cutoffEntry.lt).toBeInstanceOf(Date);

    // The cutoff should be roughly `now - THROTTLE_MS`.
    const now = Date.now();
    const cutoffMs = cutoffEntry.lt.getTime();
    const expected = now - SCIM_LAST_SYNC_THROTTLE_MS;
    expect(Math.abs(cutoffMs - expected)).toBeLessThan(1000);

    // Writes a fresh `lastSyncAt`.
    expect(call.data.lastSyncAt).toBeInstanceOf(Date);
  });

  test("is fire-and-forget — returns void synchronously", () => {
    // Even though updateMany returns a Promise, the helper returns void.
    const ret = touchLastSync("tok-test-2");
    expect(ret).toBeUndefined();
  });

  test("swallows DB errors via .catch — never throws", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    mockUpdateMany.mockRejectedValueOnce(new Error("DB down"));

    expect(() => touchLastSync("tok-test-3")).not.toThrow();

    // Wait a microtask so the .catch handler fires.
    await new Promise((resolve) => setImmediate(resolve));

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0]![0]).toContain(
      "[scim/token-telemetry] Failed to update lastSyncAt"
    );

    consoleErrorSpy.mockRestore();
  });
});
