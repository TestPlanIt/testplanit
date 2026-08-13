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
  /** The editor src this attachment was resolved from. */
  src: string;
}

// Pure src walkers moved to lib/tiptap/editorMediaSrcs.ts so the browser
// (wizard image picker) can import them without dragging in the S3 SDK.
// Re-exported here to keep this module's existing public API stable.
import {
  extractEditorMediaSrcs,
  filenameForEditorMediaSrc,
} from "~/lib/tiptap/editorMediaSrcs";

export { extractEditorMediaSrcs, filenameForEditorMediaSrc };

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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
          src,
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
        src,
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
