import DOMPurify from "dompurify";

/**
 * Search highlight fragments come from Elasticsearch as HTML: the indexed
 * text with `<mark class="search-highlight">` around the matched terms. The
 * indexed text is user-written (case names, step text, notes), so the only
 * markup a fragment may carry into the DOM is the mark tag itself. The server
 * asks Elasticsearch to HTML-encode the text (`encoder: "html"`); this is the
 * second gate, applied right before `dangerouslySetInnerHTML`.
 */
const ALLOWED_TAGS = ["mark"];
const ALLOWED_ATTR = ["class"];

function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** HTML that is safe to render: only `<mark class>` survives. */
export function sanitizeSearchHighlight(
  html: string | null | undefined
): string {
  if (!html) return "";
  if (!DOMPurify.isSupported) {
    // No DOM to parse with (server render). Highlights only arrive after the
    // search request on the client, so this path never shows a fragment;
    // escaping the whole string keeps it inert if it ever does.
    return escapeText(html);
  }
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    KEEP_CONTENT: true,
  });
}

/** The plain text of a highlight fragment: marks removed, entities decoded. */
export function searchHighlightText(html: string | null | undefined): string {
  const safe = sanitizeSearchHighlight(html);
  if (!safe) return "";
  if (typeof document === "undefined") {
    return safe.replace(/<\/?mark[^>]*>/gi, "");
  }
  const el = document.createElement("div");
  el.innerHTML = safe;
  return el.textContent ?? "";
}
