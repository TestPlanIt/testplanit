// Extensions that are safe for email rendering - defined as a plain object to avoid importing extensions on client
const extensionConfig = {
  starterKit: {
    link: false, // We'll configure this separately
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
 * Minimal HTML generation fallback for when TipTap fails
 */
export function generateHTMLFallback(content: any): string {
  if (!content || !content.content) {
    return '<div></div>';
  }

  function processNode(node: any): string {
    if (!node) return '';

    switch (node.type) {
      case 'doc':
        return node.content?.map(processNode).join('') || '';

      case 'paragraph':
        const pContent = node.content?.map(processNode).join('') || '';
        return `<p>${pContent}</p>`;

      case 'text':
        let text = node.text || '';
        if (node.marks) {
          for (const mark of node.marks) {
            switch (mark.type) {
              case 'bold':
                text = `<strong>${text}</strong>`;
                break;
              case 'italic':
                text = `<em>${text}</em>`;
                break;
              case 'link':
                const href = mark.attrs?.href || '#';
                const target = mark.attrs?.target || '_blank';
                text = `<a href="${href}" target="${target}" rel="noopener noreferrer">${text}</a>`;
                break;
            }
          }
        }
        return text;

      case 'heading':
        const level = node.attrs?.level || 1;
        const hContent = node.content?.map(processNode).join('') || '';
        return `<h${level}>${hContent}</h${level}>`;

      case 'bulletList':
        const ulContent = node.content?.map(processNode).join('') || '';
        return `<ul>${ulContent}</ul>`;

      case 'listItem':
        const liContent = node.content?.map(processNode).join('') || '';
        return `<li>${liContent}</li>`;

      case 'image':
        const src = node.attrs?.src || '';
        const alt = node.attrs?.alt || '';
        return `<img src="${src}" alt="${alt}" style="max-width: 100%; height: auto;" />`;

      default:
        return node.content?.map(processNode).join('') || '';
    }
  }

  return processNode(content);
}

// Server-side functionality moved to separate file to avoid bundling server dependencies

/**
 * Client-safe TipTap to HTML conversion
 * Uses fallback implementation that works in browser environments
 * @param json - The TipTap JSON content
 * @returns HTML string
 */
export function tiptapToHtml(json: any): string {
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

    // Use fallback HTML generation for client-side
    const html = generateHTMLFallback(content);

    // Add some basic styling for email compatibility
    return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333;">${html}</div>`;
  } catch (error) {
    console.error("Failed to convert TipTap to HTML:", error);
    // Return plain text fallback
    return `<p>${String(json)}</p>`;
  }
}

/**
 * Checks if content is TipTap JSON
 */
export function isTipTapContent(content: any): boolean {
  try {
    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    return !!(parsed && typeof parsed === "object" && (parsed.type === "doc" || parsed.content));
  } catch {
    return false;
  }
}