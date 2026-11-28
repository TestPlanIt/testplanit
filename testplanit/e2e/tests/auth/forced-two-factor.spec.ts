import type { APIRequestContext, Page } from "@playwright/test";
import { createHash, randomBytes } from "crypto";
import { expect, test } from "../../fixtures";
import { SigninPage } from "../../page-objects/signin.page";
import { generateTOTP } from "../../utils/totp";

const TEST_EMAIL_DOMAIN = process.env.TEST_EMAIL_DOMAIN || "example.com";
const DEFAULT_SETTINGS_ID = "default-registration-settings";

/**
 * Two-factor required for every sign-in.
 *
 * A sign-in that used no password (magic link, SSO) already holds a session
 * cookie when it is sent to the two-factor step. These tests sign in with a
 * magic link and check that the session can do nothing until the step is
 * done: the API refuses it, server actions refuse it, and the browser cannot
 * declare the step done itself. Then they finish the step and check the
 * session works.
 *
 * The setting is instance-wide, so this file runs in the instance-settings
 * project, after the parallel suite, and its tests run one at a time.
 */
test.describe.configure({ mode: "serial" });

interface PageResponse {
  status: number;
  body: any;
}

/** A request made by the page itself, the way the app's own code makes one. */
async function fetchFromPage(
  page: Page,
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {}
): Promise<PageResponse> {
  return page.evaluate(
    async ({ url, init }) => {
      const response = await fetch(url, init);
      const text = await response.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // not JSON: keep the text
      }
      return { status: response.status, body };
    },
    { url, init }
  );
}

function projectsQuery(baseURL: string): string {
  const q = encodeURIComponent(
    JSON.stringify({ select: { id: true }, take: 1 })
  );
  return `${baseURL}/api/model/projects/findMany?q=${q}`;
}

async function setTwoFactorForAllSignIns(
  request: APIRequestContext,
  baseURL: string,
  value: boolean
): Promise<void> {
  const found = await request.get(
    `${baseURL}/api/model/registrationSettings/findFirst`,
    { params: { q: JSON.stringify({ select: { id: true } }) } }
  );
  const id = (await found.json())?.data?.id ?? DEFAULT_SETTINGS_ID;
  const saved = await request.post(
    `${baseURL}/api/model/registrationSettings/upsert`,
    {
      data: {
        where: { id },
        create: { id: DEFAULT_SETTINGS_ID, force2FAAllLogins: value },
        update: { force2FAAllLogins: value },
      },
    }
  );
  expect(saved.ok(), await saved.text()).toBeTruthy();
}

/**
 * The server registers the email provider only while a MAGIC_LINK provider
 * record exists. Returns the id of a record this call created, to delete
 * afterwards, or null when one was already there.
 */
async function ensureMagicLinkProvider(
  request: APIRequestContext,
  baseURL: string
): Promise<string | null> {
  const found = await request.get(
    `${baseURL}/api/model/ssoProvider/findFirst`,
    {
      params: {
        q: JSON.stringify({
          where: { type: "MAGIC_LINK", enabled: true },
          select: { id: true },
        }),
      },
    }
  );
  if ((await found.json())?.data?.id) return null;

  const created = await request.post(
    `${baseURL}/api/model/ssoProvider/create`,
    {
      data: {
        data: {
          name: "Magic Link",
          type: "MAGIC_LINK",
          enabled: true,
          config: {},
        },
      },
    }
  );
  expect(created.ok(), await created.text()).toBeTruthy();
  return (await created.json()).data.id as string;
}

/**
 * NextAuth registers the email provider only when the environment has a mail
 * server configured. The probe signs the page out, which every caller is
 * about to do anyway.
 */
async function emailSignInAvailable(
  page: Page,
  baseURL: string
): Promise<boolean> {
  const probe = await page.request.get(
    `${baseURL}/api/auth/callback/email?token=test&email=test@example.com&callbackUrl=/`
  );
  return !(await probe.text()).includes("not supported");
}

/**
 * Sign the page in with a magic link, without the email: the token is
 * written straight to the database and the page opens the link it would have
 * been sent.
 */
async function signInWithMagicLink(
  page: Page,
  request: APIRequestContext,
  baseURL: string,
  email: string
): Promise<void> {
  const secret = process.env.NEXTAUTH_SECRET!;
  const plainToken = randomBytes(32).toString("hex");
  const hashedToken = createHash("sha256")
    .update(plainToken + secret)
    .digest("hex");

  const created = await request.post(
    `${baseURL}/api/model/verificationToken/create`,
    {
      data: {
        data: {
          identifier: email,
          token: hashedToken,
          expires: new Date(Date.now() + 86400000).toISOString(),
        },
      },
    }
  );
  expect(created.ok(), await created.text()).toBeTruthy();

  await page.context().clearCookies();
  await page.goto(
    `${baseURL}/api/auth/callback/email?token=${plainToken}&email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(baseURL + "/en-US")}`
  );
}

/**
 * Everything a session that still owes its sign-in step might try. `stepPath`
 * is the page the session is held on.
 */
async function expectSessionCanDoNothing(
  page: Page,
  baseURL: string,
  stepPath: RegExp
): Promise<void> {
  await test.step("The API refuses the session", async () => {
    const response = await fetchFromPage(page, projectsQuery(baseURL));
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: "SIGN_IN_INCOMPLETE" });
  });

  await test.step("A server action posted to the page it is on is refused", async () => {
    const response = await fetchFromPage(page, page.url(), {
      method: "POST",
      headers: {
        "Next-Action": "0".repeat(42),
        "Content-Type": "text/plain;charset=UTF-8",
      },
      body: "[]",
    });
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: "SIGN_IN_INCOMPLETE" });
  });

  await test.step("The browser cannot declare the step done", async () => {
    const csrf = await fetchFromPage(page, `${baseURL}/api/auth/csrf`);
    const update = await fetchFromPage(page, `${baseURL}/api/auth/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        csrfToken: csrf.body.csrfToken,
        data: { twoFactorVerified: true, twoFactorSetupComplete: true },
      }),
    });
    expect(update.status).toBe(200);

    await page.goto(`${baseURL}/en-US/projects`);
    await page.waitForURL(stepPath, { timeout: 15000 });

    const response = await fetchFromPage(page, projectsQuery(baseURL));
    expect(response.status).toBe(403);
  });
}

async function expectSessionWorks(page: Page, baseURL: string): Promise<void> {
  await page.goto(`${baseURL}/en-US/projects`);
  await page.waitForLoadState("load");
  expect(page.url()).not.toContain("/auth/two-factor");
  expect(page.url()).not.toContain("/signin");

  const response = await fetchFromPage(page, projectsQuery(baseURL));
  expect(response.status).toBe(200);
}

test.describe("Two-factor required for every sign-in", () => {
  test("a magic-link sign-in owes its code before it can use the app", async ({
    page,
    request,
    api,
    baseURL,
  }) => {
    test.skip(!process.env.NEXTAUTH_SECRET, "NEXTAUTH_SECRET not available");

    const stamp = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const email = `forced-2fa-verify-${stamp}@${TEST_EMAIL_DOMAIN}`;
    const password = "Password123!";
    const user = await api.createUser({
      name: `Forced 2FA Verify ${stamp}`,
      email,
      password,
    });
    let providerId: string | null = null;
    let secret = "";

    try {
      await test.step("Enrol the user in two-factor with a password sign-in", async () => {
        await page.context().clearCookies();
        const signinPage = new SigninPage(page);
        await signinPage.goto();
        await signinPage.fillCredentials(email, password);
        await signinPage.submit();
        await page.waitForURL((url) => !url.pathname.includes("/signin"), {
          timeout: 30000,
        });

        const setup = await page.request.get(
          `${baseURL}/api/auth/two-factor/setup`
        );
        expect(setup.ok(), await setup.text()).toBeTruthy();
        secret = (await setup.json()).secret as string;
        const enabled = await page.request.post(
          `${baseURL}/api/auth/two-factor/enable`,
          { data: { token: generateTOTP(secret) } }
        );
        expect(enabled.ok(), await enabled.text()).toBeTruthy();
      });

      providerId = await ensureMagicLinkProvider(request, baseURL!);
      test.skip(
        !(await emailSignInAvailable(page, baseURL!)),
        "Email provider not configured in the test environment"
      );
      await setTwoFactorForAllSignIns(request, baseURL!, true);

      await test.step("Sign in with a magic link and land on the code page", async () => {
        await signInWithMagicLink(page, request, baseURL!, email);
        await page.waitForURL(/\/auth\/two-factor-verify/, { timeout: 15000 });
      });

      await expectSessionCanDoNothing(
        page,
        baseURL!,
        /\/auth\/two-factor-verify/
      );

      await test.step("Enter the code and reach the app", async () => {
        const codeInput = page
          .locator('input[autocomplete="one-time-code"]')
          .first();
        await codeInput.click();
        await codeInput.fill(generateTOTP(secret));
        await page.waitForURL(
          (url) => !url.pathname.includes("/auth/two-factor-verify"),
          { timeout: 30000 }
        );
        await expectSessionWorks(page, baseURL!);
      });
    } finally {
      await setTwoFactorForAllSignIns(request, baseURL!, false);
      await api.deleteUser(user.data.id);
      if (providerId) {
        await request
          .delete(`${baseURL}/api/model/ssoProvider/delete`, {
            params: { q: JSON.stringify({ where: { id: providerId } }) },
          })
          .catch(() => {});
      }
    }
  });

  test("a magic-link sign-in with no two-factor yet has to set it up first", async ({
    page,
    request,
    api,
    baseURL,
  }) => {
    test.skip(!process.env.NEXTAUTH_SECRET, "NEXTAUTH_SECRET not available");

    const stamp = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const email = `forced-2fa-setup-${stamp}@${TEST_EMAIL_DOMAIN}`;
    const user = await api.createUser({
      name: `Forced 2FA Setup ${stamp}`,
      email,
      password: "Password123!",
    });
    let providerId: string | null = null;

    try {
      providerId = await ensureMagicLinkProvider(request, baseURL!);
      test.skip(
        !(await emailSignInAvailable(page, baseURL!)),
        "Email provider not configured in the test environment"
      );
      await setTwoFactorForAllSignIns(request, baseURL!, true);

      await test.step("Sign in with a magic link and land on the setup page", async () => {
        await signInWithMagicLink(page, request, baseURL!, email);
        await page.waitForURL(/\/auth\/two-factor-setup/, { timeout: 15000 });
      });

      await expectSessionCanDoNothing(
        page,
        baseURL!,
        /\/auth\/two-factor-setup/
      );

      await test.step("Set two-factor up and reach the app", async () => {
        const secretText = page.getByTestId("two-factor-setup-secret");
        await expect(secretText).toBeVisible({ timeout: 15000 });
        const secret = (await secretText.textContent())!.trim();

        const codeInput = page
          .locator('input[autocomplete="one-time-code"]')
          .first();
        await codeInput.click();
        await codeInput.fill(generateTOTP(secret));

        const continueButton = page.getByTestId("two-factor-setup-continue");
        await expect(continueButton).toBeVisible({ timeout: 15000 });
        await continueButton.click();
        await page.waitForURL(
          (url) => !url.pathname.includes("/auth/two-factor-setup"),
          { timeout: 30000 }
        );
        await expectSessionWorks(page, baseURL!);
      });
    } finally {
      await setTwoFactorForAllSignIns(request, baseURL!, false);
      await api.deleteUser(user.data.id);
      if (providerId) {
        await request
          .delete(`${baseURL}/api/model/ssoProvider/delete`, {
            params: { q: JSON.stringify({ where: { id: providerId } }) },
          })
          .catch(() => {});
      }
    }
  });

  test("a password sign-in with no two-factor yet has to set it up first", async ({
    page,
    request,
    api,
    baseURL,
  }) => {
    const stamp = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const email = `forced-2fa-password-${stamp}@${TEST_EMAIL_DOMAIN}`;
    const password = "Password123!";
    const user = await api.createUser({
      name: `Forced 2FA Password ${stamp}`,
      email,
      password,
    });
    const signinPage = new SigninPage(page);
    let secret = "";

    try {
      await setTwoFactorForAllSignIns(request, baseURL!, true);

      await test.step("Sign in with the password and land on the setup page", async () => {
        await page.context().clearCookies();
        await signinPage.goto();
        await signinPage.fillCredentials(email, password);
        await signinPage.submit();
        await page.waitForURL(/\/auth\/two-factor-setup\?token=/, {
          timeout: 30000,
        });
      });

      await test.step("The setup token is not a session, and cannot be traded for one", async () => {
        const session = await fetchFromPage(
          page,
          `${baseURL}/api/auth/session`
        );
        expect(session.body?.user).toBeUndefined();

        const setupToken = new URL(page.url()).searchParams.get("token")!;
        const completion = await fetchFromPage(
          page,
          `${baseURL}/api/auth/saml/complete?token=${encodeURIComponent(setupToken)}`
        );
        expect(completion.status).toBe(401);
      });

      await test.step("Set two-factor up and return to the sign-in page", async () => {
        const secretText = page.getByTestId("two-factor-setup-secret");
        await expect(secretText).toBeVisible({ timeout: 15000 });
        secret = (await secretText.textContent())!.trim();

        const codeInput = page
          .locator('input[autocomplete="one-time-code"]')
          .first();
        await codeInput.click();
        await codeInput.fill(generateTOTP(secret));

        const continueButton = page.getByTestId("two-factor-setup-continue");
        await expect(continueButton).toBeVisible({ timeout: 15000 });
        await continueButton.click();
        await page.waitForURL(/\/signin/, { timeout: 30000 });
      });

      await test.step("Sign in with the password and the code", async () => {
        await signinPage.fillCredentials(email, password);
        await signinPage.submit();

        const dialog = page.locator('[role="dialog"]').first();
        await expect(dialog).toBeVisible({ timeout: 15000 });
        const codeInput = dialog
          .locator('input[autocomplete="one-time-code"]')
          .first();
        await codeInput.click();
        await codeInput.fill(generateTOTP(secret));

        await page.waitForURL((url) => !url.pathname.includes("/signin"), {
          timeout: 30000,
        });
        await expectSessionWorks(page, baseURL!);
      });
    } finally {
      await setTwoFactorForAllSignIns(request, baseURL!, false);
      await api.deleteUser(user.data.id);
    }
  });
});
