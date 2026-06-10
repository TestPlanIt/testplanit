import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import { formatTestRunCompletedBlocks } from "./test-run-completed";
import { formatTestRunCreatedBlocks } from "./test-run-created";
import { formatTestRunStateChangedBlocks } from "./test-run-state-changed";
import { formatTestRunResultAddedBlocks } from "./test-run-result-added";
import { formatTestRunDuplicatedBlocks } from "./test-run-duplicated";
import { formatSessionCompletedBlocks } from "./session-completed";
import { formatSessionCreatedBlocks } from "./session-created";
import { formatSessionDuplicatedBlocks } from "./session-duplicated";
import { formatSessionStateChangedBlocks } from "./session-state-changed";
import { formatSessionResultAddedBlocks } from "./session-result-added";
import { formatIterationResultRecordedBlocks } from "./iteration-result-recorded";
import { formatIssueCreatedBlocks } from "./issue-created";
import { formatIssueUpdatedBlocks } from "./issue-updated";
import { formatIssueDeletedBlocks } from "./issue-deleted";
import { formatCaseCreatedBlocks } from "./case-created";
import { formatCaseUpdatedBlocks } from "./case-updated";
import { formatCaseDeletedBlocks } from "./case-deleted";
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
  "test_run.created": formatTestRunCreatedBlocks,
  "test_run.state_changed": formatTestRunStateChangedBlocks,
  "test_run.result_added": formatTestRunResultAddedBlocks,
  "test_run.duplicated": formatTestRunDuplicatedBlocks,
  "session.completed": formatSessionCompletedBlocks,
  "session.created": formatSessionCreatedBlocks,
  "session.duplicated": formatSessionDuplicatedBlocks,
  "session.state_changed": formatSessionStateChangedBlocks,
  "session.result_added": formatSessionResultAddedBlocks,
  "iteration.result.recorded": formatIterationResultRecordedBlocks,
  "issue.created": formatIssueCreatedBlocks,
  "issue.updated": formatIssueUpdatedBlocks,
  "issue.deleted": formatIssueDeletedBlocks,
  "case.created": formatCaseCreatedBlocks,
  "case.updated": formatCaseUpdatedBlocks,
  "case.deleted": formatCaseDeletedBlocks,
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
