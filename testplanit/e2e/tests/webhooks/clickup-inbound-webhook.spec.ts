import { createHmac } from "node:crypto";
import { expect, test } from "../../fixtures/index";
import { createRawDbClient } from "~/lib/rawDbClient";

/**
 * ClickUp Inbound Webhook E2E
 *
 * Three specs:
 *   1. Happy path — the admin pastes the secret ClickUp minted for a
 *      webhook they registered themselves (the path that needs no live
 *      ClickUp); self-test posts the synthetic `taskStatusUpdated` payload
 *      twice: first send → outcome `synthetic`, second send hits the dedup
 *      INSERT and resolves to outcome `duplicate`.
 *   2. Signature mismatch — raw POST signed with the wrong secret → 401 and
 *      no delivery row.
 *   3. no_handler — raw POST with a valid signature and a `taskUpdated`
 *      event, which carries no status, → 200 with a WebhookDelivery row
 *      carrying error="no_handler".
 *
 * ClickUp signs with a bare hex HMAC-SHA256 in `x-signature`. Pasting the
 * secret means nothing is revealed on creation, so the token is read from
 * the DB rather than the DOM, as the Azure DevOps spec does.
 */

const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const CLICKUP_SECRET = "e2e-clickup-minted-secret";

function signature(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("ClickUp inbound webhook — admin form + raw-POST coverage", () => {
  let projectId: number;
  let configToken: string;
  let configId: string;

  test.beforeAll(async ({ api }) => {
    projectId = await api.createProject(`E2E ClickUp Webhook ${uniqueId}`);
    await api.setupProjectIssueIntegration(projectId, "CLICKUP");
  });

  test("Spec 1 happy path: configure ClickUp inbound with a pasted secret + self-test (synthetic → duplicate)", async ({
    page,
    baseURL,
  }) => {
    const clickupCard = page.getByTestId("webhook-inbound-card-clickup");

    await test.step("Configure the ClickUp inbound webhook with the secret ClickUp minted", async () => {
      await page.goto(`${baseURL}/projects/settings/${projectId}/webhooks`);

      const form = page.getByTestId("webhook-config-form");
      await expect(form).toBeVisible();

      await page.getByTestId("webhook-inbound-add-button").click();
      const wizard = page.getByTestId("webhook-inbound-wizard");
      await wizard.getByTestId("webhook-wizard-source-issues").click();
      await wizard.getByTestId("webhook-wizard-next").click();
      await expect(wizard.getByTestId("webhook-wizard-clickup")).toBeVisible();
      await wizard
        .getByTestId("webhook-inbound-clickup-secret-input")
        .fill(CLICKUP_SECRET);
      await wizard.getByTestId("webhook-create-button").click();
      await expect(
        wizard.getByTestId("webhook-inbound-revealed-box")
      ).toBeVisible();
      await wizard.getByTestId("webhook-reveal-done-button").click();
    });

    await test.step("Verify the configured ClickUp card and webhook URL", async () => {
      await expect(clickupCard).toBeVisible();
      await expect(clickupCard.getByTestId("webhook-url")).toBeVisible();
    });

    const db = createRawDbClient();
    try {
      const config = await db.webhookConfig.findFirst({
        where: {
          projectId,
          adapterType: "CLICKUP",
          direction: "INBOUND",
        },
        select: { id: true, token: true, externalWebhookId: true },
      });
      expect(config).not.toBeNull();
      // A pasted secret means TestPlanIt registered nothing in ClickUp.
      expect(config!.externalWebhookId).toBeNull();
      configId = config!.id;
      configToken = config!.token;
    } finally {
      await db.$disconnect();
    }

    await test.step("Run self-test twice and confirm synthetic then duplicate outcomes", async () => {
      await clickupCard.getByTestId("webhook-send-test-button").click();
      const result = clickupCard.getByTestId("webhook-test-result");
      await expect(result).toContainText("200", { timeout: 10000 });
      await expect(result).toContainText("synthetic");

      await clickupCard.getByTestId("webhook-send-test-button").click();
      await expect(result).toContainText("200", { timeout: 10000 });
      await expect(result).toContainText("duplicate");
    });
  });

  test("Spec 2 signature mismatch: wrong secret → 401, no WebhookDelivery row", async ({
    request,
    baseURL,
  }) => {
    const body = JSON.stringify({
      event: "taskStatusUpdated",
      task_id: "86c0xyz12",
      history_items: [
        {
          field: "status",
          before: { status: "to do" },
          after: { status: "done" },
        },
      ],
    });

    await test.step("POST with a signature from the wrong secret and expect 401", async () => {
      const response = await request.post(
        `${baseURL}/api/webhooks/${configToken}`,
        {
          data: body,
          headers: {
            "content-type": "application/json",
            "x-signature": signature(body, "not-the-secret"),
          },
        }
      );
      expect(response.status()).toBe(401);
    });

    const db = createRawDbClient();
    try {
      const rows = await db.webhookDelivery.findMany({
        where: { webhookConfigId: configId, error: "signature-mismatch" },
      });
      expect(rows).toHaveLength(0);
    } finally {
      await db.$disconnect();
    }
  });

  test("Spec 3 no_handler: taskUpdated carries no status → 200 + WebhookDelivery.error='no_handler'", async ({
    request,
    baseURL,
  }) => {
    const body = JSON.stringify({
      event: "taskUpdated",
      task_id: "86c0xyz12",
      history_items: [{ field: "name", before: "Old name", after: "New name" }],
    });

    await test.step("POST a taskUpdated event with a valid signature and expect 200", async () => {
      const response = await request.post(
        `${baseURL}/api/webhooks/${configToken}`,
        {
          data: body,
          headers: {
            "content-type": "application/json",
            "x-signature": signature(body, CLICKUP_SECRET),
          },
        }
      );
      expect(response.status()).toBe(200);
    });

    const db = createRawDbClient();
    try {
      const deliveries = await db.webhookDelivery.findMany({
        where: { webhookConfigId: configId, error: "no_handler" },
      });
      expect(deliveries.length).toBeGreaterThanOrEqual(1);
    } finally {
      await db.$disconnect();
    }
  });

  // Cleanup via auto-tracking `api` fixture invoked in beforeAll.
});
