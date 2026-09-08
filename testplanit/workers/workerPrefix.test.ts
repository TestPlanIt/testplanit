import { afterEach, describe, expect, it, vi } from "vitest";

// Regression guard for the consume half of worker-group isolation: a Worker
// constructed without the group prefix would watch an empty keyspace while
// the tenant's jobs pile up under the prefixed one. budgetAlertWorker is the
// representative — all 17 BullMQ workers share the same constructor pattern.

const constructed: Array<{ name: string; opts: Record<string, unknown> }> = [];

vi.mock("bullmq", () => ({
  Worker: class {
    constructor(
      name: string,
      _processor: unknown,
      opts: Record<string, unknown>
    ) {
      constructed.push({ name, opts });
    }
    on() {
      return this;
    }
    close() {
      return Promise.resolve();
    }
  },
  Queue: class {
    on() {
      return this;
    }
  },
}));

vi.mock("../lib/valkey", () => ({
  default: { fake: "connection" },
  createSubscriberClient: () => null,
}));

vi.mock("../lib/multiTenantDb", () => ({
  isMultiTenantMode: () => true,
  validateMultiTenantJobData: () => undefined,
  getDbClientForJob: () => null,
  getAllTenantIds: () => [],
}));

afterEach(() => {
  delete process.env.BULLMQ_PREFIX;
});

describe("worker constructors propagate BULLMQ_PREFIX", () => {
  it("passes the group prefix to the BullMQ Worker", async () => {
    process.env.BULLMQ_PREFIX = "bull-heavy";
    vi.resetModules();
    constructed.length = 0;

    const { startWorker } = await import("./budgetAlertWorker");
    await startWorker();

    expect(constructed).toHaveLength(1);
    expect(constructed[0].name).toBe("budget-alerts");
    expect(constructed[0].opts.prefix).toBe("bull-heavy");
  });

  it('defaults to prefix "bull" when env is unset', async () => {
    delete process.env.BULLMQ_PREFIX;
    vi.resetModules();
    constructed.length = 0;

    const { startWorker } = await import("./budgetAlertWorker");
    await startWorker();

    expect(constructed).toHaveLength(1);
    expect(constructed[0].opts.prefix).toBe("bull");
  });
});
