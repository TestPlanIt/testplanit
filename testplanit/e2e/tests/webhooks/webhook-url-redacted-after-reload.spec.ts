import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures/index";
import type { ApiHelper } from "../../fixtures/api.fixture";

/**
 * Webhook URL `[redacted]` after reload (M-05).
 *
 * Workflow under test: an admin configures a fresh inbound webhook → the
 * URL with the full `whk_<64-hex>` token is shown once in the revealed
 * box → the page is reloaded → the URL field MUST now show the redacted
 * form (`/api/webhooks/{prefix}…[redacted]`) and the full 64-hex token
 * MUST NOT be present anywhere in the rendered HTML on subsequent
 * loads. This protects token-leak in (a) admin browser caches, (b) over-
 * the-shoulder views of the webhooks page, and (c) HTML snapshots
 * exported from the page.
 *
 * Adapter-parity: M-05 explicitly calls for "all 3 inbound adapters" —
 * Jira, GitHub, Azure DevOps — because each adapter has its own
 * create-form variant (ADO uses Basic Auth credentials inputs; Jira /
 * GitHub auto-generate HMAC secrets). The redaction lives on the
 * configured-card view (renderConfigCard, webhook-config-form.tsx:741-
 * 753) which is shared across all three, so any future regression in
 * `redactWebhookUrl` would surface identically — but driving all three
 * adapters end-to-end keeps the contract honest in case a future
 * adapter-specific override sneaks in.
 *
 * Outbound is NOT in scope for M-05: the outbound URL is the admin's
 * destination URL (their Slack URL or generic-HMAC endpoint), not an
 * adapter-minted token, so token-redaction doesn't apply on that side
 * (D-18 — Slack URL IS the credential).
 */

const FULL_TOKEN_RE = /whk_[0-9a-f]{64}/;

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

interface AdapterCase {
  /** Display name for the test title. */
  label: string;
  /** Adapter chooser testid (e.g. "webhook-inbound-chooser-jira"). */
  chooserTestId: string;
  /** Card testid suffix (e.g. "jira", "github", "ado"). */
  cardSlug: "jira" | "github" | "ado";
  /**
   * Optional fill function for adapter-specific create-form inputs.
   * Jira and GitHub auto-generate the HMAC secret server-side; ADO
   * needs the admin to type a username + password (D-09).
   */
  fillCreateForm?: (page: Page) => Promise<void>;
}

const ADAPTERS: AdapterCase[] = [
  {
    label: "Jira",
    chooserTestId: "webhook-inbound-chooser-jira",
    cardSlug: "jira",
  },
  {
    label: "GitHub",
    chooserTestId: "webhook-inbound-chooser-github",
    cardSlug: "github",
  },
  {
    label: "Azure DevOps",
    chooserTestId: "webhook-inbound-chooser-ado",
    cardSlug: "ado",
    fillCreateForm: async (page) => {
      await page
        .getByTestId("webhook-inbound-ado-username-input")
        .fill("e2e-redaction-user");
      await page
        .getByTestId("webhook-inbound-ado-password-input")
        .fill("e2e-redaction-pass");
    },
  },
];

async function configureAdapter(
  page: Page,
  baseURL: string,
  api: ApiHelper,
  adapter: AdapterCase
): Promise<{ projectId: number; fullToken: string }> {
  // Use a fresh project per adapter so the chooser never shows the
  // "already configured" disabled state and the after-reload card list
  // contains exactly the one adapter we want to assert against.
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const projectId = await api.createProject(
    `E2E Redact ${adapter.label} ${uniqueId}`
  );

  await page.goto(`${baseURL}/projects/settings/${projectId}/webhooks`);
  const form = page.getByTestId("webhook-config-form");
  await expect(form).toBeVisible();

  await page.getByTestId("webhook-inbound-add-button").click();
  await page.getByTestId(adapter.chooserTestId).click();
  await page.getByTestId("webhook-inbound-chooser-submit").click();
  // Jira/GitHub: chooser-submit creates inline (no separate create form).
  // ADO: chooser-submit opens the credentials form; admin fills username +
  // password, then clicks the dedicated create button.
  if (adapter.fillCreateForm) {
    await adapter.fillCreateForm(page);
    await page.getByTestId("webhook-create-button").click();
  }

  // Capture the full token from the just-revealed URL. The card is now
  // mounted; its inner `webhook-url` testid is shared between the
  // revealed box (full URL) and the configured view (redacted) — at
  // this point in the flow it's still the revealed box.
  const card = page.getByTestId(`webhook-inbound-card-${adapter.cardSlug}`);
  await expect(card).toBeVisible();
  await expect(card.getByTestId("webhook-url")).toBeVisible();
  const revealedUrl = await card.getByTestId("webhook-url").innerText();
  const tokenMatch = revealedUrl.match(FULL_TOKEN_RE);
  expect(tokenMatch).not.toBeNull();
  const fullToken = tokenMatch![0];

  return { projectId, fullToken };
}

test.describe("Inbound webhook URL is redacted after reload across all 3 adapters (M-05)", () => {
  for (const adapter of ADAPTERS) {
    test(`${adapter.label}: full token is shown once on creation, redacted on reload, and never re-rendered in subsequent HTML`, async ({
      page,
      baseURL,
      api,
    }) => {
      const { projectId, fullToken } = await configureAdapter(
        page,
        baseURL!,
        api,
        adapter
      );

      // 1. Reload — the revealed box is gone (component-local state, not
      //    persisted), and the configured-card view kicks in. The card's
      //    webhook-url field now shows the redacted URL.
      await page.reload();
      const card = page.getByTestId(`webhook-inbound-card-${adapter.cardSlug}`);
      await expect(card).toBeVisible({ timeout: 10_000 });
      await expect(card.getByTestId("webhook-url")).toBeVisible();

      const reloadedUrlText = await card.getByTestId("webhook-url").innerText();
      expect(reloadedUrlText).toContain("[redacted]");
      // The full 64-hex token MUST NOT be visible in the URL field after
      // reload — only the prefix-truncated form is allowed.
      expect(reloadedUrlText).not.toMatch(FULL_TOKEN_RE);

      // 2. Defense-in-depth: the full token MUST NOT appear ANYWHERE in
      //    the page's rendered HTML. Catches any future regression where
      //    the token might leak via a hidden field, data-attribute,
      //    embedded JSON snapshot, or overly-eager prefetch.
      const html = await page.content();
      expect(html).not.toMatch(new RegExp(fullToken));
      expect(html).not.toMatch(FULL_TOKEN_RE);

      // 3. Sanity — the redacted form is present in the HTML (otherwise
      //    a hostile change could simply hide the URL field entirely and
      //    pass step 2 by accident).
      expect(html).toContain("[redacted]");

      // 4. Tenant-scoping sanity — the projectId is real and the page
      //    is rendering against the right tenant.
      expect(projectId).toBeGreaterThan(0);
    });
  }
});
