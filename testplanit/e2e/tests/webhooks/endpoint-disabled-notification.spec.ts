import { createRawDbClient } from "~/lib/rawDbClient";
import { expect, test } from "../../fixtures/index";

/**
 * The notification administrators get when an outbound webhook endpoint is
 * switched off after too many failed deliveries in a row.
 *
 * The webhook worker queues it on the failure that disables the endpoint,
 * which takes ten events through the full retry schedule (about 21 hours
 * each). Here the notification is seeded as the notification worker writes
 * it, and the unit and live-database suites cover who is told.
 *
 * - The bell names the endpoint and its project and links to the project's
 *   webhooks.
 * - A system webhook's notification links to Admin > System Webhooks.
 * - The type can be switched off on the notification preferences page.
 */

test.use({ storageState: "e2e/.auth/admin.json" });

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const AFTER = "was disabled after too many failed deliveries in a row.";

test.describe("Webhook endpoint disabled notification", () => {
  let db: ReturnType<typeof createRawDbClient>;

  test.beforeAll(() => {
    db = createRawDbClient();
  });

  test.afterAll(async () => {
    await db?.$disconnect();
  });

  test("names the endpoint and its project, and links to the project's webhooks", async ({
    page,
    api,
  }) => {
    const label = uid();
    const projectName = `E2E Endpoint Disabled ${label}`;
    const projectId = await api.createProject(projectName);
    const endpointName = `Release channel ${label}`;
    await db.notification.create({
      data: {
        userId: await api.getCurrentUserId(),
        type: "WEBHOOK_ENDPOINT_DISABLED",
        title: "Webhook endpoint disabled",
        message: `The webhook "${endpointName}" in project "${projectName}" ${AFTER}`,
        relatedEntityId: `cfg-${label}`,
        relatedEntityType: "WebhookConfig",
        data: {
          webhookConfigId: `cfg-${label}`,
          endpointName,
          projectId,
          projectName,
        },
      },
    });

    await page.goto(`/en-US/projects/repository/${projectId}`);
    await page.waitForLoadState("load");
    await page.getByTestId("notification-bell-button").first().click();
    const item = page
      .locator("[data-notification-item]")
      .filter({ hasText: endpointName });
    await expect(item).toBeVisible();
    await expect(item).toContainText("Webhook Endpoint Disabled");
    await expect(item).toContainText(
      `The webhook "${endpointName}" in ${projectName} ${AFTER} Nothing is sent to it until it is re-enabled.`
    );

    await item
      .getByRole("link", { name: "View the project's webhooks" })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/projects/settings/${projectId}/webhooks`)
    );
    await expect(page.getByTestId("webhooks-tab-outbound")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("a system webhook's notification links to the system webhooks", async ({
    page,
    api,
  }) => {
    const label = uid();
    const endpointName = `SCIM audit ${label}`;
    await db.notification.create({
      data: {
        userId: await api.getCurrentUserId(),
        type: "WEBHOOK_ENDPOINT_DISABLED",
        title: "Webhook endpoint disabled",
        message: `The system webhook "${endpointName}" ${AFTER}`,
        relatedEntityId: `cfg-${label}`,
        relatedEntityType: "WebhookConfig",
        data: {
          webhookConfigId: `cfg-${label}`,
          endpointName,
          projectId: null,
          projectName: "",
        },
      },
    });

    await page.goto("/en-US/projects");
    await page.waitForLoadState("load");
    await page.getByTestId("notification-bell-button").first().click();
    const item = page
      .locator("[data-notification-item]")
      .filter({ hasText: endpointName });
    await expect(item).toBeVisible();
    await expect(item).toContainText(
      `The system webhook "${endpointName}" ${AFTER}`
    );

    await item.getByRole("link", { name: "View the system webhooks" }).click();
    await expect(page).toHaveURL(/\/admin\/webhooks/);
  });

  test("the type is listed on the notification preferences page and can be switched off", async ({
    page,
    api,
  }) => {
    const userId = await api.getCurrentUserId();
    await page.goto(`/en-US/users/profile/${userId}/alerts`);
    await expect(page.getByTestId("notification-type-preferences")).toBeVisible(
      { timeout: 15000 }
    );
    const toggle = page.getByTestId(
      "notification-type-switch-WEBHOOK_ENDPOINT_DISABLED"
    );
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeEnabled();
    await expect(
      page.getByTestId("notification-type-preferences")
    ).toContainText("Webhook endpoint disabled");
  });
});
