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

- [ ] **REPO-01**: E2E test verifies test case CRUD (create, view, edit, delete) including all field types
- [ ] **REPO-02**: E2E test verifies folder operations (create, rename, move, delete, nested hierarchy)
- [ ] **REPO-03**: E2E test verifies bulk operations (multi-select, bulk edit, bulk delete, bulk move)
- [ ] **REPO-04**: E2E test verifies search and filtering (text search, custom field filters, tag filters, state filters)
- [ ] **REPO-05**: E2E test verifies import/export (CSV, JSON, markdown import and export)
- [ ] **REPO-06**: E2E test verifies shared steps (create, use in test cases, edit, version history)
- [ ] **REPO-07**: E2E test verifies version history (view versions, diff, restore previous version)
- [ ] **REPO-08**: E2E test verifies tag management (create, assign, remove, case-insensitive matching)
- [ ] **REPO-09**: E2E test verifies issue linking (attach, navigate, unlink) with mocked integrations
- [ ] **REPO-10**: E2E test verifies drag-and-drop reordering and folder tree navigation
- [ ] **REPO-11**: Component tests for test case editor (TipTap rich text, custom fields, steps, attachments)
- [ ] **REPO-12**: Component tests for repository table (sorting, pagination, column visibility, view switching)
- [ ] **REPO-13**: Component tests for folder tree, breadcrumbs, and navigation components
- [ ] **REPO-14**: Hook tests for repository-related hooks (useRepositoryCasesWithFilteredFields, field hooks, filter hooks)

### Test Execution (Runs)

- [ ] **RUN-01**: E2E test verifies test run creation wizard (name, milestone, configuration, case selection)
- [ ] **RUN-02**: E2E test verifies test case execution (step-by-step result recording, status updates, attachments)
- [ ] **RUN-03**: E2E test verifies bulk status updates and case assignment
- [ ] **RUN-04**: E2E test verifies test run completion workflow with status enforcement
- [ ] **RUN-05**: E2E test verifies multi-configuration test runs (configuration groups)
- [ ] **RUN-06**: E2E test verifies test result import (JUnit XML, automation frameworks) via API
- [ ] **RUN-07**: Component tests for test run detail view (case list, execution panel, result recording)
- [ ] **RUN-08**: Component tests for TestRunCaseDetails, TestResultHistory, result recording forms
- [ ] **RUN-09**: Component tests for MagicSelectButton/Dialog (AI-assisted case selection, mocked LLM)
- [ ] **RUN-10**: Hook tests for test run related hooks

### Exploratory Sessions

- [ ] **SESS-01**: E2E test verifies session creation with template, configuration, and milestone selection
- [ ] **SESS-02**: E2E test verifies session execution (add results with status, notes, attachments)
- [ ] **SESS-03**: E2E test verifies session completion and session summary view
- [ ] **SESS-04**: Component tests for SessionResultForm, SessionResultsList, SessionResultsSummary
- [ ] **SESS-05**: Component tests for CompleteSessionDialog with edge cases
- [ ] **SESS-06**: Hook tests for session-related hooks

### Project Management

- [ ] **PROJ-01**: E2E test verifies project creation wizard (5-step: name, description, template, members, configs)
- [ ] **PROJ-02**: E2E test verifies project settings (general, integrations, AI models, quickscript, shares)
- [ ] **PROJ-03**: E2E test verifies milestone CRUD (create, edit, nest, complete, cascade delete)
- [ ] **PROJ-04**: E2E test verifies project documentation editor (TipTap wiki, AI writing assistant mocked)
- [ ] **PROJ-05**: E2E test verifies member management (add, remove, change roles, group assignment)
- [ ] **PROJ-06**: E2E test verifies project overview dashboard (stats, recent activity, assignments)
- [ ] **PROJ-07**: Component tests for ProjectCard, ProjectMenu, ProjectQuickSelector, project settings forms
- [ ] **PROJ-08**: Component tests for milestone components (list, detail, hierarchy, progress tracking)
- [ ] **PROJ-09**: Hook tests for project-related hooks (useProjectPermissions and related)

### AI Features

- [ ] **AI-01**: E2E test verifies AI test case generation wizard (source input, template, configure, review) with mocked LLM
- [ ] **AI-02**: E2E test verifies auto-tag flow (configure, analyze, review suggestions, apply) with mocked LLM
- [ ] **AI-03**: E2E test verifies magic select for test runs with mocked LLM
- [ ] **AI-04**: E2E test verifies QuickScript generation (template-based and AI-based) with mocked LLM
- [ ] **AI-05**: E2E test verifies writing assistant in TipTap editor with mocked LLM
- [ ] **AI-06**: Component tests for AutoTagWizardDialog, AutoTagReviewDialog, AutoTagProgress, TagChip
- [ ] **AI-07**: Component tests for QuickScript dialog, template selector, AI preview pane
- [ ] **AI-08**: API tests for LLM endpoints (generate-test-cases, magic-select, chat, parse-markdown) with mocked providers
- [ ] **AI-09**: API tests for auto-tag endpoints (submit, status, cancel, apply) with mocked providers

### Administration

- [ ] **ADM-01**: E2E test verifies user management (list, edit, deactivate, reset 2FA, revoke API keys)
- [ ] **ADM-02**: E2E test verifies group management (create, edit, assign users, assign to projects)
- [ ] **ADM-03**: E2E test verifies role management (create, edit permissions per application area)
- [ ] **ADM-04**: E2E test verifies SSO configuration (add/edit providers, force SSO, email domain restrictions)
- [ ] **ADM-05**: E2E test verifies workflow management (create, edit, reorder states, assign to projects)
- [ ] **ADM-06**: E2E test verifies status management (create, edit, configure flags, scope assignment)
- [ ] **ADM-07**: E2E test verifies configuration management (categories, variants, configuration groups)
- [ ] **ADM-08**: E2E test verifies audit log viewing, filtering, and CSV export
- [ ] **ADM-09**: E2E test verifies Elasticsearch admin (settings, reindex operations)
- [ ] **ADM-10**: E2E test verifies LLM integration management (add provider, test connection, per-project assignment)
- [ ] **ADM-11**: E2E test verifies app config management (edit_results_duration, project_docs_default)
- [ ] **ADM-12**: Component tests for admin pages (QueueManagement, ElasticsearchAdmin, audit log viewer)
- [ ] **ADM-13**: Component tests for admin forms (user edit, group edit, role permissions matrix)

### Reporting & Analytics

- [ ] **RPT-01**: E2E test verifies report builder (create report, select dimensions/metrics, generate chart)
- [ ] **RPT-02**: E2E test verifies pre-built reports (automation trends, flaky tests, test case health, issue coverage)
- [ ] **RPT-03**: E2E test verifies report drill-down and filtering
- [ ] **RPT-04**: E2E test verifies share links (create, access public/password-protected/authenticated)
- [ ] **RPT-05**: E2E test verifies forecasting (milestone forecast, test case duration estimates)
- [ ] **RPT-06**: Component tests for ReportBuilder, ReportChart, DrillDownDrawer, ReportFilters
- [ ] **RPT-07**: Component tests for data visualizations (donut, gantt, bubble, sunburst, line, bar charts)
- [ ] **RPT-08**: Component tests for share link components (ShareDialog, PasswordGate, SharedReportViewer)

### Search

- [ ] **SRCH-01**: E2E test verifies global search (Cmd+K, cross-entity search, result navigation)
- [ ] **SRCH-02**: E2E test verifies advanced search operators (exact phrase, required/excluded terms, wildcards, field:value)
- [ ] **SRCH-03**: E2E test verifies faceted search filters (custom field values, tags, states, dates)
- [ ] **SRCH-04**: Component tests for UnifiedSearch, GlobalSearchSheet, SearchResultComponents, FacetedSearchFilters
- [ ] **SRCH-05**: Component tests for search result display (CustomFieldDisplay, DateTimeDisplay, UserDisplay)

### Integrations

- [ ] **INTG-01**: E2E test verifies issue tracker setup (add Jira/GitHub/Azure DevOps integration) with mocked APIs
- [ ] **INTG-02**: E2E test verifies issue operations (create issue, link to test case, sync status) with mocked APIs
- [ ] **INTG-03**: E2E test verifies code repository setup and QuickScript file context with mocked APIs
- [ ] **INTG-04**: Component tests for issue management components (UnifiedIssueManager, CreateIssueDialog, SearchIssuesDialog)
- [ ] **INTG-05**: Component tests for integration configuration forms
- [ ] **INTG-06**: API tests for integration endpoints (test-connection, create-issue, search, sync) with mocked externals

### Custom API Routes

- [ ] **CAPI-01**: API tests for project endpoints (cases/bulk-edit, cases/fetch-many, folders/stats)
- [ ] **CAPI-02**: API tests for test run endpoints (summary, attachments, import, completed, summaries)
- [ ] **CAPI-03**: API tests for session endpoints (summary)
- [ ] **CAPI-04**: API tests for milestone endpoints (descendants, forecast, summary)
- [ ] **CAPI-05**: API tests for share link endpoints (access, password-verify, report data)
- [ ] **CAPI-06**: API tests for report builder endpoints (all report types, drill-down queries)
- [ ] **CAPI-07**: API tests for admin endpoints (elasticsearch, queues, trash, user management)
- [ ] **CAPI-08**: API tests for search endpoint and tag/issue count aggregation endpoints
- [ ] **CAPI-09**: API tests for file upload/download endpoints (attachments, avatars, doc images, project icons)
- [ ] **CAPI-10**: API tests for health, metadata, and OpenAPI documentation endpoints

### Components (General)

- [ ] **COMP-01**: Component tests for Header, UserDropdownMenu, NotificationBell with all states
- [ ] **COMP-02**: Component tests for comment system (CommentEditor, CommentList, MentionSuggestion)
- [ ] **COMP-03**: Component tests for attachment components (AttachmentsDisplay, UploadAttachments, preview/carousel)
- [ ] **COMP-04**: Component tests for DataTable with sorting, filtering, column visibility, row selection
- [ ] **COMP-05**: Component tests for form components (ConfigurationSelect, FolderSelect, MilestoneSelect, DatePickerField)
- [ ] **COMP-06**: Component tests for onboarding (InitialPreferencesDialog, NextStepOnboarding)
- [ ] **COMP-07**: Component tests for TipTap editor extensions (image resize, formatting, tables, code blocks)
- [ ] **COMP-08**: Component tests for DnD components (TestCaseDragPreview, WorkflowDragPreview, drag interactions)

### Hooks

- [ ] **HOOK-01**: Tests for data fetching hooks (ZenStack generated: useFindMany*, useCreate*, useUpdate*, useDelete*)
- [ ] **HOOK-02**: Tests for permission hooks (useProjectPermissions, useUserAccess, role-based hooks)
- [ ] **HOOK-03**: Tests for UI state hooks (useExportData, useReportColumns, filter/sort hooks)
- [ ] **HOOK-04**: Tests for form hooks (useForm integrations, validation hooks)
- [ ] **HOOK-05**: Tests for integration hooks (useAutoTagJob, useIntegration, useLlm hooks)

### Notifications & Collaboration

- [ ] **NOTIF-01**: Component tests for NotificationBell, NotificationContent with all notification types
- [ ] **NOTIF-02**: Component tests for NotificationPreferences with all delivery mode options
- [ ] **NOTIF-03**: API tests for notification dispatch (work assigned, comment mentions, system announcements, milestone reminders)

### Workers & Background Jobs

- [ ] **WORK-01**: Unit tests for emailWorker (template rendering, delivery, error handling)
- [ ] **WORK-02**: Unit tests for repoCacheWorker (file cache refresh, TTL handling)
- [ ] **WORK-03**: Unit tests for autoTagWorker (job processing, progress tracking, cancellation)

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
| REPO-01 | Phase 10 | Pending |
| REPO-02 | Phase 10 | Pending |
| REPO-03 | Phase 10 | Pending |
| REPO-04 | Phase 10 | Pending |
| REPO-05 | Phase 10 | Pending |
| REPO-06 | Phase 10 | Pending |
| REPO-07 | Phase 10 | Pending |
| REPO-08 | Phase 10 | Pending |
| REPO-09 | Phase 10 | Pending |
| REPO-10 | Phase 10 | Pending |
| REPO-11 | Phase 11 | Pending |
| REPO-12 | Phase 11 | Pending |
| REPO-13 | Phase 11 | Pending |
| REPO-14 | Phase 11 | Pending |
| RUN-01 | Phase 12 | Pending |
| RUN-02 | Phase 12 | Pending |
| RUN-03 | Phase 12 | Pending |
| RUN-04 | Phase 12 | Pending |
| RUN-05 | Phase 12 | Pending |
| RUN-06 | Phase 12 | Pending |
| RUN-07 | Phase 13 | Pending |
| RUN-08 | Phase 13 | Pending |
| RUN-09 | Phase 13 | Pending |
| RUN-10 | Phase 13 | Pending |
| SESS-01 | Phase 13 | Pending |
| SESS-02 | Phase 13 | Pending |
| SESS-03 | Phase 13 | Pending |
| SESS-04 | Phase 13 | Pending |
| SESS-05 | Phase 13 | Pending |
| SESS-06 | Phase 13 | Pending |
| PROJ-01 | Phase 14 | Pending |
| PROJ-02 | Phase 14 | Pending |
| PROJ-03 | Phase 14 | Pending |
| PROJ-04 | Phase 14 | Pending |
| PROJ-05 | Phase 14 | Pending |
| PROJ-06 | Phase 14 | Pending |
| PROJ-07 | Phase 14 | Pending |
| PROJ-08 | Phase 14 | Pending |
| PROJ-09 | Phase 14 | Pending |
| AI-01 | Phase 15 | Pending |
| AI-02 | Phase 15 | Pending |
| AI-03 | Phase 15 | Pending |
| AI-04 | Phase 15 | Pending |
| AI-05 | Phase 15 | Pending |
| AI-06 | Phase 16 | Pending |
| AI-07 | Phase 16 | Pending |
| AI-08 | Phase 15 | Pending |
| AI-09 | Phase 15 | Pending |
| ADM-01 | Phase 17 | Pending |
| ADM-02 | Phase 17 | Pending |
| ADM-03 | Phase 17 | Pending |
| ADM-04 | Phase 17 | Pending |
| ADM-05 | Phase 17 | Pending |
| ADM-06 | Phase 17 | Pending |
| ADM-07 | Phase 17 | Pending |
| ADM-08 | Phase 17 | Pending |
| ADM-09 | Phase 17 | Pending |
| ADM-10 | Phase 17 | Pending |
| ADM-11 | Phase 17 | Pending |
| ADM-12 | Phase 18 | Pending |
| ADM-13 | Phase 18 | Pending |
| RPT-01 | Phase 19 | Pending |
| RPT-02 | Phase 19 | Pending |
| RPT-03 | Phase 19 | Pending |
| RPT-04 | Phase 19 | Pending |
| RPT-05 | Phase 19 | Pending |
| RPT-06 | Phase 19 | Pending |
| RPT-07 | Phase 19 | Pending |
| RPT-08 | Phase 19 | Pending |
| SRCH-01 | Phase 20 | Pending |
| SRCH-02 | Phase 20 | Pending |
| SRCH-03 | Phase 20 | Pending |
| SRCH-04 | Phase 20 | Pending |
| SRCH-05 | Phase 20 | Pending |
| INTG-01 | Phase 21 | Pending |
| INTG-02 | Phase 21 | Pending |
| INTG-03 | Phase 21 | Pending |
| INTG-04 | Phase 21 | Pending |
| INTG-05 | Phase 21 | Pending |
| INTG-06 | Phase 21 | Pending |
| CAPI-01 | Phase 22 | Pending |
| CAPI-02 | Phase 22 | Pending |
| CAPI-03 | Phase 22 | Pending |
| CAPI-04 | Phase 22 | Pending |
| CAPI-05 | Phase 22 | Pending |
| CAPI-06 | Phase 22 | Pending |
| CAPI-07 | Phase 22 | Pending |
| CAPI-08 | Phase 22 | Pending |
| CAPI-09 | Phase 22 | Pending |
| CAPI-10 | Phase 22 | Pending |
| COMP-01 | Phase 23 | Pending |
| COMP-02 | Phase 23 | Pending |
| COMP-03 | Phase 23 | Pending |
| COMP-04 | Phase 23 | Pending |
| COMP-05 | Phase 23 | Pending |
| COMP-06 | Phase 23 | Pending |
| COMP-07 | Phase 23 | Pending |
| COMP-08 | Phase 23 | Pending |
| HOOK-01 | Phase 24 | Pending |
| HOOK-02 | Phase 24 | Pending |
| HOOK-03 | Phase 24 | Pending |
| HOOK-04 | Phase 24 | Pending |
| HOOK-05 | Phase 24 | Pending |
| NOTIF-01 | Phase 24 | Pending |
| NOTIF-02 | Phase 24 | Pending |
| NOTIF-03 | Phase 24 | Pending |
| WORK-01 | Phase 24 | Pending |
| WORK-02 | Phase 24 | Pending |
| WORK-03 | Phase 24 | Pending |

**Coverage:**

- v1.0 requirements: 15 total (all complete)
- v2.0 requirements: 89 total
- Mapped to phases: 89
- Unmapped: 0

---

*Requirements defined: 2026-03-18*
*Last updated: 2026-03-18 after v2.0 roadmap creation*
