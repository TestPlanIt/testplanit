import { test as base, expect } from "@playwright/test";

// Create a custom test that authenticates via API before each test
export const test = base.extend({
  // Authenticate via API and return an authenticated request context
  request: async ({ request }, use) => {
    // Get CSRF token
    const csrfResponse = await request.get("/api/auth/csrf");
    const { csrfToken } = await csrfResponse.json();

    // Authenticate via API
    await request.post("/api/auth/callback/credentials", {
      form: {
        email: "test+admin@testplanit.com",
        password: "password123",
        csrfToken: csrfToken,
        json: "true",
      },
    });

    // The session cookie is now stored in the request context
    // All subsequent requests will include the authentication cookie
    /* eslint-disable-next-line react-hooks/rules-of-hooks */
    await use(request);
  },
});

export { expect };
