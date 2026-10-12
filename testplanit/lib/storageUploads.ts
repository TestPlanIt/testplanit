import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client } from "~/lib/s3Client";

// Attachment and inline-image ceilings are per-deployment. The bundled nginx
// caps request bodies at 10 MB and operators raise that from nginx-local/, so
// the app's own ceiling has to be able to move with it -- otherwise raising the
// proxy limit alone does nothing. UPLOAD_MAX_MB is the single knob:
// next.config.ts derives the server-action body limit from the same variable.
//
// Project icons and avatars are deliberately NOT covered: they are UI
// thumbnails with fixed dimensions, not operator-sized user payloads.
const DEFAULT_UPLOAD_MAX_MB = 10;

function uploadMaxBytes(): number {
  const parsed = Number(process.env.UPLOAD_MAX_MB);
  const mb =
    Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_UPLOAD_MAX_MB;
  return mb * 1024 * 1024;
}

export const UPLOAD_CONFIGS = {
  "project-icon": {
    folder: "uploads/project-icons",
    maxSize: 4 * 1024 * 1024, // 4MB
    imagesOnly: true,
  },
  avatar: {
    folder: "uploads/avatars",
    maxSize: 2 * 1024 * 1024, // 2MB
    imagesOnly: true,
  },
  docimage: {
    folder: "uploads/document-images",
    maxSize: uploadMaxBytes(),
    imagesOnly: true,
  },
  attachment: {
    folder: "uploads/attachments",
    maxSize: uploadMaxBytes(),
    imagesOnly: false,
  },
} as const;

export type UploadType = keyof typeof UPLOAD_CONFIGS;

export function isUploadType(value: unknown): value is UploadType {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(UPLOAD_CONFIGS, value)
  );
}

/** Reduces a caller-supplied key prefix to `[A-Za-z0-9_-]`, max 64 chars. */
export function sanitizeKeyPrefix(value: string | null | undefined): string {
  return (value ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}

/** Reduces an uploaded file name to a single safe path segment. */
export function sanitizeFileName(name: string | null | undefined): string {
  const base = (name ?? "").split(/[/\\]/).pop() ?? "";
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(-128);
  return cleaned || "file";
}

export function buildUploadKey(
  uploadType: UploadType,
  prependString?: string | null,
  fileName?: string | null
): string {
  const prefix = sanitizeKeyPrefix(prependString);
  const name = fileName == null ? "" : `_${sanitizeFileName(fileName)}`;
  return `${UPLOAD_CONFIGS[uploadType].folder}/${prefix}${prefix ? "_" : ""}${Date.now()}${name}`;
}

/** Returns an error message when the file is not acceptable for the type. */
export function validateUpload(
  file: File,
  uploadType: UploadType
): string | null {
  const config = UPLOAD_CONFIGS[uploadType];
  if (file.size > config.maxSize) {
    return `File is too large. Maximum size is ${config.maxSize / (1024 * 1024)}MB.`;
  }
  if (config.imagesOnly && !file.type.startsWith("image/")) {
    return "Only image files are allowed.";
  }
  return null;
}

export class StorageNotConfiguredError extends Error {
  constructor() {
    super("Storage bucket not configured");
  }
}

/** Uploads an already-validated file and returns its proxy URL and key. */
export async function putUpload(
  file: File,
  uploadType: UploadType,
  prependString?: string | null
): Promise<{ url: string; key: string }> {
  const bucketName = process.env.AWS_BUCKET_NAME;
  if (!bucketName) {
    throw new StorageNotConfiguredError();
  }

  const objectKey = buildUploadKey(uploadType, prependString, file.name);
  const buffer = Buffer.from(await file.arrayBuffer());

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
      Body: buffer,
      ContentType: file.type,
      ContentLength: buffer.length,
    })
  );

  return { url: `/api/storage/${objectKey}`, key: objectKey };
}
