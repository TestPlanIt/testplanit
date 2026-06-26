import { expect, test } from "../../fixtures/index";
import { createRawDbClient } from "~/lib/rawDbClient";

/**
 * Inbound Webhook Body Cap E2E (Phase 3, plan 03-08)
 *
 * Single spec: 6 MB body POST → HTTP 413, zero WebhookDelivery rows.
 *
 * The body cap is a route-level constant (`MAX_WEBHOOK_BYTES = 5_242_880`
 * in `app/api/webhooks/[token]/route.ts`), enforced before any signature
 * verification or DB write — testing once with one adapter exercises the
 * code path for all three. We use Jira here for simplicity (its create
 * form has no required input fields) with the per-card-scoped pattern from
 * plan 03-07 to provision the config.
 */

const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Inbound webhook body cap (5 MB)", () => {
  let projectId: number;

  test.beforeAll(async ({ api }) => {
    projectId = await api.createProject(`E2E Body Cap ${uniqueId}`);
    await api.setupProjectIssueIntegration(projectId, "JIRA");
  });

  test("rejects bodies > 5 MB with HTTP 413, no WebhookDelivery row written", async ({
    page,
    request,
    baseURL,
  }) => {
    let configToken: string | undefined;
    let configId: string | undefined;
    let oversizeBody: string | undefined;
    let response: Awaited<ReturnType<typeof request.post>> | undefined;

    await test.step("Provision an inbound Jira webhook config", async () => {
      // Provision a Jira config via the admin form. The body cap is route-
      // level so the choice of adapter is immaterial.
      await page.goto(`${baseURL}/projects/settings/${projectId}/webhooks`);
      // 1:1 inbound model: Add skips the chooser and creates inline.
      await page.getByTestId("webhook-inbound-add-button").click();

      // Scope to the JIRA card after creation.
      const jiraCard = page.getByTestId("webhook-inbound-card-jira");
      await expect(jiraCard).toBeVisible();
      const urlText = await jiraCard.getByTestId("webhook-url").innerText();
      const tokenMatch = urlText.match(/\/api\/webhooks\/(whk_[0-9a-f]+)/);
      expect(tokenMatch).not.toBeNull();
      configToken = tokenMatch![1];
    });

    await test.step("Resolve the webhook config id from the database", async () => {
      const db = createRawDbClient();
      try {
        const config = await db.webhookConfig.findFirst({
          where: { token: configToken!, direction: "INBOUND" },
          select: { id: true },
        });
        expect(config).not.toBeNull();
        configId = config!.id;
      } finally {
        await db.$disconnect();
      }
    });

    await test.step("Build a 6 MB JSON body exceeding the cap", async () => {
      oversizeBody = JSON.stringify({
        webhookEvent: "jira:issue_updated",
        issue: {
          key: "OVERSIZE-1",
          fields: {
            status: { name: "X" },
            summary: "A".repeat(6 * 1024 * 1024),
          },
        },
      });
      expect(oversizeBody.length).toBeGreaterThan(5_242_880);
      expect(oversizeBody.length).toBeLessThan(7 * 1024 * 1024);
    });

    await test.step("POST the oversize body and expect HTTP 413", async () => {
      response = await request.post(`${baseURL}/api/webhooks/${configToken!}`, {
        data: oversizeBody!,
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": "sha256=" + "0".repeat(64),
        },
        timeout: 30000,
      });

      expect(response.status()).toBe(413);
    });

    const db = createRawDbClient();
    try {
      const deliveries = await db.webhookDelivery.findMany({
        where: { webhookConfigId: configId! },
      });
      expect(deliveries).toHaveLength(0);
    } finally {
      await db.$disconnect();
    }
  });

  // Cleanup via auto-tracking `api` fixture invoked in beforeAll.
});
