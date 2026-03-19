# Roadmap: TestPlanIt

## Milestones

- ✅ **v1.0 AI Bulk Auto-Tagging** - Phases 1-4 (shipped 2026-03-08)
- ✅ **v1.1 ZenStack Upgrade Regression Tests** - Phases 5-8 (shipped 2026-03-17)
- 📋 **v2.0 Comprehensive Test Coverage** - Phases 9-24 (planned)
- 🚧 **v2.1 Per-Project Export Template Assignment** - Phases 25-27 (in progress)

## Phases

<details>
<summary>✅ v1.0 AI Bulk Auto-Tagging (Phases 1-4) - SHIPPED 2026-03-08</summary>

- [x] **Phase 1: Schema Foundation** - Data model supports AI tag suggestions
- [x] **Phase 2: Alert Service and Pipeline** - Background job pipeline processes tag suggestions
- [x] **Phase 3: Settings Page UI** - Users can configure AI tagging from settings
- [x] **Phase 4: (v1.0 complete)** - Milestone wrap-up

</details>

<details>
<summary>✅ v1.1 ZenStack Upgrade Regression Tests (Phases 5-8) - SHIPPED 2026-03-17</summary>

- [x] **Phase 5: CRUD Operations** - ZenStack v3 CRUD regression tests
- [x] **Phase 6: Relations and Queries** - Relation query regression tests
- [x] **Phase 7: Access Control** - Access control regression tests
- [x] **Phase 8: Error Handling and Batch Operations** - Error handling and batch regression tests

</details>

### 📋 v2.0 Comprehensive Test Coverage (Phases 9-24)

- [x] **Phase 9: Authentication E2E and API Tests** - All auth flows and API token behavior verified (completed 2026-03-19)
- [ ] **Phase 10: Test Case Repository E2E Tests** - All repository workflows verified end-to-end
- [ ] **Phase 11: Repository Components and Hooks** - Repository UI components and hooks tested with edge cases
- [ ] **Phase 12: Test Execution E2E Tests** - Test run creation and execution workflows verified
- [ ] **Phase 13: Run Components, Sessions E2E, and Session Components** - Run UI components and session workflows verified
- [ ] **Phase 14: Project Management E2E and Components** - Project workflows verified with component coverage
- [ ] **Phase 15: AI Feature E2E and API Tests** - AI features verified end-to-end and via API with mocked LLM
- [ ] **Phase 16: AI Component Tests** - AI UI components tested with all states and mocked data
- [ ] **Phase 17: Administration E2E Tests** - All admin management workflows verified end-to-end
- [ ] **Phase 18: Administration Component Tests** - Admin UI components tested with all states
- [ ] **Phase 19: Reporting E2E and Component Tests** - Reporting and analytics verified with component coverage
- [ ] **Phase 20: Search E2E and Component Tests** - Search functionality verified end-to-end and via components
- [ ] **Phase 21: Integrations E2E, Components, and API Tests** - Integration workflows verified across all layers
- [ ] **Phase 22: Custom API Route Tests** - All custom API endpoints verified with auth and error handling
- [ ] **Phase 23: General Components** - Shared UI components tested with edge cases and accessibility
- [ ] **Phase 24: Hooks, Notifications, and Workers** - Custom hooks, notification flows, and workers unit tested

### 🚧 v2.1 Per-Project Export Template Assignment (Phases 25-27)

**Milestone Goal:** Allow admins to assign specific Case Export Templates to individual projects and set a per-project default, so users only see relevant templates when exporting.

- [x] **Phase 25: Default Template Schema** - Project model extended with optional default export template relation (completed 2026-03-19)
- [x] **Phase 26: Admin Assignment UI** - Admin can assign, unassign, and set a default export template per project (completed 2026-03-19)
- [x] **Phase 27: Export Dialog Filtering** - Export dialog shows only project-assigned templates with project default pre-selected (completed 2026-03-19)

## Phase Details

### Phase 9: Authentication E2E and API Tests
**Goal**: All authentication flows are verified end-to-end and API token behavior is confirmed
**Depends on**: Phase 8 (v1.1 complete)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07, AUTH-08
**Success Criteria** (what must be TRUE):
  1. E2E test passes for sign-in/sign-out with valid credentials and correctly rejects invalid credentials
  2. E2E test passes for the complete sign-up flow including email verification
  3. E2E test passes for 2FA (setup, code entry, backup code recovery) with mocked authenticator
  4. E2E tests pass for magic link, SSO (Google/Microsoft/SAML), and password change with session persistence
  5. Component tests pass for all auth pages covering error states, and API tests confirm token auth, creation, revocation, and scope enforcement
**Plans:** 4/4 plans complete

Plans:
- [ ] 09-01-PLAN.md -- Sign-in/sign-out and sign-up with email verification E2E tests
- [ ] 09-02-PLAN.md -- 2FA, SSO, magic link, and password change E2E tests
- [ ] 09-03-PLAN.md -- Auth page component tests (signin, signup, 2FA setup, 2FA verify)
- [ ] 09-04-PLAN.md -- API token authentication, creation, revocation, and scope tests

### Phase 10: Test Case Repository E2E Tests
**Goal**: All test case repository workflows are verified end-to-end
**Depends on**: Phase 9
**Requirements**: REPO-01, REPO-02, REPO-03, REPO-04, REPO-05, REPO-06, REPO-07, REPO-08, REPO-09, REPO-10
**Success Criteria** (what must be TRUE):
  1. E2E tests pass for test case CRUD including all custom field types (text, select, date, user, etc.)
  2. E2E tests pass for folder operations including create, rename, move, delete, and nested hierarchies
  3. E2E tests pass for bulk operations (multi-select, bulk edit, bulk delete, bulk move to folder)
  4. E2E tests pass for search/filter (text search, custom field filters, tag filters, state filters) and import/export (CSV, JSON, markdown)
  5. E2E tests pass for shared steps, version history, tag management, issue linking, and drag-and-drop reordering
**Plans**: 2 plans

Plans:
- [ ] 10-01-PLAN.md -- Gap-fill: test case edit/delete and bulk move to folder
- [ ] 10-02-PLAN.md -- Gap-fill: shared steps CRUD and versioning

### Phase 11: Repository Components and Hooks
**Goal**: Test case repository UI components and data hooks are fully tested with edge cases
**Depends on**: Phase 10
**Requirements**: REPO-11, REPO-12, REPO-13, REPO-14
**Success Criteria** (what must be TRUE):
  1. Component tests pass for the test case editor covering TipTap rich text, custom fields, steps, and attachment uploads
  2. Component tests pass for the repository table covering sorting, pagination, column visibility, and view switching
  3. Component tests pass for folder tree, breadcrumbs, and navigation with empty and nested states
  4. Hook tests pass for useRepositoryCasesWithFilteredFields, field hooks, and filter hooks with mock data
**Plans**: 2 plans

Plans:
- [ ] 10-01-PLAN.md -- Gap-fill: test case edit/delete and bulk move to folder
- [ ] 10-02-PLAN.md -- Gap-fill: shared steps CRUD and versioning

### Phase 12: Test Execution E2E Tests
**Goal**: All test run creation and execution workflows are verified end-to-end
**Depends on**: Phase 10
**Requirements**: RUN-01, RUN-02, RUN-03, RUN-04, RUN-05, RUN-06
**Success Criteria** (what must be TRUE):
  1. E2E test passes for the test run creation wizard (name, milestone, configuration group, case selection)
  2. E2E test passes for step-by-step case execution including result recording, status updates, and attachments
  3. E2E test passes for bulk status updates and case assignment across multiple cases in a run
  4. E2E test passes for run completion workflow with status enforcement and multi-configuration test runs
  5. E2E test passes for test result import via API (JUnit XML format)
**Plans**: 2 plans

Plans:
- [ ] 10-01-PLAN.md -- Gap-fill: test case edit/delete and bulk move to folder
- [ ] 10-02-PLAN.md -- Gap-fill: shared steps CRUD and versioning

### Phase 13: Run Components, Sessions E2E, and Session Components
**Goal**: Test run UI components and all exploratory session workflows are verified
**Depends on**: Phase 12
**Requirements**: RUN-07, RUN-08, RUN-09, RUN-10, SESS-01, SESS-02, SESS-03, SESS-04, SESS-05, SESS-06
**Success Criteria** (what must be TRUE):
  1. Component tests pass for test run detail view (case list, execution panel, result recording) including TestRunCaseDetails and TestResultHistory
  2. Component tests pass for MagicSelectButton/Dialog with mocked LLM responses covering success, loading, and error states
  3. E2E tests pass for session creation with template, configuration, and milestone selection
  4. E2E tests pass for session execution (add results with status/notes/attachments) and session completion with summary view
  5. Component and hook tests pass for SessionResultForm, SessionResultsList, CompleteSessionDialog, and session hooks
**Plans**: 2 plans

Plans:
- [ ] 10-01-PLAN.md -- Gap-fill: test case edit/delete and bulk move to folder
- [ ] 10-02-PLAN.md -- Gap-fill: shared steps CRUD and versioning

### Phase 14: Project Management E2E and Components
**Goal**: All project management workflows are verified end-to-end with component coverage
**Depends on**: Phase 9
**Requirements**: PROJ-01, PROJ-02, PROJ-03, PROJ-04, PROJ-05, PROJ-06, PROJ-07, PROJ-08, PROJ-09
**Success Criteria** (what must be TRUE):
  1. E2E test passes for the 5-step project creation wizard (name, description, template, members, configurations)
  2. E2E tests pass for project settings (general, integrations, AI models, quickscript, share links)
  3. E2E tests pass for milestone CRUD (create, edit, nest, complete, cascade delete) and project documentation editor with mocked AI writing assistant
  4. E2E tests pass for member management (add, remove, role changes) and project overview dashboard (stats, activity, assignments)
  5. Component and hook tests pass for ProjectCard, ProjectMenu, milestone components, and project permission hooks
**Plans**: 2 plans

Plans:
- [ ] 10-01-PLAN.md -- Gap-fill: test case edit/delete and bulk move to folder
- [ ] 10-02-PLAN.md -- Gap-fill: shared steps CRUD and versioning

### Phase 15: AI Feature E2E and API Tests
**Goal**: All AI-powered features are verified end-to-end and via API with mocked LLM providers
**Depends on**: Phase 9
**Requirements**: AI-01, AI-02, AI-03, AI-04, AI-05, AI-08, AI-09
**Success Criteria** (what must be TRUE):
  1. E2E test passes for AI test case generation wizard (source input, template, configure, review) with mocked LLM
  2. E2E test passes for auto-tag flow (configure, analyze, review suggestions, apply) with mocked LLM
  3. E2E test passes for magic select in test runs and QuickScript generation with mocked LLM
  4. E2E test passes for writing assistant in TipTap editor with mocked LLM
  5. API tests pass for all LLM and auto-tag endpoints (generate-test-cases, magic-select, chat, parse-markdown, submit, status, cancel, apply)
**Plans**: 2 plans

Plans:
- [ ] 10-01-PLAN.md -- Gap-fill: test case edit/delete and bulk move to folder
- [ ] 10-02-PLAN.md -- Gap-fill: shared steps CRUD and versioning

### Phase 16: AI Component Tests
**Goal**: All AI feature UI components are tested with edge cases and mocked data
**Depends on**: Phase 15
**Requirements**: AI-06, AI-07
**Success Criteria** (what must be TRUE):
  1. Component tests pass for AutoTagWizardDialog, AutoTagReviewDialog, AutoTagProgress, and TagChip covering all states (loading, empty, error, success)
  2. Component tests pass for QuickScript dialog, template selector, and AI preview pane with mocked LLM responses
**Plans**: 2 plans

Plans:
- [ ] 10-01-PLAN.md -- Gap-fill: test case edit/delete and bulk move to folder
- [ ] 10-02-PLAN.md -- Gap-fill: shared steps CRUD and versioning

### Phase 17: Administration E2E Tests
**Goal**: All admin management workflows are verified end-to-end
**Depends on**: Phase 9
**Requirements**: ADM-01, ADM-02, ADM-03, ADM-04, ADM-05, ADM-06, ADM-07, ADM-08, ADM-09, ADM-10, ADM-11
**Success Criteria** (what must be TRUE):
  1. E2E tests pass for user management (list, edit, deactivate, reset 2FA, revoke API keys) and group management (create, edit, assign users, assign to projects)
  2. E2E tests pass for role management (create, edit permissions per area) and SSO configuration (add/edit providers, force SSO, email domain restrictions)
  3. E2E tests pass for workflow management (create, edit, reorder states) and status management (create, edit flags, scope assignment)
  4. E2E tests pass for configuration management (categories, variants, groups) and audit log (view, filter, CSV export)
  5. E2E tests pass for Elasticsearch admin (settings, reindex), LLM integration management, and app config management
**Plans**: 2 plans

Plans:
- [ ] 10-01-PLAN.md -- Gap-fill: test case edit/delete and bulk move to folder
- [ ] 10-02-PLAN.md -- Gap-fill: shared steps CRUD and versioning

### Phase 18: Administration Component Tests
**Goal**: Admin UI components are tested with all states and form interactions
**Depends on**: Phase 17
**Requirements**: ADM-12, ADM-13
**Success Criteria** (what must be TRUE):
  1. Component tests pass for QueueManagement, ElasticsearchAdmin, and audit log viewer covering loading, empty, error, and populated states
  2. Component tests pass for user edit form, group edit form, and role permissions matrix covering validation and error states
**Plans**: 2 plans

Plans:
- [ ] 10-01-PLAN.md -- Gap-fill: test case edit/delete and bulk move to folder
- [ ] 10-02-PLAN.md -- Gap-fill: shared steps CRUD and versioning

### Phase 19: Reporting E2E and Component Tests
**Goal**: All reporting and analytics workflows are verified with component coverage
**Depends on**: Phase 9
**Requirements**: RPT-01, RPT-02, RPT-03, RPT-04, RPT-05, RPT-06, RPT-07, RPT-08
**Success Criteria** (what must be TRUE):
  1. E2E test passes for the report builder (create report, select dimensions/metrics, generate chart)
  2. E2E tests pass for pre-built reports (automation trends, flaky tests, test case health, issue coverage) and report drill-down/filtering
  3. E2E tests pass for share links (create, access public/password-protected/authenticated) and forecasting (milestone forecast, duration estimates)
  4. Component tests pass for ReportBuilder, ReportChart, DrillDownDrawer, and ReportFilters with all data states
  5. Component tests pass for all chart types (donut, gantt, bubble, sunburst, line, bar) and share link components (ShareDialog, PasswordGate, SharedReportViewer)
**Plans**: 2 plans

Plans:
- [ ] 10-01-PLAN.md -- Gap-fill: test case edit/delete and bulk move to folder
- [ ] 10-02-PLAN.md -- Gap-fill: shared steps CRUD and versioning

### Phase 20: Search E2E and Component Tests
**Goal**: All search functionality is verified end-to-end with component coverage
**Depends on**: Phase 9
**Requirements**: SRCH-01, SRCH-02, SRCH-03, SRCH-04, SRCH-05
**Success Criteria** (what must be TRUE):
  1. E2E test passes for global search (Cmd+K, cross-entity results, result navigation to correct page)
  2. E2E tests pass for advanced search operators (exact phrase, required/excluded terms, wildcards, field:value syntax)
  3. E2E test passes for faceted search filters (custom field values, tags, states, date ranges)
  4. Component tests pass for UnifiedSearch, GlobalSearchSheet, search result components, and FacetedSearchFilters with all data states
  5. Component tests pass for result display components (CustomFieldDisplay, DateTimeDisplay, UserDisplay) covering all field types
**Plans**: 2 plans

Plans:
- [ ] 10-01-PLAN.md -- Gap-fill: test case edit/delete and bulk move to folder
- [ ] 10-02-PLAN.md -- Gap-fill: shared steps CRUD and versioning

### Phase 21: Integrations E2E, Components, and API Tests
**Goal**: All third-party integration workflows are verified end-to-end with component and API coverage
**Depends on**: Phase 9
**Requirements**: INTG-01, INTG-02, INTG-03, INTG-04, INTG-05, INTG-06
**Success Criteria** (what must be TRUE):
  1. E2E tests pass for issue tracker setup (Jira, GitHub, Azure DevOps) and issue operations (create, link, sync status) with mocked APIs
  2. E2E test passes for code repository setup and QuickScript file context with mocked APIs
  3. Component tests pass for UnifiedIssueManager, CreateIssueDialog, SearchIssuesDialog, and integration configuration forms
  4. API tests pass for integration endpoints (test-connection, create-issue, search, sync) with mocked external services
**Plans**: 2 plans

Plans:
- [ ] 10-01-PLAN.md -- Gap-fill: test case edit/delete and bulk move to folder
- [ ] 10-02-PLAN.md -- Gap-fill: shared steps CRUD and versioning

### Phase 22: Custom API Route Tests
**Goal**: All custom API endpoints are verified with correct behavior, auth enforcement, and error handling
**Depends on**: Phase 9
**Requirements**: CAPI-01, CAPI-02, CAPI-03, CAPI-04, CAPI-05, CAPI-06, CAPI-07, CAPI-08, CAPI-09, CAPI-10
**Success Criteria** (what must be TRUE):
  1. API tests pass for project endpoints (cases/bulk-edit, cases/fetch-many, folders/stats) with auth and tenant isolation verified
  2. API tests pass for test run endpoints (summary, attachments, import, completed, summaries) and session summary endpoint
  3. API tests pass for milestone endpoints (descendants, forecast, summary) and share link endpoints (access, password-verify, report data)
  4. API tests pass for all report builder endpoints (all report types, drill-down queries) and admin endpoints (elasticsearch, queues, trash, user management)
  5. API tests pass for search, tag/issue count aggregation, file upload/download, health, metadata, and OpenAPI documentation endpoints
**Plans**: 2 plans

Plans:
- [ ] 10-01-PLAN.md -- Gap-fill: test case edit/delete and bulk move to folder
- [ ] 10-02-PLAN.md -- Gap-fill: shared steps CRUD and versioning

### Phase 23: General Components
**Goal**: All shared UI components are tested with full edge case and error state coverage
**Depends on**: Phase 9
**Requirements**: COMP-01, COMP-02, COMP-03, COMP-04, COMP-05, COMP-06, COMP-07, COMP-08
**Success Criteria** (what must be TRUE):
  1. Component tests pass for Header, UserDropdownMenu, and NotificationBell covering all notification states (empty, unread count, loading)
  2. Component tests pass for comment system (CommentEditor, CommentList, MentionSuggestion) and attachment components (display, upload, preview carousel)
  3. Component tests pass for DataTable (sorting, filtering, column visibility, row selection) and form components (ConfigurationSelect, FolderSelect, MilestoneSelect, DatePickerField)
  4. Component tests pass for onboarding dialogs, TipTap editor extensions (image resize, tables, code blocks), and DnD components (drag previews, drag interactions)
**Plans**: 2 plans

Plans:
- [ ] 10-01-PLAN.md -- Gap-fill: test case edit/delete and bulk move to folder
- [ ] 10-02-PLAN.md -- Gap-fill: shared steps CRUD and versioning

### Phase 24: Hooks, Notifications, and Workers
**Goal**: All custom hooks, notification flows, and background workers are unit tested
**Depends on**: Phase 9
**Requirements**: HOOK-01, HOOK-02, HOOK-03, HOOK-04, HOOK-05, NOTIF-01, NOTIF-02, NOTIF-03, WORK-01, WORK-02, WORK-03
**Success Criteria** (what must be TRUE):
  1. Hook tests pass for ZenStack-generated data fetching hooks (useFindMany*, useCreate*, useUpdate*, useDelete*) with mocked data
  2. Hook tests pass for permission hooks (useProjectPermissions, useUserAccess, role-based hooks) covering all permission states
  3. Hook tests pass for UI state hooks (useExportData, useReportColumns, filter/sort hooks) and form hooks (useForm integrations, validation)
  4. Hook tests pass for integration hooks (useAutoTagJob, useIntegration, useLlm) with mocked providers
  5. Component tests pass for NotificationBell, NotificationContent, and NotificationPreferences; API tests pass for notification dispatch; unit tests pass for emailWorker, repoCacheWorker, and autoTagWorker
**Plans**: 2 plans

Plans:
- [ ] 10-01-PLAN.md -- Gap-fill: test case edit/delete and bulk move to folder
- [ ] 10-02-PLAN.md -- Gap-fill: shared steps CRUD and versioning

---

### Phase 25: Default Template Schema
**Goal**: The Project model exposes an optional default export template so that the application can persist and query per-project default selections
**Depends on**: Nothing (SCHEMA-01 already complete; this extends it)
**Requirements**: SCHEMA-02
**Success Criteria** (what must be TRUE):
  1. The Project model has an optional relation to CaseExportTemplate representing the project's default export template
  2. Setting and clearing the default template for a project persists correctly in the database
  3. ZenStack/Prisma generation succeeds and the new relation is queryable via generated hooks
**Plans**: 1 plan

Plans:
- [ ] 25-01-PLAN.md -- Add defaultCaseExportTemplate relation to Project model and regenerate

### Phase 26: Admin Assignment UI
**Goal**: Admins can assign or unassign export templates to a project and designate one as the default, directly from project settings
**Depends on**: Phase 25
**Requirements**: ADMIN-01, ADMIN-02
**Success Criteria** (what must be TRUE):
  1. Admin can navigate to project settings and see a list of all enabled export templates with their assignment status for that project
  2. Admin can assign an export template to a project and the assignment is reflected immediately in the UI
  3. Admin can unassign an export template from a project and it no longer appears in the project's assigned list
  4. Admin can mark one assigned template as the project default, and the selection persists across page reloads
**Plans**: 2 plans

Plans:
- [ ] 26-01-PLAN.md -- Update ZenStack access rules for project admin write access
- [ ] 26-02-PLAN.md -- Build ExportTemplateAssignmentSection and integrate into quickscript page

### Phase 27: Export Dialog Filtering
**Goal**: The export dialog shows only the templates relevant to the current project, with the project default pre-selected, while gracefully falling back when no assignments exist
**Depends on**: Phase 26
**Requirements**: EXPORT-01, EXPORT-02, EXPORT-03
**Success Criteria** (what must be TRUE):
  1. When a project has assigned templates, the export dialog lists only those templates (not all global templates)
  2. When a project has a default template set, the export dialog opens with that template pre-selected
  3. When a project has no assigned templates, the export dialog shows all enabled templates (backward compatible fallback)
**Plans**: 1 plan

Plans:
- [ ] 27-01-PLAN.md -- Filter QuickScript dialog templates by project assignment and pre-select project default

---

## Progress

**Execution Order:**
Phases execute in numeric order: 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18 → 19 → 20 → 21 → 22 → 23 → 24 → 25 → 26 → 27

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Schema Foundation | v1.0 | 1/1 | Complete | 2026-03-08 |
| 2. Alert Service and Pipeline | v1.0 | 3/3 | Complete | 2026-03-08 |
| 3. Settings Page UI | v1.0 | 1/1 | Complete | 2026-03-08 |
| 4. (v1.0 complete) | v1.0 | 0/0 | Complete | 2026-03-08 |
| 5. CRUD Operations | v1.1 | 4/4 | Complete | 2026-03-17 |
| 6. Relations and Queries | v1.1 | 2/2 | Complete | 2026-03-17 |
| 7. Access Control | v1.1 | 2/2 | Complete | 2026-03-17 |
| 8. Error Handling and Batch Operations | v1.1 | 2/2 | Complete | 2026-03-17 |
| 9. Authentication E2E and API Tests | v2.0 | 4/4 | Complete | 2026-03-19 |
| 10. Test Case Repository E2E Tests | v2.0 | 0/2 | Planning complete | - |
| 11. Repository Components and Hooks | v2.0 | 0/TBD | Not started | - |
| 12. Test Execution E2E Tests | v2.0 | 0/TBD | Not started | - |
| 13. Run Components, Sessions E2E, and Session Components | v2.0 | 0/TBD | Not started | - |
| 14. Project Management E2E and Components | v2.0 | 0/TBD | Not started | - |
| 15. AI Feature E2E and API Tests | v2.0 | 0/TBD | Not started | - |
| 16. AI Component Tests | v2.0 | 0/TBD | Not started | - |
| 17. Administration E2E Tests | v2.0 | 0/TBD | Not started | - |
| 18. Administration Component Tests | v2.0 | 0/TBD | Not started | - |
| 19. Reporting E2E and Component Tests | v2.0 | 0/TBD | Not started | - |
| 20. Search E2E and Component Tests | v2.0 | 0/TBD | Not started | - |
| 21. Integrations E2E, Components, and API Tests | v2.0 | 0/TBD | Not started | - |
| 22. Custom API Route Tests | v2.0 | 0/TBD | Not started | - |
| 23. General Components | v2.0 | 0/TBD | Not started | - |
| 24. Hooks, Notifications, and Workers | v2.0 | 0/TBD | Not started | - |
| 25. Default Template Schema | 1/1 | Complete    | 2026-03-19 | - |
| 26. Admin Assignment UI | 2/2 | Complete    | 2026-03-19 | - |
| 27. Export Dialog Filtering | 1/1 | Complete    | 2026-03-19 | - |
