import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPublish = vi.fn();

vi.mock("~/lib/valkey", () => ({
  default: { publish: (...args: unknown[]) => mockPublish(...args) },
}));

vi.mock("~/lib/multiTenantDb", () => ({
  getCurrentTenantId: vi.fn(),
}));

import { getCurrentTenantId } from "~/lib/multiTenantDb";
import { publishMilestoneWakeUp, publishTestRunWakeUp } from "./publish";

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

/**
 * `publishMilestoneWakeUp` — the sibling to `publishTestRunWakeUp` above,
 * mirroring its exact behavior for milestones (D-13/D-14).
 *
 * See: .planning/phases/19-webhooks-lifecycle/19-VALIDATION.md (19-02-T1),
 *      19-PATTERNS.md "SSE wake-up publish (D-14 hard constraint)".
 */
describe("publishMilestoneWakeUp", () => {
  beforeEach(() => {
    mockPublish.mockReset();
    mockPublish.mockResolvedValue(1);
    vi.mocked(getCurrentTenantId).mockReturnValue("acme");
  });

  it("publishes the wake-up to both the per-milestone and per-project channels", async () => {
    publishMilestoneWakeUp({
      event: "milestone.updated",
      milestoneId: 42,
      projectId: 7,
    });
    await flushImmediate();
    expect(mockPublish).toHaveBeenCalledTimes(2);
    const channels = mockPublish.mock.calls.map((c) => c[0]);
    expect(channels).toContain("live:tenant:acme:milestone:42");
    expect(channels).toContain("live:tenant:acme:project:7:milestones");
    const bodies = mockPublish.mock.calls.map((c) =>
      JSON.parse(c[1] as string)
    );
    for (const body of bodies) {
      expect(body).toEqual({
        event: "milestone.updated",
        milestoneId: 42,
        projectId: 7,
      });
    }
  });

  it("falls back to the default tenant when one is not resolved", async () => {
    vi.mocked(getCurrentTenantId).mockReturnValue(undefined);
    publishMilestoneWakeUp({
      event: "milestone.created",
      milestoneId: 7,
      projectId: 3,
    });
    await flushImmediate();
    const channels = mockPublish.mock.calls.map((c) => c[0]);
    expect(channels).toContain("live:tenant:default:milestone:7");
    expect(channels).toContain("live:tenant:default:project:3:milestones");
  });

  it("defers both publishes until after setImmediate (fires after the surrounding tx commits — D-14)", async () => {
    publishMilestoneWakeUp({
      event: "milestone.membership_changed",
      milestoneId: 1,
      projectId: 2,
    });
    expect(mockPublish).not.toHaveBeenCalled();
    await flushImmediate();
    expect(mockPublish).toHaveBeenCalledTimes(2);
  });

  it("swallows a per-channel publish rejection independently (one channel failing does not block the other)", async () => {
    mockPublish.mockRejectedValueOnce(new Error("valkey down"));
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    publishMilestoneWakeUp({
      event: "milestone.converted",
      milestoneId: 1,
      projectId: 5,
    });
    await flushImmediate();
    await flushImmediate(); // unhandled rejection .catch handler is a microtask
    expect(spy).toHaveBeenCalled();
    expect(mockPublish).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it("sends a thin payload only ({ event, milestoneId, projectId, targetId? }) — never milestone data", async () => {
    publishMilestoneWakeUp({
      event: "milestone.membership_changed",
      milestoneId: 42,
      projectId: 7,
      targetId: 999,
    });
    await flushImmediate();
    for (const call of mockPublish.mock.calls) {
      const body = JSON.parse(call[1] as string);
      expect(Object.keys(body).sort()).toEqual(
        ["event", "milestoneId", "projectId", "targetId"].sort()
      );
    }
  });
});

/**
 * `publishMilestoneWakeUp` no-op when Valkey is unavailable (single-pod
 * dev / SKIP_VALKEY_CONNECTION). Isolated in its own module registry reset
 * because `~/lib/valkey`'s default export must resolve to `null` for this
 * one behavior, unlike every other test in this file.
 */
describe("publishMilestoneWakeUp (no valkeyConnection)", () => {
  it("no-ops when valkeyConnection is unavailable (single-pod dev)", async () => {
    vi.resetModules();
    const localMockPublish = vi.fn();
    vi.doMock("~/lib/valkey", () => ({ default: null }));
    vi.doMock("~/lib/multiTenantDb", () => ({
      getCurrentTenantId: () => "acme",
    }));
    const { publishMilestoneWakeUp: publishWithNullConn } =
      await import("./publish");
    publishWithNullConn({
      event: "milestone.updated",
      milestoneId: 1,
      projectId: 1,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(localMockPublish).not.toHaveBeenCalled();
    vi.doUnmock("~/lib/valkey");
    vi.doUnmock("~/lib/multiTenantDb");
    vi.resetModules();
  });
});
