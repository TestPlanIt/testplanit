import { expect, test } from "../../fixtures";
import { SigninPage } from "../../page-objects/signin.page";
import { uniqueEmail } from "../../utils/unique-email";

const TEST_EMAIL_DOMAIN = process.env.TEST_EMAIL_DOMAIN || "example.com";

test.describe("Passkey sign-in", () => {
  // Start signed out; the test signs in as a user of its own.
  test.use({ storageState: { cookies: [], origins: [] } });

  // The virtual authenticator is driven over the Chrome DevTools Protocol,
  // which only Chromium speaks.
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "A virtual authenticator needs Chromium"
  );

  test("add a passkey, sign in with it, then remove it", async ({
    page,
    api,
  }) => {
    const email = uniqueEmail("passkey", TEST_EMAIL_DOMAIN);
    const password = "Password123!";
    const passkeyName = `Test Passkey ${Date.now()}`;
    const { data: user } = await api.createUser({
      name: `Passkey User ${Date.now()}`,
      email,
      password,
    });

    // A platform authenticator that verifies its user and answers every
    // prompt by itself, standing in for a fingerprint reader.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    const signinPage = new SigninPage(page);
    const leftSignin = (url: URL) => !url.pathname.includes("/signin");

    try {
      await test.step("Sign in with the password", async () => {
        await signinPage.goto();
        await signinPage.fillCredentials(email, password);
        await signinPage.submit();
        await page.waitForURL(leftSignin, { timeout: 30000 });
      });

      await test.step("Add a passkey from the profile", async () => {
        await page.goto(`/en-US/users/profile/${user.id}`);
        const section = page.getByTestId("passkey-settings");
        await expect(section).toBeVisible({ timeout: 15000 });

        await section.getByTestId("add-passkey-button").click();
        await page.getByTestId("passkey-name-input").fill(passkeyName);
        await page.getByTestId("passkey-password-input").fill(password);
        await page.getByTestId("add-passkey-submit").click();

        await expect(
          section.getByTestId("passkey-row").filter({ hasText: passkeyName })
        ).toBeVisible({ timeout: 15000 });
      });

      await test.step("Sign out and sign in with the passkey", async () => {
        await page.context().clearCookies();
        await signinPage.goto();
        await page.getByTestId("passkey-signin-button").click();
        await page.waitForURL(leftSignin, { timeout: 30000 });

        const session = await page.request.get("/api/auth/session");
        expect((await session.json())?.user?.email).toBe(email);
      });

      await test.step("Remove the passkey from the profile", async () => {
        await page.goto(`/en-US/users/profile/${user.id}`);
        const section = page.getByTestId("passkey-settings");
        const row = section
          .getByTestId("passkey-row")
          .filter({ hasText: passkeyName });
        await expect(row).toBeVisible({ timeout: 15000 });

        await row.getByTestId("remove-passkey-button").click();
        await page.getByTestId("confirm-remove-passkey").click();
        await expect(row).toHaveCount(0, { timeout: 15000 });
      });

      await test.step("The removed passkey no longer signs in", async () => {
        await page.context().clearCookies();
        await signinPage.goto();
        // The authenticator still holds the key; the server no longer knows it.
        await page.getByTestId("passkey-signin-button").click();

        await expect(page.getByText(/passkey could not be used/i)).toBeVisible({
          timeout: 15000,
        });
        expect(page.url()).toContain("/signin");
      });
    } finally {
      await api.deleteUser(user.id);
    }
  });
});
