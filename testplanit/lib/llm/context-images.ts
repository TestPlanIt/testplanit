/**
 * ContextImage — the one internal shape every image source (Jira/ADO issue
 * attachments, TipTap editor embeds, URL-crawl screenshots) resolves into
 * before generation. The generation routes only ever see this shape; where
 * the bytes came from stays a per-source concern.
 *
 * Server-only: images are raw base64 payloads that must never round-trip
 * through the client (the wizard sees metadata via the enrichment envelope;
 * bytes live in the Redis stash between outline and expand).
 */

import type { LlmImagePart } from "~/lib/llm/types";
import { IMAGE_TOKEN_ESTIMATE } from "~/lib/llm/content";

export type ContextImageSource =
  "jira-attachment" | "ado-attachment" | "editor" | "url-screenshot";

export interface ContextImage {
  /** Stable within a stash: `${source}:${attachmentId ?? index}`. */
  id: string;
  source: ContextImageSource;
  filename: string;
  mimeType: string;
  /** Raw base64, no data-URI prefix. */
  base64: string;
  /** Decoded byte size (NOT base64 length). */
  byteSize: number;
  origin?: {
    issueKey?: string;
    attachmentId?: string;
    url?: string;
    editorSrc?: string;
  };
}

/** Metadata slice of a ContextImage that is safe to send to the client. */
export interface ContextImageMeta {
  id: string;
  source: ContextImageSource;
  filename: string;
  byteSize: number;
}

export type ContextImageSkipReason =
  "too-large" | "unsupported-type" | "over-count";

export interface ContextImageSkip {
  filename: string;
  reason: ContextImageSkipReason;
}

export const MAX_CONTEXT_IMAGES = 5;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

export { IMAGE_TOKEN_ESTIMATE };

export function isAllowedImageMime(mimeType: string | undefined): boolean {
  return (
    !!mimeType &&
    (ALLOWED_IMAGE_MIME as readonly string[]).includes(mimeType.toLowerCase())
  );
}

/**
 * Apply the type/size/count caps in order, preserving input order for the
 * survivors. Every rejected image is reported with a reason so the wizard
 * can say exactly why something the user checked did not go.
 */
export function sanitizeContextImages(images: ContextImage[]): {
  included: ContextImage[];
  skipped: ContextImageSkip[];
} {
  const included: ContextImage[] = [];
  const skipped: ContextImageSkip[] = [];

  for (const image of images) {
    if (!isAllowedImageMime(image.mimeType)) {
      skipped.push({ filename: image.filename, reason: "unsupported-type" });
      continue;
    }
    if (image.byteSize > MAX_IMAGE_BYTES) {
      skipped.push({ filename: image.filename, reason: "too-large" });
      continue;
    }
    if (included.length >= MAX_CONTEXT_IMAGES) {
      skipped.push({ filename: image.filename, reason: "over-count" });
      continue;
    }
    included.push(image);
  }

  return { included, skipped };
}

export function toImageParts(images: ContextImage[]): LlmImagePart[] {
  return images.map((image) => ({
    type: "image" as const,
    mimeType: image.mimeType,
    base64: image.base64,
    filename: image.filename,
  }));
}

export function toContextImageMeta(images: ContextImage[]): ContextImageMeta[] {
  return images.map(({ id, source, filename, byteSize }) => ({
    id,
    source,
    filename,
    byteSize,
  }));
}

/** Token estimate the budget loops subtract before packing text context. */
export function contextImageTokens(images: ContextImage[]): number {
  return images.length * IMAGE_TOKEN_ESTIMATE;
}
