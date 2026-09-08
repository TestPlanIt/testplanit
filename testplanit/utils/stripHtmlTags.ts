/**
 * Plain-text preview of possibly-HTML content: strips tags and decodes the
 * HTML entities integrations escape into issue titles/descriptions.
 * Whitespace inside the text is preserved (callers render previews with
 * `whitespace-pre-wrap`); collapse it at the call site if needed.
 */
export function stripHtmlTags(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
