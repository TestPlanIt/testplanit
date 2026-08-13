/**
 * Pure TipTap media-src helpers, importable from BOTH the browser and the
 * server. The server-only resolution of srcs to storage bytes lives in
 * lib/integrations/editorMediaAttachments.ts (S3 imports), which re-exports
 * these for its existing callers.
 */

/**
 * Collect the distinct `src` values of image and video nodes anywhere in a
 * TipTap doc, in document order.
 */
export function extractEditorMediaSrcs(doc: unknown): string[] {
  const srcs: string[] = [];
  const seen = new Set<string>();
  const walk = (node: any): void => {
    if (!node || typeof node !== "object") return;
    if (
      (node.type === "image" || node.type === "video") &&
      typeof node.attrs?.src === "string" &&
      node.attrs.src.length > 0 &&
      !seen.has(node.attrs.src)
    ) {
      seen.add(node.attrs.src);
      srcs.push(node.attrs.src);
    }
    if (Array.isArray(node.content)) {
      node.content.forEach(walk);
    }
  };
  walk(doc);
  return srcs;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Derive a human-readable filename for an editor media src.
 *
 * Editor uploads land in storage under two key shapes, both ending in a
 * basename that embeds the original filename next to an upload timestamp:
 *  - presigned PUT:  `<original name>_<epoch millis>`
 *  - upload proxy:   `<original name>_<epoch millis>_<original name>`
 * Strip the timestamp decoration back off so the attachment carries the name
 * the user uploaded. Base64 data URIs have no name — synthesize one from the
 * mime subtype and the media's position in the document.
 */
export function filenameForEditorMediaSrc(src: string, index: number): string {
  if (src.startsWith("data:")) {
    const subtype = /^data:(?:image|video)\/([a-z0-9.-]+)/i.exec(src)?.[1];
    const extension = subtype ? subtype.replace(/[^a-z0-9]/gi, "") : "bin";
    return `embedded-media-${index + 1}.${extension}`;
  }

  const path = src.split(/[?#]/)[0];
  const basename = safeDecode(path.split("/").filter(Boolean).pop() ?? "");
  if (!basename) {
    return `embedded-media-${index + 1}`;
  }

  const proxyShape = /^.*_\d{13}_(.+)$/.exec(basename);
  if (proxyShape) {
    return proxyShape[1];
  }
  return basename.replace(/_\d{13}$/, "");
}
