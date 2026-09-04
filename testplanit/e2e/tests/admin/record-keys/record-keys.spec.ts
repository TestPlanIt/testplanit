import { expect, test } from "../../../fixtures";

/**
 * Record keys (admin): the cosmetic PROJECT-TC-1234 prefixes. The feature is
 * a global AppConfig switch plus a per-type token map, so the test snapshots
 * the two config rows first and restores them in `finally`.
 */
const CONFIG_KEYS = ["record_key_enabled", "record_key_type_tokens"];

test.describe("Record keys", () => {
  test("enables the feature, customises a token, rejects duplicates and persists", async ({
    page,
    request,
    baseURL,
  }) => {
    const before = await request.get(
      `${baseURL}/api/model/appConfig/findMany`,
      {
        params: { q: JSON.stringify({ where: { key: { in: CONFIG_KEYS } } }) },
      }
    );
    const previous = ((await before.json()).data ?? []) as Array<{
      key: string;
      value: unknown;
    }>;

    try {
      await test.step("Turn the feature on", async () => {
        await page.goto("/en-US/admin/record-keys");
        const card = page.getByTestId("record-keys-card");
        await expect(card).toBeVisible({ timeout: 15000 });
        const toggle = card.getByTestId("record-keys-toggle");
        if ((await toggle.getAttribute("data-state")) !== "checked") {
          await toggle.click();
        }
        await expect(card.getByTestId("record-keys-token-table")).toBeVisible({
          timeout: 15000,
        });
      });

      await test.step("Change the test-case token and watch the preview follow", async () => {
        const input = page.getByTestId("record-keys-input-TEST_CASE");
        await input.clear();
        await input.fill("TCX");
        await expect(
          page.getByTestId("record-keys-preview-TEST_CASE")
        ).toContainText("-TCX-");

        // Wait for the upsert itself. The page is already at networkidle, so
        // a load-state wait would resolve immediately and the reload below
        // would abort the in-flight save.
        const saved = page.waitForResponse(
          (r) =>
            r.url().includes("/api/model/appConfig/upsert") &&
            r.request().method() === "POST"
        );
        await page.getByTestId("record-keys-save").click();
        expect((await saved).ok()).toBeTruthy();
      });

      await test.step("The saved token survives a reload", async () => {
        await page.reload();
        await expect(
          page.getByTestId("record-keys-input-TEST_CASE")
        ).toHaveValue("TCX", { timeout: 15000 });
      });

      await test.step("A duplicate token blocks saving until reset", async () => {
        const runInput = page.getByTestId("record-keys-input-TEST_RUN");
        await runInput.clear();
        await runInput.fill("TCX");
        await expect(page.getByTestId("record-keys-save")).toBeDisabled();
        await page.getByTestId("record-keys-reset").click();
        await expect(runInput).not.toHaveValue("TCX");
      });
    } finally {
      for (const key of CONFIG_KEYS) {
        const prior = previous.find((row) => row.key === key);
        if (prior) {
          await request
            .patch(`${baseURL}/api/model/appConfig/update`, {
              data: { where: { key }, data: { value: prior.value } },
            })
            .catch(() => {});
        } else {
          await request
            .delete(`${baseURL}/api/model/appConfig/delete`, {
              params: { q: JSON.stringify({ where: { key } }) },
            })
            .catch(() => {});
        }
      }
    }
  });
});
