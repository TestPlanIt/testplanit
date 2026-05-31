// End-to-end publisher fan-out invariant.
//
// Runs against a REAL Valkey/Redis container — NO mocks of the pub/sub
// layer (mocks would defeat the purpose: a regression where the publisher
// silently switches the per-project channel back to the per-run pattern
// would slip past channel-shape unit tests because both call the right
// constructors, but the wire-level fan-out behavior is the actual
// production contract).
//
// The suite is skipped when neither TEST_VALKEY_URL nor VALKEY_URL is
// set so contributors without a local Valkey running don't see spurious
// failures. Mirrors `lib/notifications/sse-isolation.test.ts`.
//
// Local prerequisite to actually exercise the assertions:
//   docker compose -f testplanit/docker-compose.dev.yml up valkey -d
//   TEST_VALKEY_URL=redis://localhost:6379 pnpm test run \
//     lib/live/publish-fanout.integration.test.ts

import { randomUUID } from "crypto";
import IORedis from "ioredis";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { testRunChannel, testRunProjectChannel } from "./channels";

const VALKEY_URL = process.env.TEST_VALKEY_URL ?? process.env.VALKEY_URL;
const describeMaybe = VALKEY_URL ? describe : describe.skip;

// Tenant must be set BEFORE publish.ts is imported because the mock
// captures it via getCurrentTenantId().
const TENANT_ID = `tenant-fanout-${randomUUID().slice(0, 8)}`;

// Mock the publisher's two real-world dependencies with a real IORedis
// client. The test fires the production publishTestRunWakeUp function;
// the only thing diverging from prod is who owns the pub client.
let publisher: IORedis;

vi.mock("~/lib/multiTenantPrisma", () => ({
  getCurrentTenantId: () => TENANT_ID,
}));

vi.mock("~/lib/valkey", () => ({
  get default() {
    return publisher;
  },
}));

// publish.ts must be imported AFTER vi.mock so it picks up the mocked deps.
// Dynamic import inside beforeAll guarantees order.
type PublishFn = typeof import("./publish").publishTestRunWakeUp;
let publishTestRunWakeUp: PublishFn;

describeMaybe("publishTestRunWakeUp fan-out (real Valkey)", () => {
  let runSub: IORedis;
  let projectSub: IORedis;

  // Unique per-run ids so concurrent CI invocations against the same
  // Valkey instance don't collide on channel keys.
  const rand = () => parseInt(randomUUID().replace(/-/g, "").slice(0, 6), 16);
  const RUN_ID = 100_000 + (rand() % 10_000);
  const PROJECT_ID = 200_000 + (rand() % 10_000);
  const runChannelKey = testRunChannel(TENANT_ID, RUN_ID);
  const projectChannelKey = testRunProjectChannel(TENANT_ID, PROJECT_ID);

  beforeAll(async () => {
    const opts = { maxRetriesPerRequest: null, enableReadyCheck: false };
    const url = VALKEY_URL!.replace(/^valkey:\/\//, "redis://");
    publisher = new IORedis(url, opts);
    runSub = new IORedis(url, opts);
    projectSub = new IORedis(url, opts);
    await publisher.ping();

    const mod = (await import("./publish")) as typeof import("./publish");
    publishTestRunWakeUp = mod.publishTestRunWakeUp;
  });

  afterAll(async () => {
    for (const client of [publisher, runSub, projectSub]) {
      try {
        await client?.quit();
      } catch {
        /* ignore — already closed or never connected */
      }
    }
  });

  afterEach(async () => {
    try {
      await runSub.unsubscribe();
    } catch {
      /* ignore */
    }
    try {
      await projectSub.unsubscribe();
    } catch {
      /* ignore */
    }
    runSub.removeAllListeners("message");
    projectSub.removeAllListeners("message");
  });

  /** Subscribe a client to a channel and collect messages it receives.
   *  Returns a promise that resolves with the FIRST message on that channel
   *  (or rejects after timeoutMs). publishTestRunWakeUp defers via
   *  setImmediate, so we need to wait. */
  function captureFirstMessage(
    client: IORedis,
    channel: string,
    timeoutMs = 2000
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for message on ${channel}`)),
        timeoutMs
      );
      client.on("message", (chan: string, msg: string) => {
        if (chan === channel) {
          clearTimeout(timer);
          resolve(msg);
        }
      });
      void client.subscribe(channel);
    });
  }

  it("delivers a single publish call to BOTH the per-run and per-project subscribers", async () => {
    const runReceived = captureFirstMessage(runSub, runChannelKey);
    const projectReceived = captureFirstMessage(projectSub, projectChannelKey);

    // Give both subscribers a beat to actually attach. IORedis subscribe
    // is async; firing the publish before the SUBSCRIBE ack lands means
    // Valkey drops the message (no buffering on pub/sub).
    await new Promise((r) => setTimeout(r, 100));

    publishTestRunWakeUp({
      event: "test_run.result_added",
      runId: RUN_ID,
      projectId: PROJECT_ID,
      targetId: 555,
    });

    const [runMsg, projectMsg] = await Promise.all([
      runReceived,
      projectReceived,
    ]);

    const expected = {
      event: "test_run.result_added",
      runId: RUN_ID,
      projectId: PROJECT_ID,
      targetId: 555,
    };
    expect(JSON.parse(runMsg)).toEqual(expected);
    expect(JSON.parse(projectMsg)).toEqual(expected);
  });

  it("a different project's subscriber never receives this run's wake-up (no cross-project leak)", async () => {
    const otherProjectId = PROJECT_ID + 1;
    const otherProjectChannel = testRunProjectChannel(
      TENANT_ID,
      otherProjectId
    );
    const otherSub = new IORedis(VALKEY_URL!, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    let otherReceived = 0;
    otherSub.on("message", () => {
      otherReceived++;
    });
    await otherSub.subscribe(otherProjectChannel);

    // Also subscribe the project channel so we can confirm the publish
    // actually fired (vs. silently failing and giving a false-pass on
    // the other-project assertion).
    const projectReceived = captureFirstMessage(projectSub, projectChannelKey);
    await new Promise((r) => setTimeout(r, 100));

    publishTestRunWakeUp({
      event: "test_run.state_changed",
      runId: RUN_ID,
      projectId: PROJECT_ID,
    });

    await projectReceived; // confirms the publish landed
    // Give Valkey a moment to deliver any cross-project leak (won't happen)
    await new Promise((r) => setTimeout(r, 100));

    expect(otherReceived).toBe(0);
    await otherSub.quit().catch(() => {});
  });

  it("a different tenant's subscriber never receives this tenant's wake-up", async () => {
    // The tenant prefix is the multi-tenant isolation boundary; this is
    // the load-bearing invariant for SaaS. If a wake-up ever leaked across
    // tenants, one customer would see another's test-run activity.
    const otherTenantChannel = testRunProjectChannel(
      `tenant-other-${randomUUID().slice(0, 8)}`,
      PROJECT_ID
    );
    const otherSub = new IORedis(VALKEY_URL!, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    let otherReceived = 0;
    otherSub.on("message", () => {
      otherReceived++;
    });
    await otherSub.subscribe(otherTenantChannel);

    const projectReceived = captureFirstMessage(projectSub, projectChannelKey);
    await new Promise((r) => setTimeout(r, 100));

    publishTestRunWakeUp({
      event: "test_run.completed",
      runId: RUN_ID,
      projectId: PROJECT_ID,
    });

    await projectReceived;
    await new Promise((r) => setTimeout(r, 100));

    expect(otherReceived).toBe(0);
    await otherSub.quit().catch(() => {});
  });
});
