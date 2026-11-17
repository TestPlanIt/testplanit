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

  // Regression guard: the per-provider page was unreachable from the UI for
  // several releases because the Configure action opened a dialog instead. If
  // that regresses, the page is orphaned again and only its URL reaches it.
  test("each SAML provider gets its own row that opens its own page", async ({
    page,
    request,
    baseURL,
  }) => {
    const names = [`E2E SAML A ${uid()}`, `E2E SAML B ${uid()}`];
    const ids: string[] = [];

    for (const name of names) {
      const created = await request.post(
        `${baseURL}/api/model/ssoProvider/create`,
        {
          data: {
            data: {
              name,
              type: "SAML",
              enabled: false,
              forceSso: false,
              config: {},
            },
          },
        }
      );
      expect(created.ok()).toBeTruthy();
      ids.push((await created.json()).data.id);
    }

    try {
      await test.step("Both providers are listed as separate rows", async () => {
        await page.goto("/en-US/admin/sso");
        await expect(page.getByTestId("sso-page-title")).toBeVisible({
          timeout: 15000,
        });
        for (const name of names) {
          await expect(
            page.locator("tr").filter({ hasText: name })
          ).toHaveCount(1);
        }
      });

      await test.step("Configure opens that provider's own page", async () => {
        await page
          .locator("tr")
          .filter({ hasText: names[1] })
          .getByRole("button", { name: "Configure" })
          .click();

        await page.waitForURL(`**/admin/sso/saml/${ids[1]}`, {
          timeout: 15000,
        });
        await expect(page.locator("#providerName")).toHaveValue(names[1]);
        // Fields the old dialog never exposed, which is why it clobbered them.
        await expect(page.locator("#autoProvision")).toBeVisible();
        await expect(page.locator("#attrEmail")).toBeVisible();
      });
    } finally {
      for (const id of ids) {
        await request
          .delete(`${baseURL}/api/model/ssoProvider/delete`, {
            params: { q: JSON.stringify({ where: { id } }) },
          })
          .catch(() => {});
      }
    }
  });

  test("Add SAML Provider creates a provider and opens its page", async ({
    page,
    request,
    baseURL,
  }) => {
    // The provider this test creates is identified by the id the app routes
    // to, never by diffing the SAML providers table: the suite runs this file
    // in parallel, so a sibling test's providers would land in any such diff
    // and in any cleanup built from one.
    let createdId: string | null = null;

    try {
      await page.goto("/en-US/admin/sso");
      await expect(page.getByTestId("sso-page-title")).toBeVisible({
        timeout: 15000,
      });
      await page.getByTestId("add-saml-provider-button").click();

      await page.waitForURL(/\/admin\/sso\/saml\/[a-z0-9]+$/, {
        timeout: 15000,
      });
      createdId = new URL(page.url()).pathname.split("/").pop() ?? null;
      expect(createdId).toBeTruthy();

      // A generated name, so the provider is nameable before it is enabled.
      await expect(page.locator("#providerName")).not.toHaveValue("");

      const res = await request.get(
        `${baseURL}/api/model/ssoProvider/findUnique`,
        {
          params: {
            q: JSON.stringify({
              where: { id: createdId },
              select: { type: true, enabled: true },
            }),
          },
        }
      );
      const created = (await res.json()).data;
      expect(created?.type).toBe("SAML");
      // Created disabled, so enabling SAML stays a deliberate later step.
      expect(created?.enabled).toBe(false);
    } finally {
      if (createdId) {
        await request
          .delete(`${baseURL}/api/model/ssoProvider/delete`, {
            params: { q: JSON.stringify({ where: { id: createdId } }) },
          })
          .catch(() => {});
      }
    }
  });
});
