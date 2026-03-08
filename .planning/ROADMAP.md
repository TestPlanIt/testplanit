# Roadmap: AI Bulk Auto-Tagging

## Overview

Deliver AI-powered bulk tagging for test cases, test runs, and sessions. The build progresses from backend LLM analysis logic, through API/background processing, to the review UI, and finally wiring entry points into existing list views and the tags management page. Each phase delivers a coherent, testable capability that the next phase builds on.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: LLM Tag Analysis** - Backend service that analyzes entity content and produces tag suggestions with smart batching (completed 2026-03-07)
- [x] **Phase 2: API and Background Processing** - API routes for requesting suggestions, background job processing for large batches, and bulk apply endpoint (completed 2026-03-07)
- [x] **Phase 3: Review Dialog** - UI component for reviewing, accepting/rejecting, and applying AI-suggested tags (completed 2026-03-08)
- [x] **Phase 4: Entry Point Integrations** - Wire AI tagging into bulk action menus on list views and the tags management page (completed 2026-03-08)

## Phase Details

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

## Progress

**Execution Order:**
Phases execute in numeric order: 1 > 2 > 3 > 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. LLM Tag Analysis | 2/2 | Complete | 2026-03-07 |
| 2. API and Background Processing | 2/2 | Complete | 2026-03-07 |
| 3. Review Dialog | 2/2 | Complete | 2026-03-08 |
| 4. Entry Point Integrations | 3/3 | Complete | 2026-03-08 |
