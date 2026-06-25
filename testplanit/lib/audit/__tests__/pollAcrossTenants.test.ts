import { describe, expect, it, vi } from "vitest";

import {
  pollDataChangeLogsAcrossTenants,
  type RawDbClient,
  type TenantPollClient,
} from "../correlation";

/**
 * Unit tests for the multi-tenant Loop B supervisor. They exercise the iteration /
 * error-isolation / re-read / shutdown contract WITHOUT a DB: each fake client's
 * unprocessed-rows SELECT returns [], so pollDataChangeLogsOnce reports processed=0
 * (an empty poll). `calls()` counts how many poll passes a client received.
 */

function makeEmptyClient(): { client: RawDbClient; calls: () => number } {
  const counter = { n: 0 };
  const tx = {
    $queryRaw: async () => [],
    $executeRaw: async () => 0,
    $queryRawUnsafe: async () => [],
  };
  const client = {
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
      counter.n++;
      return fn(tx);
    },
    $queryRaw: tx.$queryRaw,
    $executeRaw: tx.$executeRaw,
    $queryRawUnsafe: tx.$queryRawUnsafe,
  } as unknown as RawDbClient;
  return { client, calls: () => counter.n };
}

function makeThrowingClient(): {
  client: RawDbClient;
  calls: () => number;
} {
  const counter = { n: 0 };
  const client = {
    $transaction: async () => {
      counter.n++;
      throw new Error("tenant db unreachable");
    },
    $queryRaw: async () => [],
    $executeRaw: async () => 0,
    $queryRawUnsafe: async () => [],
  } as unknown as RawDbClient;
  return { client, calls: () => counter.n };
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("pollDataChangeLogsAcrossTenants (multi-tenant Loop B supervisor)", () => {
  it("polls every tenant client each cycle and isolates a per-tenant failure", async () => {
    const a = makeEmptyClient();
    const bad = makeThrowingClient();
    const c = makeEmptyClient();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const runningRef = { running: true };
    const listClients = (): TenantPollClient[] => [
      { tenantId: "a", client: a.client },
      { tenantId: "b", client: bad.client },
      { tenantId: "c", client: c.client },
    ];

    const loop = pollDataChangeLogsAcrossTenants(listClients, runningRef, {
      pollIntervalMs: 1,
    });
    await tick(25);
    runningRef.running = false;
    await loop;

    // All three were polled despite 'b' throwing; the loop kept cycling.
    expect(a.calls()).toBeGreaterThan(0);
    expect(c.calls()).toBeGreaterThan(0);
    expect(bad.calls()).toBeGreaterThan(0);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("re-resolves the tenant list each cycle, picking up a tenant added at runtime", async () => {
    const a = makeEmptyClient();
    const b = makeEmptyClient();
    let tenants: TenantPollClient[] = [{ tenantId: "a", client: a.client }];
    const listClients = vi.fn(() => tenants);
    const runningRef = { running: true };

    const loop = pollDataChangeLogsAcrossTenants(listClients, runningRef, {
      pollIntervalMs: 1,
    });
    await tick(10);
    // Tenant 'b' is added while the loop is already running.
    tenants = [
      { tenantId: "a", client: a.client },
      { tenantId: "b", client: b.client },
    ];
    await tick(15);
    runningRef.running = false;
    await loop;

    expect(listClients.mock.calls.length).toBeGreaterThan(1); // re-read each cycle
    expect(b.calls()).toBeGreaterThan(0); // the runtime-added tenant got polled
  });

  it("backs off and recovers when listClients throws (bad tenant config)", async () => {
    const c = makeEmptyClient();
    let broken = true;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const runningRef = { running: true };
    const listClients = (): TenantPollClient[] => {
      if (broken) throw new Error("bad TENANT_CONFIGS");
      return [{ tenantId: "a", client: c.client }];
    };

    const loop = pollDataChangeLogsAcrossTenants(listClients, runningRef, {
      pollIntervalMs: 1,
    });
    await tick(10);
    broken = false; // config fixed
    await tick(15);
    runningRef.running = false;
    await loop;

    expect(c.calls()).toBeGreaterThan(0); // recovered after the config was fixed
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("stops cycling once runningRef flips false", async () => {
    const a = makeEmptyClient();
    const runningRef = { running: true };
    const loop = pollDataChangeLogsAcrossTenants(
      () => [{ tenantId: undefined, client: a.client }],
      runningRef,
      { pollIntervalMs: 1 }
    );
    await tick(10);
    runningRef.running = false;
    await loop; // resolves → loop exited cleanly
    const after = a.calls();
    await tick(10);
    expect(a.calls()).toBe(after); // no further polling after stop
  });
});
