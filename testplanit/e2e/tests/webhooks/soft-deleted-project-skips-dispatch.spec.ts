

import { expect, test } from "../../fixtures/index";
import { createRawDbClient } from "~/lib/rawDbClient";
import {
  seedOutboundConfig,
  softDeleteProject,
} from "../../fixtures/webhooks-seed";
import {
  startStubServer,
  type StubServerHandle,
} from "../../fixtures/webhook-outbound-stub-server";
import { dispatchWebhook } from "../../../lib/webhooks/dispatch";

/**
 * Soft-deleted project skips outbound dispatch (L-05).
 *
 * Tenancy invariant: when a project is soft-deleted (`isDeleted = true`),
 * any in-flight outbox events for that project must NOT fire to external
 * URLs. The dispatcher's gate (lib/webhooks/dispatch.ts) treats a soft-
 * deleted project as functionally inactive and returns
 * `outcome: "skipped_inactive"` — same outcome as `config.isActive === false`.
 *
 * Without this gate, an outbox row that committed BEFORE the project was
 * soft-deleted would still POST to whatever URLs the (now-removed) project's
 * WebhookConfigs point at, leaking events for a tenant the admin has
 * already deleted from the UI.
 *
 * Test strategy: seed an outbound config + a paired outbox event row, then
 * soft-delete the project, then call `dispatchWebhook` directly. The
 * dispatcher MUST return `skipped_inactive`, the stub server MUST NOT
 * receive any HTTP, and NO new WebhookDelivery row may be written. We call
 * `dispatchWebhook` directly (instead of going through BullMQ) so the test
 * exercises the gate inline rather than racing against the worker poll
 * interval — the gate is a pure function over the loaded `WebhookConfig`
 * row, so the BullMQ wrapper adds no relevant behavior to verify here.
 */

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Outbound dispatcher skips soft-deleted projects (L-05)", () => {
  let projectId: number;
  let stub: StubServerHandle;
  let db: ReturnType<typeof createRawDbClient>;
  let configId: string;
  let outboxEventId: string;
  const eventId = `evt_l05_${Date.now()}`;

  test.beforeAll(async ({ api }) => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    projectId = await api.createProject(`E2E Soft Delete ${uniqueId}`);
    stub = await startStubServer(); // 200 by default — must NEVER receive a hit
    db = createRawDbClient();

    const seededConfig = await seedOutboundConfig(db, {
      projectId,
      url: stub.url,
      events: ["test_run.completed"],
    });
    configId = seededConfig.configId;

    // Seed a paired outbox event so the dispatcher has something to load.
    // dispatchedAt is pre-set to now() so the production outbox poller (which
    // claims rows WHERE dispatchedAt IS NULL FOR UPDATE SKIP LOCKED) does NOT
    // race with this test's direct dispatchWebhook() calls. The test owns the
    // row's lifecycle — no poller-driven duplicate dispatch can leak HTTP to
    // the stub in the window before softDeleteProject() commits.
    const outbox = await db.webhookOutboxEvent.create({
      data: {
        projectId,
        eventName: "test_run.completed",
        eventId,
        payload: { runId: 1, runTitle: "L-05 soft-deleted run" },
        dispatchedAt: new Date(),
      },
      select: { id: true },
    });
    outboxEventId = outbox.id;

    // Soft-delete the project. The dispatch.ts gate reads project.isDeleted
    // fresh on every call, so subsequent dispatchWebhook() invocations will
    // see the soft-delete state regardless of when the outbox row committed.
    await softDeleteProject(db, { projectId });
  });

  test.afterAll(async () => {
    if (stub) await stub.close();
    if (db) await db.$disconnect();
  });

  test("dispatchWebhook returns skipped_inactive, no HTTP fired, no new delivery row", async () => {
    let stubHitsBefore: number | undefined;
    let deliveriesBefore: number | undefined;
    let outcome: Awaited<ReturnType<typeof dispatchWebhook>> | undefined;

    await test.step("Record baseline stub hits and delivery row count", async () => {
      stubHitsBefore = stub.captures.length;
      deliveriesBefore = await db.webhookDelivery.count({
        where: { webhookConfigId: configId },
      });
    });

    await test.step("Dispatch the webhook for the soft-deleted project", async () => {
      outcome = await dispatchWebhook(
        {
          outboxEventId,
          webhookConfigId: configId,
          attempt: 1,
          tenantId: undefined,
        },
        db
      );
    });

    await test.step("Verify gate skipped dispatch with no HTTP and no new delivery row", async () => {
      // Contract — dispatcher reports the gate fired.
      expect(outcome).toEqual({ outcome: "skipped_inactive" });

      // Stub MUST NOT have been hit. The gate runs BEFORE fetch().
      expect(stub.captures.length).toBe(stubHitsBefore);

      // No new WebhookDelivery row written. The skipped_inactive path does
      // NOT write a row (this is the documented dispatcher behavior — only
      // the DISABLED gate writes a stub row).
      const deliveriesAfter = await db.webhookDelivery.count({
        where: { webhookConfigId: configId },
      });
      expect(deliveriesAfter).toBe(deliveriesBefore);
    });
  });

  test("dispatchWebhook still returns skipped_inactive on subsequent attempts (gate is stable)", async () => {
    let stubHitsBefore: number | undefined;
    let outcome: Awaited<ReturnType<typeof dispatchWebhook>> | undefined;

    await test.step("Replay the dispatch on a subsequent attempt", async () => {
      // Defensive — replaying the dispatch (e.g. if BullMQ retries despite
      // the gate firing) must not silently switch to a different code path
      // on the second try. The gate reads `Projects.isDeleted` fresh from
      // the DB on every call.
      stubHitsBefore = stub.captures.length;
      outcome = await dispatchWebhook(
        {
          outboxEventId,
          webhookConfigId: configId,
          attempt: 2,
          tenantId: undefined,
        },
        db
      );
    });

    await test.step("Verify the gate stays stable with no HTTP fired", async () => {
      expect(outcome).toEqual({ outcome: "skipped_inactive" });
      expect(stub.captures.length).toBe(stubHitsBefore);
    });
  });

  test("undeleting the project lets dispatch proceed (gate reverses cleanly)", async () => {
    let outcome: Awaited<ReturnType<typeof dispatchWebhook>> | undefined;

    await test.step("Undelete the project and dispatch the webhook", async () => {
      // Reverse the soft-delete. Dispatch should now reach the stub. This
      // proves the gate is a function of CURRENT `Projects.isDeleted` rather
      // than a one-shot decision baked at config creation time.
      await db.projects.update({
        where: { id: projectId },
        data: { isDeleted: false },
      });

      outcome = await dispatchWebhook(
        {
          outboxEventId,
          webhookConfigId: configId,
          attempt: 1,
          tenantId: undefined,
        },
        db
      );
    });

    await test.step("Verify dispatch succeeded and reached the stub", async () => {
      expect(outcome!.outcome).toBe("success");

      await stub.waitForCapture((c) => c.length > 0, 5_000);
      expect(stub.captures.length).toBeGreaterThan(0);
    });

    await test.step("Re-soft-delete the project to restore prior state", async () => {
      // Re-soft-delete so the auto-cleanup path runs from the same state the
      // test left earlier (Playwright's afterAll fires after this).
      await db.projects.update({
        where: { id: projectId },
        data: { isDeleted: true },
      });
    });
  });
});
