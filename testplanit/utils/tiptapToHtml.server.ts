import { generateHTML } from "@tiptap/html/server";
import { StarterKit } from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { Link } from "@tiptap/extension-link";
import { Image } from "@tiptap/extension-image";
import { Emoji, gitHubEmojis } from "@tiptap/extension-emoji";
import { generateHTMLFallback } from "./tiptapToHtml";

// Extensions configuration (same as client version)
const extensionConfig = {
  starterKit: {
    link: false as const, // We'll configure this separately
  },
  link: {
    openOnClick: false,
    HTMLAttributes: {
      target: "_blank",
      rel: "noopener noreferrer",
    },
  },
  image: {
    inline: true,
    allowBase64: true,
    HTMLAttributes: {
      style: 'max-width: 100%; height: auto;',
    },
  },
};

/**
 * Server-side TipTap to HTML conversion with full TipTap rendering
 * Only use this in server components or API routes
 */
export async function tiptapToHtmlServer(json: any): Promise<string> {
  try {
    // If it's already a string, try to parse it as JSON
    let content;
    if (typeof json === "string") {
      try {
        content = JSON.parse(json);
      } catch {
        // If JSON parsing fails, treat as plain text
        return `<p>${json}</p>`;
      }
    } else {
      content = json;
    }

    try {
      const extensions = [
        StarterKit.configure(extensionConfig.starterKit),
        TextStyle,
        Color,
        Link.configure(extensionConfig.link),
        Image.configure(extensionConfig.image),
        Emoji.configure({
          emojis: gitHubEmojis,
        }),
      ];

      const html = generateHTML(content, extensions);
      return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333;">${html}</div>`;
    } catch (error) {
      console.warn("Server-side TipTap failed, using fallback:", error);
      const html = generateHTMLFallback(content);
      return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333;">${html}</div>`;
    }
  } catch (error) {
    console.error("Failed to convert TipTap to HTML:", error);
    // Return plain text fallback
    return `<p>${String(json)}</p>`;
  }
}