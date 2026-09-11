import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Execution-dispatch worker unit tests.
 *
 * The worker multiplexes two job names onto one queue, so the tests pin the
 * routing (a poll job must never start a CI job), the ordering guarantee that
 * tenant data is validated before any DB client is handed out, and the fact
 * that the exported processor is wrapped in tenant context — dispatch and poll
 * both decrypt target credentials with the tenant's key.
 */

const state = vi.hoisted(() => ({ inTenantContext: false }));

vi.mock("../lib/execution/dispatch", () => ({
  dispatchExecution: vi.fn(),
  pollActiveExecutions: vi.fn(),
}));

vi.mock("../lib/multiTenantDb", () => ({
  getDbClientForJob: vi.fn(),
  validateMultiTenantJobData: vi.fn(),
  isMultiTenantMode: vi.fn(() => false),
  disconnectAllTenantClients: vi.fn(),
}));

// Records whether the processor body actually ran inside the wrapper, so the
// tests can assert tenant context rather than just that the wrapper exists.
vi.mock("../lib/tenantContext", () => ({
  withTenantContext:
    (fn: (job: unknown) => Promise<unknown>) => async (job: unknown) => {
      state.inTenantContext = true;
      try {
        return await fn(job);
      } finally {
        state.inTenantContext = false;
      }
    },
}));

vi.mock("../lib/valkey", () => ({ default: null }));

vi.mock("../lib/queueNames", () => ({
  EXECUTION_DISPATCH_QUEUE_NAME: "execution-dispatch",
  JOB_DISPATCH_EXECUTION: "dispatch-execution",
  JOB_POLL_ACTIVE_EXECUTIONS: "poll-active-executions",
}));

vi.mock("../lib/bullPrefix", () => ({ BULLMQ_PREFIX: "bull" }));

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation(() => ({ on: vi.fn(), close: vi.fn() })),
  Queue: vi.fn(),
  Job: class {},
}));

import {
  dispatchExecution,
  pollActiveExecutions,
} from "../lib/execution/dispatch";
import {
  getDbClientForJob,
  validateMultiTenantJobData,
} from "../lib/multiTenantDb";
import { dispatch, processor } from "./executionDispatchWorker";

const mockDispatchExecution = dispatchExecution as unknown as ReturnType<
  typeof vi.fn
>;
const mockPoll = pollActiveExecutions as unknown as ReturnType<typeof vi.fn>;
const mockGetDb = getDbClientForJob as unknown as ReturnType<typeof vi.fn>;
const mockValidate = validateMultiTenantJobData as unknown as ReturnType<
  typeof vi.fn
>;

const DB = { __tenantScopedClient: true };
const EMPTY_SUMMARY = { polled: 0, finished: 0, timedOut: 0, stalled: 0 };

/** Whether the mocked worker helpers observed tenant context when called. */
let sawTenantContext: boolean | null = null;

function job(name: string, data: Record<string, unknown>) {
  return { id: "job-1", name, data } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  state.inTenantContext = false;
  sawTenantContext = null;
  mockGetDb.mockReturnValue(DB);
  mockValidate.mockImplementation(() => undefined);
  mockPoll.mockImplementation(async () => {
    sawTenantContext = state.inTenantContext;
    return EMPTY_SUMMARY;
  });
  mockDispatchExecution.mockImplementation(async () => {
    sawTenantContext = state.inTenantContext;
    return { outcome: "DISPATCHED" };
  });
});

describe("job routing", () => {
  it("sends a poll job to pollActiveExecutions and never to dispatch", async () => {
    const summary = { polled: 2, finished: 1, timedOut: 0, stalled: 0 };
    mockPoll.mockResolvedValue(summary);
    const result = await processor(
      job("poll-active-executions", { tenantId: "acme" })
    );
    expect(mockPoll).toHaveBeenCalledTimes(1);
    expect(mockPoll).toHaveBeenCalledWith(DB, { tenantId: "acme" });
    expect(mockDispatchExecution).not.toHaveBeenCalled();
    expect(result).toBe(summary);
  });

  it("polls in single-tenant mode with an undefined tenantId", async () => {
    await processor(job("poll-active-executions", {}));
    expect(mockGetDb).toHaveBeenCalledWith({});
    expect(mockPoll).toHaveBeenCalledWith(DB, { tenantId: undefined });
  });

  it("sends a dispatch job to dispatchExecution and never to the poller", async () => {
    mockDispatchExecution.mockResolvedValue({ outcome: "DISPATCHED" });
    const result = await processor(
      job("dispatch-execution", { executionId: 7, tenantId: "acme" })
    );
    expect(mockDispatchExecution).toHaveBeenCalledTimes(1);
    expect(mockDispatchExecution).toHaveBeenCalledWith(DB, 7, {
      tenantId: "acme",
    });
    expect(mockPoll).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: "DISPATCHED" });
  });

  it("treats any non-poll job name as a dispatch", async () => {
    await processor(job("something-else", { executionId: 9 }));
    expect(mockDispatchExecution).toHaveBeenCalledWith(DB, 9, {
      tenantId: undefined,
    });
    expect(mockPoll).not.toHaveBeenCalled();
  });

  it("lets a dispatch failure propagate so BullMQ records it", async () => {
    mockDispatchExecution.mockRejectedValue(new Error("provider exploded"));
    await expect(
      processor(job("dispatch-execution", { executionId: 7 }))
    ).rejects.toThrow("provider exploded");
  });
});

describe("multi-tenant validation", () => {
  it("validates the job data before asking for a DB client", async () => {
    await processor(
      job("dispatch-execution", { executionId: 7, tenantId: "acme" })
    );
    expect(mockValidate).toHaveBeenCalledWith({
      executionId: 7,
      tenantId: "acme",
    });
    expect(mockValidate.mock.invocationCallOrder[0]).toBeLessThan(
      mockGetDb.mock.invocationCallOrder[0]
    );
  });

  it("never touches the DB or the provider when validation rejects the job", async () => {
    mockValidate.mockImplementation(() => {
      throw new Error("tenantId is required in multi-tenant mode");
    });
    await expect(
      processor(job("dispatch-execution", { executionId: 7 }))
    ).rejects.toThrow("tenantId is required in multi-tenant mode");
    expect(mockGetDb).not.toHaveBeenCalled();
    expect(mockDispatchExecution).not.toHaveBeenCalled();
  });
});

describe("tenant context", () => {
  it("wraps the processor rather than exporting it bare", () => {
    expect(dispatch).not.toBe(processor);
    expect(typeof dispatch).toBe("function");
  });

  it("runs a dispatch job inside the tenant context", async () => {
    await dispatch(
      job("dispatch-execution", { executionId: 7, tenantId: "acme" })
    );
    expect(sawTenantContext).toBe(true);
    expect(state.inTenantContext).toBe(false);
  });

  it("runs a poll job inside the tenant context", async () => {
    await dispatch(job("poll-active-executions", { tenantId: "acme" }));
    expect(sawTenantContext).toBe(true);
    expect(state.inTenantContext).toBe(false);
  });

  it("leaves the context even when the job throws", async () => {
    mockDispatchExecution.mockRejectedValue(new Error("boom"));
    await expect(
      dispatch(job("dispatch-execution", { executionId: 7, tenantId: "acme" }))
    ).rejects.toThrow("boom");
    expect(state.inTenantContext).toBe(false);
  });
});
