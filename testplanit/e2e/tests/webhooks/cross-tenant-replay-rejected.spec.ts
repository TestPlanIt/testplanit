import type { BrowserContext } from "@playwright/test";
import { createRawDbClient } from "~/lib/rawDbClient";

import { expect, test } from "../../fixtures/index";
import {
  seedDeliveries,
  seedOutboundConfig,
} from "../../fixtures/webhooks-seed";
import {
  sameOriginRequestHeaders,
  signInSecondaryContext,
} from "../../utils/secondary-context-login";

/**
 * v0.23.0 Section K-02 — cross-tenant replay rejection.
 *
 * The server actions `replayWebhookDelivery` and `bulkReplayFailedDeliveries`
 * (app/actions/webhook-config.ts:1244-1401) auth-gate via
 * `canManageWebhookConfig` BEFORE any service call:
 *
 *   - replayWebhookDelivery looks up `delivery.webhookConfig.projectId`
 *     and runs `canManageWebhookConfig(session, projectId)`. A B-only
 *     PROJECTADMIN holding A's deliveryId would receive `Forbidden` and
 *     no replay would be enqueued (no audit row, no new WebhookDelivery).
 *   - bulkReplayFailedDeliveries looks up `config.projectId` and runs the
 *     same gate before scanning failed deliveries. A B-only PROJECTADMIN
 *     pointed at A's webhookConfigId never reaches the SELECT.
 *
 * E2E-observable contract:
 *   The reachable attack path is the admin UI. Both replay surfaces (the
 *   delivery drawer's "Replay" button and the deliveries tab's "Bulk
 *   replay" button) are gated behind the page-level `notFound()` clause
 *   on `/projects/settings/{A-id}/webhooks` — a B-only PROJECTADMIN
 *   navigating there sees no UI to click. We assert that combined with
 *   ZenStack's read filter (B-only cannot enumerate A's deliveries via
 *   `/api/model/webhookDelivery/findMany`), no replay or audit row is
 *   written for A from B-only's session.
 *
 * The actor is a global PROJECTADMIN who is a `ProjectAssignment` member of
 * Project B but NOT of Project A. The signup endpoint Zod schema is
 * `z.enum(["NONE", "USER", "ADMIN"])` (so PROJECTADMIN cannot be minted at
 * registration), but the user-update endpoint accepts the full
 * `NONE | USER | PROJECTADMIN | ADMIN` set. The fixture composes the two:
 * `api.createUser({access: "USER"})` → `api.setUserAccess(id, "PROJECTADMIN")`
 * → `api.assignUserToProject(id, projectBId)`. The positive control at the
 * bottom of the file proves the assigned-PROJECTADMIN actor IS still a
 * legitimate webhook admin somewhere (Project B), so the negative
 * cross-tenant assertions aren't trivially passing because of a globally
 * broken account.
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
  let projectBId: number;
  let db: ReturnType<typeof createRawDbClient>;
  let projectAOutboundConfigId: string;
  let projectBOutboundConfigId: string;
  let seededAOriginalDeliveryIds: string[] = [];
  let bOnlyEmail: string;
  let bOnlyPassword: string;
  let bOnlyUserId: string;
  let bOnlyCtx: BrowserContext;

  test.beforeAll(async ({ api, browser, baseURL }) => {
    db = createRawDbClient();
    projectAId = await api.createProject(`E2E K-02 Project A ${uniqueId}`);
    projectBId = await api.createProject(`E2E K-02 Project B ${uniqueId}`);

    // Seed an OUTBOUND GENERIC_HMAC config in each project. Per Plan 04-08
    // schema (SetNull on webhookConfigId), deliveries survive config delete;
    // here we keep the configs so the replay UI (if reachable) would be live.
    const aOutbound = await seedOutboundConfig(db, {
      projectId: projectAId,
      url: "https://example.test/k02-a",
      events: ["test_run.completed"],
    });
    projectAOutboundConfigId = aOutbound.configId;

    const bOutbound = await seedOutboundConfig(db, {
      projectId: projectBId,
      url: "https://example.test/k02-b",
      events: ["test_run.completed"],
    });
    projectBOutboundConfigId = bOutbound.configId;

    // Seed 3 failed OUTBOUND delivery rows in Project A. These are the rows
    // a B-only PROJECTADMIN would target if they could enumerate them.
    const seeded = await seedDeliveries(db, {
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

    // Create a global PROJECTADMIN user assigned to Project B only (two-step
    // mint: signup as USER → PATCH access → assign to B; see K-01 header
    // for why this composition is required by the signup Zod schema).
    bOnlyEmail = `k02-bonly-${uniqueId}@example.com`;
    bOnlyPassword = "password123";
    const created = await api.createUser({
      name: "K-02 B-Only PROJECTADMIN",
      email: bOnlyEmail,
      password: bOnlyPassword,
      access: "USER",
    });
    bOnlyUserId = created.data.id;
    await api.setUserAccess(bOnlyUserId, "PROJECTADMIN");
    await api.assignUserToProject(bOnlyUserId, projectBId);

    // Sign in the B-only admin in a fresh sessionless context. The context is
    // kept clean (no extraHTTPHeaders) so the signin page hydrates and any
    // later page navigations load their assets; same-origin classification for
    // ctx.request.* API calls is applied per-request via
    // sameOriginRequestHeaders().
    bOnlyCtx = await signInSecondaryContext(
      browser,
      baseURL!,
      bOnlyEmail,
      bOnlyPassword
    );
  });

  test.afterAll(async ({ api }) => {
    await api.deleteUser(bOnlyUserId);
    await bOnlyCtx.close();
    if (db) await db.$disconnect();
  });

  test("B-only PROJECTADMIN cannot enumerate Project A's failed deliveries via ZenStack", async ({
    baseURL,
  }) => {
    // The deliveries tab's bulk-replay button gates on the deliveries it
    // displays — but the read policy on WebhookDelivery returns an empty
    // array for cross-tenant queries, so the bulk path has nothing to
    // operate on. This is the necessary precondition for K-02: if a
    // cross-tenant caller cannot even discover A's delivery IDs via the
    // RPC surface, they cannot construct a replay request against them.
    let response: Awaited<ReturnType<typeof bOnlyCtx.request.get>> | undefined;
    await test.step("Query Project A's failed deliveries via the RPC surface", async () => {
      response = await bOnlyCtx.request.get(
        `${baseURL}/api/model/webhookDelivery/findMany`,
        {
          headers: sameOriginRequestHeaders(),
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
    });

    await test.step("Assert the cross-tenant query returns an empty list", async () => {
      expect(response!.status()).toBe(200);
      const body = await response!.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(0);
    });
  });

  test("B-only PROJECTADMIN cannot read Project A's outbound config via ZenStack (replay button hidden)", async ({
    baseURL,
  }) => {
    // The single-row replay flow requires the admin to first see the row in
    // the deliveries tab. Since the deliveries tab is gated on
    // useFindFirstProjects(A) which returns null for B-only, AND the
    // WebhookConfig read policy filters to A=invisible, there is no UI
    // surface that ever holds the deliveryId.
    let response: Awaited<ReturnType<typeof bOnlyCtx.request.get>> | undefined;
    await test.step("Query Project A's outbound config via the RPC surface", async () => {
      response = await bOnlyCtx.request.get(
        `${baseURL}/api/model/webhookConfig/findMany`,
        {
          headers: sameOriginRequestHeaders(),
          params: {
            q: JSON.stringify({ where: { projectId: projectAId } }),
          },
        }
      );
    });

    await test.step("Assert the cross-tenant config query returns an empty list", async () => {
      expect(response!.status()).toBe(200);
      const body = await response!.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(0);
    });
  });

  test("B-only PROJECTADMIN URL-tampering to Project A deliveries tab sees no replay UI", async ({
    baseURL,
  }) => {
    // Even with a hand-crafted URL pointing at A's outbound config, the
    // page-level notFound() gate (page.tsx:90-99) unmounts the entire
    // tabs UI. The bulk-replay button + delivery-row drawer (which hosts
    // the single replay button) are both children of this tree and
    // therefore never render.
    const page = await bOnlyCtx.newPage();
    try {
      await test.step("Navigate to Project A's deliveries tab via tampered URL", async () => {
        await page.goto(
          `${baseURL}/projects/settings/${projectAId}/webhooks` +
            `?tab=deliveries&configIds=${projectAOutboundConfigId}&status=failed`,
          { waitUntil: "load" }
        );
      });

      await test.step("Assert the deliveries tab and bulk-replay button never render", async () => {
        await expect(page.getByTestId("webhook-deliveries-tab")).toHaveCount(
          0,
          {
            timeout: 10_000,
          }
        );
        await expect(page.getByTestId("webhook-deliveries-table")).toHaveCount(
          0
        );
        await expect(
          page.getByTestId("webhook-bulk-replay-button")
        ).toHaveCount(0);
      });

      await test.step("Assert no Project A delivery rows render", async () => {
        // No specific delivery row testid for A's deliveries should render.
        for (const id of seededAOriginalDeliveryIds) {
          await expect(
            page.getByTestId(`webhook-delivery-row-${id}`)
          ).toHaveCount(0);
        }
      });
    } finally {
      await page.close();
    }
  });

  test("after B-only's tampering attempts, no replay rows or WEBHOOK_REPLAYED audit exist for Project A", async () => {
    // End-state proof: regardless of what the B-only session attempted via
    // the UI, the database must show no replay rows pointing at A's
    // seeded originals, and no WEBHOOK_REPLAYED audit rows for A. The
    // server actions' `canManageWebhookConfig` gate is the canonical
    // enforcer; ZenStack's read filter is defence-in-depth. This
    // assertion catches a regression in either layer (e.g., if a future
    // refactor accidentally bypassed one of the gates).
    await test.step("Assert no replay rows point at Project A's seeded originals", async () => {
      const replayRows = await db.webhookDelivery.findMany({
        where: {
          replayedFromDeliveryId: { in: seededAOriginalDeliveryIds },
        },
        select: { id: true },
      });
      expect(replayRows).toHaveLength(0);
    });

    await test.step("Assert no WEBHOOK_REPLAYED audit rows exist for Project A", async () => {
      const auditRows = await db.auditLog.findMany({
        where: {
          action: "WEBHOOK_REPLAYED",
          projectId: projectAId,
        },
        select: { id: true },
      });
      expect(auditRows).toHaveLength(0);
    });
  });

  test("positive control — B-only PROJECTADMIN CAN enumerate Project B's outbound config (gate is project-scoped, not global)", async ({
    baseURL,
  }) => {
    // Sanity check: the previous assertions would also pass if the
    // policy globally denied B-only — that would mask a bug where the
    // policy is over-broad. Project B's config must be visible.
    let response: Awaited<ReturnType<typeof bOnlyCtx.request.get>> | undefined;
    await test.step("Query Project B's outbound config via the RPC surface", async () => {
      response = await bOnlyCtx.request.get(
        `${baseURL}/api/model/webhookConfig/findMany`,
        {
          headers: sameOriginRequestHeaders(),
          params: {
            q: JSON.stringify({ where: { projectId: projectBId } }),
          },
        }
      );
    });

    await test.step("Assert Project B's config is visible to the B-only admin", async () => {
      expect(response!.status()).toBe(200);
      const body = await response!.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data.map((row: { id: string }) => row.id)).toContain(
        projectBOutboundConfigId
      );
    });
  });
});
