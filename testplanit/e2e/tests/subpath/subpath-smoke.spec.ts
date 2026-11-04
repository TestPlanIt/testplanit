import { type Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import path from "path";

/**
 * Smoke suite for an install served under a path prefix (next.config
 * basePath). It runs only against a build made with BASE_PATH set, with the
 * same prefix exported as E2E_BASE_PATH and included in E2E_BASE_URL:
 *
 *   cd testplanit
 *   BASE_PATH=/testplanit pnpm build
 *   BASE_PATH=/testplanit E2E_PROD=on E2E_BASE_PATH=/testplanit \
 *   E2E_BASE_URL=http://localhost:3002/testplanit \
 *   APP_URL=http://localhost:3002/testplanit \
 *   NEXTAUTH_URL=http://localhost:3002/testplanit/api/auth \
 *   pnpm test:e2e e2e/tests/subpath/subpath-smoke.spec.ts
 *
 * The rest of the suite navigates with root-relative paths, which Playwright
 * resolves against the origin and not the prefix, so only this file is run in
 * that mode. Every spec here builds its URLs from the prefix explicitly and
 * fails on any same-origin request that escapes it, which is how a hard-coded
 * root-relative URL anywhere in the app shows up.
 */
const BASE_PATH = process.env.E2E_BASE_PATH ?? "";

test.describe("Path-prefixed install", () => {
  test.skip(!BASE_PATH, "Set E2E_BASE_PATH to run the subpath smoke suite");

  const origin = () => new URL(test.info().project.use.baseURL!).origin;
  const url = (p: string) => `${origin()}${BASE_PATH}${p}`;

  /**
   * Records every same-origin request whose path is outside the prefix.
   * Next's own assets, API calls, redirects and EventSource connections all
   * have to stay under it.
   */
  function watchForEscapes(page: Page): string[] {
    const escapes: string[] = [];
    const base = origin();
    page.on("request", (request) => {
      const target = new URL(request.url());
      if (target.origin !== base) return;
      if (
        target.pathname === BASE_PATH ||
        target.pathname.startsWith(`${BASE_PATH}/`)
      ) {
        return;
      }
      escapes.push(`${request.method()} ${target.pathname}${target.search}`);
    });
    return escapes;
  }

  test("answers the health check only under the prefix", async ({
    request,
  }) => {
    const prefixed = await request.get(url("/api/health"));
    expect(prefixed.status()).toBe(200);

    // The proxy in front of the app must not strip the prefix; the app itself
    // serves nothing at the host root.
    const root = await request.get(`${origin()}/api/health`);
    expect(root.status()).toBe(404);
  });

  test("treats unauthenticated model requests under the prefix exactly as at the root", async ({
    browser,
  }) => {
    // Mirrors ACL-04 in e2e/tests/api/access-control.spec.ts: reads are
    // silently filtered to nothing, writes are rejected with 422.
    const context = await browser.newContext({ storageState: undefined });
    const read = await context.request.get(
      url("/api/model/projects/findMany"),
      {
        params: { q: JSON.stringify({}) },
      }
    );
    expect(read.status()).toBe(200);
    const result = await read.json();
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data).toHaveLength(0);

    const write = await context.request.post(
      url("/api/model/projects/create"),
      {
        data: { data: { name: `Unauth Project ${Date.now()}` } },
      }
    );
    expect(write.status()).toBe(422);
    await context.close();
  });

  test("sends an anonymous visitor to the sign-in page inside the prefix", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    const escapes = watchForEscapes(page);

    await page.goto(url("/"));
    await page.waitForURL(new RegExp(`${BASE_PATH}/en-US/signin`));
    expect(new URL(page.url()).pathname).toBe(`${BASE_PATH}/en-US/signin`);

    // The bare prefix, without a trailing slash, is what a user types.
    await page.goto(url(""));
    await page.waitForURL(new RegExp(`${BASE_PATH}/en-US/signin`));

    await page.goto(url("/en-US/projects"));
    await page.waitForURL(new RegExp(`${BASE_PATH}/en-US/signin`));

    expect(escapes).toEqual([]);
    await context.close();
  });

  test("signs in with credentials and stays inside the prefix", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    const escapes = watchForEscapes(page);

    await page.goto(url("/en-US/signin"));
    await page.getByTestId("email-input").fill("admin@example.com");
    await page.getByTestId("password-input").fill("admin");
    await page.getByTestId("signin-button").click();
    await page.waitForURL(new RegExp(`${BASE_PATH}/en-US/?$`), {
      timeout: 30000,
    });

    // next-auth's client was told its route; the session resolves under it.
    const session = await context.request.get(url("/api/auth/session"));
    expect(session.status()).toBe(200);
    const body = await session.json();
    expect(body?.user?.email).toBe("admin@example.com");

    await expect(page.getByTestId("header-container")).toBeVisible();

    // On a shared host the cookies must not leak to other apps on the domain.
    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) =>
      c.name.endsWith("next-auth.session-token")
    );
    expect(sessionCookie?.path).toBe(BASE_PATH);
    const csrf = cookies.find((c) => c.name.endsWith("next-auth.csrf-token"));
    expect(csrf?.path).toBe(BASE_PATH);
    for (const cookie of cookies) {
      expect(
        cookie.path === BASE_PATH || cookie.path.startsWith(`${BASE_PATH}/`)
      ).toBe(true);
    }

    expect(escapes).toEqual([]);
    await context.close();
  });

  test("loads the app pages and keeps every request under the prefix", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: path.join(__dirname, "../../.auth/admin.json"),
    });
    const page = await context.newPage();
    const escapes = watchForEscapes(page);

    await page.goto(url("/en-US/projects"));
    await expect(page.getByTestId("header-container")).toBeVisible();
    await page.waitForLoadState("networkidle");

    await page.goto(url("/en-US/admin/users"));
    await expect(page.getByTestId("header-container")).toBeVisible();
    await page.waitForLoadState("networkidle");

    // In-app navigation through the header stays under the prefix too.
    await page.getByTestId("user-menu-trigger").click();
    await expect(page.getByTestId("user-menu-content")).toBeVisible();
    await page.keyboard.press("Escape");

    expect(escapes).toEqual([]);
    await context.close();
  });

  test("signs out to the sign-in page inside the prefix", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: path.join(__dirname, "../../.auth/admin.json"),
    });
    const page = await context.newPage();
    const escapes = watchForEscapes(page);

    await page.goto(url("/en-US/projects"));
    await page.getByTestId("user-menu-trigger").click();
    await page.getByRole("menuitem", { name: /sign out|log out/i }).click();
    await page.waitForURL(new RegExp(`${BASE_PATH}/en-US/signin`), {
      timeout: 30000,
    });

    const session = await context.request.get(url("/api/auth/session"));
    const body = await session.json().catch(() => null);
    expect(body?.user).toBeFalsy();

    expect(escapes).toEqual([]);
    await context.close();
  });
});
