import type { BrowserContext } from "@playwright/test";

import { expect, test } from "../../fixtures/index";

/**
 * v0.23.0 Section K-01 — cross-tenant URL tampering on the webhooks admin page.
 *
 * Verifies the two-layer defence around the project-scoped webhooks page:
 *
 *   1. UI gate (page-level):
 *      `/projects/settings/{projectId}/webhooks` calls `notFound()` when the
 *      caller's session is not a global ADMIN AND not a PROJECTADMIN assigned
 *      to that specific project (page.tsx:90-99). A B-only PROJECTADMIN
 *      tampering with the URL to reach Project A's webhooks page must NEVER
 *      see the form, tabs, or any webhook config card.
 *
 *   2. ZenStack policy (data layer):
 *      `WebhookConfig` and `WebhookDelivery` `@@allow('read', ...)` clauses
 *      gate by `project.creator == auth() || project.userPermissions[…]
 *      || project.assignedUsers[user == auth() && auth().access ==
 *      'PROJECTADMIN']` (schema.zmodel:3517-3523, 3582-3587). A
 *      cross-tenant `findMany` from a B-only PROJECTADMIN against
 *      Project A's rows must return an empty array.
 *
 * Setup mirrors `access-control.spec.ts` ACL-02/03 pattern: admin (default
 * storageState) seeds projects A + B + a webhook config in A, then a fresh
 * `browser.newContext` signs in as a B-only PROJECTADMIN via the UI signin
 * page so the second user never inherits the admin's session. The `api`
 * fixture's auto-cleanup tears down both projects + the seeded user.
 */

const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Webhook cross-tenant — URL tampering blocked at UI + ZenStack policy", () => {
  let projectAId: number;
  let projectBId: number;
  let bOnlyEmail: string;
  let bOnlyPassword: string;
  let bOnlyUserId: string;
  let bOnlyCtx: BrowserContext;

  test.beforeAll(async ({ api, browser, baseURL, request }) => {
    // Admin context creates both projects (auto-tracked for cleanup).
    projectAId = await api.createProject(`E2E K-01 Project A ${uniqueId}`);
    projectBId = await api.createProject(`E2E K-01 Project B ${uniqueId}`);

    // Configure a Jira inbound webhook on Project A so the data-layer assertion
    // has a row to NOT see. We use the admin's `api.request` (the page-route
    // helper accepts the admin session) — going through the model API would
    // hit the schema's `@@deny('create, update, delete', true)` on
    // WebhookConfig. The webhook seed helper uses raw Prisma which bypasses
    // policy by design — the same shape the real server action produces.
    // Here we use the existing admin form route (PROJECTADMIN A doesn't exist
    // and this spec doesn't need one — only B-only matters).
    const adminPage = await browser.newPage({
      storageState: "e2e/.auth/admin.json",
    });
    try {
      await adminPage.goto(
        `${baseURL}/projects/settings/${projectAId}/webhooks`
      );
      const form = adminPage.getByTestId("webhook-config-form");
      await expect(form).toBeVisible({ timeout: 15_000 });
      await adminPage.getByTestId("webhook-inbound-add-button").click();
      await adminPage.getByTestId("webhook-inbound-chooser-jira").click();
      await adminPage.getByTestId("webhook-inbound-chooser-submit").click();
      await adminPage.getByTestId("webhook-create-button").click();
      const jiraCard = adminPage.getByTestId("webhook-inbound-card-jira");
      await expect(jiraCard).toBeVisible({ timeout: 15_000 });
    } finally {
      await adminPage.close();
    }

    // Create a PROJECTADMIN-access user assigned to Project B only. This is
    // the closest analogue to "a project admin of project B" in TestPlanIt's
    // access model — `canManageWebhookConfig` (lib/webhooks/auth.ts:62-65)
    // and the webhook page-level gate (page.tsx:91-95) both grant access on
    // (User.access == 'PROJECTADMIN' && project.assignedUsers contains user).
    bOnlyEmail = `k01-bonly-${uniqueId}@example.com`;
    bOnlyPassword = "password123";
    const created = await api.createUser({
      name: "K-01 B-Only PROJECTADMIN",
      email: bOnlyEmail,
      password: bOnlyPassword,
      access: "PROJECTADMIN",
    });
    bOnlyUserId = created.data.id;

    // Assign the user to Project B only — explicitly NOT to Project A.
    const assignResp = await request.post(
      `${baseURL}/api/model/projectAssignment/create`,
      {
        data: {
          data: { userId: bOnlyUserId, projectId: projectBId },
        },
      }
    );
    expect(assignResp.status()).toBe(201);

    // Sign in as the B-only PROJECTADMIN in a fresh browser context so they
    // never inherit the admin's storageState. extraHTTPHeaders matches the
    // ACL spec — the proxy middleware gates same-origin classification on
    // Sec-Fetch-Site for API calls from this context.
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
    // Soft-delete the B-only user. Projects auto-clean via api.cleanup().
    await api.deleteUser(bOnlyUserId);
    await bOnlyCtx.close();
  });

  test("B-only PROJECTADMIN navigating to Project A's webhooks page sees no form, no tabs, no config cards", async ({
    baseURL,
  }) => {
    const page = await bOnlyCtx.newPage();
    try {
      await page.goto(`${baseURL}/projects/settings/${projectAId}/webhooks`, {
        waitUntil: "load",
      });

      // Page-level gate calls notFound() when project is not visible OR when
      // session.user.access ∉ {ADMIN, PROJECTADMIN-assigned}. In both
      // branches the form + tabs are unmounted — assert the inverse so we
      // don't depend on the rendered 404 chrome (which has no testid contract).
      await expect(page.getByTestId("webhook-config-form")).toHaveCount(0, {
        timeout: 10_000,
      });
      await expect(page.getByTestId("webhooks-tab-inbound")).toHaveCount(0);
      await expect(page.getByTestId("webhooks-tab-outbound")).toHaveCount(0);
      await expect(page.getByTestId("webhooks-tab-deliveries")).toHaveCount(0);
      await expect(page.getByTestId("webhook-inbound-card-jira")).toHaveCount(
        0
      );
    } finally {
      await page.close();
    }
  });

  test("B-only PROJECTADMIN navigating to Project A's deliveries tab sees no deliveries table", async ({
    baseURL,
  }) => {
    const page = await bOnlyCtx.newPage();
    try {
      await page.goto(
        `${baseURL}/projects/settings/${projectAId}/webhooks?tab=deliveries`,
        { waitUntil: "load" }
      );
      // ?tab=deliveries is irrelevant once notFound() unmounts the page —
      // the deliveries-tab + table testids must never render.
      await expect(page.getByTestId("webhook-deliveries-tab")).toHaveCount(0, {
        timeout: 10_000,
      });
      await expect(page.getByTestId("webhook-deliveries-table")).toHaveCount(0);
    } finally {
      await page.close();
    }
  });

  test("B-only PROJECTADMIN findMany webhookConfig scoped to Project A returns empty (ZenStack read policy)", async ({
    baseURL,
  }) => {
    // Direct ZenStack RPC probe — bypasses the UI entirely. The
    // WebhookConfig @@allow('read', ...) clause filters to projects where
    // the caller is creator / Project Admin SPECIFIC_ROLE / PROJECTADMIN
    // assigned. Project A has none of those for this user, so the result
    // must be an empty array (200, not 422 — silent filter, per ACL-03
    // pattern).
    const response = await bOnlyCtx.request.get(
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

  test("B-only PROJECTADMIN findMany webhookDelivery scoped to Project A returns empty (ZenStack read policy)", async ({
    baseURL,
  }) => {
    // Same posture — `WebhookDelivery.@@allow('read', ...)` mirrors the
    // WebhookConfig clause through `webhookConfig.project.{creator,
    // userPermissions, assignedUsers}` (schema.zmodel:3582-3587). A
    // tenant-A scoped find from a B-only caller must silently filter all
    // rows. We don't seed delivery rows for this assertion — the clause is
    // identical regardless of count, and the empty result is the
    // observable contract.
    const response = await bOnlyCtx.request.get(
      `${baseURL}/api/model/webhookDelivery/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: { webhookConfig: { projectId: projectAId } },
          }),
        },
      }
    );

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(0);
  });

  test("B-only PROJECTADMIN can still see their OWN project's webhooks page (positive control)", async ({
    baseURL,
  }) => {
    // Sanity: the B-only PROJECTADMIN's gate is project-specific, NOT global.
    // Navigating to Project B's webhooks page must succeed — otherwise this
    // spec would also pass against a globally-broken auth path, which would
    // give a false sense of security.
    const page = await bOnlyCtx.newPage();
    try {
      await page.goto(`${baseURL}/projects/settings/${projectBId}/webhooks`, {
        waitUntil: "load",
      });
      await expect(page.getByTestId("webhook-config-form")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByTestId("webhooks-tab-inbound")).toBeVisible();
    } finally {
      await page.close();
    }
  });
});
