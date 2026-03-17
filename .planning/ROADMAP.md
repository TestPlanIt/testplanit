# Roadmap: TestPlanIt ZenStack Regression Tests

## Milestones

- ✅ **v1.0 AI Bulk Auto-Tagging** - Phases 1-4 (shipped 2026-03-08)
- 🚧 **v1.1 ZenStack Upgrade Regression Tests** - Phases 5-8 (in progress)

## Phases

<details>
<summary>✅ v1.0 AI Bulk Auto-Tagging (Phases 1-4) - SHIPPED 2026-03-08</summary>

### Phase 1: LLM Tag Analysis
**Goal**: The system can analyze entity content and produce meaningful tag suggestions using the existing LLM infrastructure
**Depends on**: Nothing (first phase)
**Requirements**: LLM-01, LLM-02, LLM-03, LLM-04
**Success Criteria** (what must be TRUE):
  1. Given entity content (title, description, steps, custom fields), the LLM service returns a list of suggested tags
  2. Entities are grouped into batches that respect estimated token limits so no single LLM call exceeds context window
  3. Suggestions include both existing project tags and new tag names that do not yet exist in the project
  4. The tag suggestion prompt is resolved through the existing prompt config chain (project-specific > system default > fallback)
**Plans:** 2/2 plans complete

Plans:
- [x] 01-01-PLAN.md — Register AUTO_TAG feature, define types, create fallback prompt, build content extractors
- [x] 01-02-PLAN.md — Build tag analysis service with smart batching, LLM orchestration, and fuzzy tag matching

### Phase 2: API and Background Processing
**Goal**: Users can request tag suggestions via API and the system handles all batches as background jobs with progress tracking
**Depends on**: Phase 1
**Requirements**: API-01, API-02, API-03
**Success Criteria** (what must be TRUE):
  1. A user can submit a set of entity IDs and receive AI tag suggestions for those entities
  2. All processing happens as a background job and the user can navigate away and return to check progress
  3. A user can submit accepted suggestions and all tags (including newly created ones) are applied to the correct entities in bulk
**Plans:** 2/2 plans complete

Plans:
- [x] 02-01-PLAN.md — Queue infrastructure, worker with progress/cancellation, TagAnalysisService callback support
- [x] 02-02-PLAN.md — Submit, status, cancel, and bulk apply API routes

### Phase 3: Review Dialog
**Goal**: Users can review AI-suggested tags per entity and decide which to accept before anything is applied
**Depends on**: Phase 2
**Requirements**: UI-01, UI-02, UI-03, UI-04
**Success Criteria** (what must be TRUE):
  1. After AI processing completes, a dialog displays suggested tags grouped by entity
  2. The user can accept or reject individual tag suggestions per entity, and can modify suggestions before applying
  3. New tags (tags that do not yet exist in the project) are visually distinguished from existing tags (e.g., badge or color)
  4. A single "Apply" action commits all accepted suggestions across all entities
**Plans:** 2/2 plans complete

Plans:
- [x] 03-01-PLAN.md — Auto-tag review dialog component structure, state management, and entity list
- [x] 03-02-PLAN.md — Tag chips, suggestion toggles, apply flow, and i18n

### Phase 4: Entry Point Integrations
**Goal**: Users can trigger AI bulk tagging from everywhere it makes sense: list view bulk actions and the tags management page
**Depends on**: Phase 3
**Requirements**: EP-01, EP-02, EP-03, EP-04
**Success Criteria** (what must be TRUE):
  1. User can select test cases on the cases list, open bulk actions, and trigger AI tagging
  2. User can select test runs on the test runs list, open bulk actions, and trigger AI tagging
  3. User can select sessions on the sessions list, open bulk actions, and trigger AI tagging
  4. User can trigger AI tagging from the tags management page by choosing an entity type and selecting entities
**Plans:** 3/3 plans complete

Plans:
- [x] 04-01-PLAN.md — localStorage persistence for useAutoTagJob, i18n keys, and cases list bulk action integration
- [x] 04-02-PLAN.md — Tag All buttons for test runs and sessions pages
- [x] 04-03-PLAN.md — AI Auto-Tag popover on tags management page

</details>

### 🚧 v1.1 ZenStack Upgrade Regression Tests (In Progress)

**Milestone Goal:** Comprehensive API-level test suite that verifies CRUD, relations, access control, error handling, and batch operations all behave correctly after the ZenStack v2→v3 upgrade.

- [ ] **Phase 5: CRUD Operations** - API tests verifying create, read, update, delete for all core models
- [ ] **Phase 6: Relations and Queries** - API tests verifying nested includes, filters, ordering, pagination, and aggregates
- [ ] **Phase 7: Access Control** - API tests verifying per-user permission enforcement across all access levels
- [ ] **Phase 8: Error Handling and Batch Operations** - API tests verifying error response formats and bulk write operations

## Phase Details

### Phase 5: CRUD Operations
**Goal**: Every core model can be created, read, updated, and deleted through the REST API and responses are correct
**Depends on**: Phase 4
**Requirements**: CRUD-01, CRUD-02, CRUD-03, CRUD-04, CRUD-05, CRUD-06, CRUD-07, CRUD-08
**Success Criteria** (what must be TRUE):
  1. A test creates a Project and reads it back with matching fields, updates a field, then deletes it — all return expected HTTP status codes
  2. A test creates a RepositoryCase with Steps and reads back the correct step count and content
  3. A test creates a TestRun and TestRunCase pair, updates state, and deletes both — no orphan records remain
  4. A test creates a CaseField with CaseFieldValues and a Template with field assignments, then tears them down cleanly
  5. A test links Tags to entities via many-to-many relations and a Session through its full lifecycle
**Plans:** 4 plans

Plans:
- [ ] 05-01-PLAN.md — Projects, RepositoryCases, and Steps CRUD tests
- [ ] 05-02-PLAN.md — TestRuns and TestRunCases CRUD tests
- [ ] 05-03-PLAN.md — Templates, CaseFields, and CaseFieldValues CRUD tests
- [ ] 05-04-PLAN.md — Tags (with many-to-many linking) and Sessions CRUD tests

### Phase 6: Relations and Queries
**Goal**: Nested includes, filtered queries, pagination, and aggregate operations return correct data without alias or ordering errors
**Depends on**: Phase 5
**Requirements**: REL-01, REL-02, REL-03, REL-04
**Success Criteria** (what must be TRUE):
  1. A findMany on RepositoryCases with nested includes (steps, fieldValues, tags, template) returns all related data correctly structured
  2. A findMany on TestRuns with nested includes (testRunCases, results, stepResults) returns data without PostgreSQL alias errors
  3. A findMany with where filters, orderBy, skip, and take returns only the expected subset of records in the expected order
  4. Count and aggregate queries on core models return numerically correct results matching actual row counts
**Plans**: TBD

### Phase 7: Access Control
**Goal**: The API enforces the correct permissions for each user role — admins see everything, scoped users see their projects, and unauthorized requests are blocked
**Depends on**: Phase 5
**Requirements**: ACL-01, ACL-02, ACL-03, ACL-04, ACL-05
**Success Criteria** (what must be TRUE):
  1. An admin user can create, read, update, and delete records across all models without receiving a 403 or access-denied error
  2. A regular project member can read project data but receives a 403 when attempting to delete the project itself
  3. A user with NO_ACCESS permission receives a 403 or empty result when reading any data within that project
  4. An unauthenticated request (no session cookie or token) receives a 401 for any model endpoint
  5. A user without TestCaseRepository area access cannot create or modify RepositoryCases in a project where they lack that role
**Plans**: TBD

### Phase 8: Error Handling and Batch Operations
**Goal**: Error responses are identifiable by type (unique constraint, foreign key, validation, not found) and bulk write operations complete atomically
**Depends on**: Phase 5
**Requirements**: ERR-01, ERR-02, ERR-03, ERR-04, BATCH-01, BATCH-02, BATCH-03
**Success Criteria** (what must be TRUE):
  1. Creating a record with a duplicate unique field returns an error response that can be identified as a unique constraint violation (via message text pattern or error code)
  2. Creating a record with a nonexistent foreign key returns an error response identifiable as a foreign key violation
  3. Creating a record missing required fields returns an error response identifiable as a validation error
  4. Reading a nonexistent record ID returns a 404 or empty result, not a 500
  5. A createMany for Steps, updateMany for RepositoryCases, and deleteMany for Tags each apply to all targeted records or none (no partial writes)
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 5 → 6 → 7 → 8

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. LLM Tag Analysis | v1.0 | 2/2 | Complete | 2026-03-07 |
| 2. API and Background Processing | v1.0 | 2/2 | Complete | 2026-03-07 |
| 3. Review Dialog | v1.0 | 2/2 | Complete | 2026-03-08 |
| 4. Entry Point Integrations | v1.0 | 3/3 | Complete | 2026-03-08 |
| 5. CRUD Operations | v1.1 | 0/4 | Planning complete | - |
| 6. Relations and Queries | v1.1 | 0/TBD | Not started | - |
| 7. Access Control | v1.1 | 0/TBD | Not started | - |
| 8. Error Handling and Batch Operations | v1.1 | 0/TBD | Not started | - |
