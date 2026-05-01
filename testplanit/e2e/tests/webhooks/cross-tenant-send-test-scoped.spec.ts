import { PrismaClient } from "@prisma/client";
import type { BrowserContext } from "@playwright/test";

import { expect, test } from "../../fixtures/index";

/**
 * v0.23.0 Section K-03 — send-test fires only against the requesting
 * project's webhook config.
 *
 * Two invariants:
 *
 *   1. Token-scoped routing.
 *      `sendTestWebhook(configId)` (app/actions/webhook-config.ts:493-663)
 *      decrypts THIS config's secret, signs the synthetic payload, and POSTs
 *      to `${origin}/api/webhooks/${config.token}`. Each WebhookConfig has
 *      its own unique token (generated as `whk_${randomBytes(32).hex}`,
 *      schema @unique on WebhookConfig.token). A click on Project A's Jira
 *      card therefore lands EXCLUSIVELY on A's config — token uniqueness
 *      makes cross-project leakage structurally impossible.
 *
 *   2. Auth gate on the send-test action.
 *      `sendTestWebhook` calls `canManageWebhookConfig(session, projectId)`
 *      BEFORE decrypting (lines 532-541). A B-only PROJECTADMIN who somehow
 *      held A's configId would receive `Forbidden` and no fetch() would
 *      fire. The reachable UI surface for non-admins is the per-card
 *      "Send test" button, which is gated behind the page-level
 *      notFound() — covered here by asserting the button is unreachable
 *      from a cross-tenant session.
 *
 * Observable contract:
 *   - Click send-test on A's Jira card → exactly one new WebhookDelivery
 *     row for A's WebhookConfig with statusCode=200.
 *   - No new WebhookDelivery rows for B's WebhookConfig as a result.
 *   - From a B-only session, the send-test button on A's card never
 *     renders (notFound() unmounts the entire form).
 */

const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Webhook cross-tenant — send-test fires only on the requesting project", () => {
  let projectAId: number;
  let projectBId: number;
  let prisma: PrismaClient;
  let projectAJiraConfigId: string;
  let projectBJiraConfigId: string;
  let bOnlyEmail: string;
  let bOnlyPassword: string;
  let bOnlyUserId: string;
  let bOnlyCtx: BrowserContext;

  test.beforeAll(async ({ api, browser, baseURL, request }) => {
    prisma = new PrismaClient();
    projectAId = await api.createProject(`E2E K-03 Project A ${uniqueId}`);
    projectBId = await api.createProject(`E2E K-03 Project B ${uniqueId}`);

    // Configure a Jira inbound webhook in EACH project via the admin form.
    // We use the admin storageState (default) for the page navigation —
    // creation goes through `createOrRotateInboundWebhook` which is the
    // same code path the production admin UI exercises.
    const adminPage = await browser.newPage({
      storageState: "e2e/.auth/admin.json",
    });
    try {
      for (const pid of [projectAId, projectBId]) {
        await adminPage.goto(`${baseURL}/projects/settings/${pid}/webhooks`);
        await expect(adminPage.getByTestId("webhook-config-form")).toBeVisible({
          timeout: 15_000,
        });
        await adminPage.getByTestId("webhook-inbound-add-button").click();
        await adminPage.getByTestId("webhook-inbound-chooser-jira").click();
        await adminPage.getByTestId("webhook-inbound-chooser-submit").click();
        await adminPage.getByTestId("webhook-create-button").click();
        await expect(
          adminPage.getByTestId("webhook-inbound-card-jira")
        ).toBeVisible({ timeout: 15_000 });
      }
    } finally {
      await adminPage.close();
    }

    // Capture the per-project Jira config IDs by direct DB query — the page
    // doesn't render the config id at-a-glance, but we need it for the
    // delivery-row assertions below.
    const aConfig = await prisma.webhookConfig.findFirst({
      where: {
        projectId: projectAId,
        adapterType: "JIRA",
        direction: "INBOUND",
      },
      select: { id: true, token: true },
    });
    const bConfig = await prisma.webhookConfig.findFirst({
      where: {
        projectId: projectBId,
        adapterType: "JIRA",
        direction: "INBOUND",
      },
      select: { id: true, token: true },
    });
    expect(aConfig).not.toBeNull();
    expect(bConfig).not.toBeNull();
    projectAJiraConfigId = aConfig!.id;
    projectBJiraConfigId = bConfig!.id;
    // Tokens MUST differ — schema @unique on token prevents collision, but
    // assert it here so a regression in the token mint helper surfaces in
    // this spec rather than as a mysterious cross-tenant delivery.
    expect(aConfig!.token).not.toBe(bConfig!.token);

    // Create a B-only PROJECTADMIN for the cross-tenant UI assertion.
    bOnlyEmail = `k03-bonly-${uniqueId}@example.com`;
    bOnlyPassword = "password123";
    const created = await api.createUser({
      name: "K-03 B-Only PROJECTADMIN",
      email: bOnlyEmail,
      password: bOnlyPassword,
      access: "PROJECTADMIN",
    });
    bOnlyUserId = created.data.id;

    const assignResp = await request.post(
      `${baseURL}/api/model/projectAssignment/create`,
      {
        data: {
          data: { userId: bOnlyUserId, projectId: projectBId },
        },
      }
    );
    expect(assignResp.status()).toBe(201);

    bOnlyCtx = await browser.newContext({
      storageState: undefined,
      extraHTTPHeaders: { "Sec-Fetch-Site": "same-origin" },
    });
    const signinPage = await bOnlyCtx.newPage();
    await signinPage.goto(`${baseURL}/en-US/signin`, { waitUntil: "load" });
    await signinPage.getByTestId("email-input").fill(bOnlyEmail);
    await signinPage.getByTestId("password-input").fill(bOnlyPassword);
    await signinPage.locator('button[type="submit"]').first().click();
    await signinPage.waitForURL(/\/en-US\/?$/, { timeout: 30_000 });
    await signinPage.close();
  });

  test.afterAll(async ({ api }) => {
    await api.deleteUser(bOnlyUserId);
    await bOnlyCtx.close();
    if (prisma) await prisma.$disconnect();
  });

  test("admin clicks Send test on Project A's Jira card → delivery lands on A's config only, NOT on B's", async ({
    page,
    baseURL,
  }) => {
    // Snapshot pre-click delivery counts for both configs. We compare
    // against POST-click counts so an unrelated delivery (e.g., a previous
    // test run that fired before this test's beforeAll completed) doesn't
    // contaminate the assertion.
    const aBefore = await prisma.webhookDelivery.count({
      where: { webhookConfigId: projectAJiraConfigId },
    });
    const bBefore = await prisma.webhookDelivery.count({
      where: { webhookConfigId: projectBJiraConfigId },
    });

    // Admin navigates to Project A's webhooks page and fires the send-test
    // self-loop on the Jira card. The same flow as jira-inbound-webhook.spec
    // — but here we additionally assert that B's config sees ZERO new rows.
    await page.goto(`${baseURL}/projects/settings/${projectAId}/webhooks`);
    const jiraCard = page.getByTestId("webhook-inbound-card-jira");
    await expect(jiraCard).toBeVisible({ timeout: 15_000 });
    await jiraCard.getByTestId("webhook-send-test-button").click();
    const result = jiraCard.getByTestId("webhook-test-result");
    await expect(result).toContainText("200", { timeout: 10_000 });
    await expect(result).toContainText("synthetic");

    // Wait for the delivery row on A's config to land. The receiver writes
    // it inside the request handler, but Next's RSC + DB commit ordering
    // can lag a few ms after the UI's response — poll until visible rather
    // than a fixed sleep (per feedback_no_flaky_tests).
    const aAfterRows = await waitForCount(prisma, {
      where: { webhookConfigId: projectAJiraConfigId },
      atLeast: aBefore + 1,
      timeoutMs: 15_000,
    });
    expect(aAfterRows).toBeGreaterThanOrEqual(aBefore + 1);

    // Project B's config must have ZERO additional rows. The token-scoped
    // routing invariant: A's send-test POSTs to `/api/webhooks/${A.token}`,
    // which the receiver routes via `WebhookConfig.findFirst({where:
    // {token}})` — there is no path by which B's config could be selected.
    const bAfter = await prisma.webhookDelivery.count({
      where: { webhookConfigId: projectBJiraConfigId },
    });
    expect(bAfter).toBe(bBefore);
  });

  test("delivery row written for Project A is scoped to A's config (statusCode=200, JIRA, INBOUND)", async () => {
    // Tighten the assertion: the new row on A's config has the exact
    // shape sendTestWebhook produces. This guards against a regression
    // where the receiver writes the row against a different config (e.g.,
    // a future refactor that mistakenly uses projectId rather than token
    // for routing).
    const rows = await prisma.webhookDelivery.findMany({
      where: { webhookConfigId: projectAJiraConfigId },
      select: {
        id: true,
        adapterType: true,
        direction: true,
        statusCode: true,
        error: true,
      },
      orderBy: { receivedAt: "desc" },
      take: 1,
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const latest = rows[0];
    expect(latest.adapterType).toBe("JIRA");
    expect(latest.direction).toBe("INBOUND");
    expect(latest.statusCode).toBe(200);
    // First send-test in this test's lifetime should be the synthetic
    // success path; error column null on success per Phase 1 contract.
    expect(latest.error).toBeNull();
  });

  test("B-only PROJECTADMIN URL-tampering to Project A's webhooks page sees no send-test button on A's Jira card", async ({
    baseURL,
  }) => {
    // Cross-tenant probe: the B-only session has no path to invoke
    // send-test against A's config. Page-level notFound() unmounts the
    // form + cards entirely, so the per-card send-test button never
    // renders. Asserting the button's count is 0 captures both the
    // notFound() branch AND any future refactor that would render the
    // form but hide individual buttons (the latter would be a weaker
    // posture but still pass this assertion — fine, defence-in-depth).
    const page = await bOnlyCtx.newPage();
    try {
      await page.goto(`${baseURL}/projects/settings/${projectAId}/webhooks`, {
        waitUntil: "load",
      });
      await expect(page.getByTestId("webhook-inbound-card-jira")).toHaveCount(
        0,
        { timeout: 10_000 }
      );
      await expect(page.getByTestId("webhook-send-test-button")).toHaveCount(0);
    } finally {
      await page.close();
    }
  });
});

/**
 * Poll Prisma until the count of matching rows is at least `atLeast`. Returns
 * the final count. Mirrors the `waitForCount` helper in
 * `replay-bulk-deliveries.spec.ts` but for `count()` rather than `findMany`.
 */
async function waitForCount(
  prisma: PrismaClient,
  args: {
    where: Record<string, unknown>;
    atLeast: number;
    timeoutMs: number;
  }
): Promise<number> {
  const startedAt = Date.now();
  let last = 0;
  while (Date.now() - startedAt < args.timeoutMs) {
    last = await prisma.webhookDelivery.count({ where: args.where });
    if (last >= args.atLeast) return last;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `waitForCount: timed out after ${args.timeoutMs}ms; last=${last}, target=${args.atLeast}, where=${JSON.stringify(args.where)}`
  );
}
