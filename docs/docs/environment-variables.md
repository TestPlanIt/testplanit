---
sidebar_label: 'Environment Variables'
title: 'Environment Variables'
description: Reference for every environment variable TestPlanIt reads, grouped by area, with defaults
---

# Environment Variables

This page lists every environment variable the application, its workers, and its build read, with the default that applies when the variable is unset. Variables marked **required** have no usable default. Variables marked **build-time** are baked into the Next.js build and take effect only after the `prod` image is rebuilt, not after a restart.

The `testplanit/.env.example` file in the repository carries the same variables with commented examples. Setup pages describe how each area fits together; this page is the reference.

## Core

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | **required** | PostgreSQL connection string, including `?schema=public`. |
| `NEXTAUTH_URL` | **required** | The public URL of the application. Also forms the OAuth callback URL that issue-tracker integrations register with their providers: `${NEXTAUTH_URL}/api/integrations/oauth/<provider>/callback`. |
| `NEXTAUTH_SECRET` | **required** | Session signing secret. Generate with `openssl rand -base64 32`. |
| `ENCRYPTION_KEY` | **required** | Key for encrypting stored secrets such as integration credentials and two-factor seeds. Generate with `openssl rand -hex 32`. Changing it makes existing encrypted values unreadable. |
| `VALKEY_URL` | **required** | Valkey or Redis connection string, used for job queues, caches, rate limits, and real-time notifications. |

## Database

See [External Database Deployment](external-database-deployment.md) and [Horizontal Read Scaling](horizontal-read-scaling.md).

| Variable | Default | Description |
| --- | --- | --- |
| `DIRECT_DATABASE_URL` | `DATABASE_URL` | A connection that bypasses a transaction-mode pooler such as pgbouncer. Schema sync, index creation, and audit-trigger setup use it. Required when `DATABASE_URL` points at a pooler. |
| `DATABASE_POOL_MAX` | `20` | Client-side connection pool size per process. One pool per replica; keep the total under the server's `max_connections`. |
| `DATABASE_POOL_CONNECTION_TIMEOUT_MS` | `10000` | How long a query waits for a free pool slot before failing. `0` waits without limit. |
| `DATABASE_POOL_IDLE_TIMEOUT_MS` | `10000` | How long an unused connection stays open before it is closed. |
| `DATABASE_STATEMENT_TIMEOUT_MS` | unset | Server-side per-statement deadline. Set it on the web process only; workers run long statements legitimately. |
| `DATABASE_REPLICA_URLS` | unset | Comma-separated read-replica connection strings. Reads spread across them; writes and transactions stay on `DATABASE_URL`. |
| `DATABASE_PRIMARY_STICKY_MS` | `5000` | After a write, how long a user's reads stay on the primary so they see their own changes. `0` disables. |
| `AUDIT_TRIGGER_BOOTSTRAP` | on | Set to `off` to skip installing the audit triggers at startup, for example when the database role cannot run DDL. |
| `AUDIT_TRIGGER_BOOTSTRAP_FATAL` | unset | Set to `1` to abort startup when the audit triggers cannot be installed. Recommended on the worker tier. The default logs the failure and continues. |

## Valkey and Job Queues

| Variable | Default | Description |
| --- | --- | --- |
| `VALKEY_SENTINELS` | unset | Comma-separated `host:port` list. When set, the app connects through Sentinel instead of `VALKEY_URL` directly; the password in `VALKEY_URL` still authenticates to the master. |
| `VALKEY_SENTINEL_MASTER` | `mymaster` | Sentinel master name. |
| `VALKEY_SENTINEL_PASSWORD` | unset | Password for the Sentinel nodes themselves. |
| `BULLMQ_PREFIX` | `bull` | Key prefix for all job queues. Worker-group deployments set `bull-<group>` so each group works on its own keyspace. Letters, digits, `_` and `-` only. The app and the workers serving it must use the same value. |
| `SKIP_VALKEY_CONNECTION` | unset | Set to `true` to skip connecting to Valkey. Used during builds. |

## Search

See [Search Configuration](search-configuration.md).

| Variable | Default | Description |
| --- | --- | --- |
| `ELASTICSEARCH_NODE` | unset | Elasticsearch URL. Leave unset to disable search-backed features; keyword features fall back to the database where they can. |

## File Storage

See [File Storage](file-storage.md).

| Variable | Default | Description |
| --- | --- | --- |
| `AWS_ACCESS_KEY_ID` | **required** | Access key for S3 or MinIO. |
| `AWS_SECRET_ACCESS_KEY` | **required** | Secret key for S3 or MinIO. |
| `AWS_REGION` | **required** | Bucket region. `AWS_BUCKET_REGION` is accepted as a legacy alias. |
| `AWS_BUCKET_NAME` | **required** | Bucket name. |
| `AWS_ENDPOINT_URL` | unset | Storage endpoint the server talks to. Leave unset for AWS S3; set to the MinIO service URL for MinIO. |
| `AWS_PUBLIC_ENDPOINT_URL` | unset | Browser-reachable storage URL for presigned links when MinIO sits behind a proxy. When unset on a hosted instance, files are served through the application instead. |
| `MINIO_INTERNAL_ENDPOINT` | unset | **Build-time.** An extra internal storage host to allow in the image optimizer. |
| `UPLOAD_MAX_MB` | `10` | **Build-time.** Per-file upload ceiling for attachments and inline images. Raise the bundled nginx limit to match. |
| `IS_HOSTED` | `false` | Marks a hosted instance. With no `AWS_PUBLIC_ENDPOINT_URL`, files are proxied through the application. |
| `SELF_HOSTED` | unset | **Build-time.** Set to `true` for self-hosted images to turn off the Next.js image optimizer, so one image runs on any host without a baked-in domain allowlist. |
| `BASE_DOMAIN` | unset | **Build-time.** Multi-tenant base domain; `*.BASE_DOMAIN` storage URLs are allowed in the image optimizer. |
| `NEXT_PUBLIC_APP_URL`, `APP_URL` | unset | **Build-time.** Fallback public URL for the image optimizer allowlist when `AWS_PUBLIC_ENDPOINT_URL` is unset. |

## Authentication

Single sign-on with SAML and OAuth2 providers is configured in Administration → Authentication, not with environment variables. The variables below cover the built-in social providers and the secrets behind tokens.

| Variable | Default | Description |
| --- | --- | --- |
| `PASSWORDLESS_DEVICE_BOUND` | `true` | Magic-link sign-in completes only in the browser that requested it. Set to `false` for a plain clickable link. |
| `API_TOKEN_SECRET` | `NEXTAUTH_SECRET` | HMAC secret for hashing API tokens. Changing it invalidates every existing token. |
| `TWO_FACTOR_ENCRYPTION_KEY` | `NEXTAUTH_SECRET` | Legacy key used only to read two-factor secrets written before `ENCRYPTION_KEY` took over. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | unset | Enables the Google sign-in button when both are set. |
| `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET` | unset | Enables the Microsoft Entra ID sign-in button when both are set. |
| `AZURE_AD_TENANT_ID` | `common` | Entra ID tenant for the button above. |
| `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | unset | Enables the Apple sign-in button when all four are set. Newlines in the private key may be written as `\n`. |
| `JIRA_CLIENT_ID`, `JIRA_CLIENT_SECRET`, `JIRA_REDIRECT_URI` | unset | Legacy global Jira OAuth credentials, consulted only when an integration has none of its own. New installs configure these per integration in the admin UI. |
| `DISABLE_SCIM_RATE_LIMIT` | `false` | Set to `true` to disable the per-token SCIM request limit. Development only. |

## Email

| Variable | Default | Description |
| --- | --- | --- |
| `EMAIL_SERVER_HOST` | unset | SMTP host. Email features are off while unset. |
| `EMAIL_SERVER_PORT` | `587` | SMTP port. |
| `EMAIL_SERVER_USER`, `EMAIL_SERVER_PASSWORD` | unset | SMTP credentials. |
| `EMAIL_FROM` | unset | Sender address for all outgoing mail. |

## API Rate Limiting

See [API Tokens](api-tokens.md).

| Variable | Default | Description |
| --- | --- | --- |
| `TIER` | `professional` | Preset hourly limit on authenticated API requests per instance: `essentials` 1,000, `team` 5,000, `professional` 10,000, `dedicated` 25,000. |
| `API_RATE_LIMIT` | unset | Explicit hourly limit. Overrides `TIER`. |
| `DISABLE_API_RATE_LIMIT` | `false` | Set to `true` to turn rate limiting off. Use for load testing — Do not use in Production. |

## Outbound Requests and Link Previews

| Variable | Default | Description |
| --- | --- | --- |
| `ALLOWED_PRIVATE_HOSTS` | unset | Comma-separated private or internal hostnames that outbound requests may reach: LLM endpoints, self-hosted git and issue trackers, and URL-based test generation. Private addresses are otherwise blocked. |
| `WEBHOOK_OUTBOUND_ALLOW_HTTP` | `false` | Set to `true` to let outbound webhooks target plain `http://` URLs. Exists for test harnesses; never set it in production. |
| `LINK_PREVIEW_MODE` | `safe` | What unauthenticated link previews show. `safe` shows the record kind only; `names` also shows the record and project name. |
| `CRAWL_SCREENSHOTS` | `false` | Set to `true` to capture a screenshot per page during URL-based test generation and offer it to vision-capable models. The official workers image enables this. |
| `CHROMIUM_EXECUTABLE_PATH` | unset | Chromium binary used for screenshots. The official workers image sets it. |

## Real-Time Notifications

See [SSE Notifications](sse-notifications.md).

| Variable | Default | Description |
| --- | --- | --- |
| `SSE_PER_TENANT_CAP` | `1000` | Open notification streams allowed per tenant. |
| `SSE_PER_USER_CAP` | `4` | Open notification streams allowed per user. |
| `SSE_ISSUES_PER_TENANT_CAP` | `1000` | Open issue-sync streams allowed per tenant. |
| `SSE_ISSUES_PER_USER_CAP` | `8` | Open issue-sync streams allowed per user. |

## Workers

See [Background Processes](background-processes.md). Each variable sets how many jobs the named worker processes at once.

| Variable | Default | Worker |
| --- | --- | --- |
| `TESTMO_IMPORT_CONCURRENCY` | `1` | Testmo import |
| `SYNC_CONCURRENCY` | `2` | Issue sync |
| `EMAIL_CONCURRENCY` | `3` | Email |
| `NOTIFICATION_CONCURRENCY` | `5` | Notifications |
| `FORECAST_CONCURRENCY` | `5` | Forecast |
| `ELASTICSEARCH_REINDEX_CONCURRENCY` | `2` | Search reindex |
| `AUDIT_LOG_CONCURRENCY` | `10` | Audit log |
| `BUDGET_ALERT_CONCURRENCY` | `2` | AI budget alerts |
| `AUTO_TAG_CONCURRENCY` | `3` | Auto-tag |
| `DERIVE_CASE_STEPS_CONCURRENCY` | `2` | Derive case steps |
| `WEBHOOK_DISPATCH_CONCURRENCY` | `5` | Webhook dispatch |
| `EXECUTION_DISPATCH_CONCURRENCY` | `3` | Automated execution dispatch |
| `IMPACT_ANALYSIS_CONCURRENCY` | `1` | Impact Analysis |

The repo cache, copy/move, duplicate scan, Magic Select, and step scan workers always process one job at a time. The matching `*_CONCURRENCY` variables for them only change the value shown on the Job Queues page.

Memory ceilings for the two heaviest workers, applied by the process manager in the workers image:

| Variable | Default | Description |
| --- | --- | --- |
| `TESTMO_IMPORT_MAX_MEMORY_RESTART` | `4G` | Restart the Testmo import worker above this resident size. |
| `TESTMO_IMPORT_MAX_OLD_SPACE_MB` | `3072` | Node heap for the Testmo import worker. |
| `ELASTICSEARCH_REINDEX_MAX_MEMORY_RESTART` | `2G` | Restart the reindex worker above this resident size. |
| `ELASTICSEARCH_REINDEX_MAX_OLD_SPACE_MB` | `1536` | Node heap for the reindex worker. |

## Testmo Import

See [Import from Testmo](import-testmo.md). Chunk sizes are rows per batch write.

| Variable | Default |
| --- | --- |
| `TESTMO_IMPORT_TRANSACTION_TIMEOUT_MS` | `900000` (15 minutes) |
| `TESTMO_AUTOMATION_TRANSACTION_TIMEOUT_MS` | `2700000` (45 minutes) |
| `TESTMO_REPOSITORY_CASE_CHUNK_SIZE` | `500` |
| `TESTMO_TEST_RUN_CASE_CHUNK_SIZE` | `500` |
| `TESTMO_TEST_RUN_RESULT_CHUNK_SIZE` | `2000` |
| `TESTMO_ISSUE_RELATIONSHIP_CHUNK_SIZE` | `1000` |
| `TESTMO_AUTOMATION_CASE_CHUNK_SIZE` | `500` |
| `TESTMO_AUTOMATION_RUN_CHUNK_SIZE` | `500` |
| `TESTMO_AUTOMATION_RUN_TEST_CHUNK_SIZE` | `2000` |
| `TESTMO_AUTOMATION_RUN_FIELD_CHUNK_SIZE` | `500` |
| `TESTMO_AUTOMATION_RUN_LINK_CHUNK_SIZE` | `500` |
| `TESTMO_AUTOMATION_RUN_TEST_FIELD_CHUNK_SIZE` | `500` |
| `TESTMO_AUTOMATION_RUN_TAG_CHUNK_SIZE` | `500` |

## Parameterized Test Runs

| Variable | Default | Description |
| --- | --- | --- |
| `PARAMETERIZED_RUN_HARD_CAP` | `5000` | Run creation refuses more total iterations than this. |
| `PARAMETERIZED_RUN_SOFT_CAP` | `1000` | Above this many iterations, creation asks for confirmation. |
| `PARAMETERIZED_RUN_ASYNC_CAP` | `500` | Above this many iterations, the run is built by a background job. |

## Magic Select

See [Magic Select](user-guide/llm-magic-select.md).

| Variable | Default | Description |
| --- | --- | --- |
| `MAGIC_SELECT_TRUNCATE_CASE_NAME` | `80` | Characters of each case name sent to the model. |
| `MAGIC_SELECT_TRUNCATE_TEXT_LONG` | `100` | Characters of each long text field sent to the model. |
| `MAGIC_SELECT_TRUNCATE_OTHER_FIELD` | `100` | Characters of other fields sent to the model. |
| `MAGIC_SELECT_TRUNCATE_ISSUE_DESC` | `250` | Characters of each linked issue description sent to the model. |
| `MAGIC_SELECT_SEARCH_THRESHOLD` | `250` | Case count above which search pre-filters the candidates. |
| `MAGIC_SELECT_MIN_KEYWORD_LENGTH` | `3` | Shortest keyword used for search pre-filtering. |
| `MAGIC_SELECT_MIN_SEARCH_SCORE` | `50.0` | Lowest search score kept as a candidate. |
| `MAGIC_SELECT_MAX_SEARCH_RESULTS` | `2000` | Most candidates taken from search. |

## Impact Analysis

See [Test Impact Analysis](user-guide/impact.md).

| Variable | Default | Description |
| --- | --- | --- |
| `IMPACT_DIFF_TOKEN_BUDGET` | `12000` | Tokens of diff sent to the model per analysis. |
| `IMPACT_TRUNCATE_PATCH_CHARS` | `4000` | Characters of each file's patch kept in the prompt. |
| `IMPACT_MAX_PATCH_FILES` | `40` | Files whose patch text is included; the rest are summarized by path. |
| `IMPACT_MAX_DIFF_FILES` | `500` | Most changed files read from the provider. |
| `IMPACT_TRUNCATE_CASE_NAME` | `80` | Characters of each case name sent to the model. |
| `IMPACT_TRUNCATE_TEXT_LONG` | `100` | Characters of each long text field sent to the model. |
| `IMPACT_TRUNCATE_OTHER_FIELD` | `100` | Characters of other fields sent to the model. |
| `IMPACT_AI_FULL_REPO_THRESHOLD` | `250` | Case count up to which every case is an AI candidate. |
| `IMPACT_MAX_AI_CANDIDATES` | `400` | Most cases the model ranks. |
| `IMPACT_AI_SAMPLE_SIZE` | `150` | Folder neighbours added to the candidates in large repositories. |
| `IMPACT_MIN_SEARCH_SCORE` | `5` | Lowest keyword-search score kept. |
| `IMPACT_MAX_SEARCH_RESULTS` | `500` | Most keyword-search hits kept. |
| `IMPACT_BM25_SATURATION` | `20` | Search score at which the keyword signal reaches its cap. |
| `IMPACT_MIN_SCORE` | `20` | Lowest score a case needs to appear at all. Pinned cases always appear. |
| `IMPACT_AFFECTED_THRESHOLD` | `50` | Score at which a case moves from the related to the affected tier. |
| `IMPACT_HISTORY_LOOKBACK_DAYS` | `365` | How far back earlier analyses count as history. |
| `IMPACT_HISTORY_MAX_ANALYSES` | `25` | Most earlier analyses consulted. |
| `IMPACT_MAX_ANCHOR_FETCHES` | `50` | Pinned files fetched at the base commit to relocate line and symbol pins. |
| `IMPACT_THINKING_BUDGET` | `1024` | Thinking tokens allowed to models that support it. |
| `IMPACT_LINKED_EXPANSION` | `true` | Also select cases linked to strongly selected cases. |
| `IMPACT_REUSE_HOURS` | `24` | Reuse a completed analysis of the same commits within this window. |
| `IMPACT_ISSUE_MAX_COMMIT_FETCHES` | `25` | Commits naming a ticket whose own file list is read per analysis. |
| `IMPACT_ISSUE_SCAN_LOOKBACK_DAYS` | `90` | How far back the ticket scan reads commits on each cache refresh. |
| `IMPACT_ISSUE_SCAN_MAX_COMMITS` | `300` | Most commits the ticket scan reads. |
| `IMPACT_ISSUE_SCAN_MAX_COMMIT_FETCHES` | `100` | Ticket commits whose file list the scan reads per refresh. |
| `IMPACT_ISSUE_SCAN_MAX_FILES_PER_COMMIT` | `50` | A ticket commit touching more files than this is skipped. |

## Multi-Tenant Deployments

See [Multi-Tenant Workers](multi-tenant-workers.md).

| Variable | Default | Description |
| --- | --- | --- |
| `MULTI_TENANT_MODE` | `false` | Set to `true` to serve several tenants from one worker process, each with its own database. |
| `INSTANCE_TENANT_ID` | `default` | Pins an application pod to one tenant. |
| `TENANT_CONFIG_FILE` | `/config/tenants.json` | JSON file of tenant configurations. Re-read when it changes. |
| `TENANT_CONFIGS` | unset | JSON object of tenant configurations keyed by tenant id, with `databaseUrl`, `replicaUrls`, `elasticsearchNode`, `elasticsearchIndex`, and `baseUrl`. Overrides the file. |
| `TENANT_<ID>_DATABASE_URL` | unset | Per-tenant database, as an alternative to the file or JSON. Companions: `TENANT_<ID>_DATABASE_REPLICA_URLS`, `TENANT_<ID>_ELASTICSEARCH_NODE`, `TENANT_<ID>_ELASTICSEARCH_INDEX`, `TENANT_<ID>_BASE_URL`. |
| `TENANT_SECRETS_NAMESPACE` | pod namespace | Kubernetes namespace holding per-tenant secrets. |
| `TENANT_SECRET_NAME_TEMPLATE` | `tpi-{tenant}-env` | Name of each tenant's Kubernetes secret; `{tenant}` is replaced by the tenant id. |
| `TENANT_SECRETS_CACHE_TTL_MS` | `600000` | How long a tenant secret is cached before it is read again. |
| `KUBERNETES_SERVICE_HOST`, `KUBERNETES_SERVICE_PORT` | `kubernetes.default.svc`, `443` | API server used to read tenant secrets. Kubernetes sets these in every pod. |

## Trial Instances

| Variable | Default | Description |
| --- | --- | --- |
| `IS_TRIAL_INSTANCE` | `false` | Marks a time-limited trial. |
| `TRIAL_END_DATE` | unset | When the trial ends. |
| `FEEDBACK_SURVEY_URL` | unset | Survey link shown to trial users. |
| `NEXT_PUBLIC_CONTACT_EMAIL` | `sales@testplanit.com` | Contact shown when a trial has expired. |
| `NEXT_PUBLIC_WEBSITE_URL` | `https://testplanit.com` | Website link shown when a trial has expired. |

## Build-Time Variables

These are read while the application is built. The release pipeline sets the version variables; operators building their own image may set the others.

| Variable | Default | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_VERSION`, `NEXT_PUBLIC_GIT_COMMIT`, `NEXT_PUBLIC_GIT_BRANCH`, `NEXT_PUBLIC_GIT_TAG`, `NEXT_PUBLIC_BUILD_DATE` | generated | Version information shown in the application. Written by the build script. |
| `NEXT_PUBLIC_FORCE_RTL` | unset | Set to `true` to render every locale right-to-left, for checking the mirrored layout. |
| `DOCKER_BUILD` | unset | Set to `true` inside the image build to skip the local build cache. |
| `CI` | unset | Set by CI runners; also skips the local build cache. |
| `SELF_HOSTED`, `BASE_DOMAIN`, `UPLOAD_MAX_MB`, `MINIO_INTERNAL_ENDPOINT`, `NEXT_PUBLIC_APP_URL` | see [File Storage](#file-storage) | Storage and image optimizer settings that are also build-time. |

## Seeding, Development, and Testing

| Variable | Default | Description |
| --- | --- | --- |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` | unset | The first administrator account, created when the database is seeded. |
| `TEST_REGULAR_USER_PASSWORD` | unset | Password for the seeded non-admin user in test environments. |
| `TEST_EMAIL_DOMAIN` | `example.com` | Domain for generated E2E test user addresses. |
| `E2E_PROD` | unset | Set to `on` to run E2E tests against a production build. See [E2E Testing](e2e-testing.md). |
| `RUN_DB_INTEGRATION` | unset | Set to `1` to run the live-database integration tests. |
| `TEST_VALKEY_URL` | unset | Valkey used by tests that need a real instance. |
| `DEBUG_FORECAST` | unset | Any value turns on verbose forecast logging. |

## Docker Compose

The `DOCKER_*_PORT` variables, `POSTGRES_*`, `MINIO_ROOT_*`, and resource limits are consumed by the compose files rather than the application. See [Docker Setup](docker-setup.md).
