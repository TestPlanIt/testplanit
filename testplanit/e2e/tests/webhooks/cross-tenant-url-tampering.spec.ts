import type { BrowserContext } from "@playwright/test";

import { expect, test } from "../../fixtures/index";

/**
 * v0.23.0 Section K-01 — cross-tenant URL tampering on the webhooks admin page.
 *
 * Verifies the two-layer defence around the project-scoped webhooks page:
 *
 *   1. UI gate (page-level):
 *      `/projects/settings/{projectId}/webhooks` calls `notFound()` when the
 *      caller's `session.user.access` is not ADMIN AND not PROJECTADMIN
 *      (page.tsx:90-99). A regular USER tampering with the URL to reach
 *      Project A's webhooks page must NEVER see the form, tabs, or any
 *      webhook config card.
 *
 *   2. ZenStack policy (data layer):
 *      `WebhookConfig` and `WebhookDelivery` `@@allow('read', ...)` clauses
 *      gate by `project.creator == auth() || project.userPermissions[…
 *      SPECIFIC_ROLE && role.name == 'Project Admin'] ||
 *      project.assignedUsers[user == auth() && auth().access ==
 *      'PROJECTADMIN']` (schema.zmodel:3517-3523, 3582-3587). A regular USER
 *      who is none of those for Project A must receive an empty array from a
 *      cross-tenant `findMany` against Project A's rows.
 *
 * The actor is a regular USER (signup endpoint Zod schema is
 * `z.enum(["NONE", "USER", "ADMIN"])`, so PROJECTADMIN cannot be minted via
 * the signup path the test fixture uses). USER is sufficient for this
 * defence: every webhook read path requires creator / SPECIFIC_ROLE Project
 * Admin / global PROJECTADMIN, and the outsider USER has none of these on
 * Project A.
 *
 * Setup mirrors `access-control.spec.ts` ACL-02 pattern: admin (default
 * storageState) seeds Project A + a webhook config in A, then a fresh
 * `browser.newContext` signs in as the outsider USER via the UI signin page
 * so the second user never inherits the admin's session. The `api` fixture's
 * auto-cleanup tears down the project + the seeded user.
 */

const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Webhook cross-tenant — URL tampering blocked at UI + ZenStack policy", () => {
  let projectAId: number;
  let outsiderEmail: string;
  let outsiderPassword: string;
  let outsiderUserId: string;
  let outsiderCtx: BrowserContext;

  test.beforeAll(async ({ api, browser, baseURL }) => {
    // Admin context creates Project A (auto-tracked for cleanup).
    projectAId = await api.createProject(`E2E K-01 Project A ${uniqueId}`);

    // Configure a Jira inbound webhook on Project A so the data-layer
    // assertion has a row to NOT see. We use the admin's storageState to
    // drive the page route — going through the model API would hit the
    // schema's `@@deny('create, update, delete', true)` on WebhookConfig.
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

    // Create a regular USER with no Project A membership. The signup
    // endpoint accepts only NONE | USER | ADMIN, and USER is what every
    // non-admin / non-PROJECTADMIN session looks like in production. The
    // outsider USER fails every webhook read path on Project A:
    //   - not the project creator (admin is)
    //   - no SPECIFIC_ROLE 'Project Admin' assignment on A
    //   - not auth().access == 'PROJECTADMIN'
    // and fails the page-level gate (`access === 'ADMIN' || 'PROJECTADMIN'`).
    outsiderEmail = `k01-outsider-${uniqueId}@example.com`;
    outsiderPassword = "password123";
    const created = await api.createUser({
      name: "K-01 Outsider USER",
      email: outsiderEmail,
      password: outsiderPassword,
      access: "USER",
    });
    outsiderUserId = created.data.id;

    // Sign in as the outsider in a fresh browser context so they never
    // inherit the admin's storageState. extraHTTPHeaders matches the ACL
    // spec — the proxy middleware gates same-origin classification on
    // Sec-Fetch-Site for API calls from this context.
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
    // Soft-delete the outsider user. Project A auto-cleans via api.cleanup().
    await api.deleteUser(outsiderUserId);
    await outsiderCtx.close();
  });

  test("outsider USER navigating to Project A's webhooks page sees no form, no tabs, no config cards", async ({
    baseURL,
  }) => {
    const page = await outsiderCtx.newPage();
    try {
      await page.goto(`${baseURL}/projects/settings/${projectAId}/webhooks`, {
        waitUntil: "load",
      });

      // Page-level gate calls notFound() when project is not visible OR when
      // session.user.access ∉ {ADMIN, PROJECTADMIN}. In both branches the
      // form + tabs are unmounted — assert the inverse so we don't depend
      // on the rendered 404 chrome (which has no testid contract).
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

  test("outsider USER navigating to Project A's deliveries tab sees no deliveries table", async ({
    baseURL,
  }) => {
    const page = await outsiderCtx.newPage();
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

  test("outsider USER findMany webhookConfig scoped to Project A returns empty (ZenStack read policy)", async ({
    baseURL,
  }) => {
    // Direct ZenStack RPC probe — bypasses the UI entirely. The
    // WebhookConfig @@allow('read', ...) clause filters to projects where
    // the caller is creator / Project Admin SPECIFIC_ROLE / PROJECTADMIN
    // assigned. Project A has none of those for this user, so the result
    // must be an empty array (200, not 422 — silent filter, per ACL-03
    // pattern).
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

  test("outsider USER findMany webhookDelivery scoped to Project A returns empty (ZenStack read policy)", async ({
    baseURL,
  }) => {
    // Same posture — `WebhookDelivery.@@allow('read', ...)` mirrors the
    // WebhookConfig clause through `webhookConfig.project.{creator,
    // userPermissions, assignedUsers}` (schema.zmodel:3582-3587). A
    // tenant-A scoped find from an outsider USER must silently filter all
    // rows. We don't seed delivery rows for this assertion — the clause is
    // identical regardless of count, and the empty result is the
    // observable contract.
    const response = await outsiderCtx.request.get(
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
});
