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
export const COPY_MOVE_QUEUE_NAME = "copy-move";
export const DUPLICATE_SCAN_QUEUE_NAME = "duplicate-scan";
export const STEP_SCAN_QUEUE_NAME = "step-scan";
export const MAGIC_SELECT_QUEUE_NAME = "magic-select";
export const GENERATE_FROM_URL_QUEUE_NAME = "generate-from-url";
export const ITERATION_GENERATION_QUEUE_NAME = "iteration-generation";
export const WEBHOOK_DISPATCH_QUEUE_NAME = "webhook-dispatch";
export const SCIM_ACCESS_RECOMPUTE_QUEUE_NAME = "scim-access-recompute";

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
export const JOB_UPDATE_ALL_CASES = "update-all-cases-forecast";
export const JOB_AUTO_COMPLETE_MILESTONES = "auto-complete-milestones";
export const JOB_MILESTONE_DUE_NOTIFICATIONS = "milestone-due-notifications";
export const JOB_REVIEW_REMINDERS = "review-reminders";
export const JOB_SWEEP_ABANDONED_RUNS = "sweep-abandoned-runs";
