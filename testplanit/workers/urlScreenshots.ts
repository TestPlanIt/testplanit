/**
 * Env-gated page-screenshot capture for the generate-from-url crawl.
 *
 * OFF by default. Turns on only when BOTH hold:
 *   - CRAWL_SCREENSHOTS === "true"
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
 * straight into a screenshot destined for LLM context. Every request the
 * browser makes is therefore intercepted and resolved: non-http(s)
 * protocols abort, and any hostname resolving to a private/internal IP
 * aborts (same IP predicate the crawl fetch uses). This is also why the
 * flag defaults OFF.
 */

import { existsSync } from "fs";
import { lookup } from "dns/promises";
import { isIP } from "net";
import type { Browser } from "playwright-core";
import { isPrivateOrInternalIp } from "~/lib/utils/ssrf";

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
 */
export async function isAllowedSubresource(
  rawUrl: string,
  resolve: (hostname: string) => Promise<{ address: string }> = lookup
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
  if (isIP(hostname)) {
    return !isPrivateOrInternalIp(hostname);
  }
  try {
    const { address } = await resolve(hostname);
    return !isPrivateOrInternalIp(address);
  } catch {
    // Unresolvable hosts can't be fetched anyway; abort deterministically.
    return false;
  }
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
      });
      try {
        await context.route("**/*", async (route) => {
          const allowed = await isAllowedSubresource(route.request().url());
          if (allowed) {
            await route.continue();
          } else {
            await route.abort();
          }
        });

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
