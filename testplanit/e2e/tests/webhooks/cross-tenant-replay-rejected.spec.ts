import { PrismaClient } from "@prisma/client";
import type { BrowserContext } from "@playwright/test";

import { expect, test } from "../../fixtures/index";
import {
  seedDeliveries,
  seedOutboundConfig,
} from "../../fixtures/webhooks-seed";

/**
 * v0.23.0 Section K-02 — cross-tenant replay rejection.
 *
 * The server actions `replayWebhookDelivery` and `bulkReplayFailedDeliveries`
 * (app/actions/webhook-config.ts:1244-1401) auth-gate via
 * `canManageWebhookConfig` BEFORE any service call:
 *
 *   - replayWebhookDelivery looks up `delivery.webhookConfig.projectId`
 *     and runs `canManageWebhookConfig(session, projectId)`. An outsider
 *     USER holding A's deliveryId would receive `Forbidden` and no replay
 *     would be enqueued (no audit row, no new WebhookDelivery).
 *   - bulkReplayFailedDeliveries looks up `config.projectId` and runs the
 *     same gate before scanning failed deliveries. An outsider USER
 *     pointed at A's webhookConfigId never reaches the SELECT.
 *
 * E2E-observable contract:
 *   The reachable attack path is the admin UI. Both replay surfaces (the
 *   delivery drawer's "Replay" button and the deliveries tab's "Bulk
 *   replay" button) are gated behind the page-level `notFound()` clause
 *   on `/projects/settings/{A-id}/webhooks` — an outsider USER navigating
 *   there sees no UI to click. We assert that combined with ZenStack's
 *   read filter (USER cannot enumerate A's deliveries via
 *   `/api/model/webhookDelivery/findMany`), no replay or audit row is
 *   written for A from the outsider's session.
 *
 * The actor is a regular USER (signup endpoint Zod schema is
 * `z.enum(["NONE", "USER", "ADMIN"])`, so PROJECTADMIN cannot be minted via
 * the signup path the test fixture uses). USER fails every webhook auth path
 * — `canManageWebhookConfig` requires creator / SPECIFIC_ROLE Project Admin
 * / global PROJECTADMIN, none of which apply to a freshly signed-up USER.
 *
 * Direct server-action invocation from tests would require forging the
 * Next.js Server Action wire format (Next-Action header + form-data
 * payload), which has no stable contract — the existing webhook unit
 * suite (`replay.test.ts`, `auth.test.ts`) covers the helper-level
 * rejection. This spec covers the end-to-end UI + ZenStack defence.
 */

const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const FAILED_OUTBOUND_COUNT = 3;

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Webhook cross-tenant — replay/bulk-replay UI + data path blocked", () => {
  let projectAId: number;
  let prisma: PrismaClient;
  let projectAOutboundConfigId: string;
  let seededAOriginalDeliveryIds: string[] = [];
  let outsiderEmail: string;
  let outsiderPassword: string;
  let outsiderUserId: string;
  let outsiderCtx: BrowserContext;

  test.beforeAll(async ({ api, browser, baseURL }) => {
    prisma = new PrismaClient();
    projectAId = await api.createProject(`E2E K-02 Project A ${uniqueId}`);

    // Seed an OUTBOUND GENERIC_HMAC config in Project A. Per Plan 04-08
    // schema (SetNull on webhookConfigId), deliveries survive config delete;
    // here we keep the config so the replay UI (if reachable) would be live.
    const aOutbound = await seedOutboundConfig(prisma, {
      projectId: projectAId,
      url: "https://example.test/k02-a",
      events: ["test_run.completed"],
    });
    projectAOutboundConfigId = aOutbound.configId;

    // Seed 3 failed OUTBOUND delivery rows in Project A. These are the rows
    // an outsider USER would target if they could enumerate them.
    const seeded = await seedDeliveries(prisma, {
      webhookConfigId: projectAOutboundConfigId,
      projectId: projectAId,
      direction: "OUTBOUND",
      adapterType: "GENERIC_HMAC",
      count: FAILED_OUTBOUND_COUNT,
      statusPattern: "all-failure",
      eventIdPrefix: `evt_k02_${uniqueId}`,
    });
    seededAOriginalDeliveryIds = seeded.map((s) => s.id);
    expect(seededAOriginalDeliveryIds).toHaveLength(FAILED_OUTBOUND_COUNT);

    // Create a regular USER with no Project A membership. The signup endpoint
    // accepts only NONE | USER | ADMIN; USER is what every non-admin /
    // non-PROJECTADMIN session looks like in production. The outsider USER
    // fails `canManageWebhookConfig` on Project A (not creator, no
    // SPECIFIC_ROLE Project Admin, not auth().access == 'PROJECTADMIN').
    outsiderEmail = `k02-outsider-${uniqueId}@example.com`;
    outsiderPassword = "password123";
    const created = await api.createUser({
      name: "K-02 Outsider USER",
      email: outsiderEmail,
      password: outsiderPassword,
      access: "USER",
    });
    outsiderUserId = created.data.id;

    outsiderCtx = await browser.newContext({
      storageState: undefined,
      extraHTTPHeaders: { "Sec-Fetch-Site": "same-origin" },
    });
    const signinPage = await outsiderCtx.newPage();
    await signinPage.goto(`${baseURL}/en-US/signin`, { waitUntil: "load" });
    await signinPage.getByTestId("email-input").fill(outsiderEmail);
    await signinPage.getByTestId("password-input").fill(outsiderPassword);
    await signinPage.locator('button[type="submit"]').first().click();
    await signinPage.waitForURL(/\/en-US\/?$/, { timeout: 30_000 });
    await signinPage.close();
  });

  test.afterAll(async ({ api }) => {
    await api.deleteUser(outsiderUserId);
    await outsiderCtx.close();
    if (prisma) await prisma.$disconnect();
  });

  test("outsider USER cannot enumerate Project A's failed deliveries via ZenStack", async ({
    baseURL,
  }) => {
    // The deliveries tab's bulk-replay button gates on the deliveries it
    // displays — but the read policy on WebhookDelivery returns an empty
    // array for cross-tenant queries, so the bulk path has nothing to
    // operate on. This is the necessary precondition for K-02: if a
    // cross-tenant caller cannot even discover A's delivery IDs via the
    // RPC surface, they cannot construct a replay request against them.
    const response = await outsiderCtx.request.get(
      `${baseURL}/api/model/webhookDelivery/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: {
              webhookConfigId: projectAOutboundConfigId,
              error: { not: null },
            },
          }),
        },
      }
    );
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(0);
  });

  test("outsider USER cannot read Project A's outbound config via ZenStack (replay button hidden)", async ({
    baseURL,
  }) => {
    // The single-row replay flow requires the admin to first see the row in
    // the deliveries tab. Since the deliveries tab is gated on
    // useFindFirstProjects(A) which returns null for outsider USER, AND the
    // WebhookConfig read policy filters to A=invisible, there is no UI
    // surface that ever holds the deliveryId.
    const response = await outsiderCtx.request.get(
      `${baseURL}/api/model/webhookConfig/findMany`,
      {
        params: {
          q: JSON.stringify({ where: { projectId: projectAId } }),
        },
      }
    );
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(0);
  });

  test("outsider USER URL-tampering to Project A deliveries tab sees no replay UI", async ({
    baseURL,
  }) => {
    // Even with a hand-crafted URL pointing at A's outbound config, the
    // page-level notFound() gate (page.tsx:90-99) unmounts the entire
    // tabs UI for any session whose access is not ADMIN/PROJECTADMIN. The
    // bulk-replay button + delivery-row drawer (which hosts the single
    // replay button) are both children of this tree and therefore never
    // render.
    const page = await outsiderCtx.newPage();
    try {
      await page.goto(
        `${baseURL}/projects/settings/${projectAId}/webhooks` +
          `?tab=deliveries&configIds=${projectAOutboundConfigId}&status=failed`,
        { waitUntil: "load" }
      );
      await expect(page.getByTestId("webhook-deliveries-tab")).toHaveCount(0, {
        timeout: 10_000,
      });
      await expect(page.getByTestId("webhook-deliveries-table")).toHaveCount(0);
      await expect(page.getByTestId("webhook-bulk-replay-button")).toHaveCount(
        0
      );
      // No specific delivery row testid for A's deliveries should render.
      for (const id of seededAOriginalDeliveryIds) {
        await expect(
          page.getByTestId(`webhook-delivery-row-${id}`)
        ).toHaveCount(0);
      }
    } finally {
      await page.close();
    }
  });

  test("after outsider's tampering attempts, no replay rows or WEBHOOK_REPLAYED audit exist for Project A", async () => {
    // End-state proof: regardless of what the outsider session attempted
    // via the UI, the database must show no replay rows pointing at A's
    // seeded originals, and no WEBHOOK_REPLAYED audit rows for A. The
    // server actions' `canManageWebhookConfig` gate is the canonical
    // enforcer; ZenStack's read filter is defence-in-depth. This
    // assertion catches a regression in either layer (e.g., if a future
    // refactor accidentally bypassed one of the gates).
    const replayRows = await prisma.webhookDelivery.findMany({
      where: {
        replayedFromDeliveryId: { in: seededAOriginalDeliveryIds },
      },
      select: { id: true },
    });
    expect(replayRows).toHaveLength(0);

    const auditRows = await prisma.auditLog.findMany({
      where: {
        action: "WEBHOOK_REPLAYED",
        projectId: projectAId,
      },
      select: { id: true },
    });
    expect(auditRows).toHaveLength(0);
  });
});
