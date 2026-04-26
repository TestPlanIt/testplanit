import { expect, test } from "../../fixtures/index";

/**
 * Jira Inbound Webhook E2E (Phase 1, plan 01-05)
 *
 * Closes the loop:
 *   admin opens project integrations → configures Jira webhook → reload →
 *   row persists → click "Send test webhook" → outcome 'synthetic' →
 *   click again → outcome 'duplicate' (BLOCKER #5 SC#5 demo lock).
 *
 * The synthetic payload signed by `sendTestWebhook` is byte-identical across
 * clicks (locked at the source-grep level by Task 5.2a's acceptance criterion
 * and at the unit-test level by webhook-config.test.ts Test #8). With plan
 * 01-03's dedup-INSERT-then-synthetic ordering, the second click's dedup
 * INSERT throws P2002 and the receiver returns outcome='duplicate'. This
 * spec asserts that contract end-to-end against the running production app.
 *
 * NOTE on actual execution: this file is written autonomously in Task 5.3a
 * for sub-30s feedback. The actual `pnpm build && E2E_PROD=on pnpm test:e2e`
 * dress rehearsal is a separate human-verify checkpoint (Task 5.3b).
 */

const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Jira inbound webhook — admin form + send-test self-loop", () => {
  let projectId: number;

  test.beforeAll(async ({ api }) => {
    projectId = await api.createProject(`E2E Jira Webhook ${uniqueId}`);
  });

  test("project admin can configure Jira inbound webhook and self-test it end-to-end (SC#5 demo)", async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${baseURL}/projects/settings/${projectId}/integrations`);

    // Form is mounted on the integrations page (extends, not replaces, the
    // existing project-integration-settings card).
    const form = page.getByTestId("webhook-config-form");
    await expect(form).toBeVisible();

    // No config yet → create button shown.
    const createBtn = page.getByTestId("webhook-create-button");
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    // URL + secret revealed exactly once on creation.
    await expect(page.getByTestId("webhook-url")).toBeVisible();
    await expect(page.getByTestId("webhook-secret")).toBeVisible();
    const url = await page.getByTestId("webhook-url").textContent();
    expect(url).toMatch(/whk_[0-9a-f]{64}/);

    // Reload — URL is now redacted, secret is masked (D-19).
    await page.reload();
    await expect(page.getByTestId("webhook-url")).toBeVisible();
    const reloadedUrl = await page.getByTestId("webhook-url").textContent();
    expect(reloadedUrl).toContain("[redacted]");
    // Full 64-hex token must NOT be visible at-a-glance after reload.
    expect(reloadedUrl).not.toMatch(/[0-9a-f]{64}/);

    // FIRST send-test click — full pipeline runs synthetically; sync service
    // writes WebhookEventDedup row + WebhookDelivery row (D-20).
    await page.getByTestId("webhook-send-test-button").click();
    const result = page.getByTestId("webhook-test-result");
    await expect(result).toContainText("200", { timeout: 5000 });
    await expect(result).toContainText("synthetic");

    // SECOND send-test click (BLOCKER #5 SC#5 demo lock):
    // SYNTHETIC_PAYLOAD is byte-identical → same payloadDigest → dedup
    // INSERT throws P2002 → fresh WebhookDelivery row written with
    // error='duplicate' → server action forwards outcome='duplicate'.
    await page.getByTestId("webhook-send-test-button").click();
    await expect(result).toContainText("200", { timeout: 5000 });
    await expect(result).toContainText("duplicate");
  });
});
