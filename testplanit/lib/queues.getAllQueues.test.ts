import { describe, expect, it, vi } from "vitest";

// The admin Queues page (app/api/admin/queues/route.ts) now builds its list
// dynamically from `Object.values(getAllQueues())` using each queue's `.name`.
// This guards the contract that makes that correct: every registered
// `*_QUEUE_NAME` constant must be exposed by getAllQueues(), so no queue can
// be silently omitted from the admin page again. The Queue and valkey
// connection are mocked — we only care about the names getAllQueues surfaces.

const constructed: string[] = [];

vi.mock("bullmq", () => ({
  Queue: class {
    name: string;
    constructor(name: string) {
      this.name = name;
      constructed.push(name);
    }
    on() {
      return this;
    }
  },
}));

vi.mock("./valkey", () => ({
  default: { fake: "connection" },
  createSubscriberClient: () => null,
}));

describe("getAllQueues exposes every registered queue by name", () => {
  it("surfaces a named queue for every *_QUEUE_NAME constant", async () => {
    vi.resetModules();
    constructed.length = 0;
    const { getAllQueues } = await import("./queues");
    const queueNames = await import("./queueNames");

    const expected = Object.entries(queueNames)
      .filter(([key]) => key.endsWith("_QUEUE_NAME"))
      .map(([, value]) => value as string);

    const actual = Object.values(getAllQueues()).map(
      (queue) => (queue as { name: string }).name
    );

    // Order-independent: every registered queue name is present, none extra.
    expect(new Set(actual)).toEqual(new Set(expected));

    // The queues that were previously missing from the hardcoded admin list.
    for (const name of [
      "derive-case-steps",
      "generate-from-url",
      "iteration-generation",
      "webhook-dispatch",
      "scim-access-recompute",
    ]) {
      expect(actual).toContain(name);
    }
  });
});
