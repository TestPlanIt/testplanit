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
