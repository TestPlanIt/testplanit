import { expect, test } from "../../../fixtures";

/**
 * SCIM provisioning tokens (admin): mint a bearer token, see it revealed
 * once, find it in the list, and revoke it.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test.describe("SCIM tokens", () => {
  test("mints a token, reveals it once, and revokes it", async ({ page }) => {
    const name = `E2E SCIM ${uid()}`;

    await test.step("Mint a token with the defaults", async () => {
      await page.goto("/en-US/admin/scim");
      await expect(page.getByTestId("scim-admin-page")).toBeVisible({
        timeout: 15000,
      });
      await page.getByTestId("scim-mint-button").click();
      await page.getByTestId("scim-mint-dialog-name-input").fill(name);
      await page.getByTestId("scim-mint-dialog-submit").click();
    });

    await test.step("The plaintext token is shown once", async () => {
      const token = page.getByTestId("scim-mint-dialog-reveal-token");
      await expect(token).toBeVisible({ timeout: 15000 });
      expect(((await token.textContent()) ?? "").trim().length).toBeGreaterThan(
        10
      );
      await page.getByTestId("scim-mint-dialog-close").click();
    });

    let rowId = "";
    await test.step("The new token is listed", async () => {
      const row = page
        .locator('[data-testid^="admin-scim-row-"]')
        .filter({ hasText: name })
        .first();
      await expect(row).toBeVisible({ timeout: 15000 });
      rowId = (await row.getAttribute("data-testid"))!.replace(
        "admin-scim-row-",
        ""
      );
    });

    await test.step("Revoke it and confirm", async () => {
      await page.getByTestId(`scim-revoke-button-${rowId}`).click();
      const alert = page.getByRole("alertdialog");
      await expect(alert).toBeVisible({ timeout: 10000 });
      await alert.getByRole("button", { name: "Revoke" }).click();
      await expect(alert).toBeHidden({ timeout: 15000 });
      // Revoked tokens leave the default (active-only) list.
      await expect(page.getByTestId(`admin-scim-row-${rowId}`)).toBeHidden({
        timeout: 15000,
      });
    });
  });
});
