# Roadmap: TestPlanIt

## Milestones

- ✅ **v1.0 AI Bulk Auto-Tagging** - Phases 1-4 (shipped 2026-03-08)
- ✅ **v1.1 ZenStack Upgrade Regression Tests** - Phases 5-8 (shipped 2026-03-17)
- 📋 **v2.0 Comprehensive Test Coverage** - Phases 9-24 (planned)
- ✅ **v2.1 Per-Project Export Template Assignment** - Phases 25-27 (shipped 2026-03-19)
- ✅ **v0.17.0-copy-move Copy/Move Test Cases Between Projects** - Phases 28-33 (shipped 2026-03-21)
- 🚧 **v0.17.0 Per-Prompt LLM Configuration** - Phases 34-39 (in progress)

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

<details>
<summary>✅ v2.1 Per-Project Export Template Assignment (Phases 25-27) - SHIPPED 2026-03-19</summary>

- [x] **Phase 25: Default Template Schema** - Project model extended with optional default export template relation
- [x] **Phase 26: Admin Assignment UI** - Admin can assign, unassign, and set a default export template per project
- [x] **Phase 27: Export Dialog Filtering** - Export dialog shows only project-assigned templates with project default pre-selected

</details>

<details>
<summary>✅ v0.17.0-copy-move Copy/Move Test Cases Between Projects (Phases 28-33) - SHIPPED 2026-03-21</summary>

- [x] **Phase 28: Copy/Move Schema and Worker Foundation** - BullMQ worker and schema support async copy/move operations
- [x] **Phase 29: Preflight Compatibility Checks** - Compatibility checks prevent invalid cross-project copies
- [x] **Phase 30: Folder Tree Copy/Move** - Folder hierarchies are preserved during copy/move operations
- [x] **Phase 31: Copy/Move UI Entry Points** - Users can initiate copy/move from cases and folder tree
- [x] **Phase 32: Progress and Result Feedback** - Users see real-time progress and outcome for copy/move jobs
- [x] **Phase 33: Copy/Move Test Coverage** - Copy/move flows are verified end-to-end and via unit tests

</details>

### 🚧 v0.17.0 Per-Prompt LLM Configuration (Phases 34-37)

**Milestone Goal:** Allow each prompt within a PromptConfig to use a different LLM integration, so teams can optimize cost, speed, and quality per AI feature. Resolution chain: Project LlmFeatureConfig > PromptConfigPrompt > Project default.

- [x] **Phase 34: Schema and Migration** - PromptConfigPrompt supports per-prompt LLM assignment with DB migration (completed 2026-03-21)
- [x] **Phase 35: Resolution Chain** - PromptResolver and LlmManager implement the full three-level LLM resolution chain with backward compatibility (completed 2026-03-21)
- [x] **Phase 36: Admin Prompt Editor LLM Selector** - Admin can assign an LLM integration and model override to each prompt, with mixed-integration indicator (completed 2026-03-21)
- [x] **Phase 37: Project AI Models Overrides** - Project admins can set per-feature LLM overrides with resolution chain display (completed 2026-03-21)
- [x] **Phase 38: Export/Import and Testing** - Per-prompt LLM fields in export/import, unit tests for resolution chain, E2E tests for admin and project UI (completed 2026-03-21)
- [x] **Phase 39: Documentation** - User-facing docs for per-prompt LLM configuration and project-level overrides (completed 2026-03-21)

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

### Phase 34: Schema and Migration
**Goal**: PromptConfigPrompt supports per-prompt LLM assignment with proper database migration
**Depends on**: Phase 33
**Requirements**: SCHEMA-01, SCHEMA-02, SCHEMA-03
**Success Criteria** (what must be TRUE):
  1. PromptConfigPrompt has optional llmIntegrationId FK and modelOverride string fields in schema.zmodel; ZenStack generation succeeds
  2. Database migration adds both columns with proper FK constraint to LlmIntegration and index on llmIntegrationId
  3. A PromptConfigPrompt record can be saved with a specific LLM integration and retrieved with the relation included
  4. LlmFeatureConfig model confirmed to have correct fields and access rules for project admins
**Plans**: 1 plan

Plans:
- [ ] 34-01-PLAN.md -- Add llmIntegrationId and modelOverride to PromptConfigPrompt in schema.zmodel, generate migration, validate

### Phase 35: Resolution Chain
**Goal**: The LLM selection logic applies the correct integration for every AI feature call using a three-level fallback chain with full backward compatibility
**Depends on**: Phase 34
**Requirements**: RESOLVE-01, RESOLVE-02, RESOLVE-03, COMPAT-01
**Success Criteria** (what must be TRUE):
  1. PromptResolver returns per-prompt LLM integration ID and model override when set on the resolved prompt
  2. Resolution chain enforced: project LlmFeatureConfig > PromptConfigPrompt.llmIntegrationId > project default integration
  3. When neither per-prompt nor project override exists, the project default LLM integration is used (existing behavior preserved)
  4. Existing projects and prompt configs without per-prompt LLM assignments continue to work without any changes
**Plans**: 1 plan

Plans:
- [ ] 35-01-PLAN.md -- Extend PromptResolver to surface per-prompt LLM info and update LlmManager to apply the resolution chain

### Phase 36: Admin Prompt Editor LLM Selector
**Goal**: Admins can assign an LLM integration and optional model override to each prompt directly in the prompt config editor, with visual indicator for mixed configs
**Depends on**: Phase 35
**Requirements**: ADMIN-01, ADMIN-02, ADMIN-03
**Success Criteria** (what must be TRUE):
  1. Each feature accordion in the admin prompt config editor shows an LLM integration selector populated with all available integrations
  2. Admin can select an LLM integration and model override for a prompt; the selection is saved when the prompt config is submitted
  3. On returning to the editor, the previously saved per-prompt LLM assignment is pre-selected in the selector
  4. Prompt config list/table shows a summary indicator when prompts within a config use mixed LLM integrations
**Plans**: 2 plans

Plans:
- [ ] 36-01-PLAN.md -- Add LLM integration and model override selectors to PromptFeatureSection accordion and wire save/load
- [ ] 36-02-PLAN.md -- Add mixed-integration indicator to prompt config list/table

### Phase 37: Project AI Models Overrides
**Goal**: Project admins can configure per-feature LLM overrides from the project AI Models settings page with clear resolution chain display
**Depends on**: Phase 35
**Requirements**: PROJ-01, PROJ-02
**Success Criteria** (what must be TRUE):
  1. The Project AI Models settings page shows a per-feature override section listing all 7 LLM features with an integration selector for each
  2. Project admin can assign a specific LLM integration to a feature; the assignment is saved as a LlmFeatureConfig record
  3. Project admin can clear a per-feature override; the feature falls back to prompt-level assignment or project default
  4. The effective resolution chain is displayed per feature (which LLM will actually be used and why — override, prompt-level, or default)
**Plans**: 1 plan

Plans:
- [ ] 37-01-PLAN.md -- Build per-feature override UI on AI Models settings page with resolution chain display and LlmFeatureConfig CRUD

### Phase 38: Export/Import and Testing
**Goal**: Per-prompt LLM fields are portable via export/import, and all new functionality is verified with unit and E2E tests
**Depends on**: Phase 36, Phase 37
**Requirements**: EXPORT-01, TEST-01, TEST-02, TEST-03, TEST-04
**Success Criteria** (what must be TRUE):
  1. Per-prompt LLM assignments (integration reference + model override) are included in prompt config export and correctly restored on import
  2. Unit tests pass for PromptResolver 3-tier resolution chain covering all fallback levels independently
  3. Unit tests pass for LlmFeatureConfig override behavior (create, update, delete, fallback)
  4. E2E tests pass for admin prompt editor LLM integration selector workflow (select, save, reload, clear)
  5. E2E tests pass for project AI Models per-feature override workflow (assign, clear, verify effective LLM)
**Plans**: 3 plans

Plans:
- [ ] 38-01-PLAN.md -- Add per-prompt LLM fields to prompt config export/import
- [ ] 38-02-PLAN.md -- Unit tests for resolution chain and LlmFeatureConfig
- [ ] 38-03-PLAN.md -- E2E tests for admin prompt editor and project AI Models overrides

### Phase 39: Documentation
**Goal**: User-facing documentation covers per-prompt LLM configuration and project-level overrides
**Depends on**: Phase 38
**Requirements**: DOCS-01, DOCS-02
**Success Criteria** (what must be TRUE):
  1. Documentation explains how admins configure per-prompt LLM integrations in the admin prompt editor
  2. Documentation explains how project admins set per-feature LLM overrides on the AI Models settings page
  3. Documentation describes the resolution chain precedence (project override > prompt-level > project default)
**Plans**: 1 plan

Plans:
- [x] 39-01-PLAN.md -- Write user-facing documentation for per-prompt LLM configuration and project-level overrides

---

## Progress

**Execution Order:**
Phases execute in numeric order: 34 → 35 → 36 + 37 (parallel) → 38 → 39

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
| 25. Default Template Schema | v2.1 | 1/1 | Complete | 2026-03-19 |
| 26. Admin Assignment UI | v2.1 | 2/2 | Complete | 2026-03-19 |
| 27. Export Dialog Filtering | v2.1 | 1/1 | Complete | 2026-03-19 |
| 28. Copy/Move Schema and Worker Foundation | v0.17.0-copy-move | TBD | Complete | 2026-03-21 |
| 29. Preflight Compatibility Checks | v0.17.0-copy-move | TBD | Complete | 2026-03-21 |
| 30. Folder Tree Copy/Move | v0.17.0-copy-move | TBD | Complete | 2026-03-21 |
| 31. Copy/Move UI Entry Points | v0.17.0-copy-move | TBD | Complete | 2026-03-21 |
| 32. Progress and Result Feedback | v0.17.0-copy-move | TBD | Complete | 2026-03-21 |
| 33. Copy/Move Test Coverage | v0.17.0-copy-move | TBD | Complete | 2026-03-21 |
| 34. Schema and Migration | 1/1 | Complete    | 2026-03-21 | - |
| 35. Resolution Chain | 1/1 | Complete    | 2026-03-21 | - |
| 36. Admin Prompt Editor LLM Selector | 2/2 | Complete    | 2026-03-21 | - |
| 37. Project AI Models Overrides | 1/1 | Complete    | 2026-03-21 | - |
| 38. Export/Import and Testing | 3/3 | Complete    | 2026-03-21 | - |
| 39. Documentation | 1/1 | Complete    | 2026-03-21 | - |
