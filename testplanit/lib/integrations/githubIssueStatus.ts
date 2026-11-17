/**
 * The status a GitHub issue is stored under. GitHub issues are only ever
 * `open` or `closed`, but a closed issue also carries a `state_reason`, and
 * one closed as not planned is a different outcome from one closed as
 * completed, so it gets its own status.
 */
export const GITHUB_NOT_PLANNED_STATUS = "not_planned";

export function githubIssueStatus(issue: {
  state?: unknown;
  state_reason?: unknown;
}): string | null {
  if (typeof issue.state !== "string") return null;
  return issue.state === "closed" &&
    issue.state_reason === GITHUB_NOT_PLANNED_STATUS
    ? GITHUB_NOT_PLANNED_STATUS
    : issue.state;
}
