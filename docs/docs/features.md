---
title: Features
sidebar_position: 3
slug: /features
---

# Features

TestPlanIt is a comprehensive test management platform designed to help teams plan, execute, and track their testing efforts. Here's an overview of the key features.

## Test Case Management

### Test Case Editor

- **Rich text editing** - Create detailed test steps with formatted text, images, and attachments. Supports pasting markdown directly into the editor with automatic conversion to rich text
- **Shared steps** - Define reusable step sequences that can be included in multiple test cases
- **Custom fields** - Define custom fields to capture additional metadata for your test cases
- **Expected results** - Clearly define what success looks like for each step

### Repository Organization

- **Hierarchical folders** - Organize test cases into nested folders for logical grouping
- **Custom fields** - Filter test cases by custom fields
- **Tags** - Apply tags to categorize and filter test cases across projects
- **Issues** - Attach issues to quickly navigate between test cases and related issues
- **External link attachments** - First-class link attachments alongside file uploads (paste a URL onto any drop zone)
- **Version history** - Track changes to test cases over time with full version control
- **Documentation pages** - Create wiki-style documentation pages within projects
- **Duplicate detection** - Background scan surfaces near-duplicate test cases at create time and from a dedicated review surface
- **Copy / move** - Reorganize cases across folders and projects, including in-place reordering

### Parameterized Test Cases

- **Named typed parameters** - Declare STRING / INTEGER / BOOLEAN / SELECT parameters on a case and reference them in steps via `@chip` mentions
- **Local + shared datasets** - Each case can have its own owner-bound dataset, or assign a project-scoped shared dataset and map its columns to the case's parameter names
- **Version pinning** - Pin a case to a specific shared-dataset version, or follow the latest
- **Iterations** - Parameterized cases run once per dataset row in a test run, each with its own per-row status; the case-level status rolls up as worst-of
- **CSV import** - Paste-CSV and full upload wizard for bulk dataset row authoring
- **Sensitive values** - Mark a parameter sensitive to mask it in the UI and redact it in exports and notifications for users without read-sensitive permission
- **Parameter Iteration Matrix report** - Pre-built report that pivots iteration outcomes across runs
- **Exclude draft cases from runs** - Opt-in per-project setting that keeps Not Started cases out of the Add Cases picker and auto-removes them from open runs when reverted

### Review & Approval

- **Gated workflow states** - Mark any workflow state as "requires review"; transitions into it (or across it) need an approved review request
- **Reviewer assignment** - Request review from a specific user or any holder of a role; reviewers see their queue in a Review Inbox
- **Strict transitive gates** - A single transition crossing multiple gated states requires an approval for each one
- **Decision audit** - All decisions, comments, and reminders are recorded and emitted as outbound webhook events
- **Reminders** - Configurable hourly scheduler nudges reviewers when requests sit pending past a threshold
- **System + per-project toggles** - System admins flip the master switch; project admins opt their project in independently

## Test Execution

### Test Runs

- **Flexible run creation** - Create test runs from entire folders, filtered sets, or individual test cases
- **Magic Select** - Create test runs from similar test cases using AI
- **Multi-configuration runs** - Execute tests against different configurations (browsers, environments, OS, etc.) in parallel; configurations are scoped to projects
- **Bulk status updates** - Quickly update multiple test results at once
- **Execution history** - View the complete history of test executions for any run or individual test case
- **Immutable completed runs** - Once a run is marked complete its case set, results, and configuration are structurally frozen; admins can edit a single result via the audit-log-tracked override path
- **Live updates** - SSE-driven push so multiple testers watching the same run see each other's status changes without refreshing
- **PDF export** - Per-run PDF with expanded step details and per-iteration values; also available at the milestone level
- **Forecasting** - Live estimates of remaining duration based on historical pass/fail per case

### Result Governance

- **Required result fields** - Optional per-project requirement that result-recording forms must collect certain fields
- **Edit window** - Lock results from in-place edit after a configurable window; later edits go through the audited override path
- **Flip justification** - Require a justification note when a result flips a previously-passed iteration to failed (or vice versa)
- **Linked-issue requirement** - Optional per-project requirement that failures must be linked to an issue before save

### Automation Integration

- **CI/CD friendly** - Designed to fit into your continuous integration pipelines
- **SDK support** - Integrate automated test results using the TestPlanIt SDK
- **TestPlanIt CLI** - CLI tool for submitting test case results in popular formats
- **API access** - Push results programmatically via the REST API
- **WebdriverIO reporter** - Native integration with WebdriverIO test framework
- **JUnit iteration property mapping** - Configurable per-project list of JUnit property/attribute names the importer uses to detect the iteration index — defaults to `iteration`, fully customizable for any CI vocabulary

## Exploratory Testing

### Session-Based Testing

- **Timed sessions** - Create focused exploratory testing sessions with time limits
- **Charter-driven** - Define clear objectives and scope for each session
- **Real-time notes** - Capture observations, issues, and insights as you explore
- **Session reports** - Generate summaries of findings from exploratory sessions

## Project Management

### Milestones

- **Release tracking** - Organize test activities around releases or sprints
- **Progress monitoring** - Track completion status across milestones
- **Due dates** - Set target dates and monitor timeline adherence
- **Alerts** - Receive notifications when milestone due dates are approaching
- **Milestone types** - Define custom milestone categories (releases, sprints, etc.)

### Issue Tracking Integration

- **Jira integration** - Link test cases and results to Jira issues
- **GitHub integration** - Connect with GitHub Issues for defect tracking; supports GitHub Enterprise Server via configurable API base URL
- **GitLab integration** - Link to GitLab.com or self-hosted GitLab issues
- **Gitea / Forgejo / Gogs integration** - Connect to self-hosted Gitea-family issue trackers
- **Azure DevOps integration** - Sync with Azure Boards work items
- **OAuth 2.0 authentication** - Use OAuth for GitHub, GitLab, and Gitea/Forgejo connections (no personal access token required)
- **Two-way sync** - Optional outbound notifications and inbound webhook updates between TestPlanIt and the issue tracker
- **Linked-issue context for AI** - Auto-tag and test case generation pull labels, components, and metadata from linked issues
- **Bi-directional linking** - Navigate seamlessly between tests and issues

## Reporting & Analytics

### Dashboards

- **Project dashboards** - Get an at-a-glance view of testing progress
- **Custom widgets** - Configure dashboards to show the metrics that matter to you
- **Real-time updates** - See live status as testing progresses

### Reports

- **Report builder** - Create custom reports with drag-and-drop interface, including folder and tag dimensions
- **Test run reports** - Detailed breakdowns of test execution results
- **Execution Log report** - Pre-built timeline of every result event with expanded step details
- **Automation Candidates report** - LLM-ranked list of manual cases best suited for automation, drawing on custom field signals and attached-issue metadata
- **Parameter Iteration Matrix** - Pivots per-iteration outcomes across runs for parameterized cases
- **Cross-project reports** - Aggregate results across multiple projects in a single view
- **Coverage analysis** - Understand what has been tested and what remains
- **Trend analysis** - Track quality metrics over time
- **Export options** - Export reports in CSV for stakeholders

### Forecasting

- **Completion predictions** - Estimates of when testing will complete
- **Resource planning** - Plan testing capacity based on historical data

## AI-Powered Features

### LLM Integration

- **Test case generation** - Generate test cases from requirements using AI; optional `includeParameters` toggle (admin-gated) for parameterized output
- **Generate from URL** - Crawl a webpage or sitemap and generate test cases targeting it
- **Generate from the Jira panel** - Create test cases from a Jira issue inside the TestPlanIt for Jira app, streamed live and linked back to the issue
- **Markdown Parsing** - Pasted Markdown is parsed by an LLM into structured cases (name, steps, expected results, custom field values) on the Import Markdown surface
- **QuickScript AI generation** - Convert manual test cases into automation scripts with AI, optionally informed by your code repository (GitHub, GitLab, Bitbucket, Azure DevOps, Gitea/Forgejo/Gogs); ships with templates spanning web, mobile, API, and Mobilewright targets
- **Enhance Writing** - Get AI recommendations to improve writing for any rich text field
- **Magic Select** - AI-assisted test case selection for quickly building test runs
- **Auto Tag** - Automatically suggest and apply tags to test cases, test runs, and sessions using AI analysis; incorporates linked-issue context (Jira labels + components, etc.) for sharper suggestions
- **Duplicate Detection** - LLM-scored semantic similarity layered on top of the syntactic scan so near-duplicates with reworded steps are surfaced too
- **Automation Candidates ranking** - The Automation Candidates report (under [Reports](#reports)) is LLM-ranked over manual cases + their custom fields + drilled-down issue metadata
- **Prompt Configurations** - Per-feature prompt templates that admins can override system-wide or per project
- **Multiple providers** - Support for OpenAI, Azure OpenAI, Anthropic, Google Gemini, Ollama, plus a generic OpenAI-compatible custom endpoint, with per-feature provider routing
- **Privacy options** - Use local models for sensitive data with Ollama integration
- **Capability probing + billing periods** - Admin UI surfaces each provider's available capabilities and tracks usage against custom billing periods

### MCP Server

- **Model Context Protocol** - First-class MCP server exposing TestPlanIt entities as resources and tools so agents (Claude Desktop, Cursor, etc.) can read and edit cases, sessions, runs, and results
- **Auth-aware** - Operates within the calling user's permissions; honors all access policies the rest of the product enforces

## Administration

### User Management

- **Role-based access** - Define custom roles with granular permissions, including a per-area "Can Approve" right for Review & Approval reviewers
- **Groups** - Organize users into groups for easier permission management
- **SSO support** - Integrate with your identity provider via [SAML, Google OAuth, Apple Sign In, or Microsoft (Azure AD)](./user-guide/sso.md). SAML providers expose per-provider `Require signed assertions` and `Require signed response` toggles so a standard IdP that signs only the assertion (Okta's default) works out of the box, and a stricter IdP can require both signatures.
- **SCIM 2.0 provisioning** - Provision, update, and de-provision users and groups from your IdP via [SCIM 2.0](./user-guide/scim.md). Includes a per-token rate limit, a 5-minute coalescing window to avoid first-sync webhook floods, and an admin conflict log surfacing JIT binds, resurrections, and skipped-member operations.
- **Group role mapping** - Drive each user's global access tier (None, User, Project Admin, or Admin) from their [group membership](./user-guide/scim.md#role-mapping), with highest-wins precedence across groups, a configurable fallback default for users outside every mapped group, a downgrade-confirmation guard before any access is lowered, and a manual-override path that hands a user back to admin control.
- **Magic Link sign-in** - Optional passwordless email link as an alternative to password authentication
- **Self-registration toggle** - Admin-controlled switch for letting users create their own accounts (or restricting account creation to admins)

### Customization

- **Custom workflows** - Define status workflows that match your process
- **Custom statuses** - Create statuses with custom icons and colors
- **Templates** - Create templates for consistent test case structure
- **User preferences** - Configure theme, locale, timezone, and date/time formats; preference selections are visible from the profile view as well as the editor
- **Accessible theme** - Opt-in high-contrast theme tuned for WCAG 2.2 Level AA (stronger contrast, larger interactive targets, visible focus), selectable per user without affecting other themes
- **Configurations** - Author OS / browser / environment configurations scoped to projects, with an admin UX overhaul covering bulk assign and search

### Security & Compliance

- **Password policy** - Configure minimum length, character requirements, history depth, and expiration
- **Account lockout** - Protect against brute-force attacks with configurable threshold and duration
- **Password enforcement** - Force password changes (individual or bulk) and revoke passwords
- **Password strength indicator** - Real-time zxcvbn-powered feedback on signup and password change forms
- **Sign-in enforcement** - [Force SSO](./user-guide/security-settings.md#sign-in-enforcement) (disable email/password sign-in), require 2FA for password logins, or require 2FA for all sign-ins including SSO. All three toggles live alongside the password policy on the Security admin page
- **Audit logs** - Track all changes for compliance and security review; covers admin configuration mutations, system-actor attribution, SCIM mutations (filterable by `source = scim` with the originating token id), and a tamper-evident archive surface for long-term retention
- **Two-factor authentication** - Add an extra layer of security for user accounts
- **Data encryption** - Secure data at rest and in transit
- **API tokens** - [Personal and service-account API tokens](./api-tokens.md) with scoped access and revocation

## Collaboration

### Team Features

- **Comments** - Discuss test cases and results with your team
- **Notifications** - Stay informed about changes and assignments via in-app inbox, email, or daily digest
- **Real-time notification delivery** - Server-sent events push the bell badge instantly, no polling
- **@mentions** - Tag team members in discussions
- **Activity feeds** - See recent activity across your projects
- **Localized UI** - Ship-with-product localization for 13 locales including English, German, Spanish, French, Italian, Japanese, Korean, Dutch, Polish, Portuguese (Brazil), Russian, Turkish, Vietnamese, and Simplified + Traditional Chinese

### Import & Export

- **Drag and drop import** - Drag files directly from your desktop onto the Repository or Test Runs page to instantly start an import with the file pre-loaded
- **Bulk import** - Import test cases from CSV with automatic markdown/HTML detection for rich text fields
- **Markdown import** - Paste markdown source directly to seed cases, steps, and documentation pages
- **Test Results import** - Import automated test results via popular formats like JUnit XML
- **TestMo migration** - Special import support for migrating from Testmo
- **Export capabilities** - Export data in CSV or PDF, with markdown format option for rich text fields
- **Data Lake Export** - Project-scoped export endpoints that emit normalized JSON for warehouse pipelines
- **API access** - Full programmatic access to all features

## Webhooks & Extensibility

### Outbound Webhooks

- **Per-project endpoints** - Configure webhook destinations from project settings, with HMAC signing and optional Slack adapter
- **Event catalog** - Subscribe to fine-grained events: case lifecycle, run completion, per-iteration results, session updates, review requests, review decisions, reviewer reminders, and more
- **Per-iteration payloads** - `iteration.result.recorded` event ships per-row values with sensitive parameters redacted
- **Replay + audit** - Failed deliveries are queued, retried with exponential backoff, and replayable from the admin surface; every delivery is audited

### Inbound Webhooks

- **Issue-tracker sync** - Configure inbound webhooks from Jira / GitHub / GitLab / Gitea so issue updates flow back into TestPlanIt
- **Adapter-aware** - The inbound config is keyed to the issue integration so swapping providers cleanly resets the webhook

### Agent Integrations

- **MCP Server** - See [AI-Powered Features → MCP Server](#mcp-server) — first-class Model Context Protocol surface so Claude Desktop, Cursor, and similar agents can read and edit TestPlanIt entities through the same access policies as the UI

## Search & Discovery

- **Advanced search** - Powerful search across all entities with complex filters
- **Global search** - Quick access search from anywhere (Cmd+K / Ctrl+K)
- **Elasticsearch integration** - Full-text search for large datasets
- **Custom field filtering** - Filter by any custom field values

## System & Operations

- **Background job processing** - Asynchronous task processing with BullMQ (workers cover audit, search reindex, email, webhooks, AI, dataset import, and more)
- **System health monitoring** - Monitor system status and queue health
- **Multi-tenancy support** - Optional schema-isolated multi-tenant mode for SaaS deployments
- **External database support** - Run against your own managed PostgreSQL, Redis-compatible cache (Redis/Valkey), and Elasticsearch instances
- **Docker-first deployment** - Production Compose files, recommended ARM + x86 images, and a documented manual setup path
- **Upgrade notifications** - Get notified about new features since the last time you logged in
- **Release notes catalog** - In-app catalog of version-specific marketing copy with one-click jumps to the relevant documentation
