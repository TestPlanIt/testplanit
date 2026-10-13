import { expect, test } from "../../../fixtures";

/**
 * System-scope webhooks (/admin/webhooks) reuse the project webhook form with
 * the system pseudo-project. The form's own behaviour is covered by the
 * project-level specs under e2e/tests/webhooks; this spec covers the admin
 * page's tabs and that a webhook created here lands in the system scope.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test.describe("System webhooks", () => {
  test("switches tabs and creates a system-scope webhook", async ({
    page,
    request,
    baseURL,
  }) => {
    const name = `E2E system hook ${uid()}`;
    let configId: string | null = null;

    try {
      await test.step("The outbound tab is the default and the deliveries tab syncs the URL", async () => {
        await page.goto("/en-US/admin/webhooks");
        await expect(page.getByTestId("webhook-outbound-form")).toBeVisible({
          timeout: 15000,
        });
        await page.getByTestId("system-webhooks-tab-deliveries").click();
        await expect(page).toHaveURL(/[?&]tab=deliveries/);
        await expect(page.getByTestId("webhook-deliveries-tab")).toBeVisible({
          timeout: 15000,
        });
        await page.getByTestId("system-webhooks-tab-outbound").click();
        await expect(page.getByTestId("webhook-outbound-form")).toBeVisible({
          timeout: 15000,
        });
      });

      await test.step("Create a webhook subscribed to the first offered event", async () => {
        await page.getByTestId("webhook-outbound-add-button").click();
        await expect(
          page.getByTestId("webhook-outbound-create-form")
        ).toBeVisible({
          timeout: 10000,
        });
        await page.getByTestId("webhook-outbound-name-input").fill(name);
        await page
          .getByTestId("webhook-outbound-url-input")
          .fill("https://example.invalid/e2e-system-hook");
        await page
          .locator('[data-testid^="webhook-outbound-subs-event-"]')
          .first()
          .click();
        await page.getByTestId("webhook-outbound-create-submit").click();
        await expect(
          page.getByTestId("webhook-outbound-revealed-secret")
        ).toBeVisible({ timeout: 15000 });
        await page.getByTestId("webhook-outbound-secret-done").click();
      });

      await test.step("The card appears and the config belongs to the system scope", async () => {
        const title = page
          .locator('[data-testid^="webhook-outbound-card-title-"]')
          .filter({ hasText: name })
          .first();
        await expect(title).toBeVisible({ timeout: 15000 });
        configId = (await title.getAttribute("data-testid"))!.replace(
          "webhook-outbound-card-title-",
          ""
        );
        const id = /^\d+$/.test(configId) ? Number(configId) : configId;
        const res = await request.get(
          `${baseURL}/api/model/webhookConfig/findFirst`,
          {
            params: {
              q: JSON.stringify({ where: { id }, select: { projectId: true } }),
            },
          }
        );
        expect((await res.json()).data?.projectId).toBe(-1);
      });

      await test.step("Delete it from its card", async () => {
        await page
          .getByTestId(`webhook-outbound-delete-button-${configId}`)
          .click();
        await page
          .getByTestId("webhook-outbound-delete-dialog-confirm")
          .click();
        await expect(
          page.getByTestId(`webhook-outbound-card-${configId}`)
        ).toBeHidden({ timeout: 15000 });
        configId = null;
      });
    } finally {
      if (configId) {
        const id = /^\d+$/.test(configId) ? Number(configId) : configId;
        await request
          .delete(`${baseURL}/api/model/webhookConfig/delete`, {
            params: { q: JSON.stringify({ where: { id } }) },
          })
          .catch(() => {});
      }
    }
  });
});
