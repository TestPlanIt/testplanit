import { expect, test } from "../../../fixtures";

/**
 * SAML provider configuration (/admin/sso/saml/:providerId): the per-provider
 * form that creates the SamlConfiguration row. The page has no test ids, so
 * fields are addressed by their labelled ids.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test.describe("SAML provider configuration", () => {
  test("creates the SAML configuration for a provider", async ({
    page,
    request,
    baseURL,
  }) => {
    const created = await request.post(
      `${baseURL}/api/model/ssoProvider/create`,
      {
        data: {
          data: {
            name: `E2E SAML ${uid()}`,
            type: "SAML",
            enabled: false,
            forceSso: false,
            config: {},
          },
        },
      }
    );
    expect(created.ok()).toBeTruthy();
    const providerId: string = (await created.json()).data.id;

    try {
      await test.step("Fill the SAML settings and save", async () => {
        await page.goto(`/en-US/admin/sso/saml/${providerId}`);
        await expect(page.locator("#entryPoint")).toBeVisible({
          timeout: 15000,
        });
        await page
          .locator("#entryPoint")
          .fill("https://idp.example.com/sso/saml");
        await page.locator("#issuer").fill("https://testplanit.example.com");
        // The ACS callback URL is derived by the app and rendered read-only.
        await expect(page.locator("#callbackUrl")).toHaveAttribute(
          "readonly",
          ""
        );
        await page
          .locator("#cert")
          .fill("-----BEGIN CERTIFICATE-----\nMIIC\n-----END CERTIFICATE-----");
        await page.getByRole("button", { name: "Save" }).click();
      });

      await test.step("The configuration row exists for the provider", async () => {
        await expect
          .poll(
            async () => {
              const res = await request.get(
                `${baseURL}/api/model/samlConfiguration/findUnique`,
                {
                  params: {
                    q: JSON.stringify({
                      where: { providerId },
                      select: { entryPoint: true, issuer: true },
                    }),
                  },
                }
              );
              return (await res.json()).data?.entryPoint ?? null;
            },
            { timeout: 15000 }
          )
          .toBe("https://idp.example.com/sso/saml");
      });
    } finally {
      // Deleting the provider cascades to its configuration.
      await request
        .delete(`${baseURL}/api/model/ssoProvider/delete`, {
          params: { q: JSON.stringify({ where: { id: providerId } }) },
        })
        .catch(() => {});
    }
  });
});
