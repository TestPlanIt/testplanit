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

  it("publishes the wake-up to both the per-run and per-project channels", async () => {
    publishTestRunWakeUp({
      event: "test_run.result_added",
      runId: 42,
      projectId: 7,
    });
    await flushImmediate();
    expect(mockPublish).toHaveBeenCalledTimes(2);
    const channels = mockPublish.mock.calls.map((c) => c[0]);
    expect(channels).toContain("live:tenant:acme:testrun:42");
    expect(channels).toContain("live:tenant:acme:project:7:testruns");
    // Both calls send the identical JSON body — the consumer payload
    // contract is shared regardless of which channel it arrived on.
    const bodies = mockPublish.mock.calls.map((c) =>
      JSON.parse(c[1] as string)
    );
    for (const body of bodies) {
      expect(body).toEqual({
        event: "test_run.result_added",
        runId: 42,
        projectId: 7,
      });
    }
  });

  it("falls back to the default tenant when one is not resolved", async () => {
    vi.mocked(getCurrentTenantId).mockReturnValue(undefined);
    publishTestRunWakeUp({
      event: "test_run.completed",
      runId: 7,
      projectId: 3,
    });
    await flushImmediate();
    const channels = mockPublish.mock.calls.map((c) => c[0]);
    expect(channels).toContain("live:tenant:default:testrun:7");
    expect(channels).toContain("live:tenant:default:project:3:testruns");
  });

  it("includes the targetId in both channel payloads when provided", async () => {
    publishTestRunWakeUp({
      event: "test_run.result_added",
      runId: 42,
      projectId: 7,
      targetId: 999,
    });
    await flushImmediate();
    for (const call of mockPublish.mock.calls) {
      expect(JSON.parse(call[1] as string)).toEqual({
        event: "test_run.result_added",
        runId: 42,
        projectId: 7,
        targetId: 999,
      });
    }
  });

  it("defers both publishes until after setImmediate", async () => {
    publishTestRunWakeUp({
      event: "test_run.state_changed",
      runId: 1,
      projectId: 2,
    });
    expect(mockPublish).not.toHaveBeenCalled();
    await flushImmediate();
    expect(mockPublish).toHaveBeenCalledTimes(2);
  });

  it("swallows publish failures on either channel (best-effort wake-up)", async () => {
    // Fail the first publish (per-run); the second (per-project) still fires
    mockPublish.mockRejectedValueOnce(new Error("valkey down"));
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    publishTestRunWakeUp({
      event: "test_run.completed",
      runId: 1,
      projectId: 5,
    });
    await flushImmediate();
    await flushImmediate(); // unhandled rejection .catch handler is a microtask
    expect(spy).toHaveBeenCalled();
    expect(mockPublish).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
