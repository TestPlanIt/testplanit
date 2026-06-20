
import { expect, test } from "../../fixtures/index";
import { createRawDbClient } from "~/lib/rawDbClient";

/**
 * Azure DevOps Inbound Webhook E2E (Phase 3, plan 03-08)
 *
 * Three specs:
 *   1. Happy path — admin form configures ADO inbound (username/password
 *      Basic Auth credentials); self-test runs the synthetic
 *      `workitem.updated` payload twice; first send → outcome `synthetic`,
 *      second send hits the dedup INSERT and resolves to outcome `duplicate`.
 *   2. Auth-mismatch — raw POST with a wrong Basic Auth header → 401, no
 *      auth-mismatch WebhookDelivery row written.
 *   3. no_handler — raw POST with valid Basic Auth and a `build.complete`
 *      eventType (which the adapter accepts but the service has no handler
 *      for) → 200 with a WebhookDelivery row carrying error="no_handler".
 *
 * Per-card-scoped testid pattern (locked in plan 03-07):
 *   `page.getByTestId('webhook-inbound-card-ado')` for the card root +
 *   stable inner action testids (`webhook-url`, `webhook-send-test-button`,
 *   `webhook-test-result`). The chooser uses unscoped global testids; the
 *   ADO create-form inputs use unscoped testids
 *   (`webhook-inbound-ado-username-input`,
 *   `webhook-inbound-ado-password-input`) since only one ADO create-form is
 *   alive at a time.
 *
 * ADO does NOT reveal a plaintext secret on creation — the admin already
 * typed the credentials. The token is therefore extracted from the DB via
 * Prisma rather than from the DOM (the configured-card view shows a
 * redacted URL).
 */

const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const ADO_USER = "tpi";
const ADO_PASS = "s3cret";

function basicAuthHeader(user: string, pass: string): string {
  return "Basic " + Buffer.from(`${user}:${pass}`, "utf8").toString("base64");
}

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Azure DevOps inbound webhook — admin form + raw-POST coverage", () => {
  let projectId: number;
  let configToken: string;
  let configId: string;

  test.beforeAll(async ({ api }) => {
    projectId = await api.createProject(`E2E ADO Webhook ${uniqueId}`);
    await api.setupProjectIssueIntegration(projectId, "AZURE_DEVOPS");
  });

  test("Spec 1 happy path: configure ADO inbound + self-test (synthetic → duplicate)", async ({
    page,
    baseURL,
  }) => {
    const adoCard = page.getByTestId("webhook-inbound-card-ado");

    await test.step("Configure ADO inbound webhook with Basic Auth credentials", async () => {
      await page.goto(`${baseURL}/projects/settings/${projectId}/webhooks`);

      const form = page.getByTestId("webhook-config-form");
      await expect(form).toBeVisible();

      // 1:1 inbound model: Add skips the chooser and lands directly on
      // the ADO credentials form (since ADO needs admin-typed creds).
      await page.getByTestId("webhook-inbound-add-button").click();

      // ADO create-form inputs (unscoped — only one create-form is alive at a
      // time). Submit is the same `webhook-create-button` testid all adapters
      // share.
      await page
        .getByTestId("webhook-inbound-ado-username-input")
        .fill(ADO_USER);
      await page
        .getByTestId("webhook-inbound-ado-password-input")
        .fill(ADO_PASS);
      await page.getByTestId("webhook-create-button").click();
    });

    await test.step("Verify the configured ADO card and webhook URL", async () => {
      // From here on, scope to the ADO card.
      await expect(adoCard).toBeVisible();
      await expect(adoCard.getByTestId("webhook-url")).toBeVisible();
    });

    // ADO does not reveal a plaintext secret; resolve the token via Prisma so
    // the raw-POST specs below can target the receiver directly.
    const prisma = createRawDbClient();
    try {
      const config = await prisma.webhookConfig.findFirst({
        where: {
          projectId,
          adapterType: "AZURE_DEVOPS",
          direction: "INBOUND",
        },
        select: { id: true, token: true },
      });
      expect(config).not.toBeNull();
      configId = config!.id;
      configToken = config!.token;
    } finally {
      await prisma.$disconnect();
    }

    await test.step("Run self-test twice and confirm synthetic then duplicate outcomes", async () => {
      // Dedup invariant: identical synthetic payloads dedup on the second send.
      await adoCard.getByTestId("webhook-send-test-button").click();
      const result = adoCard.getByTestId("webhook-test-result");
      await expect(result).toContainText("200", { timeout: 10000 });
      await expect(result).toContainText("synthetic");

      await adoCard.getByTestId("webhook-send-test-button").click();
      await expect(result).toContainText("200", { timeout: 10000 });
      await expect(result).toContainText("duplicate");
    });
  });

  test("Spec 2 auth-mismatch: wrong Basic Auth → 401, no auth-mismatch WebhookDelivery row", async ({
    request,
    baseURL,
  }) => {
    await test.step("POST with a wrong Basic Auth header and expect 401", async () => {
      const body = JSON.stringify({
        eventType: "workitem.updated",
        resource: { id: 297, fields: { "System.State": "Closed" } },
      });
      const response = await request.post(
        `${baseURL}/api/webhooks/${configToken}`,
        {
          data: body,
          headers: {
            "content-type": "application/json",
            authorization: basicAuthHeader("wrong", "wrong"),
          },
        }
      );
      expect(response.status()).toBe(401);
    });

    const prisma = createRawDbClient();
    try {
      const mismatchRows = await prisma.webhookDelivery.findMany({
        where: { webhookConfigId: configId, error: "auth-mismatch" },
      });
      expect(mismatchRows).toHaveLength(0);
    } finally {
      await prisma.$disconnect();
    }
  });

  test("Spec 3 no_handler: build.complete eventType → 200 + WebhookDelivery.error='no_handler'", async ({
    request,
    baseURL,
  }) => {
    await test.step("POST a build.complete event with valid Basic Auth and expect 200", async () => {
      const body = JSON.stringify({
        eventType: "build.complete",
        resource: { id: 999 },
      });
      const response = await request.post(
        `${baseURL}/api/webhooks/${configToken}`,
        {
          data: body,
          headers: {
            "content-type": "application/json",
            authorization: basicAuthHeader(ADO_USER, ADO_PASS),
          },
        }
      );
      expect(response.status()).toBe(200);
    });

    const prisma = createRawDbClient();
    try {
      const deliveries = await prisma.webhookDelivery.findMany({
        where: { webhookConfigId: configId, error: "no_handler" },
      });
      expect(deliveries.length).toBeGreaterThanOrEqual(1);
    } finally {
      await prisma.$disconnect();
    }
  });

  // Cleanup via auto-tracking `api` fixture invoked in beforeAll.
});
