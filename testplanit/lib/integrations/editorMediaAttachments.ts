import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Readable } from "stream";

/**
 * Media embedded in TipTap editor content (images/videos) lives in TestPlanIt
 * storage — external trackers only ever receive the converted description
 * text, so embedded files must be transferred separately as attachments.
 * This module extracts the media references from a TipTap doc and resolves
 * them to file buffers readable from this instance's own storage.
 */

export interface EditorMediaAttachment {
  filename: string;
  buffer: Buffer;
  mimeType?: string;
}

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

/**
 * Map an editor media src to an object key in this instance's storage bucket,
 * or null when the src does not point at our storage (external URLs are never
 * fetched). Recognized shapes:
 *  - `/api/storage/<key>` — the storage proxy route (relative or absolute)
 *  - `<endpoint>/<bucket>/<key>` — path-style presigned upload against the
 *    configured public or internal endpoint
 *  - `https://<bucket>.s3.<region>.amazonaws.com/<key>` — virtual-hosted AWS
 */
function storageKeyForSrc(src: string): string | null {
  const proxyMarker = "/api/storage/";
  const proxyIndex = src.indexOf(proxyMarker);
  if (proxyIndex !== -1) {
    const key = src.slice(proxyIndex + proxyMarker.length).split(/[?#]/)[0];
    return key ? safeDecode(key) : null;
  }

  const bucket = process.env.AWS_BUCKET_NAME;
  if (!bucket || !/^https?:\/\//i.test(src)) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  const pathname = safeDecode(url.pathname).replace(/^\/+/, "");

  const endpointOrigins = [
    process.env.AWS_PUBLIC_ENDPOINT_URL,
    process.env.AWS_ENDPOINT_URL,
  ]
    .filter((endpoint): endpoint is string => Boolean(endpoint))
    .map((endpoint) => {
      try {
        return new URL(endpoint).origin;
      } catch {
        return null;
      }
    });
  if (endpointOrigins.includes(url.origin)) {
    return pathname.startsWith(`${bucket}/`)
      ? pathname.slice(bucket.length + 1)
      : pathname;
  }

  if (
    url.hostname.startsWith(`${bucket}.`) &&
    url.hostname.endsWith(".amazonaws.com")
  ) {
    return pathname;
  }

  return null;
}

/**
 * Resolve the media embedded in a TipTap description to attachment payloads.
 * Only base64 data URIs and this instance's own storage are read; srcs that
 * point elsewhere are skipped, as is any individual file that fails to load —
 * the caller uploads whatever could be resolved.
 */
export async function resolveEditorMediaAttachments(
  description: unknown
): Promise<EditorMediaAttachment[]> {
  if (!description || typeof description !== "object") {
    return [];
  }
  const srcs = extractEditorMediaSrcs(description);
  if (srcs.length === 0) {
    return [];
  }

  const bucketName = process.env.AWS_BUCKET_NAME;
  let s3Client: S3Client | null = null;

  const attachments: EditorMediaAttachment[] = [];
  for (const [index, src] of srcs.entries()) {
    try {
      if (src.startsWith("data:")) {
        const dataUri =
          /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)?(?:;[^,]*)?;base64,(.*)$/i.exec(
            src
          );
        if (!dataUri) continue;
        attachments.push({
          filename: filenameForEditorMediaSrc(src, index),
          buffer: Buffer.from(dataUri[2], "base64"),
          mimeType: dataUri[1] || undefined,
        });
        continue;
      }

      const key = storageKeyForSrc(src);
      if (!key || !bucketName) continue;

      s3Client ??= new S3Client({
        region: process.env.AWS_REGION || process.env.AWS_BUCKET_REGION,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
        endpoint: process.env.AWS_ENDPOINT_URL,
        forcePathStyle: process.env.AWS_ENDPOINT_URL ? true : false,
      });

      const response = await s3Client.send(
        new GetObjectCommand({ Bucket: bucketName, Key: key })
      );
      if (!response.Body) continue;

      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as Readable) {
        chunks.push(chunk);
      }
      attachments.push({
        filename: filenameForEditorMediaSrc(src, index),
        buffer: Buffer.concat(chunks),
        mimeType: response.ContentType || undefined,
      });
    } catch (error) {
      console.error(
        `[editorMediaAttachments] Failed to resolve embedded media "${src}":`,
        error
      );
    }
  }
  return attachments;
}
