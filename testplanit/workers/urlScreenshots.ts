/**
 * Env-gated page-screenshot capture for the generate-from-url crawl.
 *
 * Capture runs only when BOTH hold:
 *   - CRAWL_SCREENSHOTS === "true" (the official workers image sets this in
 *     its ENV, so image-based deployments capture by default and opt out
 *     with CRAWL_SCREENSHOTS=false; other deployments opt in explicitly)
 *   - a chromium executable exists (CHROMIUM_EXECUTABLE_PATH, or the
 *     well-known system locations the official workers image installs)
 *
 * Uses playwright-core (no bundled browser download) against the system
 * chromium. Self-host deployments without chromium keep the existing
 * text-only crawl untouched.
 *
 * SECURITY — the crawl target URL itself is validated by ssrfSafeFetch
 * before we ever navigate, but the PAGE decides its own sub-resources: an
 * <img src="http://169.254.169.254/…"> would render internal content
 * straight into a screenshot destined for LLM context. Guards, in layers:
 *   - every request is intercepted; non-http(s) protocols abort, and any
 *     hostname with a private/internal resolved address aborts (same IP
 *     predicate and ALLOWED_PRIVATE_HOSTS exemption as the crawl fetch)
 *   - the browser is never allowed to follow a server-side redirect (its
 *     network stack follows them without re-invoking route handlers);
 *     installScreenshotRouteGuard fetches every response from Node with
 *     redirects disabled and re-validates each Location hop
 *   - service workers and WebSockets bypass route interception entirely,
 *     so both are blocked at the context level
 * The Node-side fetches are not IP-pinned the way ssrfSafeFetch is, so a
 * fast-rebinding DNS name retains a small TOCTOU window; restricting the
 * workers container's egress to internal ranges closes it for good.
 */

import { existsSync } from "fs";
import { lookup } from "dns/promises";
import { isIP } from "net";
import type { Browser, BrowserContext } from "playwright-core";
import {
  getAllowedPrivateHosts,
  isPrivateOrInternalIp,
} from "~/lib/utils/ssrf";

const WELL_KNOWN_CHROMIUM_PATHS = [
  "/usr/bin/chromium-browser", // alpine (official workers image)
  "/usr/bin/chromium", // debian
];

export const SCREENSHOT_VIEWPORT = { width: 1280, height: 800 };
export const SCREENSHOT_JPEG_QUALITY = 70;
/** Per-page ceiling so one slow page can't stall the whole crawl. */
export const SCREENSHOT_TIMEOUT_MS = 15_000;

export function resolveChromiumExecutable(): string | null {
  const configured = process.env.CHROMIUM_EXECUTABLE_PATH;
  if (configured) {
    return existsSync(configured) ? configured : null;
  }
  for (const path of WELL_KNOWN_CHROMIUM_PATHS) {
    if (existsSync(path)) return path;
  }
  return null;
}

export function screenshotsEnabled(): boolean {
  return (
    process.env.CRAWL_SCREENSHOTS === "true" &&
    resolveChromiumExecutable() !== null
  );
}

/**
 * Whether the browser may fetch this sub-resource URL. Exported for unit
 * tests; DNS resolution is injectable for the same reason.
 *
 * Checks EVERY resolved address, not just the first: a dual-stack or
 * multi-A-record host must not pass on a public IPv4 while the browser
 * connects to a private IPv6. Hostnames in ALLOWED_PRIVATE_HOSTS are exempt
 * from the private-IP check — the same exemption the crawl fetch applies,
 * so explicitly allow-listed internal targets can still be screenshotted.
 */
export async function isAllowedSubresource(
  rawUrl: string,
  resolve: (hostname: string) => Promise<{ address: string }[]> = (hostname) =>
    lookup(hostname, { all: true })
): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (getAllowedPrivateHosts().has(hostname.toLowerCase())) {
    return true;
  }
  if (isIP(hostname)) {
    return !isPrivateOrInternalIp(hostname);
  }
  try {
    const addresses = await resolve(hostname);
    return (
      addresses.length > 0 &&
      addresses.every(({ address }) => !isPrivateOrInternalIp(address))
    );
  } catch {
    // Unresolvable hosts can't be fetched anyway; abort deterministically.
    return false;
  }
}

/** Redirect hops the route guard will follow per request before giving up. */
export const MAX_SUBRESOURCE_REDIRECTS = 5;

/**
 * Intercepts every request in the context and serves it from Node so the
 * browser never follows a redirect itself: the browser network stack follows
 * server-side redirects WITHOUT re-invoking route handlers, so a continue()d
 * request to an allowed host could hop to an internal one unseen. Each
 * Location hop is re-validated with `isAllowed` before it is fetched, and
 * only the final non-redirect response is fulfilled to the browser.
 *
 * Exported for the integration test, which injects its own `isAllowed` to
 * exercise the interception mechanics against local test servers.
 */
export async function installScreenshotRouteGuard(
  context: BrowserContext,
  isAllowed: (url: string) => Promise<boolean> = (url) =>
    isAllowedSubresource(url)
): Promise<void> {
  await context.route("**/*", async (route) => {
    try {
      let currentUrl = route.request().url();
      if (!(await isAllowed(currentUrl))) {
        return await route.abort();
      }
      let response = await route.fetch({ maxRedirects: 0 });
      for (let hop = 0; ; hop++) {
        const status = response.status();
        const location = response.headers()["location"];
        if (status < 300 || status >= 400 || !location) break;
        if (hop >= MAX_SUBRESOURCE_REDIRECTS) {
          return await route.abort();
        }
        currentUrl = new URL(location, currentUrl).toString();
        if (!(await isAllowed(currentUrl))) {
          return await route.abort();
        }
        response = await context.request.get(currentUrl, { maxRedirects: 0 });
      }
      await route.fulfill({ response });
    } catch {
      await route.abort().catch(() => {});
    }
  });
}

/**
 * Lazily-launched shared browser for one crawl job. `capture` returns null
 * on any failure — a screenshot is an enhancement, never a crawl failure.
 */
export class CrawlScreenshotter {
  private browser: Browser | null = null;
  private launchFailed = false;

  async capture(url: string): Promise<Buffer | null> {
    if (!screenshotsEnabled() || this.launchFailed) return null;

    try {
      if (!this.browser) {
        const { chromium } = await import("playwright-core");
        this.browser = await chromium.launch({
          executablePath: resolveChromiumExecutable()!,
          headless: true,
        });
      }

      const context = await this.browser.newContext({
        viewport: SCREENSHOT_VIEWPORT,
        userAgent: "TestPlanIt",
        // Service-worker fetches bypass route interception entirely.
        serviceWorkers: "block",
      });
      try {
        // WebSockets also bypass route interception; mock every one with no
        // server connection so a page can't stream internal content over WS.
        await context.routeWebSocket(/.*/, () => {});
        await installScreenshotRouteGuard(context);

        const page = await context.newPage();
        await page.goto(url, {
          waitUntil: "networkidle",
          timeout: SCREENSHOT_TIMEOUT_MS,
        });
        return await page.screenshot({
          type: "jpeg",
          quality: SCREENSHOT_JPEG_QUALITY,
        });
      } finally {
        await context.close().catch(() => {});
      }
    } catch (err) {
      if (!this.browser) {
        // Launch failure is permanent for this job — don't retry per page.
        this.launchFailed = true;
      }
      console.warn(`[urlScreenshots] Capture failed for ${url}:`, err);
      return null;
    }
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => {});
    this.browser = null;
  }
}

/** Redis key for one page's screenshot (24h TTL at the write site). */
export function screenshotKey(jobId: string, pageIndex: number): string {
  return `generate-from-url:screenshot:${jobId}:${pageIndex}`;
}

export const SCREENSHOT_TTL_SECONDS = 24 * 60 * 60;
