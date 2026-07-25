import { describe, expect, it } from "vitest";

import { createTenantPollBackoff } from "./tenantPollBackoff";

const makeClock = (start = 0) => {
  const clock = { t: start };
  return {
    clock,
    now: () => clock.t,
    advance: (ms: number) => {
      clock.t += ms;
    },
  };
};

describe("createTenantPollBackoff", () => {
  it("polls an unknown tenant immediately", () => {
    const { now } = makeClock();
    const backoff = createTenantPollBackoff({
      baseIntervalMs: 1000,
      maxIntervalMs: 60_000,
      now,
    });
    expect(backoff.shouldPoll("a")).toBe(true);
  });

  it("doubles the interval on consecutive empty polls: base×2, ×4, ×8", () => {
    const { now, advance } = makeClock();
    const backoff = createTenantPollBackoff({
      baseIntervalMs: 1000,
      maxIntervalMs: 60_000,
      now,
    });

    backoff.recordEmpty("a"); // next eligible at +2000
    expect(backoff.shouldPoll("a")).toBe(false);
    advance(1999);
    expect(backoff.shouldPoll("a")).toBe(false);
    advance(1);
    expect(backoff.shouldPoll("a")).toBe(true);

    backoff.recordEmpty("a"); // next eligible at +4000
    advance(3999);
    expect(backoff.shouldPoll("a")).toBe(false);
    advance(1);
    expect(backoff.shouldPoll("a")).toBe(true);

    backoff.recordEmpty("a"); // next eligible at +8000
    advance(7999);
    expect(backoff.shouldPoll("a")).toBe(false);
    advance(1);
    expect(backoff.shouldPoll("a")).toBe(true);
  });

  it("caps the interval at maxIntervalMs", () => {
    const { now, advance } = makeClock();
    const backoff = createTenantPollBackoff({
      baseIntervalMs: 1000,
      maxIntervalMs: 5000,
      now,
    });

    for (let i = 0; i < 10; i++) {
      backoff.recordEmpty("a");
    }
    advance(4999);
    expect(backoff.shouldPoll("a")).toBe(false);
    advance(1);
    expect(backoff.shouldPoll("a")).toBe(true);
  });

  it("snaps back to every-cycle polling after work is found, and re-starts backoff from the base", () => {
    const { now, advance } = makeClock();
    const backoff = createTenantPollBackoff({
      baseIntervalMs: 1000,
      maxIntervalMs: 60_000,
      now,
    });

    backoff.recordEmpty("a");
    backoff.recordEmpty("a");
    backoff.recordEmpty("a");
    expect(backoff.shouldPoll("a")).toBe(false);

    backoff.recordWork("a");
    expect(backoff.shouldPoll("a")).toBe(true);

    // A mid-drain sequence of non-empty polls never re-backs-off.
    backoff.recordWork("a");
    backoff.recordWork("a");
    expect(backoff.shouldPoll("a")).toBe(true);

    // After the drain, backoff restarts from the base interval (not the
    // previously accumulated one).
    backoff.recordEmpty("a");
    advance(2000);
    expect(backoff.shouldPoll("a")).toBe(true);
  });

  it("tracks tenants independently", () => {
    const { now } = makeClock();
    const backoff = createTenantPollBackoff({
      baseIntervalMs: 1000,
      maxIntervalMs: 60_000,
      now,
    });

    backoff.recordEmpty("idle");
    expect(backoff.shouldPoll("idle")).toBe(false);
    expect(backoff.shouldPoll("active")).toBe(true);
  });

  it("prune drops state for removed tenants and keeps the rest", () => {
    const { now } = makeClock();
    const backoff = createTenantPollBackoff({
      baseIntervalMs: 1000,
      maxIntervalMs: 60_000,
      now,
    });

    backoff.recordEmpty("kept");
    backoff.recordEmpty("removed");
    backoff.prune(["kept"]);

    expect(backoff.shouldPoll("kept")).toBe(false);
    // Removed tenant's state is gone — if re-added it polls immediately.
    expect(backoff.shouldPoll("removed")).toBe(true);
  });

  it("reset clears all state", () => {
    const { now } = makeClock();
    const backoff = createTenantPollBackoff({
      baseIntervalMs: 1000,
      maxIntervalMs: 60_000,
      now,
    });

    backoff.recordEmpty("a");
    backoff.reset();
    expect(backoff.shouldPoll("a")).toBe(true);
  });
});
