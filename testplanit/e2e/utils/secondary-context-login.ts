import { expect, type Browser, type BrowserContext } from "@playwright/test";

/**
 * Same-origin classification header used by `proxy.ts` (`isExternalApiRequest`)
 * to distinguish a browser request (which carries a session cookie) from an
 * external API client (which must present a `Bearer tpi_*` token + `isApi`).
 *
 * IMPORTANT: `Sec-Fetch-*` are *forbidden header names* in the Fetch spec.
 * Chromium refuses to let a request carry a script-supplied `Sec-Fetch-Site`
 * value. If this header is set as a context-wide `extraHTTPHeaders`, Playwright
 * applies it to EVERY request the browser makes — including the navigation's
 * own subresource loads (`_next/static/chunks/*.js`, CSS, fonts) — and Chromium
 * rejects each of those with `net::ERR_INVALID_ARGUMENT`. The JS bundle then
 * never loads, React never hydrates, and client-gated UI (e.g. the signin form,
 * which only renders after a `useEffect` flips `sessionCleared`) never appears.
 *
 * The fix is to keep the browser context CLEAN (so assets load and the page
 * hydrates) and attach this header only to the Node-side `APIRequestContext`
 * calls (`context.request.*`), which are not subject to the browser's
 * forbidden-header restrictions. See `signInSecondaryContext` /
 * `sameOriginRequestHeaders` below.
 */
export const SAME_ORIGIN_REQUEST_HEADERS = {
  "Sec-Fetch-Site": "same-origin",
} as const;

/**
 * Per-request headers to pass to `context.request.{get,post,patch,...}` so the
 * proxy classifies the call as a same-origin browser request and authenticates
 * it via the context's session cookie.
 *
 * Usage:
 *   await ctx.request.get(url, { headers: sameOriginRequestHeaders() });
 */
export function sameOriginRequestHeaders(
  extra?: Record<string, string>
): Record<string, string> {
  return { ...SAME_ORIGIN_REQUEST_HEADERS, ...extra };
}

/**
 * Create a fresh, sessionless browser context and sign a user in through the
 * credentials form on `/{locale}/signin`, returning the authenticated context.
 *
 * The context is created WITHOUT `extraHTTPHeaders` so browser asset loading and
 * React hydration succeed (see the note on `SAME_ORIGIN_REQUEST_HEADERS`). API
 * calls made later via `context.request.*` must opt in to same-origin
 * classification by passing `sameOriginRequestHeaders()` as their `headers`.
 */
export async function signInSecondaryContext(
  browser: Browser,
  baseURL: string,
  email: string,
  password: string,
  locale = "en-US"
): Promise<BrowserContext> {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  try {
    await page.goto(`${baseURL}/${locale}/signin`, { waitUntil: "load" });
    // The form is client-gated: it only renders after hydration flips the
    // page's `sessionCleared` state and the SSO-provider query resolves. Wait
    // for the input to be attached before filling so we surface a clear failure
    // if hydration is broken rather than a bare `fill` timeout.
    const emailInput = page.getByTestId("email-input");
    await expect(emailInput).toBeVisible({ timeout: 30_000 });
    await emailInput.fill(email);
    await page.getByTestId("password-input").fill(password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(new RegExp(`/${locale}/?$`), { timeout: 30_000 });
  } finally {
    await page.close();
  }
  return context;
}
