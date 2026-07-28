import { describe, expect, it, vi } from "vitest";

import {
  ABANDONED_RUN_IDLE_MINUTES_KEY,
  readSystemAbandonedRunIdleMinutes,
  resolveAbandonedRunTargetStateId,
  resolveEffectiveIdleMinutes,
} from "./abandonedRuns";

function makeAppConfigClient(value?: unknown) {
  return {
    appConfig: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          value === undefined
            ? null
            : { key: ABANDONED_RUN_IDLE_MINUTES_KEY, value }
        ),
    },
  } as any;
}

describe("readSystemAbandonedRunIdleMinutes", () => {
  it("returns 0 (disabled) when no row is configured", async () => {
    expect(await readSystemAbandonedRunIdleMinutes(makeAppConfigClient())).toBe(
      0
    );
  });

  it("returns the numeric value and accepts numeric strings", async () => {
    expect(
      await readSystemAbandonedRunIdleMinutes(makeAppConfigClient(1440))
    ).toBe(1440);
    expect(
      await readSystemAbandonedRunIdleMinutes(makeAppConfigClient("720"))
    ).toBe(720);
  });

  it("floors fractional values", async () => {
    expect(
      await readSystemAbandonedRunIdleMinutes(makeAppConfigClient(90.9))
    ).toBe(90);
  });

  it("returns 0 for invalid or negative values", async () => {
    expect(
      await readSystemAbandonedRunIdleMinutes(makeAppConfigClient("soon"))
    ).toBe(0);
    expect(
      await readSystemAbandonedRunIdleMinutes(makeAppConfigClient(-5))
    ).toBe(0);
    expect(
      await readSystemAbandonedRunIdleMinutes(makeAppConfigClient(null))
    ).toBe(0);
    expect(
      await readSystemAbandonedRunIdleMinutes(
        makeAppConfigClient({ minutes: 60 })
      )
    ).toBe(0);
  });
});

describe("resolveEffectiveIdleMinutes", () => {
  it("inherits the system value when the project has no override", () => {
    expect(resolveEffectiveIdleMinutes(0, null)).toBe(0);
    expect(resolveEffectiveIdleMinutes(1440, null)).toBe(1440);
  });

  it("project override wins outright, including 0 = disabled", () => {
    expect(resolveEffectiveIdleMinutes(1440, 0)).toBe(0);
    expect(resolveEffectiveIdleMinutes(0, 720)).toBe(720); // project can enable
    expect(resolveEffectiveIdleMinutes(1440, 2880)).toBe(2880); // and loosen
  });

  it("treats a negative project value as disabled", () => {
    expect(resolveEffectiveIdleMinutes(1440, -1)).toBe(0);
  });
});

describe("resolveAbandonedRunTargetStateId", () => {
  it("returns the configured state when it is still valid for the project", async () => {
    const findFirst = vi.fn().mockResolvedValueOnce({ id: 42 });
    const client = { workflows: { findFirst } } as any;

    expect(await resolveAbandonedRunTargetStateId(client, 7, 42)).toBe(42);
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst.mock.calls[0][0].where).toMatchObject({
      id: 42,
      scope: "RUNS",
      isEnabled: true,
      isDeleted: false,
      projects: { some: { projectId: 7 } },
    });
  });

  it("falls back to the lowest-order DONE workflow when the configured state is invalid", async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(null) // configured state no longer valid
      .mockResolvedValueOnce({ id: 9 }); // DONE fallback
    const client = { workflows: { findFirst } } as any;

    expect(await resolveAbandonedRunTargetStateId(client, 7, 42)).toBe(9);
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(findFirst.mock.calls[1][0].where).toMatchObject({
      scope: "RUNS",
      workflowType: "DONE",
      projects: { some: { projectId: 7 } },
    });
    expect(findFirst.mock.calls[1][0].orderBy).toEqual({ order: "asc" });
  });

  it("skips the configured-state lookup when none is configured", async () => {
    const findFirst = vi.fn().mockResolvedValueOnce({ id: 9 });
    const client = { workflows: { findFirst } } as any;

    expect(await resolveAbandonedRunTargetStateId(client, 7, null)).toBe(9);
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst.mock.calls[0][0].where.workflowType).toBe("DONE");
  });

  it("returns null when the project has no eligible DONE workflow", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const client = { workflows: { findFirst } } as any;

    expect(await resolveAbandonedRunTargetStateId(client, 7, null)).toBeNull();
  });
});
