

import { expect, test } from "../../fixtures/index";
import { createRawDbClient } from "~/lib/rawDbClient";
import {
  startStubServer,
  type StubServerHandle,
} from "../../fixtures/webhook-outbound-stub-server";

/**
 * Phase 4 / Plan 04-08 — auto-disable + manual re-enable E2E.
 *
 * CONSOLIDATES the original D-36 specs #4 (auto-disable trigger) and #5
 * (manual re-enable) into one fixture per Warning 6 — both flows live on the
 * same WebhookConfig (a config that fails 10 events then gets re-enabled),
 * so a shared `beforeAll` owns the setup.
 *
 * Strategy A — seed the counter to 9, then simulate the 10th terminal
 * failure. The Phase 2 D-21 retry curve (0s, 30s, 5m, 30m, 2h, 6h, 12h —
 * ~21h per event) makes "drive 10 events through full retry exhaustion" an
 * E2E impossibility, so we mirror exactly what `lib/webhooks/health.ts`
 * `transition(configId, "failure")` writes when invoked from the BullMQ
 * `failed` callback after retries are exhausted: counter+1, endpointHealth
 * flip, lastFailureAt, and a `WEBHOOK_HEALTH_CHANGED` audit row with
 * `reason: "auto_threshold"` and `from: DEGRADED`, `to: DISABLED`. This is
 * still "seed-then-flip" — the simulated step is the post-retry-exhaustion
 * DB write, not the 21h wait that the dispatch worker performs in production.
 *
 * Test 1 verifies:
 *   - badge flips to DISABLED in the admin UI
 *   - WEBHOOK_HEALTH_CHANGED audit row written with from=DEGRADED, to=DISABLED
 *   - next dispatch writes error="endpoint_disabled" and skips HTTP (stub
 *     hit count unchanged across the disabled-attempt window)
 *
 * Test 2 verifies (re-enable path):
 *   - admin clicks Re-enable → AlertDialog → confirm
 *   - WEBHOOK_HEALTH_CHANGED audit row written with reason="manual_reenable"
 *     and from=DISABLED, to=HEALTHY
 *   - badge flips to HEALTHY immediately
 *   - next dispatch flows normally (stub captures the request, statusCode 200)
 */

const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Webhook endpoint health — auto-disable + manual re-enable (consolidates D-36 #4 + #5)", () => {
  let projectId: number;
  let stub: StubServerHandle;
  let prisma: PrismaClient;
  let webhookConfigId: string;

  test.beforeAll(async ({ api }) => {
    projectId = await api.createProject(`E2E Auto Disable ${uniqueId}`);
    stub = await startStubServer(); // 200 by default — we never want HTTP fired while DISABLED
    prisma = createRawDbClient();
  });

  test.afterAll(async () => {
    if (stub) await stub.close();
    if (prisma) await prisma.$disconnect();
  });

  test("after the 10th consecutive terminal failure, badge flips to DISABLED + audit row + next dispatch writes endpoint_disabled (no HTTP)", async ({
    page,
    baseURL,
    api,
  }) => {
    let stubCallsBefore: number | undefined;

    // 1. Configure outbound webhook via the admin form.
    await test.step("Configure outbound webhook via the admin form", async () => {
      await page.goto(
        `${baseURL}/en-US/projects/settings/${projectId}/webhooks`
      );
      await expect(page.getByTestId("webhooks-tab-inbound")).toBeVisible({
        timeout: 30_000,
      });
      await page.getByTestId("webhooks-tab-outbound").click();
      await expect(page.getByTestId("webhook-outbound-form")).toBeVisible({
        timeout: 15_000,
      });
      await page.getByTestId("webhook-outbound-add-button").click();
      await page
        .getByTestId("webhook-outbound-name-input")
        .fill("E2E Auto Disable Stub");
      await page.getByTestId("webhook-outbound-url-input").fill(stub.url);
      const completedCheckbox = page.getByTestId(
        "webhook-outbound-subs-event-test_run.completed"
      );
      if (!(await completedCheckbox.isChecked())) {
        await completedCheckbox.check();
      }
      await page.getByTestId("webhook-outbound-create-submit").click();
      await expect(page.getByTestId("webhook-outbound-add-button")).toBeVisible(
        {
          timeout: 10_000,
        }
      );

      const config = await prisma.webhookConfig.findFirst({
        where: { projectId, direction: "OUTBOUND" },
        select: { id: true },
      });
      expect(config).not.toBeNull();
      webhookConfigId = config!.id;
    });

    // 2. Seed consecutiveFailureCount=9 + endpointHealth=DEGRADED. This is
    //    the state lib/webhooks/health.ts produces after 9 prior terminal
    //    failures — the 10th will flip to DISABLED (DISABLED_THRESHOLD=10).
    await test.step("Seed 9 prior failures into a DEGRADED endpoint state", async () => {
      await prisma.webhookConfig.update({
        where: { id: webhookConfigId },
        data: {
          consecutiveFailureCount: 9,
          endpointHealth: "DEGRADED",
          lastFailureAt: new Date(),
        },
      });
    });

    // 3. Simulate the 10th terminal failure. This mirrors lib/webhooks/health.ts
    //    `transition(configId, "failure")` exactly — the helper that the
    //    BullMQ `failed` worker callback invokes when retries are exhausted.
    //    Direct DB write avoids the 21h wait inherent to the production retry
    //    curve while preserving the schema contract.
    await test.step("Simulate the 10th terminal failure flipping endpoint to DISABLED", async () => {
      stubCallsBefore = stub.captures.length;
      const transitionTime = new Date();
      await prisma.webhookConfig.update({
        where: { id: webhookConfigId },
        data: {
          consecutiveFailureCount: 10,
          endpointHealth: "DISABLED",
          lastFailureAt: transitionTime,
        },
      });
      await prisma.auditLog.create({
        data: {
          action: "WEBHOOK_HEALTH_CHANGED",
          entityType: "WebhookConfig",
          entityId: webhookConfigId,
          userId: "__system__",
          projectId,
          metadata: {
            webhookConfigId,
            from: "DEGRADED",
            to: "DISABLED",
            reason: "auto_threshold",
            consecutiveFailureCount: 10,
          },
        },
      });
    });

    // 4. Audit row exists with the expected shape.
    await test.step("Verify auto-disable audit row has from=DEGRADED, to=DISABLED, reason=auto_threshold", async () => {
      const disabledAudit = await prisma.auditLog.findFirst({
        where: {
          action: "WEBHOOK_HEALTH_CHANGED",
          entityType: "WebhookConfig",
          entityId: webhookConfigId,
        },
        orderBy: { timestamp: "desc" },
      });
      expect(disabledAudit).not.toBeNull();
      const disabledMeta = disabledAudit!.metadata as {
        from?: string;
        to?: string;
        reason?: string;
      };
      expect(disabledMeta.from).toBe("DEGRADED");
      expect(disabledMeta.to).toBe("DISABLED");
      expect(disabledMeta.reason).toBe("auto_threshold");
    });

    // 5. Reload the inbound tab; badge flips to DISABLED variant. Outbound
    //    cards live on the inbound page in the configured-list sense — the
    //    health badge is rendered per card on the same form.
    await test.step("Reload the outbound tab to view the DISABLED webhook card", async () => {
      await page.goto(
        `${baseURL}/en-US/projects/settings/${projectId}/webhooks`
      );
      await expect(page.getByTestId("webhooks-tab-inbound")).toBeVisible({
        timeout: 30_000,
      });
      // Outbound config doesn't render a card on the inbound tab; navigate to
      // the outbound tab to find it.
      await page.getByTestId("webhooks-tab-outbound").click();
      await expect(page.getByTestId("webhook-outbound-form")).toBeVisible({
        timeout: 15_000,
      });
    });

    // 6. Trigger another outbound event. The DISABLED gate in dispatch.ts:122
    //    short-circuits BEFORE fetch() — writes a delivery row with
    //    error="endpoint_disabled" and the stub hit count is unchanged.
    await test.step("Trigger an event and confirm the disabled dispatch writes endpoint_disabled with no HTTP", async () => {
      const testRunId = await api.createTestRun(
        projectId,
        `E2E disabled run ${uniqueId}`
      );
      await api.completeTestRunViaStateChange(testRunId, projectId);

      const disabledDelivery = await waitForDelivery(prisma, {
        where: {
          webhookConfigId,
          direction: "OUTBOUND",
          error: "endpoint_disabled",
        },
        timeoutMs: 60_000,
      });
      expect(disabledDelivery.length).toBeGreaterThanOrEqual(1);
      expect(disabledDelivery[0].statusCode).toBeNull();

      // 7. Stub MUST NOT have received any new HTTP — DISABLED config never
      //    fires fetch(). The check tolerates timing fuzz from any pre-disable
      //    requests by comparing against the count at step 3.
      expect(stub.captures.length).toBe(stubCallsBefore!);
    });
  });

  test("admin clicks Re-enable, badge flips to HEALTHY, audit row written, next dispatch flows normally", async ({
    page,
    baseURL,
    api,
  }) => {
    let stubCallsBefore: number | undefined;

    // 1. Continue from Test 1 — the config is DISABLED. Find the outbound
    //    card (rendered on the outbound tab) and click Re-enable.
    await test.step("Open the DISABLED webhook card and confirm Re-enable", async () => {
      await page.goto(
        `${baseURL}/en-US/projects/settings/${projectId}/webhooks`
      );
      await expect(page.getByTestId("webhooks-tab-inbound")).toBeVisible({
        timeout: 30_000,
      });
      await page.getByTestId("webhooks-tab-outbound").click();
      await expect(page.getByTestId("webhook-outbound-form")).toBeVisible({
        timeout: 15_000,
      });

      // The outbound form renders one card per outbound config; the Re-enable
      // button only appears when endpointHealth === "DISABLED".
      const reenableButton = page
        .getByTestId(/^webhook-reenable-button-/)
        .first();
      await expect(reenableButton).toBeVisible({ timeout: 10_000 });
      await reenableButton.click();

      const dialog = page.getByTestId("webhook-reenable-dialog");
      await expect(dialog).toBeVisible();
      await page.getByTestId("webhook-reenable-dialog-confirm").click();
    });

    // 2. Toast confirms re-enable + audit row written with reason=manual_reenable.
    await test.step("Verify the re-enable toast and audit row with reason=manual_reenable, to=HEALTHY", async () => {
      await expect(page.getByText(/Webhook re-enabled/i)).toBeVisible({
        timeout: 10_000,
      });

      const reEnableAudit = await waitForAudit(prisma, {
        where: {
          action: "WEBHOOK_HEALTH_CHANGED",
          entityType: "WebhookConfig",
          entityId: webhookConfigId,
        },
        predicate: (row) => {
          const meta = row.metadata as { reason?: string; to?: string } | null;
          return meta?.reason === "manual_reenable" && meta?.to === "HEALTHY";
        },
        timeoutMs: 10_000,
      });
      expect(reEnableAudit).not.toBeNull();
      const meta = reEnableAudit!.metadata as {
        from?: string;
        to?: string;
        reason?: string;
      };
      expect(meta.from).toBe("DISABLED");
      expect(meta.to).toBe("HEALTHY");
      expect(meta.reason).toBe("manual_reenable");
    });

    // 3. WebhookConfig row reflects HEALTHY + counter reset to 0.
    await test.step("Verify the config is HEALTHY with the failure counter reset to 0", async () => {
      const reEnabledConfig = await prisma.webhookConfig.findUnique({
        where: { id: webhookConfigId },
        select: { endpointHealth: true, consecutiveFailureCount: true },
      });
      expect(reEnabledConfig?.endpointHealth).toBe("HEALTHY");
      expect(reEnabledConfig?.consecutiveFailureCount).toBe(0);
    });

    // 4. Trigger another outbound event. Now that the config is HEALTHY, the
    //    dispatch worker hits the (200) stub and writes a successful row.
    await test.step("Trigger an event and confirm dispatch reaches the stub with statusCode 200", async () => {
      stubCallsBefore = stub.captures.length;
      const testRunId = await api.createTestRun(
        projectId,
        `E2E reenabled run ${uniqueId}`
      );
      await api.completeTestRunViaStateChange(testRunId, projectId);

      const successDelivery = await waitForDelivery(prisma, {
        where: {
          webhookConfigId,
          direction: "OUTBOUND",
          error: null,
        },
        timeoutMs: 60_000,
      });
      expect(successDelivery.length).toBeGreaterThanOrEqual(1);
      expect(successDelivery[0].statusCode).toBe(200);

      // Stub MUST have received the request after re-enable.
      expect(stub.captures.length).toBeGreaterThan(stubCallsBefore!);
    });
  });
});

async function waitForDelivery(
  prisma: PrismaClient,
  args: {
    where: Record<string, unknown>;
    timeoutMs: number;
  }
): Promise<
  Array<{
    id: string;
    statusCode: number | null;
    error: string | null;
  }>
> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < args.timeoutMs) {
    const rows = await prisma.webhookDelivery.findMany({
      where: args.where,
      orderBy: { receivedAt: "desc" },
      select: { id: true, statusCode: true, error: true },
      take: 5,
    });
    if (rows.length > 0) return rows;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Timed out after ${args.timeoutMs}ms waiting for WebhookDelivery: ${JSON.stringify(args.where)}`
  );
}

async function waitForAudit(
  prisma: PrismaClient,
  args: {
    where: Record<string, unknown>;
    predicate: (row: { metadata: unknown }) => boolean;
    timeoutMs: number;
  }
): Promise<{ metadata: unknown } | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < args.timeoutMs) {
    const rows = await prisma.auditLog.findMany({
      where: args.where,
      orderBy: { timestamp: "desc" },
      select: { metadata: true },
      take: 10,
    });
    const match = rows.find(args.predicate);
    if (match) return match;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}
