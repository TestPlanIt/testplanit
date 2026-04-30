// Multi-tenant isolation invariant for the SSE notifications transport.
// REQ ISO-03 / CONTEXT D-25 / CR-03.
//
// Runs against a REAL Valkey/Redis container — NO mocks of the pub/sub layer
// (mocks would defeat the purpose). The suite is skipped when neither
// TEST_VALKEY_URL nor VALKEY_URL is set so contributors without a local
// Valkey running don't see spurious failures.
//
// Local prerequisite to actually exercise the assertions:
//   docker compose -f testplanit/docker-compose.dev.yml up valkey -d
//   TEST_VALKEY_URL=redis://localhost:6379 pnpm test run \
//     lib/notifications/sse-isolation.test.ts

import { randomUUID } from "crypto";
import IORedis from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { tenantBroadcastChannel, userChannel } from "./channels";

const VALKEY_URL = process.env.TEST_VALKEY_URL ?? process.env.VALKEY_URL;
const describeMaybe = VALKEY_URL ? describe : describe.skip;

describeMaybe("sse multi-tenant isolation (real Valkey)", () => {
  let pub: IORedis;
  let sub: IORedis;

  // Unique per-run identifiers so concurrent CI invocations against the same
  // Valkey instance don't cross-talk on channel keys.
  const tenantA = `tenant-test-A-${randomUUID().slice(0, 8)}`;
  const tenantB = `tenant-test-B-${randomUUID().slice(0, 8)}`;
  const userA = `user-test-A-${randomUUID().slice(0, 8)}`;
  const userB = `user-test-B-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    // Mirror the connection-options shape used by lib/valkey.ts so the test
    // exercises the exact same client behavior the SSE route does.
    const opts = { maxRetriesPerRequest: null, enableReadyCheck: false };
    const url = VALKEY_URL!.replace(/^valkey:\/\//, "redis://");
    pub = new IORedis(url, opts);
    sub = new IORedis(url, opts);
    // Fail fast if Valkey is not actually reachable (skip-guard only checks
    // that an env var was provided, not that the server responds).
    await pub.ping();
  });

  afterAll(async () => {
    // IORedis must be explicitly closed or Vitest hangs at the 30s teardownTimeout.
    try {
      await pub.quit();
    } catch {
      /* ignore — already closed or never connected */
    }
    try {
      await sub.quit();
    } catch {
      /* ignore */
    }
  });

  it("tenant-A subscriber receives zero events when tenant-B publishes", async () => {
    const received: string[] = [];
    sub.on("message", (_channel, message) => received.push(message));

    await sub.subscribe(
      userChannel(tenantA, userA),
      tenantBroadcastChannel(tenantA)
    );

    // Tenant-B user channel — must not leak to tenant-A.
    await pub.publish(
      userChannel(tenantB, userB),
      JSON.stringify({ id: "n1", event: "notification" })
    );
    // Tenant-B broadcast — must not leak to tenant-A.
    await pub.publish(
      tenantBroadcastChannel(tenantB),
      JSON.stringify({ id: "n2", event: "notification" })
    );
    // Same userId in tenant-B — channel is namespaced by tenant, must not leak.
    await pub.publish(
      userChannel(tenantB, userA),
      JSON.stringify({ id: "n3", event: "notification" })
    );

    // 1 second is well above Redis pub/sub fan-out latency on a healthy
    // local Valkey; if the isolation invariant is broken, this is plenty
    // of time for cross-tenant messages to arrive.
    await new Promise((r) => setTimeout(r, 1000));
    expect(received.length).toBe(0);
  });

  it("positive control: tenant-A subscriber receives tenant-A publish", async () => {
    // Proves the test wiring is correct — without this, a subscribe failure
    // would silently make the isolation assertion above always pass.
    const received: string[] = [];
    sub.on("message", (_channel, message) => received.push(message));

    // sub is already subscribed to tenant-A channels from the previous test.

    await pub.publish(
      userChannel(tenantA, userA),
      JSON.stringify({ id: "n4", event: "notification" })
    );

    await vi.waitFor(
      () => {
        expect(received.length).toBe(1);
      },
      { timeout: 1000 }
    );
  });
});
