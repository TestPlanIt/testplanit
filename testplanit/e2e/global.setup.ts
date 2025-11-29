import { chromium, FullConfig } from "@playwright/test";

const adminUser = {
  email: "admin@testplanit.com",
  password: "admin",
};

async function globalSetup(config: FullConfig) {
  const { baseURL, storageState } = config.projects[0].use;
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const signInUrl = `${baseURL}/api/auth/signin`;
  await page.goto(signInUrl);

  // Wait for the CSRF token input to be available
  const csrfTokenInput = page.locator('input[name="csrfToken"]');
  await csrfTokenInput.waitFor({ state: "attached" });
  const csrfToken = await csrfTokenInput.inputValue();

  if (!csrfToken) {
    throw new Error("Could not find CSRF token on sign-in page.");
  }

  const response = await page.request.post(
    `${baseURL}/api/auth/callback/credentials`,
    {
      form: {
        email: adminUser.email,
        password: adminUser.password,
        csrfToken: csrfToken,
        json: "true",
        callbackUrl: baseURL + "/",
      },
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  if (!response.ok()) {
    console.error(await response.text());
    throw new Error(`Sign-in failed with status ${response.status()}`);
  }

  // Save authentication state
  await page.context().storageState({ path: storageState as string });
  await browser.close();
}

export default globalSetup;
