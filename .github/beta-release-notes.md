**Beta pre-release of TestPlanIt 1.0 — source only.**

There is no prebuilt Docker image for betas: official images bake
`BASE_DOMAIN=testplanit.com` into the build and can't be reused by other
installs. You build it yourself from the source attached below.

> ⚠️ This is pre-release software. **Back up your database before trying it.**

### What's new since beta.16

#### Images as AI generation context

- **Screenshots now reach the model.** Test-case generation can send images
  from your source material alongside the text, so mockups, error screenshots,
  and UI captures inform the generated cases. An **Images to include as
  context** picker lists what was found — up to 5 images, 4 MB each, PNG /
  JPEG / GIF / WebP — with eligible ones pre-selected and oversized ones
  marked and unselectable.
- **From Issue.** Jira attachments, including screenshots pasted into a
  description or comments, and files attached to Azure DevOps work items.
  Inline images render as `[image: filename]` placeholders in the issue
  preview so you can see where they sit in the text. Generation from the Jira
  panel carries the issue's images automatically, under the same limits.
- **From Document.** The requirements form is now a rich-text editor, and
  images embedded in it — pasted screenshots, uploaded mockups — are offered
  as context.
- **From URL.** The crawler captures a screenshot of each page it visits and
  offers it as context. On the official workers image (Docker Compose and
  Helm) this is on by default; turn it off with `CRAWL_SCREENSHOTS=false`
  (`workers.crawlScreenshots: false` in Helm). Workers running outside the
  official image need `CRAWL_SCREENSHOTS=true` plus a Chromium executable.
  Rendering is held to the same SSRF rules as the crawl itself — every
  sub-resource the page loads is checked, not just the page URL.
- **Only on vision-capable models.** Support is detected from the model name;
  when the configured model can't take images the picker stays visible and
  says so, and generation proceeds with text only. Admins can override the
  detection per model with `supportsVision` in `modelCapabilities`, or declare
  it for a whole custom integration with `visionSupport`. The review step
  reports exactly which images were sent and which were skipped.
- Images are fetched at generation time and held in a short-lived cache; they
  are never copied into TestPlanIt's file storage.

#### AI model configuration

- **Cost fields fill themselves in.** When a provider reports per-model
  pricing — LiteLLM proxies via `/model/info`, and the OpenRouter and Together
  AI model listings — Cost Per 1M Input/Output Tokens are populated on model
  selection and after a successful Test Connection, normalized to USD per 1M
  tokens. A toast confirms the applied rates, and both fields stay editable
  before you save.
- **Custom endpoints list their models.** OpenAI-compatible Custom LLM
  endpoints now populate the model dropdown from `/models`, falling back
  silently to manual entry when the endpoint doesn't serve it.
- The available-models route requires an admin session, and the cloud
  metadata-host blocklist used by SSRF validation is now one shared predicate
  (`metadata.google` and `100.100.100.200` included).

#### Shared steps

- **Narrow a large scan.** Step Sequence Duplicates gains **Min. Steps** and
  **Min. Cases** dropdowns. Options are derived from the counts actually
  present in the scan, so every choice narrows the results, and each selection
  is remembered per project. Changing a filter clears the row selection, so a
  bulk dismissal only ever applies to the rows you picked in the list in front
  of you.
- **The conversion dialog shows its steps every time.** It resolved the
  matched run by id range, but a case whose steps were reordered or inserted
  into can have an end id lower than its start id — the query returned nothing
  and the editor opened empty. The range now resolves by position, dialog
  state resets on each open so a reopened match no longer inherits the
  previous one's name or edits, and a match whose steps are gone says it's
  stale instead of showing an empty editor.
- **Large scans stay responsive.** The results table virtualizes and no longer
  loads every matched case's full step text up front; step-text previews are
  unchanged.

#### Test runs

- **Duplicate works from the runs list again.** The list row hid its Duplicate
  action for completed runs, so the same run could be duplicated from its
  detail page but not from the list it appears in. Completed rows also get
  their record-key item back.
- **Imported cases show the automation icon.** Existing cases matched by a
  result import are marked automated but keep their original source, so they
  rendered with the manual icon throughout the automated-run views.

#### Test case result history

- The history card no longer collapses to ~5 rows when it mounts below the
  fold, and notes, step results, iteration values, and log output are fetched
  per result when a row is expanded rather than for every row up front.

#### Reports

- **Charts plotted zeros in every non-English locale.** Report rows are keyed
  by the registry's English label, but the chart read them through the
  localized display label. Any metric whose display label differed — Test
  Results, Test Results Count, and Test Cases Count in English, and *every*
  metric in other locales — drew a flat zero line while the results table
  showed correct values.

#### Notifications

- **Daily digests skip what you've already read.** The fan-out selected unread
  notifications at queue time, but the worker re-fetched them by id alone, so
  anything read or dismissed between the cron enqueue and the job running was
  still emailed and then force-marked read.
- **No email server, no email jobs.** The digest pass and email jobs now check
  for a configured SMTP transport first, instead of scanning every user and
  burning five queue retries per message on installations that run without
  email.

#### Integrations

- Issue-tracker requests retry on HTTP 429 and 5xx responses and honor a
  `Retry-After` header when the provider sends one.

#### Audit log

- **A poison batch no longer freezes the pipeline.** A SQL error anywhere in a
  poll batch aborted the whole transaction, so nothing was marked processed
  and the worker re-polled the same batch forever while looking alive. Each
  group now runs under its own SAVEPOINT — a bad group costs only its own rows
  and retries next poll while the rest of the batch drains — and progress
  counts completed rows, so a poison-only batch sleeps instead of hot-looping
  against the database.

#### Administration

- The abandoned-automation-cleanup mode and the QuickScript templates
  enabled-only filter are switches instead of two-option dropdowns.

#### Languages

- **Czech (Čeština)** joins the interface languages, bringing the total to 17.
- Count messages say "both" rather than "all 2".

#### Database and deployment

- **Case-insensitive sorting on musl-based Postgres.** Alpine's musl libc
  can't collate locales, so every `ORDER BY` on text sorted in byte order —
  all capitals ahead of all lowercase — in the bundled Postgres container.
  A migration re-collates the sorted display-name columns on existing
  databases, and the Compose and Helm Postgres now initialize new volumes with
  ICU as the collation provider.
- The Docker deployment guide is corrected: `.env.example` ships with
  local-development values, so `DATABASE_URL`, `VALKEY_URL`, and
  `ELASTICSEARCH_NODE` must be pointed at the Compose service hostnames.

#### Schema

- Adds the migration for the `worker` column on JUnit test results. The column
  was introduced in beta.16's schema but shipped without a migration, so
  deployments running `migrate deploy` never created it and every automated
  run's detail page returned a 400. Upgrading from beta.16 applies it
  normally.
