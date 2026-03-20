import { expect, test } from "../../fixtures/index";

/**
 * API Token Authentication E2E Tests
 *
 * Verifies the full API token lifecycle end-to-end against real infrastructure:
 *
 * - AUTH-08-1: Token creation returns a valid tpi_ prefixed token
 * - AUTH-08-2: Valid token authenticates requests to protected endpoints
 * - AUTH-08-3: Revoked tokens are rejected with 401
 * - AUTH-08-4: Expired tokens are rejected with 401
 * - AUTH-08-5: Requests without tokens get 401 (when using Bearer auth path)
 * - AUTH-08-6: Tokens for users with isApi=false are rejected
 * - AUTH-08-7: Tokens for deactivated users are rejected
 *
 * Note: The /api/model/* endpoints check session auth first (cookie), then
 * Bearer token auth. Tests that verify token-based rejection use a fresh
 * APIRequestContext without session cookies.
 */
test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("API Token Authentication", () => {
  /**
   * AUTH-08-1: Token creation returns valid tpi_ prefixed token
   */
  test("creates token with valid tpi_ prefix and correct response shape", async ({
    request,
    baseURL,
  }) => {
    const tokenName = `Test Token ${Date.now()}`;
    const response = await request.post(`${baseURL}/api/api-tokens`, {
      data: { name: tokenName },
    });

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(typeof body.id).toBe("string");
    expect(body.id.length).toBeGreaterThan(0);
    expect(typeof body.name).toBe("string");
    expect(body.name).toBe(tokenName);
    expect(typeof body.token).toBe("string");
    expect(body.token).toMatch(/^tpi_/);
    expect(typeof body.tokenPrefix).toBe("string");
    expect(body.tokenPrefix.length).toBeGreaterThan(0);
    expect(body.isActive).toBe(true);
    expect(body.expiresAt).toBeNull();
  });

  /**
   * AUTH-08-1b: Token creation with expiry date
   */
  test("creates token with expiration date", async ({ request, baseURL }) => {
    const response = await request.post(`${baseURL}/api/api-tokens`, {
      data: {
        name: `Expiring Token ${Date.now()}`,
        expiresAt: "2099-12-31",
      },
    });

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.token).toMatch(/^tpi_/);
    expect(body.expiresAt).not.toBeNull();
  });

  /**
   * AUTH-08-2: Valid token authenticates requests to protected endpoints
   *
   * Uses a fresh request context without session cookies to test pure token auth.
   * Admin user must have isApi=true for token-based auth to succeed.
   */
  test("valid token authenticates requests to protected endpoints", async ({
    request,
    baseURL,
    browser,
    api,
    adminUserId,
  }) => {
    // Ensure admin user has API access enabled
    await api.updateUser({ userId: adminUserId, data: { isApi: true } });

    // Create a new API token via admin session
    const createResponse = await request.post(`${baseURL}/api/api-tokens`, {
      data: { name: `Auth Test Token ${Date.now()}` },
    });
    expect(createResponse.status()).toBe(200);
    const { token } = await createResponse.json();
    expect(token).toMatch(/^tpi_/);

    // Create a fresh context WITHOUT session cookies to test pure Bearer token auth
    const unauthCtx = await browser.newContext({ storageState: undefined });
    try {
      const response = await unauthCtx.request.get(
        `${baseURL}/api/model/projects/findMany`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          params: {
            q: JSON.stringify({ take: 1 }),
          },
        }
      );

      expect(response.status()).toBe(200);
      const result = await response.json();
      expect(Array.isArray(result.data)).toBe(true);
    } finally {
      await unauthCtx.close();
    }
  });

  /**
   * AUTH-08-5: Requests without tokens get 401 via Bearer auth path
   *
   * When a request arrives without any auth (no session, no Bearer token),
   * ZenStack silently filters reads. But with an invalid Bearer token format,
   * the API returns 401.
   */
  test("request with malformed Bearer token is rejected with 401", async ({
    browser,
    baseURL,
  }) => {
    // Create context without session cookies
    const unauthCtx = await browser.newContext({ storageState: undefined });
    try {
      // Token has wrong format (not tpi_ prefix) — middleware passes through,
      // but API route's authenticateApiToken rejects it
      const response = await unauthCtx.request.get(
        `${baseURL}/api/model/projects/findMany`,
        {
          headers: {
            Authorization: "Bearer tpi_invalidtoken_that_does_not_exist_xyz",
          },
          params: {
            q: JSON.stringify({ take: 1 }),
          },
        }
      );

      // Invalid token → 401
      expect(response.status()).toBe(401);
    } finally {
      await unauthCtx.close();
    }
  });

  /**
   * AUTH-08-3: Revoked tokens are rejected
   *
   * Create a token, verify it works, revoke it, verify rejection.
   */
  test("revoked token is rejected with 401", async ({
    request,
    baseURL,
    browser,
    api,
    adminUserId,
  }) => {
    // Ensure admin user has API access enabled
    await api.updateUser({ userId: adminUserId, data: { isApi: true } });

    // Create a token
    const createResponse = await request.post(`${baseURL}/api/api-tokens`, {
      data: { name: `Revoke Test Token ${Date.now()}` },
    });
    expect(createResponse.status()).toBe(200);
    const { token, id: tokenId } = await createResponse.json();
    expect(token).toMatch(/^tpi_/);

    // Verify the token works first
    const unauthCtx = await browser.newContext({ storageState: undefined });
    try {
      const validResponse = await unauthCtx.request.get(
        `${baseURL}/api/model/projects/findMany`,
        {
          headers: { Authorization: `Bearer ${token}` },
          params: { q: JSON.stringify({ take: 1 }) },
        }
      );
      expect(validResponse.status()).toBe(200);

      // Revoke the token via ZenStack (admin session has write access to apiToken model)
      const revokeResponse = await request.patch(
        `${baseURL}/api/model/apiToken/update`,
        {
          data: {
            where: { id: tokenId },
            data: { isActive: false },
          },
        }
      );
      // Accept 200 or 422 — ZenStack may deny reading the revoked token back due to policy
      expect([200, 422]).toContain(revokeResponse.status());

      // Now try using the revoked token — should be rejected
      const revokedResponse = await unauthCtx.request.get(
        `${baseURL}/api/model/projects/findMany`,
        {
          headers: { Authorization: `Bearer ${token}` },
          params: { q: JSON.stringify({ take: 1 }) },
        }
      );
      expect(revokedResponse.status()).toBe(401);
    } finally {
      await unauthCtx.close();
    }
  });

  /**
   * AUTH-08-4: Expired tokens are rejected
   *
   * Create a token with a past expiry date and verify it is rejected.
   */
  test("expired token is rejected with 401", async ({
    request,
    baseURL,
    browser,
    api,
    adminUserId,
  }) => {
    // Ensure admin user has API access enabled
    await api.updateUser({ userId: adminUserId, data: { isApi: true } });

    // Create a token with past expiry date
    const createResponse = await request.post(`${baseURL}/api/api-tokens`, {
      data: {
        name: `Expired Token ${Date.now()}`,
        expiresAt: "2020-01-01",
      },
    });
    expect(createResponse.status()).toBe(200);
    const { token } = await createResponse.json();
    expect(token).toMatch(/^tpi_/);

    // Try using the expired token — should be rejected
    const unauthCtx = await browser.newContext({ storageState: undefined });
    try {
      const response = await unauthCtx.request.get(
        `${baseURL}/api/model/projects/findMany`,
        {
          headers: { Authorization: `Bearer ${token}` },
          params: { q: JSON.stringify({ take: 1 }) },
        }
      );
      expect(response.status()).toBe(401);
    } finally {
      await unauthCtx.close();
    }
  });

  /**
   * AUTH-08-6: Token for user with isApi=false is rejected
   *
   * Create a token as admin, disable API access for admin, verify token rejected,
   * then restore isApi=true.
   */
  test("token for user with isApi=false is rejected with 401", async ({
    request,
    baseURL,
    browser,
    api,
    adminUserId,
  }) => {
    // Ensure admin has API access first
    await api.updateUser({ userId: adminUserId, data: { isApi: true } });

    // Create a token
    const createResponse = await request.post(`${baseURL}/api/api-tokens`, {
      data: { name: `isApi Test Token ${Date.now()}` },
    });
    expect(createResponse.status()).toBe(200);
    const { token } = await createResponse.json();

    // Verify token works with isApi=true
    const unauthCtx = await browser.newContext({ storageState: undefined });
    try {
      const validResponse = await unauthCtx.request.get(
        `${baseURL}/api/model/projects/findMany`,
        {
          headers: { Authorization: `Bearer ${token}` },
          params: { q: JSON.stringify({ take: 1 }) },
        }
      );
      expect(validResponse.status()).toBe(200);

      // Disable API access for admin user
      await api.updateUser({ userId: adminUserId, data: { isApi: false } });

      // Token should now be rejected
      const rejectedResponse = await unauthCtx.request.get(
        `${baseURL}/api/model/projects/findMany`,
        {
          headers: { Authorization: `Bearer ${token}` },
          params: { q: JSON.stringify({ take: 1 }) },
        }
      );
      expect(rejectedResponse.status()).toBe(401);
    } finally {
      // Always restore admin API access
      await api.updateUser({ userId: adminUserId, data: { isApi: true } });
      await unauthCtx.close();
    }
  });

  /**
   * AUTH-08-7: Token for deactivated user is rejected
   *
   * Create a separate user with isApi=true, get a token, deactivate the user,
   * verify token rejected.
   */
  test("token for deactivated user is rejected with 401", async ({
    baseURL,
    browser,
    api,
  }) => {
    // Create a test user
    const email = `api-token-test-${Date.now()}@example.com`;
    const userResult = await api.createUser({
      name: "API Token Test User",
      email,
      password: "password123",
      access: "USER",
    });
    const testUserId = userResult.data.id;

    try {
      // Enable API access for the test user
      await api.updateUser({ userId: testUserId, data: { isApi: true } });

      // Sign in as the test user in a browser context to get a session for token creation
      const testUserCtx = await browser.newContext({
        storageState: undefined,
        extraHTTPHeaders: {
          "Sec-Fetch-Site": "same-origin",
        },
      });

      let userToken: string;
      try {
        const loginPage = await testUserCtx.newPage();
        await loginPage.goto(`${baseURL}/en-US/signin`, { waitUntil: "load" });
        await loginPage.getByTestId("email-input").fill(email);
        await loginPage.getByTestId("password-input").fill("password123");
        await loginPage.locator('button[type="submit"]').first().click();
        await loginPage.waitForURL(/\/en-US\/?$/, { timeout: 30000 });
        await loginPage.close();

        // Create a token as the test user
        const createResponse = await testUserCtx.request.post(
          `${baseURL}/api/api-tokens`,
          {
            data: { name: `Deactivation Test Token ${Date.now()}` },
          }
        );
        expect(createResponse.status()).toBe(200);
        const { token } = await createResponse.json();
        userToken = token;
        expect(userToken).toMatch(/^tpi_/);

        // Verify the token works before deactivation
        const unauthCtx = await browser.newContext({ storageState: undefined });
        try {
          const validResponse = await unauthCtx.request.get(
            `${baseURL}/api/model/projects/findMany`,
            {
              headers: { Authorization: `Bearer ${userToken}` },
              params: { q: JSON.stringify({ take: 1 }) },
            }
          );
          expect(validResponse.status()).toBe(200);

          // Deactivate the test user via admin session
          await api.updateUser({ userId: testUserId, data: { isActive: false } });

          // Token should now be rejected
          const rejectedResponse = await unauthCtx.request.get(
            `${baseURL}/api/model/projects/findMany`,
            {
              headers: { Authorization: `Bearer ${userToken}` },
              params: { q: JSON.stringify({ take: 1 }) },
            }
          );
          expect(rejectedResponse.status()).toBe(401);
        } finally {
          await unauthCtx.close();
        }
      } finally {
        await testUserCtx.close();
      }
    } finally {
      // Cleanup: delete the test user (admin session)
      await api.deleteUser(testUserId);
    }
  });
});
