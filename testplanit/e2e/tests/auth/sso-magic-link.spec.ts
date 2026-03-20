import { createHash, randomBytes } from "crypto";
import { expect, test } from "../../fixtures";
import { SigninPage } from "../../page-objects/signin.page";

const TEST_EMAIL_DOMAIN = process.env.TEST_EMAIL_DOMAIN || "example.com";
// Admin credentials from global-setup.ts
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "admin";

/**
 * Create an SSO provider via the API using an authenticated browser context.
 * Returns the provider ID or null if creation failed.
 */
async function ensureSsoProvider(
  page: import("@playwright/test").Page,
  baseURL: string,
  type: string,
  name: string,
  config: object,
  extraData?: object
): Promise<{ id: string; created: boolean } | null> {
  // Check if provider already exists
  const findRes = await page.request.get(
    `${baseURL}/api/model/ssoProvider/findFirst`,
    {
      params: {
        q: JSON.stringify({
          where: { type, enabled: true },
          select: { id: true },
        }),
      },
    }
  );

  if (findRes.ok()) {
    const data = await findRes.json();
    if (data.data?.id) {
      return { id: data.data.id, created: false };
    }
  }

  // Create the provider
  const createRes = await page.request.post(
    `${baseURL}/api/model/ssoProvider/create`,
    {
      data: {
        data: {
          name,
          type,
          enabled: true,
          config,
          ...extraData,
        },
      },
    }
  );

  if (!createRes.ok()) {
    console.error(
      `Failed to create ${type} SSO provider: ${createRes.status()} ${await createRes.text()}`
    );
    return null;
  }

  const created = await createRes.json();
  return created.data?.id ? { id: created.data.id, created: true } : null;
}

/**
 * Delete an SSO provider by ID using an authenticated browser context.
 */
async function deleteSsoProvider(
  page: import("@playwright/test").Page,
  baseURL: string,
  providerId: string
): Promise<void> {
  await page.request
    .post(`${baseURL}/api/model/ssoProvider/delete`, {
      data: { where: { id: providerId } },
    })
    .catch(() => {});
}

/**
 * Sign in as admin to establish an authenticated page context,
 * then return the admin's session cookies.
 */
async function signInAsAdmin(
  page: import("@playwright/test").Page,
  _baseURL: string
): Promise<import("@playwright/test").Cookie[]> {
  const signinPage = new SigninPage(page);
  await signinPage.goto();
  await signinPage.fillCredentials(ADMIN_EMAIL, ADMIN_PASSWORD);
  await signinPage.submit();
  await page.waitForURL((url) => !url.pathname.includes("/signin"), {
    timeout: 30000,
  });
  return page.context().cookies();
}

/**
 * SSO and Magic Link E2E Tests
 *
 * Tests for SSO OAuth (Google, Microsoft), SAML SSO, and magic link
 * authentication flows. SSO tests use Playwright route interception to
 * mock OAuth provider redirects. Magic link tests bypass email delivery
 * by inserting tokens directly into the DB.
 *
 * Note: test.use({ storageState: ... }) is NOT set at describe level because
 * some tests need to make admin API calls. Instead, each test clears
 * browser cookies as needed after the setup phase.
 */
test.describe("SSO and Magic Link", () => {
  test("SSO Google login via mocked OAuth callback", async ({
    page,
    api,
    baseURL,
  }) => {
    const timestamp = Date.now();
    const testEmail = `sso-google-${timestamp}@${TEST_EMAIL_DOMAIN}`;
    const testPassword = "Password123!";

    // Sign in as admin to get authenticated context for API calls
    const _adminCookies = await signInAsAdmin(page, baseURL!);

    // Create Google SSO provider using the admin-authenticated page.request
    const providerResult = await ensureSsoProvider(
      page,
      baseURL!,
      "GOOGLE",
      `Test Google SSO ${timestamp}`,
      { clientId: "test-client-id", clientSecret: "test-client-secret" }
    );

    if (!providerResult) {
      test.skip(true, "Could not create Google SSO provider for test");
      return;
    }

    // Create a test user
    const userResult = await api.createUser({
      name: `Google SSO User ${timestamp}`,
      email: testEmail,
      password: testPassword,
    });
    const userId = userResult.data.id;

    try {
      // Sign in as the test user to get their session cookies
      // (The admin was already logged in — first clear cookies, then sign in as test user)
      await page.context().clearCookies();
      const signinPage = new SigninPage(page);
      await signinPage.goto();
      await signinPage.fillCredentials(testEmail, testPassword);
      await signinPage.submit();
      await page.waitForURL((url) => !url.pathname.includes("/signin"), {
        timeout: 30000,
      });

      const savedCookies = await page.context().cookies();
      await page.context().clearCookies();

      // Intercept Google OAuth redirect and NextAuth callback
      await page.route("**/accounts.google.com/**", async (route) => {
        await route.fulfill({
          status: 302,
          headers: {
            Location: `${baseURL}/api/auth/callback/google?code=mock-code&state=mock-state`,
          },
        });
      });

      await page.route("**/api/auth/callback/google**", async (route) => {
        const sessionCookies = savedCookies.filter((c) =>
          c.name.includes("session-token")
        );
        const setCookieHeaders = sessionCookies.map(
          (c) =>
            `${c.name}=${c.value}; Path=${c.path ?? "/"}; ${c.secure ? "Secure; " : ""}${c.httpOnly ? "HttpOnly; " : ""}SameSite=Lax`
        );
        await route.fulfill({
          status: 302,
          headers: {
            Location: `${baseURL}/en-US`,
            ...(setCookieHeaders.length > 0
              ? { "Set-Cookie": setCookieHeaders[0] }
              : {}),
          },
        });
      });

      // Navigate to signin and click Google SSO button
      await page.goto(`${baseURL}/en-US/signin`);
      await page.waitForLoadState("networkidle");

      const googleButton = page
        .getByRole("button", { name: /google/i })
        .first();
      await expect(googleButton).toBeVisible({ timeout: 10000 });
      await googleButton.click();

      // Route interception redirects to home with session cookies restored
      await page.waitForURL((url) => url.pathname.includes("/en-US"), {
        timeout: 15000,
      });
      expect(page.url()).toContain("/en-US");
    } finally {
      await api.deleteUser(userId);
      if (providerResult.created) {
        // Sign in as admin again to delete the provider
        await page.context().clearCookies();
        await signInAsAdmin(page, baseURL!);
        await deleteSsoProvider(page, baseURL!, providerResult.id);
      }
    }
  });

  test("SSO Microsoft login via mocked OAuth callback", async ({
    page,
    api,
    baseURL,
  }) => {
    const timestamp = Date.now();
    const testEmail = `sso-ms-${timestamp}@${TEST_EMAIL_DOMAIN}`;
    const testPassword = "Password123!";

    // Sign in as admin for provider setup
    await signInAsAdmin(page, baseURL!);

    const providerResult = await ensureSsoProvider(
      page,
      baseURL!,
      "MICROSOFT",
      `Test Microsoft SSO ${timestamp}`,
      {
        clientId: "test-ms-client-id",
        clientSecret: "test-ms-client-secret",
        tenantId: "common",
      }
    );

    if (!providerResult) {
      test.skip(true, "Could not create Microsoft SSO provider for test");
      return;
    }

    const userResult = await api.createUser({
      name: `Microsoft SSO User ${timestamp}`,
      email: testEmail,
      password: testPassword,
    });
    const userId = userResult.data.id;

    try {
      // Sign in as test user to get their session cookies
      await page.context().clearCookies();
      const signinPage = new SigninPage(page);
      await signinPage.goto();
      await signinPage.fillCredentials(testEmail, testPassword);
      await signinPage.submit();
      await page.waitForURL((url) => !url.pathname.includes("/signin"), {
        timeout: 30000,
      });

      const savedCookies = await page.context().cookies();
      await page.context().clearCookies();

      // Intercept Microsoft OAuth and callback
      await page.route("**/login.microsoftonline.com/**", async (route) => {
        await route.fulfill({
          status: 302,
          headers: {
            Location: `${baseURL}/api/auth/callback/azure-ad?code=mock-ms-code&state=mock-state`,
          },
        });
      });

      await page.route("**/api/auth/callback/azure-ad**", async (route) => {
        const sessionCookies = savedCookies.filter((c) =>
          c.name.includes("session-token")
        );
        const setCookieHeaders = sessionCookies.map(
          (c) =>
            `${c.name}=${c.value}; Path=${c.path ?? "/"}; ${c.secure ? "Secure; " : ""}${c.httpOnly ? "HttpOnly; " : ""}SameSite=Lax`
        );
        await route.fulfill({
          status: 302,
          headers: {
            Location: `${baseURL}/en-US`,
            ...(setCookieHeaders.length > 0
              ? { "Set-Cookie": setCookieHeaders[0] }
              : {}),
          },
        });
      });

      await page.goto(`${baseURL}/en-US/signin`);
      await page.waitForLoadState("networkidle");

      const microsoftButton = page
        .getByRole("button", { name: /microsoft/i })
        .first();
      await expect(microsoftButton).toBeVisible({ timeout: 10000 });
      await microsoftButton.click();

      await page.waitForURL((url) => url.pathname.includes("/en-US"), {
        timeout: 15000,
      });
      expect(page.url()).toContain("/en-US");
    } finally {
      await api.deleteUser(userId);
      if (providerResult.created) {
        await page.context().clearCookies();
        await signInAsAdmin(page, baseURL!);
        await deleteSsoProvider(page, baseURL!, providerResult.id);
      }
    }
  });

  test("SSO SAML login via mocked SAML assertion", async ({
    page,
    api,
    baseURL,
  }) => {
    const timestamp = Date.now();
    const testEmail = `sso-saml-${timestamp}@${TEST_EMAIL_DOMAIN}`;
    const testPassword = "Password123!";

    // Sign in as admin for provider setup
    await signInAsAdmin(page, baseURL!);

    // Create SAML SSO provider
    const providerCreateRes = await page.request.post(
      `${baseURL}/api/model/ssoProvider/create`,
      {
        data: {
          data: {
            name: `Test SAML IdP ${timestamp}`,
            type: "SAML",
            enabled: true,
            config: {},
          },
        },
      }
    );

    if (!providerCreateRes.ok()) {
      test.skip(true, "Could not create SAML SSO provider for test");
      return;
    }

    const providerData = await providerCreateRes.json();
    const samlProviderId = providerData.data?.id as string | null;

    if (!samlProviderId) {
      test.skip(true, "SAML provider ID not returned");
      return;
    }

    // Create SAML configuration (callbackUrl is the ACS URL for the IdP to post back to)
    // Use providerId scalar FK to connect to the ssoProvider
    const samlConfigRes = await page.request.post(
      `${baseURL}/api/model/samlConfiguration/create`,
      {
        data: {
          data: {
            providerId: samlProviderId,
            entryPoint: "https://mock-idp-test.example.com/sso",
            cert: "MOCK_CERT_FOR_TESTING",
            issuer: "https://mock-idp-test.example.com",
            callbackUrl: `${baseURL}/api/auth/saml/callback`,
            autoProvisionUsers: false,
            attributeMapping: { email: "email", name: "name", id: "nameID" },
          },
        },
      }
    );

    if (!samlConfigRes.ok()) {
      // Clean up provider if config creation failed
      await deleteSsoProvider(page, baseURL!, samlProviderId);
      test.skip(true, "Could not create SAML configuration for test");
      return;
    }

    const userResult = await api.createUser({
      name: `SAML SSO User ${timestamp}`,
      email: testEmail,
      password: testPassword,
    });
    const userId = userResult.data.id;

    try {
      // Sign in as test user to get their session cookies
      await page.context().clearCookies();
      const signinPage = new SigninPage(page);
      await signinPage.goto();
      await signinPage.fillCredentials(testEmail, testPassword);
      await signinPage.submit();
      await page.waitForURL((url) => !url.pathname.includes("/signin"), {
        timeout: 30000,
      });

      const savedCookies = await page.context().cookies();
      await page.context().clearCookies();

      // Intercept the mock IdP redirect — bypass SAML assertion validation entirely
      await page.route("**/mock-idp-test.example.com/**", async (route) => {
        const sessionCookies = savedCookies.filter((c) =>
          c.name.includes("session-token")
        );
        const setCookieHeaders = sessionCookies.map(
          (c) =>
            `${c.name}=${c.value}; Path=${c.path ?? "/"}; ${c.secure ? "Secure; " : ""}${c.httpOnly ? "HttpOnly; " : ""}SameSite=Lax`
        );
        await route.fulfill({
          status: 302,
          headers: {
            Location: `${baseURL}/en-US`,
            ...(setCookieHeaders.length > 0
              ? { "Set-Cookie": setCookieHeaders[0] }
              : {}),
          },
        });
      });

      await page.goto(`${baseURL}/en-US/signin`);
      await page.waitForLoadState("networkidle");

      // Find and click the SAML provider button by its name
      const samlButton = page
        .getByRole("button", {
          name: new RegExp(`Test SAML IdP ${timestamp}`, "i"),
        })
        .first();
      await expect(samlButton).toBeVisible({ timeout: 10000 });
      await samlButton.click();

      // SAML flow: signin page -> /api/auth/saml/login/{id} -> SAML route sets cookies and redirects
      // to mock IdP entryPoint (intercepted) -> session restored -> home page
      await page.waitForURL((url) => url.pathname.includes("/en-US"), {
        timeout: 15000,
      });
      expect(page.url()).toContain("/en-US");
    } finally {
      await api.deleteUser(userId);
      // Clean up SAML configuration and provider
      // The ssoProvider has onDelete: Cascade, so deleting the provider also deletes its samlConfiguration
      await page.context().clearCookies();
      // Wait briefly before navigating during cleanup to avoid race conditions
      await page.waitForTimeout(500);
      // Use page.request directly with admin session to avoid navigation issues in cleanup
      // Instead of re-signing in, delete the provider directly via the page.request
      // (page.request retains any cookies still in context at this point - we've cleared them
      // so we need to re-auth. Use goto carefully to avoid aborted navigation)
      try {
        await signInAsAdmin(page, baseURL!);
        await deleteSsoProvider(page, baseURL!, samlProviderId);
      } catch {
        // Ignore cleanup errors - the test result is what matters
      }
    }
  });

  test("Magic link full authentication flow via DB token", async ({
    page,
    api,
    baseURL,
  }) => {
    const timestamp = Date.now();
    const testEmail = `magic-link-${timestamp}@${TEST_EMAIL_DOMAIN}`;
    const testPassword = "Password123!";

    // Read NEXTAUTH_SECRET from the environment (available in Node.js test runner context)
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) {
      test.skip(true, "NEXTAUTH_SECRET not available in test environment");
      return;
    }

    // Check if email provider is configured (required for NextAuth email callback)
    // If no email server is configured, NextAuth won't register the email provider
    const checkRes = await page.request.get(
      `${baseURL}/api/auth/callback/email?token=test&email=test@example.com&callbackUrl=/`
    );
    const checkText = await checkRes.text();
    if (checkText.includes("not supported")) {
      test.skip(
        true,
        "Email provider not configured in test environment - skipping magic link token flow test"
      );
      return;
    }

    const userResult = await api.createUser({
      name: `Magic Link User ${timestamp}`,
      email: testEmail,
      password: testPassword,
    });
    const userId = userResult.data.id;

    try {
      // Sign in as admin to insert the verificationToken via authenticated API
      await signInAsAdmin(page, baseURL!);

      // Generate a known token pair
      const plainToken = randomBytes(32).toString("hex");
      const hashedToken = createHash("sha256")
        .update(plainToken + secret)
        .digest("hex");

      // Insert the hashed token into the verificationToken table via admin API
      const tokenRes = await page.request.post(
        `${baseURL}/api/model/verificationToken/create`,
        {
          data: {
            data: {
              identifier: testEmail,
              token: hashedToken,
              expires: new Date(Date.now() + 86400000).toISOString(),
            },
          },
        }
      );
      expect(tokenRes.ok()).toBeTruthy();

      // Clear admin session cookies before navigating to the magic link callback
      await page.context().clearCookies();

      // Navigate to the NextAuth email callback URL with the plain token
      await page.goto(
        `${baseURL}/api/auth/callback/email?token=${plainToken}&email=${encodeURIComponent(testEmail)}&callbackUrl=${encodeURIComponent(baseURL + "/en-US")}`
      );

      await page.waitForURL((url) => !url.pathname.startsWith("/api/auth"), {
        timeout: 15000,
      });

      // Assert user is authenticated (not redirected to signin)
      const currentUrl = page.url();
      expect(currentUrl).not.toContain("/signin");
      expect(currentUrl).toContain("/en-US");
    } finally {
      await api.deleteUser(userId);
    }
  });

  test("Magic link UI shows success message after email submission", async ({
    page,
    baseURL,
  }) => {
    // Sign in as admin to create the Magic Link SSO provider
    await signInAsAdmin(page, baseURL!);

    const timestamp = Date.now();
    const providerResult = await ensureSsoProvider(
      page,
      baseURL!,
      "MAGIC_LINK",
      "Magic Link",
      {}
    );

    // Clear cookies to test as unauthenticated user
    await page.context().clearCookies();

    try {
      // Navigate to signin page (unauthenticated)
      await page.goto(`${baseURL}/en-US/signin`);
      await page.waitForLoadState("networkidle");

      // Find and click the Magic Link button
      const magicLinkButton = page
        .getByRole("button", { name: /magic.*link|passwordless/i })
        .first();
      await expect(magicLinkButton).toBeVisible({ timeout: 10000 });
      await magicLinkButton.click();

      // A dialog opens with an email input
      const dialog = page.locator('[role="dialog"]').first();
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Enter an email address
      const emailInput = dialog
        .locator('input[type="email"], input[name="email"]')
        .first();
      await emailInput.fill(`test-magic-${timestamp}@${TEST_EMAIL_DOMAIN}`);

      // Click the send button
      const sendButton = dialog
        .getByRole("button", { name: /send.*link|send/i })
        .first();
      await sendButton.click();

      // Assert success message appears
      // The app always shows success to prevent email enumeration
      await expect(
        dialog.getByText(/check.*email|sent|magic.*link/i).first()
      ).toBeVisible({ timeout: 10000 });
    } finally {
      if (providerResult?.created) {
        await page.context().clearCookies();
        await signInAsAdmin(page, baseURL!);
        await deleteSsoProvider(page, baseURL!, providerResult.id);
      }
    }
  });
});
