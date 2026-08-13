/**
 * Resolvers that turn a wizard `contextImages` request into `ContextImage`s.
 *
 * Security shape shared by every resolver: the client only ever sends
 * OPAQUE SELECTORS (attachment ids, editor srcs) — never URLs and never
 * bytes. The server re-derives the candidate set from its own source of
 * truth (the adapter's attachment listing, the submitted TipTap doc) and
 * intersects with the selection, so a crafted request cannot make the
 * server fetch anything the source itself doesn't offer.
 *
 * Per-item failures are tolerated (log + skip): one unfetchable attachment
 * must not sink a generation run — mirroring resolveEditorMediaAttachments.
 */

import type {
  IssueAdapter,
  IssueAttachmentMeta,
} from "~/lib/integrations/adapters/IssueAdapter";
import {
  isAllowedImageMime,
  MAX_CONTEXT_IMAGES,
  type ContextImage,
  type ContextImageSource,
} from "~/lib/llm/context-images";

/** The wizard's `contextImages` request body field. */
export interface ContextImagesRequestBody {
  /** Issue-attachment ids to include (issue source). */
  attachmentIds?: string[];
  /** Editor image srcs to include (document source; resolved in PR4). */
  editorSrcs?: string[];
}

/** Guess an image mime from the filename when the provider stores none. */
export function imageMimeFromFilename(filename: string): string | undefined {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    default:
      return undefined;
  }
}

/** Attachment metadata with its resolved (declared-or-guessed) image mime. */
export function resolveAttachmentImageMime(
  meta: IssueAttachmentMeta
): string | undefined {
  if (isAllowedImageMime(meta.mimeType)) return meta.mimeType!.toLowerCase();
  // Some providers omit or genericize mimeType (ADO stores none) — fall
  // back to the filename extension before rejecting.
  const guessed = imageMimeFromFilename(meta.filename);
  return isAllowedImageMime(guessed) ? guessed : undefined;
}

/**
 * Fetch the selected image attachments of an issue through its tracker
 * adapter. Returns [] when the adapter can't list/download attachments, the
 * issue has none, or nothing was selected — callers treat "no images" and
 * "images unavailable" identically.
 *
 * Downloads are bounded: at most MAX_CONTEXT_IMAGES + 1 fetches, so a
 * selection of fifty ids cannot fan out fifty tracker requests (the +1 lets
 * the sanitizer report at least one over-count skip truthfully).
 */
export async function resolveIssueAttachmentImages(args: {
  adapter: IssueAdapter | null;
  issueKey: string | undefined;
  attachmentIds: string[] | undefined;
  source: ContextImageSource;
}): Promise<ContextImage[]> {
  const { adapter, issueKey, attachmentIds, source } = args;
  if (
    !adapter?.listAttachments ||
    !adapter.downloadAttachment ||
    !issueKey ||
    !attachmentIds?.length
  ) {
    return [];
  }

  let listed: IssueAttachmentMeta[];
  try {
    listed = await adapter.listAttachments(issueKey);
  } catch (err) {
    console.warn(
      `[context-images] Failed to list attachments for %s:`,
      issueKey,
      err
    );
    return [];
  }

  const selected = new Set(attachmentIds);
  const candidates = listed
    .filter((meta) => selected.has(meta.id))
    .map((meta) => ({ meta, mimeType: resolveAttachmentImageMime(meta) }))
    .filter(
      (c): c is { meta: IssueAttachmentMeta; mimeType: string } => !!c.mimeType
    )
    .slice(0, MAX_CONTEXT_IMAGES + 1);

  const images: ContextImage[] = [];
  for (const { meta, mimeType } of candidates) {
    try {
      const { buffer, mimeType: downloadedMime } =
        await adapter.downloadAttachment!(meta);
      images.push({
        id: `${source}:${meta.id}`,
        source,
        filename: meta.filename,
        mimeType: isAllowedImageMime(downloadedMime)
          ? downloadedMime!.toLowerCase()
          : mimeType,
        base64: buffer.toString("base64"),
        byteSize: buffer.byteLength,
        origin: { issueKey, attachmentId: meta.id },
      });
    } catch (err) {
      console.warn(
        `[context-images] Failed to download attachment %s of %s:`,
        meta.id,
        issueKey,
        err
      );
    }
  }
  return images;
}
