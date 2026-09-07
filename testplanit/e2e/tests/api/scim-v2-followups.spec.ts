import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "../../fixtures";

/**
 * SCIM v2 follow-ups over the real HTTP surface.
 *
 * Covers the three behaviours that only exist once a request actually crosses
 * the bearer middleware:
 *
 *   - cross-IdP ownership: a second identity provider gets 404 on read and
 *     409 on write against another directory's user
 *   - overlap-window rotation: the superseded bearer keeps provisioning until
 *     its window closes
 *   - the roles hybrid: an IdP-asserted role drives the user's access tier
 *
 * Tokens are minted through the admin page (the only mint path), then every
 * SCIM call goes through a bearer-only context the way an IdP would call in.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const SCIM = "/api/scim/v2";
const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";

type IdpOption = "OKTA" | "ENTRA" | "ONELOGIN" | "OTHER";

async function mintScimToken(
  page: Page,
  name: string,
  idp: IdpOption = "OKTA"
): Promise<string> {
  await page.goto("/en-US/admin/scim");
  await expect(page.getByTestId("scim-admin-page")).toBeVisible({
    timeout: 15000,
  });
  await page.getByTestId("scim-mint-button").click();
  await page.getByTestId("scim-mint-dialog-name-input").fill(name);

  // Radix Select: open the trigger, then pick the option by its role.
  await page.getByTestId("scim-mint-dialog-idp-select").click();
  const idpLabels: Record<IdpOption, string> = {
    OKTA: "Okta",
    ENTRA: "Microsoft Entra (Azure AD)",
    ONELOGIN: "OneLogin",
    OTHER: "Other",
  };
  await page.getByRole("option", { name: idpLabels[idp], exact: true }).click();

  await page.getByTestId("scim-mint-dialog-submit").click();
  const reveal = page.getByTestId("scim-mint-dialog-reveal-token");
  await expect(reveal).toBeVisible({ timeout: 15000 });
  const token = ((await reveal.textContent()) ?? "").trim();
  await page.getByTestId("scim-mint-dialog-close").click();
  expect(token).toMatch(/^tps_/);
  return token;
}

function scimHeaders(bearer: string) {
  return {
    Authorization: `Bearer ${bearer}`,
    "Content-Type": "application/scim+json",
    Accept: "application/scim+json",
  };
}

function userBody(email: string, extra: Record<string, unknown> = {}) {
  return {
    schemas: [USER_SCHEMA],
    userName: email,
    externalId: `ext-${email}`,
    name: { givenName: "E2E", familyName: "Scim" },
    emails: [{ value: email, primary: true }],
    active: true,
    ...extra,
  };
}

test.describe.configure({ mode: "serial" });

test.describe("SCIM v2 follow-ups", () => {
  let bearerCtx: APIRequestContext;
  const mintedTokenNames: string[] = [];
  const createdUserEmails: string[] = [];

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: undefined });
    bearerCtx = ctx.request;
  });

  test.afterAll(async ({ request, baseURL }) => {
    // Revoke every token this spec minted so none outlives the run.
    for (const name of mintedTokenNames) {
      const res = await request.get(
        `${baseURL}/api/model/scimToken/findFirst`,
        {
          params: {
            q: JSON.stringify({ where: { name }, select: { id: true } }),
          },
        }
      );
      const id = (await res.json())?.data?.id;
      if (id) {
        await request
          .patch(`${baseURL}/api/model/scimToken/update`, {
            data: {
              where: { id },
              data: { revokedAt: new Date().toISOString(), isActive: false },
            },
          })
          .catch(() => undefined);
      }
    }
  });

  test("a second IdP cannot read or overwrite another directory's user", async ({
    browser,
    baseURL,
  }) => {
    const run = uid();
    const oktaName = `E2E SCIM okta ${run}`;
    const entraName = `E2E SCIM entra ${run}`;
    mintedTokenNames.push(oktaName, entraName);

    const adminCtx = await browser.newContext({
      storageState: "e2e/.auth/admin.json",
    });
    const adminPage = await adminCtx.newPage();
    const oktaToken = await mintScimToken(adminPage, oktaName, "OKTA");
    const entraToken = await mintScimToken(adminPage, entraName, "ENTRA");
    await adminCtx.close();

    const email = `scim-owner-${run}@example.com`;
    createdUserEmails.push(email);

    let userId = "";
    await test.step("Okta provisions a user", async () => {
      const res = await bearerCtx.post(`${baseURL}${SCIM}/Users`, {
        headers: scimHeaders(oktaToken),
        data: userBody(email),
      });
      expect(res.status()).toBe(201);
      userId = (await res.json()).id;
      expect(userId).toBeTruthy();
    });

    await test.step("Entra cannot see it — 404, not 403", async () => {
      const res = await bearerCtx.get(`${baseURL}${SCIM}/Users/${userId}`, {
        headers: scimHeaders(entraToken),
      });
      expect(res.status()).toBe(404);
    });

    await test.step("Entra cannot overwrite it — 409", async () => {
      const res = await bearerCtx.put(`${baseURL}${SCIM}/Users/${userId}`, {
        headers: scimHeaders(entraToken),
        data: userBody(email, { active: false }),
      });
      expect(res.status()).toBe(409);
      const body = await res.json();
      expect(body.scimType).toBe("uniqueness");
    });

    await test.step("Entra's list does not leak the user", async () => {
      const res = await bearerCtx.get(
        `${baseURL}${SCIM}/Users?filter=${encodeURIComponent(
          `userName eq "${email}"`
        )}`,
        { headers: scimHeaders(entraToken) }
      );
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.totalResults).toBe(0);
    });

    await test.step("Okta still owns it and can write", async () => {
      const res = await bearerCtx.put(`${baseURL}${SCIM}/Users/${userId}`, {
        headers: scimHeaders(oktaToken),
        data: userBody(email, { active: false }),
      });
      expect(res.status()).toBe(200);
      expect((await res.json()).active).toBe(false);
    });

    await test.step("Clean up", async () => {
      await bearerCtx.delete(`${baseURL}${SCIM}/Users/${userId}`, {
        headers: scimHeaders(oktaToken),
      });
    });
  });

  test("the superseded bearer keeps provisioning through the overlap window", async ({
    browser,
    baseURL,
    request,
  }) => {
    const run = uid();
    const name = `E2E SCIM rotate ${run}`;
    mintedTokenNames.push(name);

    const adminCtx = await browser.newContext({
      storageState: "e2e/.auth/admin.json",
    });
    const adminPage = await adminCtx.newPage();
    const oldToken = await mintScimToken(adminPage, name, "OKTA");

    // Find the row and rotate it with a 24h overlap.
    const row = adminPage
      .locator('[data-testid^="admin-scim-row-"]')
      .filter({ hasText: name })
      .first();
    await expect(row).toBeVisible({ timeout: 15000 });
    const rowId = (await row.getAttribute("data-testid"))!.replace(
      "admin-scim-row-",
      ""
    );

    await adminPage.getByTestId(`scim-rotate-button-${rowId}`).click();
    await adminPage.getByTestId("scim-rotate-dialog-submit").click();
    const reveal = adminPage.getByTestId("scim-rotate-dialog-reveal-token");
    await expect(reveal).toBeVisible({ timeout: 15000 });
    const newToken = ((await reveal.textContent()) ?? "").trim();
    await adminPage.getByTestId("scim-rotate-dialog-close").click();
    await adminCtx.close();

    expect(newToken).toMatch(/^tps_/);
    expect(newToken).not.toBe(oldToken);

    await test.step("The replacement bearer works", async () => {
      const res = await bearerCtx.get(
        `${baseURL}${SCIM}/ServiceProviderConfig`,
        { headers: scimHeaders(newToken) }
      );
      expect(res.status()).toBe(200);
    });

    await test.step("The superseded bearer still works during the window", async () => {
      const res = await bearerCtx.get(
        `${baseURL}${SCIM}/ServiceProviderConfig`,
        { headers: scimHeaders(oldToken) }
      );
      expect(res.status()).toBe(200);
    });

    const email = `scim-rotate-${run}@example.com`;
    let userId = "";
    await test.step("The superseded bearer can still provision", async () => {
      const res = await bearerCtx.post(`${baseURL}${SCIM}/Users`, {
        headers: scimHeaders(oldToken),
        data: userBody(email),
      });
      expect(res.status()).toBe(201);
      userId = (await res.json()).id;
    });

    await test.step("Closing the window retires the old bearer", async () => {
      // Wind previousTokenExpiresAt into the past rather than waiting 24h.
      const found = await request.get(
        `${baseURL}/api/model/scimToken/findFirst`,
        {
          params: {
            q: JSON.stringify({ where: { name }, select: { id: true } }),
          },
        }
      );
      const id = (await found.json())?.data?.id;
      expect(id).toBeTruthy();
      await request.patch(`${baseURL}/api/model/scimToken/update`, {
        data: {
          where: { id },
          data: { previousTokenExpiresAt: new Date(Date.now() - 1000) },
        },
      });

      const res = await bearerCtx.get(
        `${baseURL}${SCIM}/ServiceProviderConfig`,
        { headers: scimHeaders(oldToken) }
      );
      expect(res.status()).toBe(401);

      // The replacement is unaffected.
      const still = await bearerCtx.get(
        `${baseURL}${SCIM}/ServiceProviderConfig`,
        { headers: scimHeaders(newToken) }
      );
      expect(still.status()).toBe(200);
    });

    await test.step("Clean up", async () => {
      if (userId) {
        await bearerCtx.delete(`${baseURL}${SCIM}/Users/${userId}`, {
          headers: scimHeaders(newToken),
        });
      }
    });
  });

  test("an IdP-asserted role drives the user's access tier", async ({
    browser,
    baseURL,
    request,
  }) => {
    const run = uid();
    const name = `E2E SCIM roles ${run}`;
    const roleValue = `e2e-lead-${run}`;
    mintedTokenNames.push(name);

    const adminCtx = await browser.newContext({
      storageState: "e2e/.auth/admin.json",
    });
    const adminPage = await adminCtx.newPage();
    const token = await mintScimToken(adminPage, name, "OKTA");
    await adminCtx.close();

    await test.step("An admin maps the role to Project Admin", async () => {
      const res = await request.post(
        `${baseURL}/api/model/scimRoleMapping/create`,
        { data: { data: { roleValue, mappedAccess: "PROJECTADMIN" } } }
      );
      expect(res.ok()).toBeTruthy();
    });

    const email = `scim-roles-${run}@example.com`;
    let userId = "";
    await test.step("The IdP provisions a user carrying that role", async () => {
      const res = await bearerCtx.post(`${baseURL}${SCIM}/Users`, {
        headers: scimHeaders(token),
        // Upper-cased on the wire: matching is case-insensitive.
        data: userBody(email, { roles: [{ value: roleValue.toUpperCase() }] }),
      });
      expect(res.status()).toBe(201);
      userId = (await res.json()).id;
    });

    await test.step("The tier and the flattened roles column both landed", async () => {
      const res = await request.get(`${baseURL}/api/model/user/findFirst`, {
        params: {
          q: JSON.stringify({
            where: { id: userId },
            select: { access: true, accessSource: true, scimRoles: true },
          }),
        },
      });
      const data = (await res.json())?.data;
      expect(data.access).toBe("PROJECTADMIN");
      expect(data.accessSource).toBe("GROUP_MAPPING");
      expect(data.scimRoles).toContain(roleValue);
    });

    await test.step("Clean up", async () => {
      await bearerCtx.delete(`${baseURL}${SCIM}/Users/${userId}`, {
        headers: scimHeaders(token),
      });
      await request
        .post(`${baseURL}/api/model/scimRoleMapping/delete`, {
          data: { where: { roleValue } },
        })
        .catch(() => undefined);
    });
  });
});
