/**
 * Translation keys, under `projects.settings.webhooks`, for the event types a
 * delivery can carry.
 */
const EVENT_LABEL_KEYS: Record<string, string> = {
  // Outbound events
  "test_run.created": "events.testRunCreated",
  "test_run.state_changed": "events.testRunStateChanged",
  "test_run.completed": "events.testRunCompleted",
  "test_run.duplicated": "events.testRunDuplicated",
  "test_run.result_added": "events.testRunResultAdded",
  "session.created": "events.sessionCreated",
  "session.state_changed": "events.sessionStateChanged",
  "session.completed": "events.sessionCompleted",
  "session.duplicated": "events.sessionDuplicated",
  "session.result_added": "events.sessionResultAdded",
  "issue.created": "events.issueCreated",
  "issue.updated": "events.issueUpdated",
  "issue.deleted": "events.issueDeleted",
  "case.created": "events.caseCreated",
  "case.updated": "events.caseUpdated",
  "case.deleted": "events.caseDeleted",
  // Inbound: Jira
  "jira:issue_created": "events.jiraIssueCreated",
  "jira:issue_updated": "events.jiraIssueUpdated",
  "jira:issue_deleted": "events.jiraIssueDeleted",
  // Inbound: GitHub
  issues: "events.githubIssues",
  pull_request: "events.githubPullRequest",
  push: "events.githubPush",
  issue_comment: "events.githubIssueComment",
  // Inbound: Azure DevOps
  "workitem.created": "events.adoWorkitemCreated",
  "workitem.updated": "events.adoWorkitemUpdated",
  "workitem.deleted": "events.adoWorkitemDeleted",
  // Synthetic test event ("Send test webhook" / "Send test event")
  "webhook.test": "events.webhookTest",
};

/** Event names other trackers share with GitHub; their labels name GitHub. */
const GITHUB_NAMED_EVENTS = new Set([
  "issues",
  "pull_request",
  "push",
  "issue_comment",
]);

/**
 * The label key for a delivery's event type, or null to show the event type
 * as received. Pass the delivery's adapter so an event name GitHub shares
 * with another tracker is only labelled as GitHub's on a GitHub delivery.
 */
export function eventLabelKey(
  eventType: string | null | undefined,
  adapterType?: string | null
): string | null {
  if (!eventType) return null;
  if (
    GITHUB_NAMED_EVENTS.has(eventType) &&
    adapterType != null &&
    adapterType !== "GITHUB"
  ) {
    return null;
  }
  return EVENT_LABEL_KEYS[eventType] ?? null;
}
