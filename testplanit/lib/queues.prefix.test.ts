import { afterEach, describe, expect, it, vi } from "vitest";

// Verifies every lazy Queue getter passes BULLMQ_PREFIX through to the
// BullMQ Queue constructor — the enqueue half of worker-group isolation.
// The Queue and the IORedis connection are both mocked; we only assert on
// the constructor options.

const constructed: Array<{ name: string; opts: Record<string, unknown> }> = [];

vi.mock("bullmq", () => ({
  Queue: class {
    name: string;
    constructor(name: string, opts: Record<string, unknown>) {
      this.name = name;
      constructed.push({ name, opts });
    }
    on() {
      return this;
    }
  },
}));

vi.mock("./valkey", () => ({
  // Truthy stand-in: lib/queues.ts only checks for presence before passing
  // the connection to the Queue constructor.
  default: { fake: "connection" },
  createSubscriberClient: () => null,
}));

async function loadQueues() {
  vi.resetModules();
  constructed.length = 0;
  return import("./queues");
}

afterEach(() => {
  delete process.env.BULLMQ_PREFIX;
});

describe("queue getters propagate BULLMQ_PREFIX", () => {
  it('constructs every queue with prefix "bull" when env is unset', async () => {
    delete process.env.BULLMQ_PREFIX;
    const queues = await loadQueues();
    const getters = Object.entries(queues).filter(
      ([k, v]) => k.startsWith("get") && typeof v === "function"
    );

    for (const [, getter] of getters) {
      (getter as () => unknown)();
    }

    // getAllQueues-style helpers may construct nothing new; assert on what was
    // constructed rather than on getter count.
    expect(constructed.length).toBeGreaterThanOrEqual(17);
    for (const { name, opts } of constructed) {
      expect(opts.prefix, `queue "${name}" missing default prefix`).toBe(
        "bull"
      );
    }
  });

  it("constructs every queue with the group prefix when env is set", async () => {
    process.env.BULLMQ_PREFIX = "bull-heavy";
    const queues = await loadQueues();
    const getters = Object.entries(queues).filter(
      ([k, v]) => k.startsWith("get") && typeof v === "function"
    );

    for (const [, getter] of getters) {
      (getter as () => unknown)();
    }

    expect(constructed.length).toBeGreaterThanOrEqual(17);
    for (const { name, opts } of constructed) {
      expect(opts.prefix, `queue "${name}" missing group prefix`).toBe(
        "bull-heavy"
      );
    }
  });
});
