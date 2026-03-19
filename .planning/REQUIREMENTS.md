# Requirements: TestPlanIt

**Defined:** 2026-03-18
**Core Value:** Full test coverage ensuring the software does what we expect across API, component, and E2E layers

## v1.0 Requirements (Complete)

### LLM Feature (Backend)
- [x] **LLM-01**: System can analyze entity content and suggest matching tags
- [x] **LLM-02**: System supports smart batching based on token count
- [x] **LLM-03**: AI can suggest both existing and new tags
- [x] **LLM-04**: Prompt is configurable via prompt config system

### API
- [x] **API-01**: User can request AI tag suggestions for entity IDs
- [x] **API-02**: System processes large batches as background jobs
- [x] **API-03**: User can apply accepted tag suggestions in bulk

### UI - Review Dialog
- [x] **UI-01**: User can review AI-suggested tags per entity
- [x] **UI-02**: User can accept, reject, or modify suggestions
- [x] **UI-03**: New tag suggestions are visually distinct
- [x] **UI-04**: User can apply all accepted suggestions with one action

### UI - Entry Points
- [x] **EP-01**: User can trigger AI tagging from cases list bulk action
- [x] **EP-02**: User can trigger AI tagging from test runs list bulk action
- [x] **EP-03**: User can trigger AI tagging from sessions list bulk action
- [x] **EP-04**: User can trigger AI tagging from tags management page

## v2.0 Requirements

### Authentication & Account Management

- [x] **AUTH-01**: E2E test verifies complete sign-in and sign-out flow with valid and invalid credentials
- [x] **AUTH-02**: E2E test verifies sign-up flow including email verification
- [x] **AUTH-03**: E2E test verifies 2FA setup, verification, and backup code recovery
- [x] **AUTH-04**: E2E test verifies SSO flows (Google, Microsoft, SAML) with mocked providers
- [x] **AUTH-05**: E2E test verifies magic link passwordless authentication
- [x] **AUTH-06**: E2E test verifies password change and session persistence across browser refresh
- [x] **AUTH-07**: Component tests for sign-in page, sign-up page, 2FA setup/verify pages with error states
- [x] **AUTH-08**: API tests verify API token authentication, creation, revocation, and scope enforcement

### Test Case Repository

- [x] **REPO-01**: E2E test verifies test case CRUD (create, view, edit, delete) including all field types
- [ ] **REPO-02**: E2E test verifies folder operations (create, rename, move, delete, nested hierarchy)
- [x] **REPO-03**: E2E test verifies bulk operations (multi-select, bulk edit, bulk delete, bulk move)
- [ ] **REPO-04**: E2E test verifies search and filtering (text search, custom field filters, tag filters, state filters)
- [ ] **REPO-05**: E2E test verifies import/export (CSV, JSON, markdown import and export)
- [x] **REPO-06**: E2E test verifies shared steps (create, use in test cases, edit, version history)
- [ ] **REPO-07**: E2E test verifies version history (view versions, diff, restore previous version)
- [ ] **REPO-08**: E2E test verifies tag management (create, assign, remove, case-insensitive matching)
- [ ] **REPO-09**: E2E test verifies issue linking (attach, navigate, unlink) with mocked integrations
- [ ] **REPO-10**: E2E test verifies drag-and-drop reordering and folder tree navigation
- [x] **REPO-11**: Component tests for test case editor (TipTap rich text, custom fields, steps, attachments)
- [x] **REPO-12**: Component tests for repository table (sorting, pagination, column visibility, view switching)
- [x] **REPO-13**: Component tests for folder tree, breadcrumbs, and navigation components
- [x] **REPO-14**: Hook tests for repository-related hooks (useRepositoryCasesWithFilteredFields, field hooks, filter hooks)

### Test Execution (Runs)

- [x] **RUN-01**: E2E test verifies test run creation wizard (name, milestone, configuration, case selection)
- [x] **RUN-02**: E2E test verifies test case execution (step-by-step result recording, status updates, attachments)
- [x] **RUN-03**: E2E test verifies bulk status updates and case assignment
- [x] **RUN-04**: E2E test verifies test run completion workflow with status enforcement
- [x] **RUN-05**: E2E test verifies multi-configuration test runs (configuration groups)
- [x] **RUN-06**: E2E test verifies test result import (JUnit XML, automation frameworks) via API
- [x] **RUN-07**: Component tests for test run detail view (case list, execution panel, result recording)
- [x] **RUN-08**: Component tests for TestRunCaseDetails, TestResultHistory, result recording forms
- [x] **RUN-09**: Component tests for MagicSelectButton/Dialog (AI-assisted case selection, mocked LLM)
- [x] **RUN-10**: Hook tests for test run related hooks

### Exploratory Sessions

- [x] **SESS-01**: E2E test verifies session creation with template, configuration, and milestone selection
- [x] **SESS-02**: E2E test verifies session execution (add results with status, notes, attachments)
- [x] **SESS-03**: E2E test verifies session completion and session summary view
- [x] **SESS-04**: Component tests for SessionResultForm, SessionResultsList, SessionResultsSummary
- [x] **SESS-05**: Component tests for CompleteSessionDialog with edge cases
- [x] **SESS-06**: Hook tests for session-related hooks

### Project Management

- [x] **PROJ-01**: E2E test verifies project creation wizard (5-step: name, description, template, members, configs)
- [x] **PROJ-02**: E2E test verifies project settings (general, integrations, AI models, quickscript, shares)
- [x] **PROJ-03**: E2E test verifies milestone CRUD (create, edit, nest, complete, cascade delete)
- [x] **PROJ-04**: E2E test verifies project documentation editor (TipTap wiki, AI writing assistant mocked)
- [x] **PROJ-05**: E2E test verifies member management (add, remove, change roles, group assignment)
- [x] **PROJ-06**: E2E test verifies project overview dashboard (stats, recent activity, assignments)
- [x] **PROJ-07**: Component tests for ProjectCard, ProjectMenu, ProjectQuickSelector, project settings forms
- [x] **PROJ-08**: Component tests for milestone components (list, detail, hierarchy, progress tracking)
- [x] **PROJ-09**: Hook tests for project-related hooks (useProjectPermissions and related)

### AI Features

- [x] **AI-01**: E2E test verifies AI test case generation wizard (source input, template, configure, review) with mocked LLM
- [x] **AI-02**: E2E test verifies auto-tag flow (configure, analyze, review suggestions, apply) with mocked LLM
- [x] **AI-03**: E2E test verifies magic select for test runs with mocked LLM
- [x] **AI-04**: E2E test verifies QuickScript generation (template-based and AI-based) with mocked LLM
- [x] **AI-05**: E2E test verifies writing assistant in TipTap editor with mocked LLM
- [x] **AI-06**: Component tests for AutoTagWizardDialog, AutoTagReviewDialog, AutoTagProgress, TagChip
- [x] **AI-07**: Component tests for QuickScript dialog, template selector, AI preview pane
- [x] **AI-08**: API tests for LLM endpoints (generate-test-cases, magic-select, chat, parse-markdown) with mocked providers
- [x] **AI-09**: API tests for auto-tag endpoints (submit, status, cancel, apply) with mocked providers

### Administration

- [x] **ADM-01**: E2E test verifies user management (list, edit, deactivate, reset 2FA, revoke API keys)
- [x] **ADM-02**: E2E test verifies group management (create, edit, assign users, assign to projects)
- [x] **ADM-03**: E2E test verifies role management (create, edit permissions per application area)
- [x] **ADM-04**: E2E test verifies SSO configuration (add/edit providers, force SSO, email domain restrictions)
- [x] **ADM-05**: E2E test verifies workflow management (create, edit, reorder states, assign to projects)
- [x] **ADM-06**: E2E test verifies status management (create, edit, configure flags, scope assignment)
- [x] **ADM-07**: E2E test verifies configuration management (categories, variants, configuration groups)
- [x] **ADM-08**: E2E test verifies audit log viewing, filtering, and CSV export
- [x] **ADM-09**: E2E test verifies Elasticsearch admin (settings, reindex operations)
- [x] **ADM-10**: E2E test verifies LLM integration management (add provider, test connection, per-project assignment)
- [x] **ADM-11**: E2E test verifies app config management (edit_results_duration, project_docs_default)
- [x] **ADM-12**: Component tests for admin pages (QueueManagement, ElasticsearchAdmin, audit log viewer)
- [x] **ADM-13**: Component tests for admin forms (user edit, group edit, role permissions matrix)

### Reporting & Analytics

- [x] **RPT-01**: E2E test verifies report builder (create report, select dimensions/metrics, generate chart)
- [x] **RPT-02**: E2E test verifies pre-built reports (automation trends, flaky tests, test case health, issue coverage)
- [x] **RPT-03**: E2E test verifies report drill-down and filtering
- [ ] **RPT-04**: E2E test verifies share links (create, access public/password-protected/authenticated)
- [x] **RPT-05**: E2E test verifies forecasting (milestone forecast, test case duration estimates)
- [x] **RPT-06**: Component tests for ReportBuilder, ReportChart, DrillDownDrawer, ReportFilters
- [x] **RPT-07**: Component tests for data visualizations (donut, gantt, bubble, sunburst, line, bar charts)
- [x] **RPT-08**: Component tests for share link components (ShareDialog, PasswordGate, SharedReportViewer)

### Search

- [x] **SRCH-01**: E2E test verifies global search (Cmd+K, cross-entity search, result navigation)
- [ ] **SRCH-02**: E2E test verifies advanced search operators (exact phrase, required/excluded terms, wildcards, field:value)
- [x] **SRCH-03**: E2E test verifies faceted search filters (custom field values, tags, states, dates)
- [x] **SRCH-04**: Component tests for UnifiedSearch, GlobalSearchSheet, SearchResultComponents, FacetedSearchFilters
- [ ] **SRCH-05**: Component tests for search result display (CustomFieldDisplay, DateTimeDisplay, UserDisplay)

### Integrations

- [x] **INTG-01**: E2E test verifies issue tracker setup (add Jira/GitHub/Azure DevOps integration) with mocked APIs
- [x] **INTG-02**: E2E test verifies issue operations (create issue, link to test case, sync status) with mocked APIs
- [x] **INTG-03**: E2E test verifies code repository setup and QuickScript file context with mocked APIs
- [x] **INTG-04**: Component tests for issue management components (UnifiedIssueManager, CreateIssueDialog, SearchIssuesDialog)
- [x] **INTG-05**: Component tests for integration configuration forms
- [x] **INTG-06**: API tests for integration endpoints (test-connection, create-issue, search, sync) with mocked externals

### Custom API Routes

- [x] **CAPI-01**: API tests for project endpoints (cases/bulk-edit, cases/fetch-many, folders/stats)
- [x] **CAPI-02**: API tests for test run endpoints (summary, attachments, import, completed, summaries)
- [x] **CAPI-03**: API tests for session endpoints (summary)
- [x] **CAPI-04**: API tests for milestone endpoints (descendants, forecast, summary)
- [x] **CAPI-05**: API tests for share link endpoints (access, password-verify, report data)
- [x] **CAPI-06**: API tests for report builder endpoints (all report types, drill-down queries)
- [x] **CAPI-07**: API tests for admin endpoints (elasticsearch, queues, trash, user management)
- [x] **CAPI-08**: API tests for search endpoint and tag/issue count aggregation endpoints
- [x] **CAPI-09**: API tests for file upload/download endpoints (attachments, avatars, doc images, project icons)
- [x] **CAPI-10**: API tests for health, metadata, and OpenAPI documentation endpoints

### Components (General)

- [x] **COMP-01**: Component tests for Header, UserDropdownMenu, NotificationBell with all states
- [x] **COMP-02**: Component tests for comment system (CommentEditor, CommentList, MentionSuggestion)
- [x] **COMP-03**: Component tests for attachment components (AttachmentsDisplay, UploadAttachments, preview/carousel)
- [x] **COMP-04**: Component tests for DataTable with sorting, filtering, column visibility, row selection
- [x] **COMP-05**: Component tests for form components (ConfigurationSelect, FolderSelect, MilestoneSelect, DatePickerField)
- [x] **COMP-06**: Component tests for onboarding (InitialPreferencesDialog, NextStepOnboarding)
- [x] **COMP-07**: Component tests for TipTap editor extensions (image resize, formatting, tables, code blocks)
- [x] **COMP-08**: Component tests for DnD components (TestCaseDragPreview, WorkflowDragPreview, drag interactions)

### Hooks

- [x] **HOOK-01**: Tests for data fetching hooks (ZenStack generated: useFindMany*, useCreate*, useUpdate*, useDelete*)
- [x] **HOOK-02**: Tests for permission hooks (useProjectPermissions, useUserAccess, role-based hooks)
- [x] **HOOK-03**: Tests for UI state hooks (useExportData, useReportColumns, filter/sort hooks)
- [x] **HOOK-04**: Tests for form hooks (useForm integrations, validation hooks)
- [x] **HOOK-05**: Tests for integration hooks (useAutoTagJob, useIntegration, useLlm hooks)

### Notifications & Collaboration

- [x] **NOTIF-01**: Component tests for NotificationBell, NotificationContent with all notification types
- [x] **NOTIF-02**: Component tests for NotificationPreferences with all delivery mode options
- [x] **NOTIF-03**: API tests for notification dispatch (work assigned, comment mentions, system announcements, milestone reminders)

### Workers & Background Jobs

- [x] **WORK-01**: Unit tests for emailWorker (template rendering, delivery, error handling)
- [x] **WORK-02**: Unit tests for repoCacheWorker (file cache refresh, TTL handling)
- [x] **WORK-03**: Unit tests for autoTagWorker (job processing, progress tracking, cancellation)

## Future Requirements

Deferred to future. Not in current roadmap.

- **PERF-01**: Load test for concurrent API operations
- **VIS-01**: Visual regression tests for all page layouts
- **A11Y-01**: Automated accessibility audit for all pages
- **MOBILE-01**: Responsive layout E2E tests for mobile viewports

## Out of Scope

| Feature | Reason |
|---------|--------|
| Performance/load testing | Functional correctness only for v2.0 |
| Visual regression testing | Would require screenshot comparison tooling |
| Testing ZenStack internals | We test app behavior, not the ORM |
| Testing third-party library internals | We test our integration with them |
| Mobile-specific responsive tests | Desktop-first for now |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 9 | Complete |
| AUTH-02 | Phase 9 | Complete |
| AUTH-03 | Phase 9 | Complete |
| AUTH-04 | Phase 9 | Complete |
| AUTH-05 | Phase 9 | Complete |
| AUTH-06 | Phase 9 | Complete |
| AUTH-07 | Phase 9 | Complete |
| AUTH-08 | Phase 9 | Complete |
| REPO-01 | Phase 10 | Complete |
| REPO-02 | Phase 10 | Pending |
| REPO-03 | Phase 10 | Complete |
| REPO-04 | Phase 10 | Pending |
| REPO-05 | Phase 10 | Pending |
| REPO-06 | Phase 10 | Complete |
| REPO-07 | Phase 10 | Pending |
| REPO-08 | Phase 10 | Pending |
| REPO-09 | Phase 10 | Pending |
| REPO-10 | Phase 10 | Pending |
| REPO-11 | Phase 11 | Complete |
| REPO-12 | Phase 11 | Complete |
| REPO-13 | Phase 11 | Complete |
| REPO-14 | Phase 11 | Complete |
| RUN-01 | Phase 12 | Complete |
| RUN-02 | Phase 12 | Complete |
| RUN-03 | Phase 12 | Complete |
| RUN-04 | Phase 12 | Complete |
| RUN-05 | Phase 12 | Complete |
| RUN-06 | Phase 12 | Complete |
| RUN-07 | Phase 13 | Complete |
| RUN-08 | Phase 13 | Complete |
| RUN-09 | Phase 13 | Complete |
| RUN-10 | Phase 13 | Complete |
| SESS-01 | Phase 13 | Complete |
| SESS-02 | Phase 13 | Complete |
| SESS-03 | Phase 13 | Complete |
| SESS-04 | Phase 13 | Complete |
| SESS-05 | Phase 13 | Complete |
| SESS-06 | Phase 13 | Complete |
| PROJ-01 | Phase 14 | Complete |
| PROJ-02 | Phase 14 | Complete |
| PROJ-03 | Phase 14 | Complete |
| PROJ-04 | Phase 14 | Complete |
| PROJ-05 | Phase 14 | Complete |
| PROJ-06 | Phase 14 | Complete |
| PROJ-07 | Phase 14 | Complete |
| PROJ-08 | Phase 14 | Complete |
| PROJ-09 | Phase 14 | Complete |
| AI-01 | Phase 15 | Complete |
| AI-02 | Phase 15 | Complete |
| AI-03 | Phase 15 | Complete |
| AI-04 | Phase 15 | Complete |
| AI-05 | Phase 15 | Complete |
| AI-06 | Phase 16 | Complete |
| AI-07 | Phase 16 | Complete |
| AI-08 | Phase 15 | Complete |
| AI-09 | Phase 15 | Complete |
| ADM-01 | Phase 17 | Complete |
| ADM-02 | Phase 17 | Complete |
| ADM-03 | Phase 17 | Complete |
| ADM-04 | Phase 17 | Complete |
| ADM-05 | Phase 17 | Complete |
| ADM-06 | Phase 17 | Complete |
| ADM-07 | Phase 17 | Complete |
| ADM-08 | Phase 17 | Complete |
| ADM-09 | Phase 17 | Complete |
| ADM-10 | Phase 17 | Complete |
| ADM-11 | Phase 17 | Complete |
| ADM-12 | Phase 18 | Complete |
| ADM-13 | Phase 18 | Complete |
| RPT-01 | Phase 19 | Complete |
| RPT-02 | Phase 19 | Complete |
| RPT-03 | Phase 19 | Complete |
| RPT-04 | Phase 19 | Pending |
| RPT-05 | Phase 19 | Complete |
| RPT-06 | Phase 19 | Complete |
| RPT-07 | Phase 19 | Complete |
| RPT-08 | Phase 19 | Complete |
| SRCH-01 | Phase 20 | Complete |
| SRCH-02 | Phase 20 | Pending |
| SRCH-03 | Phase 20 | Complete |
| SRCH-04 | Phase 20 | Complete |
| SRCH-05 | Phase 20 | Pending |
| INTG-01 | Phase 21 | Complete |
| INTG-02 | Phase 21 | Complete |
| INTG-03 | Phase 21 | Complete |
| INTG-04 | Phase 21 | Complete |
| INTG-05 | Phase 21 | Complete |
| INTG-06 | Phase 21 | Complete |
| CAPI-01 | Phase 22 | Complete |
| CAPI-02 | Phase 22 | Complete |
| CAPI-03 | Phase 22 | Complete |
| CAPI-04 | Phase 22 | Complete |
| CAPI-05 | Phase 22 | Complete |
| CAPI-06 | Phase 22 | Complete |
| CAPI-07 | Phase 22 | Complete |
| CAPI-08 | Phase 22 | Complete |
| CAPI-09 | Phase 22 | Complete |
| CAPI-10 | Phase 22 | Complete |
| COMP-01 | Phase 23 | Complete |
| COMP-02 | Phase 23 | Complete |
| COMP-03 | Phase 23 | Complete |
| COMP-04 | Phase 23 | Complete |
| COMP-05 | Phase 23 | Complete |
| COMP-06 | Phase 23 | Complete |
| COMP-07 | Phase 23 | Complete |
| COMP-08 | Phase 23 | Complete |
| HOOK-01 | Phase 24 | Complete |
| HOOK-02 | Phase 24 | Complete |
| HOOK-03 | Phase 24 | Complete |
| HOOK-04 | Phase 24 | Complete |
| HOOK-05 | Phase 24 | Complete |
| NOTIF-01 | Phase 24 | Complete |
| NOTIF-02 | Phase 24 | Complete |
| NOTIF-03 | Phase 24 | Complete |
| WORK-01 | Phase 24 | Complete |
| WORK-02 | Phase 24 | Complete |
| WORK-03 | Phase 24 | Complete |

**Coverage:**

- v1.0 requirements: 15 total (all complete)
- v2.0 requirements: 89 total
- Mapped to phases: 89
- Unmapped: 0

---

*Requirements defined: 2026-03-18*
*Last updated: 2026-03-18 after v2.0 roadmap creation*
