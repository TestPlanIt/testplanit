import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureExecutionPollScheduler,
  executionPollSchedulerId,
  retireIdleExecutionPollScheduler,
} from "./pollScheduler";

const upsertJobScheduler = vi.fn();
const removeJobScheduler = vi.fn();
const queue = { upsertJobScheduler, removeJobScheduler };
const count = vi.fn();
const db = { testRunExecution: { count } } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("executionPollSchedulerId", () => {
  it("suffixes the tenant so reconciliation can attribute it", () => {
    expect(executionPollSchedulerId("acme")).toBe(
      "poll-active-executions-acme"
    );
  });

  it("uses the bare job name in single-tenant mode", () => {
    expect(executionPollSchedulerId()).toBe("poll-active-executions");
  });
});

describe("ensureExecutionPollScheduler", () => {
  it("registers a per-minute poll whose finished jobs are not kept", async () => {
    await ensureExecutionPollScheduler(queue, "acme");

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      "poll-active-executions-acme",
      { pattern: "* * * * *" },
      {
        name: "poll-active-executions",
        data: { tenantId: "acme" },
        opts: { removeOnComplete: true, removeOnFail: true },
      }
    );
  });
});

describe("retireIdleExecutionPollScheduler", () => {
  it("keeps the scheduler while an execution is in flight", async () => {
    count.mockResolvedValue(1);

    expect(await retireIdleExecutionPollScheduler(db, queue, "acme")).toBe(
      false
    );
    expect(removeJobScheduler).not.toHaveBeenCalled();
  });

  it("counts PENDING, DISPATCHED and RUNNING as in flight", async () => {
    count.mockResolvedValue(1);

    await retireIdleExecutionPollScheduler(db, queue, "acme");

    expect(count).toHaveBeenCalledWith({
      where: { status: { in: ["PENDING", "DISPATCHED", "RUNNING"] } },
    });
  });

  it("removes the scheduler when nothing is in flight", async () => {
    count.mockResolvedValue(0);

    expect(await retireIdleExecutionPollScheduler(db, queue, "acme")).toBe(
      true
    );
    expect(removeJobScheduler).toHaveBeenCalledWith(
      "poll-active-executions-acme"
    );
    expect(upsertJobScheduler).not.toHaveBeenCalled();
  });

  it("puts the scheduler back when a request arrived during the removal", async () => {
    count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    expect(await retireIdleExecutionPollScheduler(db, queue, "acme")).toBe(
      false
    );
    expect(removeJobScheduler).toHaveBeenCalledTimes(1);
    expect(upsertJobScheduler).toHaveBeenCalledTimes(1);
    expect(removeJobScheduler.mock.invocationCallOrder[0]).toBeLessThan(
      upsertJobScheduler.mock.invocationCallOrder[0]
    );
  });

  it("retires the single-tenant scheduler by its bare id", async () => {
    count.mockResolvedValue(0);

    await retireIdleExecutionPollScheduler(db, queue);

    expect(removeJobScheduler).toHaveBeenCalledWith("poll-active-executions");
  });
});
