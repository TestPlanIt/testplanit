import { describe, expect, it, vi } from "vitest";
import { finishedJob } from "./finishedJob";

const job = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "job-1",
    finishedOn: undefined,
    returnvalue: null,
    ...overrides,
  }) as any;

describe("finishedJob", () => {
  it("reads the job again when it finished after it was read", async () => {
    const fresh = job({ finishedOn: 2, returnvalue: { ok: true } });
    const queue = { getJob: vi.fn().mockResolvedValue(fresh) };

    expect(await finishedJob(queue as any, job(), "completed")).toBe(fresh);
    expect(queue.getJob).toHaveBeenCalledWith("job-1");
  });

  it("keeps the job in hand when it already carries its finish time", async () => {
    const queue = { getJob: vi.fn() };
    const done = job({ finishedOn: 2 });

    expect(await finishedJob(queue as any, done, "failed")).toBe(done);
    expect(queue.getJob).not.toHaveBeenCalled();
  });

  it("keeps the job in hand while it is still running", async () => {
    const queue = { getJob: vi.fn() };
    const running = job();

    expect(await finishedJob(queue as any, running, "active")).toBe(running);
    expect(queue.getJob).not.toHaveBeenCalled();
  });

  it("keeps the job in hand when the second read finds nothing", async () => {
    const queue = { getJob: vi.fn().mockResolvedValue(undefined) };
    const stale = job();

    expect(await finishedJob(queue as any, stale, "completed")).toBe(stale);
  });
});
