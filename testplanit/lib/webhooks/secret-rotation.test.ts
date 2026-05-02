import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the default prisma singleton — the helper accepts an injected client,
// so the real test surface is the where/data shape passed to updateMany.
const mockUpdateMany = vi.fn();
vi.mock("~/lib/prisma", () => ({
  prisma: {
    webhookConfigSecret: {
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    },
  },
}));

import { retireExpiredSecrets } from "./secret-rotation";

describe("retireExpiredSecrets (/ daily auto-retire)", () => {
  beforeEach(() => {
    mockUpdateMany.mockReset();
  });

  it("calls updateMany with where retiredAt:null AND autoRetireAt < NOW()", async () => {
    mockUpdateMany.mockResolvedValue({ count: 3 });

    const before = Date.now();
    const result = await retireExpiredSecrets();
    const after = Date.now();

    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    const call = mockUpdateMany.mock.calls[0][0];

    expect(call.where).toMatchObject({
      retiredAt: null,
      autoRetireAt: expect.objectContaining({ not: null }),
    });
    const cutoff = (call.where.autoRetireAt.lt as Date).getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before);
    expect(cutoff).toBeLessThanOrEqual(after);

    expect(result).toEqual({ retiredCount: 3 });
  });

  it("data clause sets retiredAt to a Date", async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });
    await retireExpiredSecrets();
    const call = mockUpdateMany.mock.calls[0][0];
    expect(call.data.retiredAt).toBeInstanceOf(Date);
  });

  it("returns the updateMany count under retiredCount", async () => {
    mockUpdateMany.mockResolvedValue({ count: 7 });
    const result = await retireExpiredSecrets();
    expect(result).toEqual({ retiredCount: 7 });
  });

  it("idempotent: second call when no rows match returns count=0", async () => {
    mockUpdateMany
      .mockResolvedValueOnce({ count: 5 })
      .mockResolvedValueOnce({ count: 0 });

    const first = await retireExpiredSecrets();
    const second = await retireExpiredSecrets();

    expect(first.retiredCount).toBe(5);
    expect(second.retiredCount).toBe(0);
  });

  it("accepts an injected prisma/tx client (used from worker)", async () => {
    const injectedUpdateMany = vi.fn().mockResolvedValue({ count: 2 });
    const injected = {
      webhookConfigSecret: { updateMany: injectedUpdateMany },
    } as any;

    const result = await retireExpiredSecrets(injected);

    expect(injectedUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(result).toEqual({ retiredCount: 2 });
  });
});
