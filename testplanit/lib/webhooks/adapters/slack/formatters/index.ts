import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import { formatTestRunCompletedBlocks } from "./test-run-completed";
import { formatTestRunStateChangedBlocks } from "./test-run-state-changed";
import { formatTestRunResultAddedBlocks } from "./test-run-result-added";
import { formatTestRunDuplicatedBlocks } from "./test-run-duplicated";
import { formatSessionCompletedBlocks } from "./session-completed";
import { formatIssueCreatedBlocks } from "./issue-created";
import { formatIssueUpdatedBlocks } from "./issue-updated";
import { formatCaseCreatedBlocks } from "./case-created";
import { formatCaseUpdatedBlocks } from "./case-updated";
import { formatReviewRequestedBlocks } from "./review-requested";
import { formatReviewCompletedBlocks } from "./review-completed";
import { formatReviewReminderBlocks } from "./review-reminder";
import { formatWebhookTestBlocks } from "./webhook-test";
import { formatGenericBlocks } from "./generic";

export type SlackFormatter = (
  envelope: OutboundEnvelope
) => FormattedHttpRequest;

/**
 * Per-event Slack formatter dispatch table. Event names not in the table
 * fall through to formatGenericBlocks (no event is unsupported; the
 * generic fallback produces a readable diagnostic block).
 */
export const SLACK_FORMATTERS: Record<string, SlackFormatter> = {
  "test_run.completed": formatTestRunCompletedBlocks,
  "test_run.state_changed": formatTestRunStateChangedBlocks,
  "test_run.result_added": formatTestRunResultAddedBlocks,
  "test_run.duplicated": formatTestRunDuplicatedBlocks,
  "session.completed": formatSessionCompletedBlocks,
  "issue.created": formatIssueCreatedBlocks,
  "issue.updated": formatIssueUpdatedBlocks,
  "case.created": formatCaseCreatedBlocks,
  "case.updated": formatCaseUpdatedBlocks,
  "case.review_requested": formatReviewRequestedBlocks,
  "case.review_completed": formatReviewCompletedBlocks,
  "test_run.review_requested": formatReviewRequestedBlocks,
  "test_run.review_completed": formatReviewCompletedBlocks,
  "session.review_requested": formatReviewRequestedBlocks,
  "session.review_completed": formatReviewCompletedBlocks,
  "case.review_reminder": formatReviewReminderBlocks,
  "test_run.review_reminder": formatReviewReminderBlocks,
  "session.review_reminder": formatReviewReminderBlocks,
  "webhook.test": formatWebhookTestBlocks,
};

export { formatGenericBlocks };
