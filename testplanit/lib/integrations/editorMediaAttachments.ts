import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getS3Client } from "~/lib/s3Client";
import { storageKeyForSrc } from "~/lib/storageKeys";
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

      s3Client ??= getS3Client();

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
