/**
 * The status a GitHub issue is stored under. GitHub issues are only ever
 * `open` or `closed`, but a closed issue also carries a `state_reason`, and
 * one closed as not planned or as a duplicate is a different outcome from one
 * closed as completed, so each gets its own status.
 */
export const GITHUB_NOT_PLANNED_STATUS = "not_planned";
export const GITHUB_DUPLICATE_STATUS = "duplicate";

/** Close reasons stored as the issue's status; every one is a closed issue. */
export const GITHUB_CLOSE_REASON_STATUSES: ReadonlySet<string> = new Set([
  GITHUB_NOT_PLANNED_STATUS,
  GITHUB_DUPLICATE_STATUS,
]);

export function githubIssueStatus(issue: {
  state?: unknown;
  state_reason?: unknown;
}): string | null {
  if (typeof issue.state !== "string") return null;
  return issue.state === "closed" &&
    typeof issue.state_reason === "string" &&
    GITHUB_CLOSE_REASON_STATUSES.has(issue.state_reason)
    ? issue.state_reason
    : issue.state;
}
