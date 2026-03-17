# Requirements: TestPlanIt

**Defined:** 2026-03-07
**Core Value:** Confidence that the ZenStack v2→v3 upgrade does not break any existing frontend-backend communication

## v1.0 Requirements (Complete)

### LLM Feature (Backend)

- [x] **LLM-01**: System can analyze entity content (title, description, steps, custom field values) and suggest matching tags
- [x] **LLM-02**: System supports smart batching of entities based on estimated token count
- [x] **LLM-03**: AI can suggest both existing tags and new tags that don't exist yet
- [x] **LLM-04**: Prompt is configurable via the existing prompt config system (project > default > fallback)

### API

- [x] **API-01**: User can request AI tag suggestions for a set of entity IDs within a project
- [x] **API-02**: System processes large batches (50+) as background jobs with progress tracking
- [x] **API-03**: User can apply accepted tag suggestions (including creating new tags) in bulk

### UI - Review Dialog

- [x] **UI-01**: User can review AI-suggested tags per entity before applying
- [x] **UI-02**: User can accept, reject, or modify suggestions per entity
- [x] **UI-03**: New tag suggestions are visually distinct from existing tags
- [x] **UI-04**: User can apply all accepted suggestions with one action

### UI - Entry Points

- [x] **EP-01**: User can trigger AI tagging from bulk action menu on cases list
- [x] **EP-02**: User can trigger AI tagging from bulk action menu on test runs list
- [x] **EP-03**: User can trigger AI tagging from bulk action menu on sessions list
- [x] **EP-04**: User can trigger AI tagging from tags management page with entity type selection

## v1.1 Requirements

Requirements for ZenStack upgrade regression test suite. Each maps to roadmap phases.

### CRUD Operations

- [ ] **CRUD-01**: API test verifies create, read, update, delete for Projects
- [ ] **CRUD-02**: API test verifies create, read, update, delete for RepositoryCases (test cases)
- [ ] **CRUD-03**: API test verifies create, read, update, delete for Steps
- [ ] **CRUD-04**: API test verifies create, read, update, delete for TestRuns and TestRunCases
- [ ] **CRUD-05**: API test verifies create, read, update, delete for Templates and field assignments
- [ ] **CRUD-06**: API test verifies create, read, update, delete for CaseFields and CaseFieldValues
- [ ] **CRUD-07**: API test verifies create, read, update, delete for Tags (including many-to-many linking)
- [ ] **CRUD-08**: API test verifies create, read, update, delete for Sessions

### Relations & Queries

- [ ] **REL-01**: API test verifies nested includes on RepositoryCases (steps, fieldValues, tags, template)
- [ ] **REL-02**: API test verifies nested includes on TestRuns (testRunCases, results, stepResults)
- [ ] **REL-03**: API test verifies findFirst and findMany with where filters, orderBy, and pagination (skip/take)
- [ ] **REL-04**: API test verifies count and aggregate operations on core models

### Access Control

- [ ] **ACL-01**: API test verifies admin user has full CRUD access to all models
- [ ] **ACL-02**: API test verifies regular project user can read but not delete projects
- [ ] **ACL-03**: API test verifies user with NO_ACCESS permission is denied read access to project data
- [ ] **ACL-04**: API test verifies unauthenticated requests are rejected
- [ ] **ACL-05**: API test verifies role-based permissions (TestCaseRepository area, TestRuns area)

### Error Handling & Batch Operations

- [ ] **ERR-01**: API test verifies unique constraint violation returns identifiable error
- [ ] **ERR-02**: API test verifies foreign key violation returns identifiable error
- [ ] **ERR-03**: API test verifies validation errors (missing required fields) return identifiable error
- [ ] **ERR-04**: API test verifies not-found responses for nonexistent records
- [ ] **BATCH-01**: API test verifies createMany for Steps (bulk step creation)
- [ ] **BATCH-02**: API test verifies updateMany for RepositoryCases (bulk state change)
- [ ] **BATCH-03**: API test verifies deleteMany for Tags (bulk tag removal)

## Future Requirements

Deferred to future. Not in current roadmap.

- **PERF-01**: Load test for concurrent API operations under ZenStack v3
- **AUDIT-01**: Verify audit logging still triggers correctly for all entity types
- **SEARCH-01**: Verify Elasticsearch sync still triggers on mutations

## Out of Scope

| Feature | Reason |
|---------|--------|
| Testing ZenStack internals | We test app behavior, not the ORM |
| UI-level E2E tests for upgrade | API tests for speed; existing E2E suite covers UI |
| Custom API routes (auth, integrations, reports) | Not affected by ZenStack upgrade |
| Performance/load testing | Functional correctness only for v1.1 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| LLM-01 | Phase 1 | Complete |
| LLM-02 | Phase 1 | Complete |
| LLM-03 | Phase 1 | Complete |
| LLM-04 | Phase 1 | Complete |
| API-01 | Phase 2 | Complete |
| API-02 | Phase 2 | Complete |
| API-03 | Phase 2 | Complete |
| UI-01 | Phase 3 | Complete |
| UI-02 | Phase 3 | Complete |
| UI-03 | Phase 3 | Complete |
| UI-04 | Phase 3 | Complete |
| EP-01 | Phase 4 | Complete |
| EP-02 | Phase 4 | Complete |
| EP-03 | Phase 4 | Complete |
| EP-04 | Phase 4 | Complete |
| CRUD-01 | Phase 5 | Pending |
| CRUD-02 | Phase 5 | Pending |
| CRUD-03 | Phase 5 | Pending |
| CRUD-04 | Phase 5 | Pending |
| CRUD-05 | Phase 5 | Pending |
| CRUD-06 | Phase 5 | Pending |
| CRUD-07 | Phase 5 | Pending |
| CRUD-08 | Phase 5 | Pending |
| REL-01 | Phase 6 | Pending |
| REL-02 | Phase 6 | Pending |
| REL-03 | Phase 6 | Pending |
| REL-04 | Phase 6 | Pending |
| ACL-01 | Phase 7 | Pending |
| ACL-02 | Phase 7 | Pending |
| ACL-03 | Phase 7 | Pending |
| ACL-04 | Phase 7 | Pending |
| ACL-05 | Phase 7 | Pending |
| ERR-01 | Phase 8 | Pending |
| ERR-02 | Phase 8 | Pending |
| ERR-03 | Phase 8 | Pending |
| ERR-04 | Phase 8 | Pending |
| BATCH-01 | Phase 8 | Pending |
| BATCH-02 | Phase 8 | Pending |
| BATCH-03 | Phase 8 | Pending |

**Coverage:**
- v1.0 requirements: 15 total (all complete)
- v1.1 requirements: 24 total
- Mapped to phases: 24
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-07*
*Last updated: 2026-03-16 after milestone v1.1 definition*
