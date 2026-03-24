# Roadmap: TestPlanIt

## Milestones

- ✅ **AI Bulk Auto-Tagging** — Phases 1-4 (shipped 2026-03-08)
- ✅ **ZenStack Upgrade Regression Tests** — Phases 5-8 (shipped 2026-03-17)
- ✅ **Comprehensive Test Coverage** — Phases 9-24 (shipped 2026-03-21)
- ✅ **Per-Project Export Template Assignment** — Phases 25-27 (shipped 2026-03-19)
- ✅ **v0.17.0 Copy/Move Test Cases** — Phases 28-33 (shipped 2026-03-21)
- 🚧 **v0.19.0 Resolve Duplicate Test Cases** — Phases 47-52 (in progress)

## Phases

<details>
<summary>✅ Prior Milestones (Phases 1-33) - SHIPPED</summary>

Phases 1-4: AI Bulk Auto-Tagging (shipped 2026-03-08)
Phases 5-8: ZenStack Upgrade Regression Tests (shipped 2026-03-17)
Phases 9-24: Comprehensive Test Coverage (shipped 2026-03-21)
Phases 25-27: Per-Project Export Template Assignment (shipped 2026-03-19)
Phases 28-33: v0.17.0 Copy/Move Test Cases Between Projects (shipped 2026-03-21)

</details>

### 🚧 v0.19.0 Resolve Duplicate Test Cases (In Progress)

**Milestone Goal:** Help test engineers find and resolve duplicate test cases that cover the same functionality, reducing redundant coverage and improving test suite quality.

- [x] **Phase 47: Detection Foundation** - Schema model + multi-signal similarity scoring engine (completed 2026-03-23)
- [x] **Phase 48: Async Project-Wide Scan** - BullMQ scan worker, API, and results view (completed 2026-03-23)
- [x] **Phase 49: Resolution Engine** - Side-by-side comparison, merge, link, and dismiss (completed 2026-03-23)
- [x] **Phase 50: Creation-Time and Import Warnings** - Soft non-blocking warnings at creation and import (completed 2026-03-24)
- [ ] **Phase 51: LLM Semantic Tier** - Optional LLM-powered semantic analysis on candidate pairs
- [ ] **Phase 52: Testing, Documentation, and Notification** - Full test coverage, user docs, upgrade notice

## Phase Details

### Phase 47: Detection Foundation
**Goal**: The similarity scoring engine and persistence layer exist so all detection entry points have a shared foundation to build on
**Depends on**: Phase 33 (prior milestone complete)
**Requirements**: DET-01, DET-02, DET-03, DET-04, DET-05
**Success Criteria** (what must be TRUE):
  1. `DuplicateScanResult` model exists in schema.zmodel and `pnpm generate` completes cleanly
  2. `pg_trgm` GIN index migration on `RepositoryCases.name` is applied with no downtime
  3. `DuplicateScanService.findSimilarCases(caseData, projectId)` returns scored candidate pairs using name, steps, tags, and field values
  4. Similarity results are expressed as high/medium/low confidence buckets (not raw floats) with matched field labels
  5. All queries are scoped to a single project — no cross-project results are returned under any inputs
**Plans:** 3/3 plans complete

Plans:
- [ ] 47-01-PLAN.md — Similarity scoring utilities (Jaro-Winkler, combineScores, scoreToConfidence) with TDD
- [ ] 47-02-PLAN.md — DuplicateScanResult schema model, pg_trgm setup, queue stub
- [ ] 47-03-PLAN.md — DuplicateScanService with findSimilarCases and ES more_like_this integration

### Phase 48: Async Project-Wide Scan
**Goal**: Users can trigger a project-wide duplicate scan and view persistent results without waiting for a synchronous response
**Depends on**: Phase 47
**Requirements**: SCAN-01, SCAN-02, SCAN-03, SCAN-04
**Success Criteria** (what must be TRUE):
  1. User can trigger a scan from the repository view and immediately see a progress indicator
  2. Scan runs in the background via BullMQ and reports progress without blocking the UI
  3. Scan results survive a page reload — candidate pairs are readable from `DuplicateScanResult` table
  4. User can navigate to a dedicated duplicates page that lists candidate pairs sorted by confidence (high first)
**Plans:** 3/3 plans complete

Plans:
- [ ] 48-01-PLAN.md — BullMQ duplicateScanWorker with tests and build registration
- [ ] 48-02-PLAN.md — API routes (submit, status, cancel, candidates)
- [ ] 48-03-PLAN.md — UI: toolbar button with progress, duplicates results page

### Phase 49: Resolution Engine
**Goal**: Users can resolve any candidate pair by merging, linking as related, or dismissing — with full history preservation
**Depends on**: Phase 48
**Requirements**: RES-01, RES-02, RES-03, RES-04, RES-05, RES-06, RES-07
**Success Criteria** (what must be TRUE):
  1. User can open a side-by-side comparison showing title, steps, tags, folder, and last run status for both candidate cases
  2. User can merge two cases and the surviving case retains all test run history, steps, attachments, tags, and field values from both
  3. Merge completes as a single atomic transaction — no partial merge state is observable if the operation fails mid-way
  4. User can link two cases as related (SAME_TEST_DIFFERENT_SOURCE) without merging them
  5. User can dismiss a candidate pair as not-duplicate and it does not resurface in future scans
**Plans:** 3/3 plans complete

Plans:
- [ ] 49-01-PLAN.md — Merge/link/dismiss service with TDD (mergeCases, linkCases, dismissPair)
- [ ] 49-02-PLAN.md — API routes (resolve endpoint + case-details endpoint)
- [ ] 49-03-PLAN.md — Side-by-side comparison dialog UI + table wiring + translations

### Phase 50: Creation-Time and Import Warnings
**Goal**: Users are warned about potential duplicates when creating or importing test cases, without any blocking of their workflow
**Depends on**: Phase 47
**Requirements**: WARN-01, WARN-02, WARN-03, WARN-04
**Success Criteria** (what must be TRUE):
  1. After saving a new test case that resembles an existing one, a soft warning banner appears without blocking the save
  2. During CSV or test-result import, each row that resembles an existing case shows a per-row advisory warning in the import preview
  3. An import with duplicate warnings completes fully — no rows are skipped or blocked due to similarity
  4. CLI imports print duplicate warnings to output but exit with success (not an error code)
**Plans:** 2/2 plans complete

Plans:
- [ ] 50-01-PLAN.md — Check-new API endpoint + post-save duplicate warning toast in AddCase
- [ ] 50-02-PLAN.md — Import preview duplicate warnings + import route SSE warnings

### Phase 51: LLM Semantic Tier
**Goal**: Projects with a configured LLM integration can optionally run semantic analysis on candidate pairs to reduce false positives
**Depends on**: Phase 48
**Requirements**: DET-06, DET-07
**Success Criteria** (what must be TRUE):
  1. When a project has an LLM integration configured, the scan worker runs a semantic analysis pass on pairs that pass the fuzzy gate
  2. LLM analysis batches multiple pairs per call and respects a configurable maximum pairs cap per scan
  3. When no LLM integration is configured, the scan completes using fuzzy scoring only — no error or degraded behavior
**Plans:** 3 plans

Plans:

- [ ] 51-01-PLAN.md — DUPLICATE_DETECTION LLM constant + detectionMethod schema field
- [ ] 51-02-PLAN.md — DuplicateAnalysisService with TDD (batching, fallback, confirm/reject logic)
- [ ] 51-03-PLAN.md — Wire LLM semantic pass into duplicateScanWorker

### Phase 52: Testing, Documentation, and Notification
**Goal**: The feature is fully tested, documented for users, and surfaced via an upgrade notification
**Depends on**: Phase 51
**Requirements**: TEST-01, TEST-02, TEST-03, DOC-01, DOC-02, NOTIF-01
**Success Criteria** (what must be TRUE):
  1. Unit tests cover similarity scoring algorithms, merge transaction logic, and scan service — all pass
  2. E2E tests cover the full duplicate scan workflow: trigger scan, view results, merge a pair, link a pair, dismiss a pair
  3. E2E tests cover creation-time duplicate warning display after saving a case
  4. User-facing documentation explains the two-tier detection approach (fuzzy + optional LLM) and how to configure and use it
  5. Users upgrading to v0.19.0 see an upgrade notification surfacing the duplicate detection feature
**Plans**: TBD

## Progress

**Execution Order:** 47 → 48 → 49 → 50 → 51 → 52

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 47. Detection Foundation | 2/3 | Complete    | 2026-03-23 | - |
| 48. Async Project-Wide Scan | 3/3 | Complete    | 2026-03-23 | - |
| 49. Resolution Engine | 3/3 | Complete    | 2026-03-24 | - |
| 50. Creation-Time and Import Warnings | 2/2 | Complete    | 2026-03-24 | - |
| 51. LLM Semantic Tier | v0.19.0 | 0/3 | Not started | - |
| 52. Testing, Documentation, and Notification | v0.19.0 | 0/TBD | Not started | - |
