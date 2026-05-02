import { expect, test } from "../../fixtures/index";

/**
 * Jira Inbound Webhook E2E
 *
 * Closes the loop end-to-end:
 *   admin opens /webhooks → Add inbound webhook → pick Jira → Continue →
 *   Create → URL+secret revealed → reload (URL redacted, secret masked) →
 *   click "Send test webhook" → outcome 'synthetic' → click again → outcome
 *   'duplicate' (dedup invariant: identical synthetic payloads dedup on the
 *   second send).
 *
 * The synthetic payload signed by `sendTestWebhook` is byte-identical across
 * clicks; with the dedup-INSERT-then-synthetic ordering in
 * `applyInboundIssueUpdate`, the second click's dedup INSERT throws P2002 and
 * the receiver returns outcome='duplicate'. This spec asserts that contract
 * against the running production app.
 *
 * Phase 3 multi-card flow: Phase 1's direct-create path was replaced by an
 * Add → chooser → Continue → Create flow. Per-card-scoped testids (locked in
 * plan 03-07) keep this spec aligned with GitHub + ADO siblings.
 */

const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Jira inbound webhook — admin form + send-test self-loop", () => {
  let projectId: number;

  test.beforeAll(async ({ api }) => {
    projectId = await api.createProject(`E2E Jira Webhook ${uniqueId}`);
  });

  test("project admin can configure Jira inbound webhook and self-test it end-to-end", async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${baseURL}/projects/settings/${projectId}/webhooks`);

    // Form is mounted on the dedicated /webhooks page — sibling to
    // /integrations (webhooks are a transport-layer concern, not nested
    // under any specific feature integration).
    const form = page.getByTestId("webhook-config-form");
    await expect(form).toBeVisible();

    // Multi-card inbound flow: Add → chooser → pick Jira → Continue → Create.
    await page.getByTestId("webhook-inbound-add-button").click();
    await page.getByTestId("webhook-inbound-chooser-jira").click();
    // Jira chooser-submit creates inline — no separate create button.
    await page.getByTestId("webhook-inbound-chooser-submit").click();

    // Scope to the JIRA card after creation. URL + secret revealed once.
    const jiraCard = page.getByTestId("webhook-inbound-card-jira");
    await expect(jiraCard).toBeVisible();
    await expect(jiraCard.getByTestId("webhook-url")).toBeVisible();
    await expect(jiraCard.getByTestId("webhook-secret")).toBeVisible();
    const url = await jiraCard.getByTestId("webhook-url").textContent();
    expect(url).toMatch(/whk_[0-9a-f]{64}/);

    // Reload — URL is now redacted, secret is masked.
    await page.reload();
    await expect(jiraCard.getByTestId("webhook-url")).toBeVisible();
    const reloadedUrl = await jiraCard.getByTestId("webhook-url").textContent();
    expect(reloadedUrl).toContain("[redacted]");
    // Full 64-hex token must NOT be visible at-a-glance after reload.
    expect(reloadedUrl).not.toMatch(/[0-9a-f]{64}/);

    // FIRST send-test click — full pipeline runs synthetically; service
    // writes WebhookEventDedup row + WebhookDelivery row.
    await jiraCard.getByTestId("webhook-send-test-button").click();
    const result = jiraCard.getByTestId("webhook-test-result");
    await expect(result).toContainText("200", { timeout: 5000 });
    await expect(result).toContainText("synthetic");

    // SECOND send-test click: SYNTHETIC_PAYLOAD is byte-identical → same
    // payloadDigest → dedup INSERT throws P2002 → fresh WebhookDelivery row
    // written with error='duplicate' → server action forwards outcome.
    await jiraCard.getByTestId("webhook-send-test-button").click();
    await expect(result).toContainText("200", { timeout: 5000 });
    await expect(result).toContainText("duplicate");
  });
});
