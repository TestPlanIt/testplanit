/**
 * Crawl helper utilities.
 *
 * Provides building blocks for the BFS web crawler:
 * - extractLinks: parse same-domain HTTP/HTTPS hrefs from HTML
 * - normalizeUrl: strip URL fragments for deduplication
 * - hashContent: SHA-256 hash for near-duplicate detection
 * - fetchRobots: fetch and parse robots.txt for a given origin
 */

import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import robotsParser from 'robots-parser';

/**
 * Extract same-domain links from HTML.
 * Only returns HTTP/HTTPS links whose hostname exactly matches allowedHostname.
 *
 * @param html              Raw HTML string
 * @param baseUrl           Base URL to resolve relative hrefs against
 * @param allowedHostname   Only links with this exact hostname are returned
 * @returns                 Array of absolute URLs (no duplicates guaranteed by BFS visited set)
 */
export function extractLinks(
  html: string,
  baseUrl: string,
  allowedHostname: string
): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const resolved = new URL(href, baseUrl);
      if (
        (resolved.protocol === 'https:' || resolved.protocol === 'http:') &&
        resolved.hostname === allowedHostname
      ) {
        links.push(resolved.href);
      }
    } catch {
      // malformed href — skip
    }
  });

  return links;
}

/**
 * Normalize URL by stripping the fragment identifier (#section).
 * Fragments are client-side only and do not affect server content, so removing
 * them prevents crawling the same page multiple times via different anchors.
 *
 * @param url  URL string to normalize
 * @returns    URL without fragment, or the original string if parsing fails
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Compute a SHA-256 hex digest of the given text.
 * Used for near-duplicate detection by hashing the first N characters of
 * extracted Markdown content before adding a page to the results set.
 *
 * @param text  Input string to hash
 * @returns     64-character lowercase hex string
 */
export function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Fetch and parse robots.txt for the given origin.
 *
 * Returns null if robots.txt is unavailable (404, non-OK status, network error,
 * or timeout) — callers should treat null as "no restrictions".
 *
 * Uses plain global fetch (not ssrfSafeFetch) because robots.txt is text/plain,
 * not text/html, and ssrfSafeFetch rejects non-HTML content types.
 *
 * @param origin  URL origin, e.g. "https://example.com"
 * @returns       robots-parser instance, or null on any failure
 */
export async function fetchRobots(
  origin: string
): Promise<ReturnType<typeof robotsParser> | null> {
  try {
    const robotsUrl = `${origin}/robots.txt`;
    const res = await fetch(robotsUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const text = await res.text();
    return robotsParser(robotsUrl, text);
  } catch {
    return null;
  }
}
