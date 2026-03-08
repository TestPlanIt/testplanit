# Requirements: AI Bulk Auto-Tagging

**Defined:** 2026-03-07
**Core Value:** Users can quickly organize large numbers of test artifacts with meaningful tags without manual effort

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### LLM Feature (Backend)

- [x] **LLM-01**: System can analyze entity content (title, description, steps, custom field values) and suggest matching tags
- [x] **LLM-02**: System supports smart batching of entities based on estimated token count
- [x] **LLM-03**: AI can suggest both existing tags and new tags that don't exist yet
- [x] **LLM-04**: Prompt is configurable via the existing prompt config system (project > default > fallback)

### API

- [x] **API-01**: User can request AI tag suggestions for a set of entity IDs within a project
- [x] **API-02**: System processes large batches (50+) as background jobs with progress tracking; user can navigate away and return to check status
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

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Enhancements

- **ENH-01**: User can trigger AI tag suggestions for a single entity from entity detail view
- **ENH-02**: System learns from user's accept/reject patterns to improve suggestions over time
- **ENH-03**: Cross-project tagging support

## Out of Scope

| Feature | Reason |
|---------|--------|
| Auto-apply without review | Users must always confirm before tags are applied |
| Cross-project tagging | Tags are meaningful within project context; adds complexity |
| Tag hierarchy/taxonomy | Separate feature, not related to AI suggestion |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

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

**Coverage:**
- v1 requirements: 15 total
- Mapped to phases: 15
- Unmapped: 0

---
*Requirements defined: 2026-03-07*
*Last updated: 2026-03-07 after roadmap creation*
