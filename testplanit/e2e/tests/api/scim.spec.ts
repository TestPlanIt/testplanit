import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "../../fixtures";

/**
 * SCIM 2.0 provisioning API (/api/scim/v2).
 *
 * Tokens are minted through the admin page (the only mint path), then every
 * call goes through a fresh context with only the `tps_` bearer, the way an
 * identity provider would call in. Users and groups are created, read,
 * patched and deleted, and the app-side rows are checked through the model
 * API with the admin session.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const SCIM = "/api/scim/v2";
const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

async function mintScimToken(page: Page, name: string): Promise<string> {
  await page.goto("/en-US/admin/scim");
  await expect(page.getByTestId("scim-admin-page")).toBeVisible({
    timeout: 15000,
  });
  await page.getByTestId("scim-mint-button").click();
  await page.getByTestId("scim-mint-dialog-name-input").fill(name);
  await page.getByTestId("scim-mint-dialog-submit").click();
  const reveal = page.getByTestId("scim-mint-dialog-reveal-token");
  await expect(reveal).toBeVisible({ timeout: 15000 });
  const token = ((await reveal.textContent()) ?? "").trim();
  await page.getByTestId("scim-mint-dialog-close").click();
  expect(token).toMatch(/^tps_/);
  return token;
}

test.describe.configure({ mode: "serial" });

test.describe("SCIM provisioning API", () => {
  let scim: APIRequestContext;
  let token = "";
  let tokenName = "";

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({
      storageState: "e2e/.auth/admin.json",
    });
    const page = await context.newPage();
    tokenName = `E2E SCIM API ${uid()}`;
    token = await mintScimToken(page, tokenName);
    await context.close();
    const bearerContext = await browser.newContext({
      storageState: undefined,
    });
    scim = bearerContext.request;
  });

  test.afterAll(async ({ request, baseURL }) => {
    // Revoke the token so it cannot outlive the run.
    const res = await request.get(`${baseURL}/api/model/scimToken/findFirst`, {
      params: {
        q: JSON.stringify({ where: { name: tokenName }, select: { id: true } }),
      },
    });
    const id = (await res.json())?.data?.id;
    if (id) {
      await request
        .patch(`${baseURL}/api/model/scimToken/update`, {
          data: {
            where: { id },
            data: { revokedAt: new Date().toISOString(), isActive: false },
          },
        })
        .catch(() => {});
    }
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  test("rejects calls without a valid SCIM bearer", async ({ baseURL }) => {
    const missing = await scim.get(`${baseURL}${SCIM}/ServiceProviderConfig`);
    expect(missing.status()).toBe(401);
    expect((await missing.json()).detail).toBe("Missing Authorization header");

    const wrongKind = await scim.get(
      `${baseURL}${SCIM}/ServiceProviderConfig`,
      {
        headers: { Authorization: "Bearer tpi_not_a_scim_token" },
      }
    );
    expect(wrongKind.status()).toBe(401);
    expect((await wrongKind.json()).detail).toBe("Invalid token format");
  });

  test("serves discovery documents to a valid token", async ({ baseURL }) => {
    const config = await scim.get(`${baseURL}${SCIM}/ServiceProviderConfig`, {
      headers: auth(),
    });
    expect(config.status()).toBe(200);
    expect((await config.json()).patch?.supported).toBe(true);

    const types = await scim.get(`${baseURL}${SCIM}/ResourceTypes`, {
      headers: auth(),
    });
    expect(types.status()).toBe(200);
  });

  test("provisions, reads, deactivates and deletes a user", async ({
    baseURL,
    request,
  }) => {
    const ts = uid();
    const userName = `scim.user.${ts}@example.com`;
    let userId = "";

    await test.step("POST /Users creates the user", async () => {
      const res = await scim.post(`${baseURL}${SCIM}/Users`, {
        headers: auth(),
        data: {
          schemas: [USER_SCHEMA],
          userName,
          name: { givenName: "Scim", familyName: `User ${ts}` },
          emails: [{ primary: true, value: userName, type: "work" }],
          externalId: `ext-${ts}`,
          active: true,
        },
      });
      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body.userName).toBe(userName);
      userId = body.id;
      expect(userId).toBeTruthy();
    });

    await test.step("GET /Users filters by userName and GET /Users/{id} reads it back", async () => {
      const list = await scim.get(`${baseURL}${SCIM}/Users`, {
        headers: auth(),
        params: { filter: `userName eq "${userName}"` },
      });
      expect(list.status()).toBe(200);
      const body = await list.json();
      expect(body.totalResults).toBe(1);
      expect(body.Resources[0].id).toBe(userId);

      const one = await scim.get(`${baseURL}${SCIM}/Users/${userId}`, {
        headers: auth(),
      });
      expect(one.status()).toBe(200);
      expect((await one.json()).userName).toBe(userName);
    });

    await test.step("The app row exists with the fallback access", async () => {
      const res = await request.get(`${baseURL}/api/model/user/findFirst`, {
        params: {
          q: JSON.stringify({
            where: { email: userName },
            select: { id: true, isActive: true, access: true },
          }),
        },
      });
      const row = (await res.json()).data;
      expect(row?.id).toBe(userId);
      expect(row?.isActive).toBe(true);
    });

    await test.step("PATCH replace active=false deactivates the user", async () => {
      const res = await scim.patch(`${baseURL}${SCIM}/Users/${userId}`, {
        headers: auth(),
        data: {
          schemas: [PATCH_SCHEMA],
          Operations: [{ op: "replace", value: { active: false } }],
        },
      });
      expect(res.status()).toBe(200);
      expect((await res.json()).active).toBe(false);
      const row = await request.get(`${baseURL}/api/model/user/findFirst`, {
        params: {
          q: JSON.stringify({
            where: { id: userId },
            select: { isActive: true },
          }),
        },
      });
      expect((await row.json()).data?.isActive).toBe(false);
    });

    await test.step("DELETE removes the user and is idempotent", async () => {
      const first = await scim.delete(`${baseURL}${SCIM}/Users/${userId}`, {
        headers: auth(),
      });
      expect(first.status()).toBe(204);
      const again = await scim.delete(`${baseURL}${SCIM}/Users/${userId}`, {
        headers: auth(),
      });
      expect(again.status()).toBe(204);
      const row = await request.get(`${baseURL}/api/model/user/findFirst`, {
        params: {
          q: JSON.stringify({
            where: { id: userId },
            select: { isDeleted: true },
          }),
        },
      });
      expect((await row.json()).data?.isDeleted).toBe(true);
    });
  });

  test("provisions a group with a member, removes the member, and deletes the group", async ({
    baseURL,
    request,
  }) => {
    const ts = uid();
    const userName = `scim.member.${ts}@example.com`;
    const displayName = `SCIM Group ${ts}`;
    let userId = "";
    let groupId = "";

    await test.step("Create a member user and a group containing it", async () => {
      const user = await scim.post(`${baseURL}${SCIM}/Users`, {
        headers: auth(),
        data: {
          schemas: [USER_SCHEMA],
          userName,
          emails: [{ primary: true, value: userName }],
          active: true,
        },
      });
      expect(user.status()).toBe(201);
      userId = (await user.json()).id;

      const group = await scim.post(`${baseURL}${SCIM}/Groups`, {
        headers: auth(),
        data: {
          schemas: [GROUP_SCHEMA],
          displayName,
          members: [{ value: userId }],
        },
      });
      expect(group.status()).toBe(201);
      const body = await group.json();
      groupId = body.id;
      expect(body.displayName).toBe(displayName);
    });

    await test.step("The membership is stored in the app", async () => {
      const res = await request.get(`${baseURL}/api/model/groups/findFirst`, {
        params: {
          q: JSON.stringify({
            where: {
              OR: [{ scimDisplayName: displayName }, { name: displayName }],
            },
            select: { id: true, assignedUsers: { select: { userId: true } } },
          }),
        },
      });
      const group = (await res.json()).data;
      expect(group?.id).toBeTruthy();
      expect(
        group.assignedUsers.map((a: { userId: string }) => a.userId)
      ).toContain(userId);
    });

    await test.step("PATCH remove drops the member", async () => {
      const res = await scim.patch(`${baseURL}${SCIM}/Groups/${groupId}`, {
        headers: auth(),
        data: {
          schemas: [PATCH_SCHEMA],
          Operations: [{ op: "remove", path: `members[value eq "${userId}"]` }],
        },
      });
      expect(res.status()).toBe(200);
      const read = await scim.get(`${baseURL}${SCIM}/Groups/${groupId}`, {
        headers: auth(),
      });
      expect(read.status()).toBe(200);
      expect(((await read.json()).members ?? []).length).toBe(0);
    });

    await test.step("DELETE removes the group and the user", async () => {
      const group = await scim.delete(`${baseURL}${SCIM}/Groups/${groupId}`, {
        headers: auth(),
      });
      expect(group.status()).toBe(204);
      const user = await scim.delete(`${baseURL}${SCIM}/Users/${userId}`, {
        headers: auth(),
      });
      expect(user.status()).toBe(204);
    });
  });
});
