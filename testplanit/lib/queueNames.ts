// Queue name constants - no initialization, just names
export const FORECAST_QUEUE_NAME = "forecast-updates";
export const NOTIFICATION_QUEUE_NAME = "notifications";
export const EMAIL_QUEUE_NAME = "emails";
export const SYNC_QUEUE_NAME = "issue-sync";
export const TESTMO_IMPORT_QUEUE_NAME = "testmo-imports";
export const ELASTICSEARCH_REINDEX_QUEUE_NAME = "elasticsearch-reindex";
export const AUDIT_LOG_QUEUE_NAME = "audit-logs";
export const BUDGET_ALERT_QUEUE_NAME = "budget-alerts";
export const AUTO_TAG_QUEUE_NAME = "auto-tag";
export const DERIVE_CASE_STEPS_QUEUE_NAME = "derive-case-steps";
export const REPO_CACHE_QUEUE_NAME = "repo-cache";
// Job name for an on-demand, single-config cache refresh (manual "Refresh"
// button). Runs the full list+content fetch off-request in the worker so a
// rate-limited provider can't time out the HTTP request.
export const JOB_REFRESH_SINGLE_REPO_CACHE = "refresh-single-repo-cache";
/** Ticket scan for one Impact config; `full: true` walks the whole branch. */
export const JOB_SCAN_REPO_ISSUES = "scan-repo-issues";
/** Evaluate every Code Pin of one Impact connection against the branch tip. */
export const JOB_CHECK_STALE_PINS = "check-stale-code-pins";
export const COPY_MOVE_QUEUE_NAME = "copy-move";
export const DUPLICATE_SCAN_QUEUE_NAME = "duplicate-scan";
export const STEP_SCAN_QUEUE_NAME = "step-scan";
export const MAGIC_SELECT_QUEUE_NAME = "magic-select";
export const IMPACT_ANALYSIS_QUEUE_NAME = "impact-analysis";
export const GENERATE_FROM_URL_QUEUE_NAME = "generate-from-url";
export const ITERATION_GENERATION_QUEUE_NAME = "iteration-generation";
export const WEBHOOK_DISPATCH_QUEUE_NAME = "webhook-dispatch";
export const EXECUTION_DISPATCH_QUEUE_NAME = "execution-dispatch";
export const JOB_DISPATCH_EXECUTION = "dispatch-execution";
export const JOB_POLL_ACTIVE_EXECUTIONS = "poll-active-executions";
export const SCIM_ACCESS_RECOMPUTE_QUEUE_NAME = "scim-access-recompute";
// Alerts (#651): rule evaluation runs here, never in the request
// that recorded the result.
export const ALERT_QUEUE_NAME = "alerts";
// Inbound webhook actions: a tracker delivery's rules run here, after the
// receiver has answered.
export const WEBHOOK_ACTIONS_QUEUE_NAME = "webhook-actions";
export const JOB_RUN_TRACKER_ACTIONS = "run-tracker-actions";
// Failure triage: group automated failures into signatures and classify them.
export const FAILURE_TRIAGE_QUEUE_NAME = "failure-triage";
export const JOB_TRIAGE_RUN = "triage-run";
export const JOB_TRIAGE_BACKFILL = "triage-backfill";
export const JOB_CLASSIFY_SIGNATURES = "classify-signatures";
export const JOB_DRAFT_CASES = "draft-cases";
export const JOB_EVALUATE_ALERT_RESULT = "evaluate-alert-result";
export const JOB_EVALUATE_ALERT_JUNIT_RESULT = "evaluate-alert-junit-result";
export const JOB_EVALUATE_ALERT_RUN = "evaluate-alert-run";
export const JOB_EVALUATE_ALERT_EXECUTION = "evaluate-alert-execution";
export const JOB_EVALUATE_ALERT_SESSION = "evaluate-alert-session";
export const JOB_EVALUATE_SCHEDULED_ALERTS = "evaluate-scheduled-alerts";
export const JOB_EVALUATE_HOURLY_ALERTS = "evaluate-hourly-alerts";

// Job names shared between enqueue sites and the workers that process them.
// They live here rather than in the worker modules so that app code, services
// and the scheduler never import a worker entry file: esbuild inlines whatever
// a bundle imports, and an inlined worker's `require.main === module` start
// guard is true inside the bundle that swallowed it.
export const JOB_CREATE_NOTIFICATION = "create-notification";
export const JOB_PROCESS_USER_NOTIFICATIONS = "process-user-notifications";
export const JOB_SEND_DAILY_DIGEST = "send-daily-digest";
export const BUDGET_ALERT_JOB_CHECK = "check-budget";
export const JOB_REFRESH_EXPIRED_CACHES = "refresh-expired-repo-caches";
export const JOB_UPDATE_SINGLE_CASE = "update-single-case-forecast";
/** Recompute one run's forecast after its case list changed. */
export const JOB_UPDATE_RUN_FORECAST = "update-run-forecast";
export const JOB_UPDATE_ALL_CASES = "update-all-cases-forecast";
export const JOB_AUTO_COMPLETE_MILESTONES = "auto-complete-milestones";
export const JOB_MILESTONE_DUE_NOTIFICATIONS = "milestone-due-notifications";
export const JOB_REVIEW_REMINDERS = "review-reminders";
export const JOB_SWEEP_ABANDONED_RUNS = "sweep-abandoned-runs";
export const JOB_PURGE_STALE_CASE_DRAFTS = "purge-stale-case-drafts";
export const JOB_SWEEP_REPORT_BUILDER_STATES = "sweep-report-builder-states";

/** Every queue the workers serve, for the queue alerts' scope picker. */
export const ALL_QUEUE_NAMES = [
  FORECAST_QUEUE_NAME,
  NOTIFICATION_QUEUE_NAME,
  EMAIL_QUEUE_NAME,
  SYNC_QUEUE_NAME,
  TESTMO_IMPORT_QUEUE_NAME,
  ELASTICSEARCH_REINDEX_QUEUE_NAME,
  AUDIT_LOG_QUEUE_NAME,
  BUDGET_ALERT_QUEUE_NAME,
  AUTO_TAG_QUEUE_NAME,
  DERIVE_CASE_STEPS_QUEUE_NAME,
  REPO_CACHE_QUEUE_NAME,
  COPY_MOVE_QUEUE_NAME,
  DUPLICATE_SCAN_QUEUE_NAME,
  STEP_SCAN_QUEUE_NAME,
  MAGIC_SELECT_QUEUE_NAME,
  IMPACT_ANALYSIS_QUEUE_NAME,
  GENERATE_FROM_URL_QUEUE_NAME,
  ITERATION_GENERATION_QUEUE_NAME,
  WEBHOOK_DISPATCH_QUEUE_NAME,
  EXECUTION_DISPATCH_QUEUE_NAME,
  SCIM_ACCESS_RECOMPUTE_QUEUE_NAME,
  ALERT_QUEUE_NAME,
  WEBHOOK_ACTIONS_QUEUE_NAME,
  FAILURE_TRIAGE_QUEUE_NAME,
] as const;
