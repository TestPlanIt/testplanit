/**
 * Trackers that take a file on an issue. Mirrors each adapter's
 * `uploadAttachment` and `getCapabilities().attachments` so the create form
 * can offer attachments without a server round trip. Keep in step with
 * `lib/integrations/adapters/*Adapter.ts`.
 */
export const ISSUE_ATTACHMENT_PROVIDERS: ReadonlySet<string> = new Set([
  "JIRA",
  "AZURE_DEVOPS",
  "GITLAB",
  "GITEA",
  "REDMINE",
  "MANTISBT",
  "CLICKUP",
]);

export function takesIssueAttachments(provider: string | null | undefined) {
  return !!provider && ISSUE_ATTACHMENT_PROVIDERS.has(provider);
}

/** The most files one create-issue request carries. */
export const MAX_ISSUE_FORM_ATTACHMENTS = 10;

/**
 * The storage prefix the create form uploads a user's files under, before
 * sanitizing. The files only pass through storage on their way to the
 * tracker: the create route reads the caller's own prefix and removes what it
 * read, so nothing else may be stored under it.
 */
export function issueFormAttachmentPrefix(
  projectId: number,
  userId: string
): string {
  return `issue-form/${projectId}/${userId}`;
}
