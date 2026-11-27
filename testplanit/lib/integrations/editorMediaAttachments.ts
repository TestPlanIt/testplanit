import {
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
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

      const stored = await readStorageObject(s3Client, bucketName, key);
      if (!stored) continue;

      attachments.push({
        filename: filenameForEditorMediaSrc(src, index),
        buffer: stored.buffer,
        mimeType: stored.mimeType,
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

async function readStorageObject(
  s3Client: S3Client,
  bucketName: string,
  key: string
): Promise<{ buffer: Buffer; mimeType?: string } | null> {
  const response = await s3Client.send(
    new GetObjectCommand({ Bucket: bucketName, Key: key })
  );
  if (!response.Body) return null;

  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as Readable) {
    chunks.push(chunk);
  }
  return {
    buffer: Buffer.concat(chunks),
    mimeType: response.ContentType || undefined,
  };
}

export interface FormAttachmentRef {
  /** Where the browser uploaded the file. */
  url: string;
  /** The name the file had on the user's machine. */
  name: string;
}

/**
 * Read files the create form uploaded to this instance's storage. Only objects
 * under `keyPrefix` are read, so a request cannot name another user's upload.
 * `unreadable` lists the names of the files that were refused or failed to
 * load.
 */
export async function resolveFormAttachments(
  files: FormAttachmentRef[],
  keyPrefix: string
): Promise<{ attachments: EditorMediaAttachment[]; unreadable: string[] }> {
  const attachments: EditorMediaAttachment[] = [];
  const unreadable: string[] = [];
  const bucketName = process.env.AWS_BUCKET_NAME;
  let s3Client: S3Client | null = null;

  for (const { url, name } of files) {
    const filename = sanitizeAttachmentName(name);
    try {
      const key = storageKeyForSrc(url);
      if (!key || !bucketName || !key.startsWith(keyPrefix)) {
        unreadable.push(filename);
        continue;
      }

      s3Client ??= getS3Client();
      const stored = await readStorageObject(s3Client, bucketName, key);
      if (!stored) {
        unreadable.push(filename);
        continue;
      }
      attachments.push({ filename, src: url, ...stored });
    } catch (error) {
      console.error(
        `[editorMediaAttachments] Failed to read form attachment "${filename}":`,
        error
      );
      unreadable.push(filename);
    }
  }
  return { attachments, unreadable };
}

/**
 * Remove the form's uploads from storage. They are only there on their way to
 * the tracker, so this runs whether or not the issue was created. Only objects
 * under `keyPrefix` are removed; one that cannot be removed is left behind.
 */
export async function discardFormUploads(
  files: FormAttachmentRef[],
  keyPrefix: string
): Promise<void> {
  const bucketName = process.env.AWS_BUCKET_NAME;
  if (!bucketName || files.length === 0) return;
  let s3Client: S3Client | null = null;

  for (const { url, name } of files) {
    const key = storageKeyForSrc(url);
    if (!key || !key.startsWith(keyPrefix)) continue;
    try {
      s3Client ??= getS3Client();
      await s3Client.send(
        new DeleteObjectCommand({ Bucket: bucketName, Key: key })
      );
    } catch (error) {
      console.error(
        `[editorMediaAttachments] Failed to remove form attachment "${sanitizeAttachmentName(name)}" from storage:`,
        error
      );
    }
  }
}

function sanitizeAttachmentName(name: string): string {
  const base = name.split(/[/\\]/).pop()?.trim() ?? "";
  return base.replace(/\p{Cc}/gu, "").slice(-200) || "file";
}
