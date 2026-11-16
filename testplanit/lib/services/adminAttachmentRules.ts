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
