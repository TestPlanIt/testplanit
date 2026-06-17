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
    // Inbound webhooks are 1:1 with the project's active issue
    // integration. Without an integration assigned the Add button is
    // disabled, so the webhook UI flow can't even start.
    await api.setupProjectIssueIntegration(projectId, "JIRA");
  });

  test("project admin can configure Jira inbound webhook and self-test it end-to-end", async ({
    page,
    baseURL,
  }) => {
    const jiraCard = page.getByTestId("webhook-inbound-card-jira");
    let result: ReturnType<typeof page.getByTestId> | undefined;

    await test.step("Open the project webhooks settings page", async () => {
      await page.goto(`${baseURL}/projects/settings/${projectId}/webhooks`);

      // Form is mounted on the dedicated /webhooks page — sibling to
      // /integrations (webhooks are a transport-layer concern, not nested
      // under any specific feature integration).
      const form = page.getByTestId("webhook-config-form");
      await expect(form).toBeVisible();
    });

    await test.step("Add the inbound webhook and verify URL + secret are revealed once", async () => {
      // 1:1 inbound model: the Add button skips the chooser entirely
      // and creates inline against the project's active integration
      // adapter (JIRA, set up in beforeAll).
      await page.getByTestId("webhook-inbound-add-button").click();

      // Scope to the JIRA card after creation. URL + secret revealed once.
      await expect(jiraCard).toBeVisible();
      await expect(jiraCard.getByTestId("webhook-url")).toBeVisible();
      await expect(jiraCard.getByTestId("webhook-secret")).toBeVisible();
      const url = await jiraCard.getByTestId("webhook-url").textContent();
      expect(url).toMatch(/whk_[0-9a-f]{64}/);
    });

    await test.step("Reload and verify the URL is redacted and the token is hidden", async () => {
      // Reload — URL is now redacted, secret is masked.
      await page.reload();
      await expect(jiraCard.getByTestId("webhook-url")).toBeVisible();
      const reloadedUrl = await jiraCard
        .getByTestId("webhook-url")
        .textContent();
      expect(reloadedUrl).toContain("[redacted]");
      // Full 64-hex token must NOT be visible at-a-glance after reload.
      expect(reloadedUrl).not.toMatch(/[0-9a-f]{64}/);
    });

    await test.step("Send the first test webhook and expect a synthetic outcome", async () => {
      // FIRST send-test click — full pipeline runs synthetically; service
      // writes WebhookEventDedup row + WebhookDelivery row.
      await jiraCard.getByTestId("webhook-send-test-button").click();
      result = jiraCard.getByTestId("webhook-test-result");
      await expect(result).toContainText("200", { timeout: 5000 });
      await expect(result).toContainText("synthetic");
    });

    await test.step("Send the test webhook again and expect a duplicate outcome", async () => {
      // SECOND send-test click: SYNTHETIC_PAYLOAD is byte-identical → same
      // payloadDigest → dedup INSERT throws P2002 → fresh WebhookDelivery row
      // written with error='duplicate' → server action forwards outcome.
      await jiraCard.getByTestId("webhook-send-test-button").click();
      await expect(result!).toContainText("200", { timeout: 5000 });
      await expect(result!).toContainText("duplicate");
    });
  });
});
