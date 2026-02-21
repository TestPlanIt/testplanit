import TurndownService from "turndown";
import { generateHTMLFallback } from "./tiptapToHtml";

const turndownService = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  strongDelimiter: "**",
  linkStyle: "inlined",
});

turndownService.addRule("strikethrough", {
  filter: ["del", "s", "strike" as keyof HTMLElementTagNameMap],
  replacement: (content) => `~~${content}~~`,
});

/**
 * Convert TipTap JSON to Markdown string.
 * Pipeline: TipTap JSON -> HTML (via generateHTMLFallback) -> Markdown (via turndown)
 */
export function tiptapToMarkdown(json: any): string {
  try {
    let content;
    if (typeof json === "string") {
      try {
        content = JSON.parse(json);
      } catch {
        return json;
      }
    } else {
      content = json;
    }

    const html = generateHTMLFallback(content);

    if (!html || html === "<div></div>") {
      return "";
    }

    return turndownService.turndown(html).trim();
  } catch (error) {
    console.error("Failed to convert TipTap JSON to Markdown:", error);
    return "";
  }
}
