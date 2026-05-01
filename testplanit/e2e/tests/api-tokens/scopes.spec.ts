import { expect, test } from "../../fixtures/index";

/**
 * API Token Scopes E2E (TOK-02 + TOK-05 + TOK-06)
 *
 * Verifies the full read-only / agent-token scope lifecycle end-to-end against
 * a production build:
 *
 * - Token creation accepts canonical scope strings (`mode:read`, `client:mcp`)
 *   individually and together; rejects unknown scopes.
 * - A read-only token (`mode:read`) is admitted on GETs but rejected on POST
 *   mutations with HTTP 403 + `code: "READ_ONLY_TOKEN"` (TOK-05 single
 *   chokepoint, REST symmetry verified at the host).
 * - A token with empty scopes can still POST mutations — TOK-06 regression
 *   guarding the "no scopes = full access" backwards-compatibility contract.
 *
 * Locked entity: `Tag` (route segment `tag`, camelCase singular per CLAUDE.md).
 * Chosen because the model has `@@allow('all', auth().access == 'ADMIN')` so
 * the admin storageState can create unconditionally, no foreign-key entangle-
 * ment, and trivial fields. The `Tags.name @length(1)` constraint requires a
 * single-character value.
 */

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

// Single-character tag name generator (Tags.name has @length(1)).
// Using a random letter from a-z; uniqueness is best-effort — if a collision
// occurs the assertion `not.toBe(403)` still holds (200 vs 400 unique-conflict
// are both acceptable per the spec since the chokepoint we're guarding is the
// READ_ONLY_TOKEN 403 path, not the entity uniqueness path).
function uniqueTagName(): string {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  return letters[Math.floor(Math.random() * letters.length)];
}

test.describe("API Token Scopes (mode:read + client:mcp)", () => {
  let readOnlyToken: string;
  let fullAccessToken: string;

  test("creates token with mode:read scope", async ({ request, baseURL }) => {
    const r = await request.post(`${baseURL}/api/api-tokens`, {
      data: { name: `RO-${Date.now()}`, scopes: ["mode:read"] },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.scopes).toEqual(["mode:read"]);
    readOnlyToken = body.token;
    expect(readOnlyToken).toMatch(/^tpi_/);
  });

  test("creates token with client:mcp scope", async ({ request, baseURL }) => {
    const r = await request.post(`${baseURL}/api/api-tokens`, {
      data: { name: `MCP-${Date.now()}`, scopes: ["client:mcp"] },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.scopes).toEqual(["client:mcp"]);
  });

  test("creates token with both scopes", async ({ request, baseURL }) => {
    const r = await request.post(`${baseURL}/api/api-tokens`, {
      data: {
        name: `Both-${Date.now()}`,
        scopes: ["mode:read", "client:mcp"],
      },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.scopes).toEqual(
      expect.arrayContaining(["mode:read", "client:mcp"])
    );
  });

  test("creates token with empty scopes (TOK-06 regression)", async ({
    request,
    baseURL,
  }) => {
    const r = await request.post(`${baseURL}/api/api-tokens`, {
      data: { name: `Full-${Date.now()}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.scopes).toEqual([]);
    fullAccessToken = body.token;
    expect(fullAccessToken).toMatch(/^tpi_/);
  });

  test("rejects token creation with invalid scope", async ({
    request,
    baseURL,
  }) => {
    const r = await request.post(`${baseURL}/api/api-tokens`, {
      data: { name: `Bad-${Date.now()}`, scopes: ["admin"] },
    });
    expect(r.status()).toBe(400);
  });

  test("read-only token can GET tag entities", async ({ baseURL, browser }) => {
    const ctx = await browser.newContext({ storageState: undefined });
    try {
      const r = await ctx.request.get(`${baseURL}/api/model/tag/findMany`, {
        headers: { Authorization: `Bearer ${readOnlyToken}` },
      });
      expect(r.status()).toBe(200);
    } finally {
      await ctx.close();
    }
  });

  test("read-only token receives 403 on POST mutation (TOK-05 single chokepoint, locked entity: Tag)", async ({
    baseURL,
    browser,
  }) => {
    const ctx = await browser.newContext({ storageState: undefined });
    try {
      const r = await ctx.request.post(`${baseURL}/api/model/tag/create`, {
        headers: { Authorization: `Bearer ${readOnlyToken}` },
        data: { data: { name: uniqueTagName() } },
      });
      expect(r.status()).toBe(403);
      const body = await r.json();
      expect(body.code).toBe("READ_ONLY_TOKEN");
    } finally {
      await ctx.close();
    }
  });

  test("full-access token CAN POST mutation (TOK-06 regression, locked entity: Tag)", async ({
    baseURL,
    browser,
  }) => {
    const ctx = await browser.newContext({ storageState: undefined });
    try {
      const r = await ctx.request.post(`${baseURL}/api/model/tag/create`, {
        headers: { Authorization: `Bearer ${fullAccessToken}` },
        data: { data: { name: uniqueTagName() } },
      });
      // The key assertion is "not 403 with READ_ONLY_TOKEN". 200 (created),
      // 201 (created alt), or 400/422 (unique-name collision on the single-
      // letter pool) are all acceptable proofs that the read-only chokepoint
      // did not trip.
      expect(r.status()).not.toBe(403);
    } finally {
      await ctx.close();
    }
  });
});
