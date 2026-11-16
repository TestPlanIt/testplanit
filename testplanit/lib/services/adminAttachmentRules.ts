/**
 * Attachment vocabulary shared by the admin attachments service and its page.
 * Kept free of server imports so the page can load it in the browser.
 */

/** The mime type an external link is stored under (see `UploadAttachments`). */
export const LINK_MIME_TYPE = "text/uri-list";

/**
 * Stands for "no type recorded" in the type filter. Some uploads arrive with
 * no mime type (the browser knows none for the file), and an empty string
 * cannot travel in a comma separated list.
 */
export const NO_MIME_TYPE = "none";

export const ATTACHMENT_PARENT_TYPES = [
  "case",
  "session",
  "sessionResult",
  "testRun",
  "testRunResult",
  "testRunStepResult",
  "junitTestResult",
  "issue",
  "none",
] as const;
export type AttachmentParentType = (typeof ATTACHMENT_PARENT_TYPES)[number];

export const ATTACHMENT_STATUSES = [
  "live",
  "softDeleted",
  "parentDeleted",
  "noParent",
  "fileMissing",
  "otherHost",
] as const;
export type AttachmentStatus = (typeof ATTACHMENT_STATUSES)[number];

export const ATTACHMENT_ACTIONS = [
  "detach",
  "softDelete",
  "restore",
  "purge",
] as const;
export type AttachmentAction = (typeof ATTACHMENT_ACTIONS)[number];

/**
 * The most attachments one action takes, and "select all matches" selects.
 * The server works through them in batches.
 */
export const MAX_ACTION_ATTACHMENTS = 50_000;

/** Formats whose mime type says little about what the file is. */
const FORMAT_NAMES: Record<string, string> = {
  "application/msword": "DOC",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "DOCX",
  "application/vnd.ms-excel": "XLS",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "application/vnd.ms-powerpoint": "PPT",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "PPTX",
  "application/x-zip-compressed": "ZIP",
  "application/octet-stream": "BIN",
  "text/plain": "TXT",
  "text/markdown": "MD",
  "text/javascript": "JS",
  "audio/mpeg": "MP3",
  "video/quicktime": "MOV",
};

/**
 * The short format name people know a file type by ("PNG", "DOCX"), from its
 * mime type. These are format names, the same in every language. Returns an
 * empty string when there is no mime type.
 */
export function fileFormatName(mimeType: string): string {
  const type = mimeType.trim().toLowerCase();
  if (!type) return "";
  const known = FORMAT_NAMES[type];
  if (known) return known;
  const subtype = type.includes("/") ? type.slice(type.indexOf("/") + 1) : type;
  const name = subtype
    .replace(/^(x-|vnd\.)/, "")
    .replace(/\+.*$/, "")
    .replace(/;.*$/, "");
  return (name || type).toUpperCase();
}
