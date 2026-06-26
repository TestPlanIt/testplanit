import { createHmac } from "node:crypto";
import { createRawDbClient } from "~/lib/rawDbClient";
import { expect, test } from "../../fixtures/index";

/**
 * GitHub Inbound Webhook E2E (Phase 3, plan 03-08)
 *
 * Three specs:
 *   1. Happy path — admin form configures GitHub inbound, self-test runs the
 *      synthetic payload twice; first send → outcome `synthetic`, second send
 *      hits the dedup INSERT and resolves to outcome `duplicate`.
 *   2. Signature mismatch — raw POST with a wrong HMAC `x-hub-signature-256`
 *      header → 401, no signature-mismatch WebhookDelivery row written.
 *   3. no_handler — raw POST a correctly-signed `push` event (which the
 *      adapter accepts but the service has no handler for) → 200 with a
 *      WebhookDelivery row carrying error="no_handler".
 *
 * All admin-form interactions use the per-card-scoped testid pattern locked
 * in plan 03-07: `page.getByTestId('webhook-inbound-card-github')` for the
 * card root + stable inner action testids (`webhook-url`, `webhook-secret`,
 * `webhook-send-test-button`, `webhook-test-result`). The chooser uses
 * unscoped global testids (`webhook-inbound-add-button`,
 * `webhook-inbound-chooser-github`, `webhook-inbound-chooser-submit`).
 */

const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function signGithubBody(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("GitHub inbound webhook — admin form + raw-POST coverage", () => {
  let projectId: number;
  let configToken: string;
  let plainSecret: string;

  test.beforeAll(async ({ api }) => {
    projectId = await api.createProject(`E2E GitHub Webhook ${uniqueId}`);
    await api.setupProjectIssueIntegration(projectId, "GITHUB");
  });

  test("Spec 1 happy path: configure GitHub inbound + self-test (synthetic → duplicate)", async ({
    page,
    baseURL,
  }) => {
    const githubCard = page.getByTestId("webhook-inbound-card-github");
    const result = githubCard.getByTestId("webhook-test-result");

    await test.step("Open the webhooks settings page and add a GitHub inbound config", async () => {
      await page.goto(`${baseURL}/projects/settings/${projectId}/webhooks`);

      // Form is mounted on the dedicated /webhooks page; inbound tab is default.
      const form = page.getByTestId("webhook-config-form");
      await expect(form).toBeVisible();

      // 1:1 inbound model: Add skips the chooser and creates inline
      // against the project's active integration adapter (GITHUB).
      await page.getByTestId("webhook-inbound-add-button").click();

      // From here on, scope to the GitHub card.
      await expect(githubCard).toBeVisible();
      await expect(githubCard.getByTestId("webhook-url")).toBeVisible();
      await expect(githubCard.getByTestId("webhook-secret")).toBeVisible();
    });

    await test.step("Capture the generated webhook URL token and plaintext secret", async () => {
      // The just-created config briefly renders a revealed box inside the card
      // showing the full URL + plaintext secret. Capture both for the raw-POST
      // specs that follow in the same describe block.
      const urlText = await githubCard.getByTestId("webhook-url").innerText();
      const tokenMatch = urlText.match(/\/api\/webhooks\/(whk_[0-9a-f]+)/);
      expect(tokenMatch).not.toBeNull();
      configToken = tokenMatch![1];
      plainSecret = await githubCard.getByTestId("webhook-secret").innerText();
      // generateSecret() returns randomBytes(48).toString("base64url") — 64
      // base64url chars (alphabet [A-Za-z0-9_-]).
      expect(plainSecret).toMatch(/^[A-Za-z0-9_-]{60,80}$/);
    });

    await test.step("Send the self-test once and confirm a synthetic outcome", async () => {
      // Dedup invariant: identical synthetic payloads dedup on the second send.
      await githubCard.getByTestId("webhook-send-test-button").click();
      await expect(result).toContainText("200", { timeout: 10000 });
      await expect(result).toContainText("synthetic");
    });

    await test.step("Send the self-test again and confirm a duplicate outcome", async () => {
      await githubCard.getByTestId("webhook-send-test-button").click();
      await expect(result).toContainText("200", { timeout: 10000 });
      await expect(result).toContainText("duplicate");
    });
  });

  test("Spec 2 signature mismatch: bad HMAC → 401, no signature-mismatch WebhookDelivery row", async ({
    request,
    baseURL,
  }) => {
    const body = JSON.stringify({
      action: "closed",
      issue: { number: 42, state: "closed" },
      repository: { full_name: "octocat/Hello-World" },
    });
    const wrongSig = "sha256=" + "0".repeat(64);

    await test.step("POST the issues event with a wrong HMAC signature and expect 401", async () => {
      const response = await request.post(
        `${baseURL}/api/webhooks/${configToken}`,
        {
          data: body,
          headers: {
            "content-type": "application/json",
            "x-hub-signature-256": wrongSig,
            "x-github-event": "issues",
          },
        }
      );
      expect(response.status()).toBe(401);
    });

    // Rejected requests must not persist a "signature-mismatch"-shaped
    // delivery row — the route returns 401 before the service is invoked.
    const db = createRawDbClient();
    try {
      await test.step("Verify no signature-mismatch WebhookDelivery row was written", async () => {
        const config = await db.webhookConfig.findFirst({
          where: { token: configToken, direction: "INBOUND" },
          select: { id: true },
        });
        expect(config).not.toBeNull();
        const mismatchRows = await db.webhookDelivery.findMany({
          where: { webhookConfigId: config!.id, error: "signature-mismatch" },
        });
        expect(mismatchRows).toHaveLength(0);
      });
    } finally {
      await db.$disconnect();
    }
  });

  test("Spec 3 no_handler: signed push event → 200 + WebhookDelivery.error='no_handler'", async ({
    request,
    baseURL,
  }) => {
    const body = JSON.stringify({
      ref: "refs/heads/main",
      repository: { full_name: "octocat/Hello-World" },
    });
    const sig = signGithubBody(body, plainSecret);

    await test.step("POST a correctly-signed push event and expect 200", async () => {
      const response = await request.post(
        `${baseURL}/api/webhooks/${configToken}`,
        {
          data: body,
          headers: {
            "content-type": "application/json",
            "x-hub-signature-256": sig,
            "x-github-event": "push",
          },
        }
      );
      expect(response.status()).toBe(200);
    });

    const db = createRawDbClient();
    try {
      await test.step("Verify a WebhookDelivery row was written with error='no_handler'", async () => {
        const config = await db.webhookConfig.findFirst({
          where: { token: configToken, direction: "INBOUND" },
          select: { id: true },
        });
        expect(config).not.toBeNull();
        const deliveries = await db.webhookDelivery.findMany({
          where: { webhookConfigId: config!.id, error: "no_handler" },
        });
        expect(deliveries.length).toBeGreaterThanOrEqual(1);
      });
    } finally {
      await db.$disconnect();
    }
  });

  // Cleanup is handled by the auto-tracking `api` fixture invoked in
  // beforeAll — the api helper records `projectId` in `createdProjectIds`
  // and `cleanup()` runs cascading deletes when the fixture scope ends
  // (matches the Phase 1 jira-inbound-webhook.spec.ts pattern).
});
