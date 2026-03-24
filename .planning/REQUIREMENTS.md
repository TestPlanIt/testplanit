# Requirements: TestPlanIt v0.19.0 — Resolve Duplicate Test Cases

**Defined:** 2026-03-23
**Core Value:** Teams can plan, execute, and track testing across manual and automated workflows in one place — with AI assistance to reduce repetitive work.

## v0.19.0 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Detection

- [x] **DET-01**: System can identify test cases with similar names using fuzzy string matching (pg_trgm + Elasticsearch MLT)
- [x] **DET-02**: System can identify test cases with similar test steps using content similarity scoring
- [x] **DET-03**: System uses multi-signal scoring combining name, steps, tags, and field values into a weighted similarity score
- [x] **DET-04**: System displays similarity confidence as high/medium/low buckets (not raw floats) with which fields matched
- [x] **DET-05**: Detection is scoped to within a project across all repositories, respecting multi-tenant isolation
- [x] **DET-06**: System can optionally use configured LLM to perform semantic analysis of whether two cases test the same functionality
- [x] **DET-07**: LLM analysis uses batching (multiple pairs per call) with a configurable maximum pairs cap per scan

### Scanning

- [x] **SCAN-01**: User can trigger an on-demand project-wide duplicate scan from the repository view
- [x] **SCAN-02**: Scan runs asynchronously via BullMQ worker with progress reporting
- [x] **SCAN-03**: Scan results persist to a DuplicateScanResult table and survive page reloads
- [x] **SCAN-04**: User can view scan results in a dedicated duplicates page showing candidate pairs sorted by confidence

### Warnings

- [x] **WARN-01**: User sees a soft, non-blocking warning after creating a test case that resembles an existing one
- [x] **WARN-02**: User sees per-row soft warnings during CSV/test-result import when imported cases resemble existing ones
- [x] **WARN-03**: Import warnings are advisory only — they never prevent or block the import
- [x] **WARN-04**: CLI imports warn of possible duplicates but never prevent the import from completing

### Resolution

- [x] **RES-01**: User can view two candidate duplicate cases side-by-side (title, steps, tags, folder, last run status) before deciding
- [x] **RES-02**: User can merge two cases — surviving case inherits all test run history, steps, attachments, tags, and field values
- [x] **RES-03**: Merge handles TestRunCases unique constraint conflicts when both cases appear in the same test run
- [x] **RES-04**: Merge preserves version history from the merged case (re-parents versions to survivor before soft-deleting)
- [x] **RES-05**: Merge executes as a single atomic transaction — no partial merge state is observable
- [x] **RES-06**: User can link two cases as related using RepositoryCaseLink (SAME_TEST_DIFFERENT_SOURCE) without merging
- [x] **RES-07**: User can dismiss a candidate pair as not-duplicate so it does not resurface in future scans

### Testing

- [ ] **TEST-01**: Unit tests cover similarity scoring algorithms, merge transaction logic, and scan service
- [ ] **TEST-02**: E2E tests cover the duplicate scan workflow (trigger scan, view results, resolve duplicates)
- [ ] **TEST-03**: E2E tests cover creation-time duplicate warning display

### Documentation

- [ ] **DOC-01**: User-facing documentation explains how duplicate detection works and how to resolve duplicates
- [ ] **DOC-02**: Documentation covers the two-tier detection approach (fuzzy + optional LLM) and how to configure it

### Notification

- [ ] **NOTIF-01**: Upgrade notification informs users about the new duplicate detection feature when they upgrade to v0.19.0

## Future Requirements

Deferred to a later release. Tracked but not in current roadmap.

### Bulk Operations

- **BULK-01**: User can bulk-resolve multiple duplicate pairs at once
- **BULK-02**: Scheduled automatic scanning on a configurable cadence

### Advanced Detection

- **ADV-01**: Cross-repository duplicate grouping (multi-way, not just pairwise)
- **ADV-02**: Vector embedding storage for persistent semantic search index

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cross-project duplicate detection | Intentional duplication across projects is common (different environments/setups); cross-project sharing belongs to shared library feature (issue #79) |
| Blocking creation on duplicate detection | Research confirms blocking warnings cause bypass behavior; advisory-only approach is deliberate |
| Auto-merge without human review | Merging is destructive — wrong merges lose test intent; always requires explicit user confirmation |
| Real-time keystroke similarity scoring | ES MLT round-trips are 50-200ms; triggers on form blur or explicit check, not every keystroke |

## Traceability

| Requirement | Phase    | Status  |
|-------------|----------|---------|
| DET-01      | Phase 47 | Complete |
| DET-02      | Phase 47 | Complete |
| DET-03      | Phase 47 | Complete |
| DET-04      | Phase 47 | Complete |
| DET-05      | Phase 47 | Complete |
| DET-06      | Phase 51 | Complete |
| DET-07      | Phase 51 | Complete |
| SCAN-01     | Phase 48 | Complete |
| SCAN-02     | Phase 48 | Complete |
| SCAN-03     | Phase 48 | Complete |
| SCAN-04     | Phase 48 | Complete |
| WARN-01     | Phase 50 | Complete |
| WARN-02     | Phase 50 | Complete |
| WARN-03     | Phase 50 | Complete |
| WARN-04     | Phase 50 | Complete |
| RES-01      | Phase 49 | Complete |
| RES-02      | Phase 49 | Complete |
| RES-03      | Phase 49 | Complete |
| RES-04      | Phase 49 | Complete |
| RES-05      | Phase 49 | Complete |
| RES-06      | Phase 49 | Complete |
| RES-07      | Phase 49 | Complete |
| TEST-01     | Phase 52 | Pending |
| TEST-02     | Phase 52 | Pending |
| TEST-03     | Phase 52 | Pending |
| DOC-01      | Phase 52 | Pending |
| DOC-02      | Phase 52 | Pending |
| NOTIF-01    | Phase 52 | Pending |

**Coverage:**
- v0.19.0 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-23*
*Last updated: 2026-03-23 after roadmap creation*
