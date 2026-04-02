/**
 * Content extraction pipeline.
 *
 * Converts raw HTML into clean Markdown using Mozilla Readability for article
 * extraction and Turndown for HTML-to-Markdown conversion. Falls back to
 * cheerio body text extraction when Readability cannot parse the content.
 *
 * Features:
 * - Strips script, style, nav, footer elements before Readability runs
 * - Detects SPA shells via extracted text length threshold (< 500 chars)
 * - Falls back to cheerio when Readability returns null
 * - ATX-style headings and fenced code blocks in Markdown output
 */

import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import * as cheerio from "cheerio";

export interface ExtractContentResult {
  /** Cleaned Markdown representation of the page content */
  markdown: string;
  /**
   * True if the extracted text is < 500 chars — indicates the page may be a
   * JavaScript-rendered SPA and content might be incomplete.
   */
  spaWarning: boolean;
  /** Which extraction method was used */
  extractionMethod: "readability" | "fallback";
}

/**
 * Extracts the main content from an HTML page and converts it to Markdown.
 *
 * @param html      Raw HTML string from ssrfSafeFetch (or any source)
 * @param finalUrl  The final URL of the page (after redirects) — required for
 *                  Readability to resolve relative URLs correctly
 * @returns         { markdown, spaWarning, extractionMethod }
 */
export function extractContent(
  html: string,
  finalUrl: string
): ExtractContentResult {
  // 1. Pre-process: strip noise elements before Readability runs
  //    (locked decision: script, style, nav, footer)
  const $ = cheerio.load(html);
  $("script, style, nav, footer").remove();
  const cleanedHtml = $.html();

  // 2. Readability extraction
  //    ALWAYS pass { url: finalUrl } — Readability needs it for relative URL resolution
  const dom = new JSDOM(cleanedHtml, { url: finalUrl });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  // 3. SPA detection: check extracted text length (locked threshold: 500 chars)
  const textContent = article?.textContent ?? "";
  const spaWarning = textContent.length < 500;

  // 4. Select content source: Readability result or cheerio fallback
  let contentHtml: string;
  let extractionMethod: "readability" | "fallback";

  if (!article?.content) {
    // Readability returned null — fall back to cheerio body text extraction
    // (locked decision: $('main, article, body'))
    contentHtml = $("main, article, body").html() ?? "";
    extractionMethod = "fallback";
  } else {
    // Readability extracts the title separately from article.content.
    // Prepend it as <h1> so it appears in Markdown output with ATX heading style.
    const titleHtml =
      article.title ? `<h1>${article.title}</h1>` : "";
    contentHtml = titleHtml + article.content;
    extractionMethod = "readability";
  }

  // 5. HTML to Markdown (locked config: headingStyle atx, codeBlockStyle fenced)
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });
  const markdown = td.turndown(contentHtml);

  // 6. Clean up DOM to prevent memory leaks in long-running workers
  dom.window.close();

  return { markdown, spaWarning, extractionMethod };
}
