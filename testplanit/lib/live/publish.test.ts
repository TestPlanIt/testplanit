import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPublish = vi.fn();

vi.mock("~/lib/valkey", () => ({
  default: { publish: (...args: unknown[]) => mockPublish(...args) },
}));

vi.mock("~/lib/multiTenantPrisma", () => ({
  getCurrentTenantId: vi.fn(),
}));

import { getCurrentTenantId } from "~/lib/multiTenantPrisma";
import { publishTestRunWakeUp } from "./publish";

async function flushImmediate() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("publishTestRunWakeUp", () => {
  beforeEach(() => {
    mockPublish.mockReset();
    mockPublish.mockResolvedValue(1);
    vi.mocked(getCurrentTenantId).mockReturnValue("acme");
  });

  it("publishes the wake-up JSON to the testRun channel", async () => {
    publishTestRunWakeUp({ event: "test_run.result_added", runId: 42 });
    await flushImmediate();
    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [channel, body] = mockPublish.mock.calls[0]!;
    expect(channel).toBe("live:tenant:acme:testrun:42");
    expect(JSON.parse(body as string)).toEqual({
      event: "test_run.result_added",
      runId: 42,
    });
  });

  it("falls back to the default tenant when one is not resolved", async () => {
    vi.mocked(getCurrentTenantId).mockReturnValue(undefined);
    publishTestRunWakeUp({ event: "test_run.completed", runId: 7 });
    await flushImmediate();
    expect(mockPublish.mock.calls[0]![0]).toBe("live:tenant:default:testrun:7");
  });

  it("includes the targetId when provided", async () => {
    publishTestRunWakeUp({
      event: "test_run.result_added",
      runId: 42,
      targetId: 999,
    });
    await flushImmediate();
    const body = JSON.parse(mockPublish.mock.calls[0]![1] as string);
    expect(body).toEqual({
      event: "test_run.result_added",
      runId: 42,
      targetId: 999,
    });
  });

  it("defers the publish until after setImmediate", async () => {
    publishTestRunWakeUp({ event: "test_run.state_changed", runId: 1 });
    expect(mockPublish).not.toHaveBeenCalled();
    await flushImmediate();
    expect(mockPublish).toHaveBeenCalledTimes(1);
  });

  it("swallows publish failures (best-effort wake-up)", async () => {
    mockPublish.mockRejectedValueOnce(new Error("valkey down"));
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    publishTestRunWakeUp({ event: "test_run.completed", runId: 1 });
    await flushImmediate();
    await flushImmediate(); // unhandled rejection .catch handler is a microtask
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
